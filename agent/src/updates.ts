import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile,writeFile,rename,lstat,mkdir} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {dirname} from "node:path";
const exec=promisify(execFile);
const REPO="developeronesw/DevOne-Server-Software";
const STATUS_FILE="/var/lib/devone-agent/update-status.json";
const WORKER="/usr/local/lib/devone/update-worker.sh";
const SOURCE="/opt/devone/current";
const HEAD_API="https://api.github.com/repos/"+REPO+"/git/ref/heads/main";
const RUNS_API="https://api.github.com/repos/"+REPO+"/commits/";
const SHA=/^[0-9a-f]{40}$/;
type Check={name:string;status:string;conclusion:string|null};
type Remote={sha:string;checks:Check[];approved:boolean};
export type UpdateStatus={currentSha:string;latestSha:string|null;updateAvailable:boolean;approved:boolean;checks:Check[];checkedAt:string|null;workerInstalled:boolean;update:{state:string;target:string;updatedAt:string}|null;error:string|null};
type Dependencies={fetchJson?:(url:string)=>Promise<any>;run?:(command:string,args:string[])=>Promise<string>;readStatus?:()=>Promise<any>;writeStatus?:(status:any)=>Promise<void>;workerReady?:()=>Promise<boolean>;launch?:(target:string)=>Promise<void>};
const errorCode=(e:unknown)=>e instanceof Error?e.message:"update_check_unavailable";
async function githubJson(url:string){
 const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(7500),headers:{"Accept":"application/vnd.github+json","User-Agent":"DevOne-Server-Updater","X-GitHub-Api-Version":"2022-11-28"}});
 if(!response.ok)throw Error(response.status===403||response.status===429?"github_rate_limited":"github_unavailable");
 return response.json();
}
async function command(binary:string,args:string[]){
 const {stdout}=await exec(binary,args,{timeout:9000,maxBuffer:8192,env:{PATH:"/usr/bin:/bin",LC_ALL:"C"}});
 return stdout.trim();
}
async function readStatus(){
 try{
  const st=await lstat(STATUS_FILE);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o077)!==0||st.size>2048)throw Error("unsafe_update_status");
  const data=JSON.parse(await readFile(STATUS_FILE,"utf8"));
  if(!data||!["queued","running","succeeded","failed"].includes(data.state)||!SHA.test(data.target)||typeof data.updatedAt!=="string")throw Error("invalid_update_status");
  return {state:data.state,target:data.target,updatedAt:data.updatedAt};
 }catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}
}
async function writeStatus(data:any){
 await mkdir(dirname(STATUS_FILE),{recursive:true,mode:0o700});
 const tmp=STATUS_FILE+"."+randomUUID();
 await writeFile(tmp,JSON.stringify(data),{mode:0o600,flag:"wx"});
 await rename(tmp,STATUS_FILE);
}
async function workerReady(){
 try{const st=await lstat(WORKER);return st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&(st.mode&0o022)===0&&(st.mode&0o100)!==0;}catch{return false;}
}
async function launch(target:string){
 const unit="devone-update-"+target.slice(0,12)+"-"+Date.now();
 await exec("/usr/bin/systemd-run",["--collect","--unit="+unit,"--property=Type=exec","/usr/bin/bash",WORKER,target],{timeout:12000,maxBuffer:4096});
}
export class UpdatesManager{
 private cache:{when:number;value:Remote}|null=null;
 private applying=false;
 constructor(private deps:Dependencies={}){}
 private async local(){
  const sha=await (this.deps.run??command)("/usr/bin/git",["-C",SOURCE,"rev-parse","HEAD"]);
  if(!SHA.test(sha))throw Error("invalid_installed_commit");
  return sha;
 }
 private async remote(force=false):Promise<Remote>{
  if(!force&&this.cache&&Date.now()-this.cache.when<120000)return this.cache.value;
  const fetcher=this.deps.fetchJson??githubJson;
  const head=await fetcher(HEAD_API);
  const sha=head?.object?.sha;
  if(typeof sha!=="string"||!SHA.test(sha))throw Error("invalid_remote_commit");
  const checksData=await fetcher(RUNS_API+sha+"/check-runs?per_page=100");
  const checks=(Array.isArray(checksData?.check_runs)?checksData.check_runs:[])
    .filter((x:any)=>typeof x?.name==="string"&&["validate","installer"].includes(x.name))
    .map((x:any)=>({name:x.name,status:String(x.status??"unknown"),conclusion:typeof x.conclusion==="string"?x.conclusion:null})) as Check[];
  // Both required checks must have exactly one unambiguous successful result.
  const approved=["validate","installer"].every(name=>checks.filter(check=>check.name===name).length===1&&checks.find(check=>check.name===name)?.status==="completed"&&checks.find(check=>check.name===name)?.conclusion==="success");
  const value={sha,checks,approved};
  this.cache={when:Date.now(),value};
  return value;
 }
 async status(force=false):Promise<UpdateStatus>{
  const currentSha=await this.local();
  const update=await (this.deps.readStatus??readStatus)();
  const workerInstalled=await (this.deps.workerReady??workerReady)();
  try{
   const remote=await this.remote(force);
   return {currentSha,latestSha:remote.sha,updateAvailable:remote.sha!==currentSha,approved:remote.approved,checks:remote.checks,checkedAt:new Date().toISOString(),workerInstalled,update,error:null};
  }catch(e){
   return {currentSha,latestSha:null,updateAvailable:false,approved:false,checks:[],checkedAt:null,workerInstalled,update,error:errorCode(e)};
  }
 }
 async start(target:unknown){
  if(this.applying)throw Error("update_busy");
  if(typeof target!=="string"||!SHA.test(target))throw Error("invalid_update_target");
  this.applying=true;
  try{
   const status=await this.status(true);
   if(status.error)throw Error(status.error);
   if(!status.workerInstalled)throw Error("update_worker_missing");
   if(status.update?.state==="running"||status.update?.state==="queued")throw Error("update_busy");
   if(!status.approved)throw Error("release_checks_not_passed");
   if(!status.updateAvailable||status.latestSha!==target)throw Error("update_target_changed");
   const stamp={state:"queued",target,updatedAt:new Date().toISOString()};
   await (this.deps.writeStatus??writeStatus)(stamp);
   try{await (this.deps.launch??launch)(target);}
   catch(e){
    await (this.deps.writeStatus??writeStatus)({state:"failed",target,updatedAt:new Date().toISOString()});
    throw e;
   }
   return stamp;
  }finally{this.applying=false;}
 }
}
