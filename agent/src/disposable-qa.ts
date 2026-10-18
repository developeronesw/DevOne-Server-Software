import {randomBytes,randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {SiteManager} from "./sites.js";
import {softwareStatus} from "./software.js";

const runCommand=promisify(execFile);
export type DisposableResult={name:string;status:"pass"|"fail"|"blocked";detail:string;siteId?:string;cleaned?:boolean};
export type DisposableStatus={id:string;state:"running"|"passed"|"failed";startedAt:string;finishedAt?:string;results:DisposableResult[];warning:string};
const fixtures={
 static:{path:"index.html",code:(marker:string)=>"<!doctype html><title>DevOne QA</title>"+marker},
 files:{path:"readme.txt",code:(marker:string)=>"DevOne QA: "+marker},
 php:{path:"index.php",code:(marker:string)=>"<?php header('Content-Type: text/plain'); echo '"+marker+"';"},
 node:{path:"server.mjs",code:(marker:string)=>"import {createServer} from 'node:http'; createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain'});res.end('"+marker+"');}).listen(Number(process.env.PORT),process.env.HOST);"},
 python:{path:"app.py",code:(marker:string)=>"import os\nfrom wsgiref.simple_server import make_server\n\ndef app(environ,start_response):\n start_response('200 OK',[('Content-Type','text/plain')]); return [b'"+marker+"']\nmake_server(os.environ['HOST'],int(os.environ['PORT']),app).serve_forever()\n"},
 container:{path:"index.html",code:(marker:string)=>"<!doctype html><title>DevOne container QA</title>"+marker}
} as const;
const versions={php:"8.3",node:"22",python:"3.12"} as const;
const types=["static","files","php","node","python","container"] as const;
export class DisposableHostQa {
 private current:DisposableStatus|null=null;
 private busy=false;
 constructor(private sites:SiteManager){}
 status(){return this.current?{...this.current,results:this.current.results.map(x=>({...x}))}:{state:"not_run",results:[],warning:"Disposable QA has never run."};}
 start(){
  if(this.busy)throw Error("qa_disposable_busy");
  this.busy=true;
  const id=randomUUID(),status:DisposableStatus={id,state:"running",startedAt:new Date().toISOString(),results:[],
   warning:"Creates temporary DevOne sites and a container-only package install test. Only QA-created resources are automatically deleted."};
  this.current=status;
  void this.execute(status).catch(()=>{status.results.push({name:"qa.runner",status:"fail",detail:"Runner unexpectedly failed; inspect QA-owned test sites before retrying."});})
    .finally(()=>{status.finishedAt=new Date().toISOString();status.state=status.results.every(x=>x.status==="pass")?"passed":"failed";this.busy=false;});
  return {id,state:"running" as const};
 }
 private async execute(status:DisposableStatus){
  const stamp=randomBytes(8).toString("hex");
  for(const type of types){
   let created:{id:string;domain:string;revision?:number}|null=null;
   let pass=false,detail="unverified",cleaned=false;
   const marker="DEVONE_QA_"+stamp+"_"+type;
   try{
    const domain="qa-"+stamp+"-"+type+".invalid";
    created=await this.sites.create({domain,siteType:type,webServer:type==="files"?"none":"nginx",
      ...(type in versions?{runtimeVersion:versions[type as keyof typeof versions]}:{})});
    const fixture=fixtures[type];
    await this.sites.files({siteId:created.id,operation:"create",path:fixture.path,
      content:Buffer.from(fixture.code(marker)).toString("base64")});
    if(type==="files"){
      const read=await this.sites.files({siteId:created.id,operation:"read",path:fixture.path}) as {content:string};
      pass=Buffer.from(read.content,"base64").toString("utf8").includes(marker);
    }else{
      if(type==="node"||type==="python"||type==="container"){
        await this.sites.action({siteId:created.id,action:"start",expectedRevision:created.revision??1});
      }
      const response=await fetch("http://127.0.0.1/",{
        headers:{Host:domain},signal:AbortSignal.timeout(10000),redirect:"manual"});
      const body=await response.text();
      pass=response.status===200&&body.includes(marker);
    }
    detail=pass?"Created isolated site, wrote source, verified real response/content.":"Unexpected website response or file contents.";
   }catch(e){
    detail=e instanceof Error&&/^(php83_runtime_not_running|node22_runtime_not_available|python312_runtime_not_available|docker_runtime_not_running|site_provisioning_requires_inspection|runtime_entry_missing|runtime_not_healthy)$/.test(e.message)?e.message:"Website creation, execution, or HTTP check failed; inspect QA sites and host logs.";
   }finally{
    if(created){
      try{
        await this.sites.action({siteId:created.id,action:"delete",expectedRevision:created.revision??1,confirmDomain:created.domain});
        cleaned=true;
      }catch{detail+=" Cleanup failed; site preserved for manual recovery.";cleaned=false;}
    }
    status.results.push({name:"site."+type,status:pass&&cleaned?"pass":"fail",detail,siteId:created?.id,cleaned});
   }
  }
  // Package installation is isolated INSIDE a disposable Docker container. Host
  // PHP, Redis and Docker packages are NEVER removed or replaced by this test.
  try{
   const inventory=await softwareStatus();
   const missing=inventory.packages.filter(p=>!p.installed||!p.serviceActive).map(p=>p.package);
   status.results.push({name:"software.host_inventory",status:missing.length?"blocked":"pass",
    detail:missing.length?"Missing/inactive host packages: "+missing.join(", "):"PHP-FPM, Redis and Docker are installed and active; no host packages modified."});
   if(missing.includes("docker.io"))return;
   const name="devone-qa-packages-"+stamp;
   const args=["run","--rm","--name",name,"--label","devone.qa="+stamp,
     "--pids-limit","96","--memory","512m","--cpus","1","--cap-drop=ALL",
     "--cap-add=CHOWN","--cap-add=FOWNER","--cap-add=SETUID","--cap-add=SETGID","--cap-add=DAC_OVERRIDE",
     "--security-opt","no-new-privileges","ubuntu:24.04","/bin/sh","-c",
     "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends php8.3-cli redis-server python3.12 && php -v >/dev/null && redis-server --version >/dev/null && python3.12 --version >/dev/null"];
   try{
    await runCommand("/usr/bin/docker",args,{timeout:480000,maxBuffer:4194304});
    status.results.push({name:"software.isolated_install",status:"pass",detail:"Installed and executed PHP, Redis, Python inside disposable Ubuntu Docker container; --rm removed it, host packages untouched.",cleaned:true});
   }catch{
    // Cleanup only the fixed, QA-owned name/label, never unknown containers.
    const inspect=await runCommand("/usr/bin/docker",["inspect","--format","{{index .Config.Labels \"devone.qa\"}}",name],{timeout:10000,maxBuffer:1024}).catch(()=>null);
    let cleaned=!inspect;
    if(inspect?.stdout.trim()===stamp){
      cleaned=await runCommand("/usr/bin/docker",["rm","-f",name],{timeout:15000,maxBuffer:1024}).then(()=>true).catch(()=>false);
    }else if(inspect){cleaned=false;}
    status.results.push({name:"software.isolated_install",status:"fail",detail:"Container package installation or validation failed; inspect Docker access, registry connectivity, or APT logs on the development VPS.",cleaned});
   }
  }catch{
   status.results.push({name:"software.isolated_install",status:"fail",detail:"Could not check installed software or run isolated package test."});
  }
 }
}
