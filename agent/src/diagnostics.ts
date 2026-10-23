import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const diagnosticTools=[
 {id:'disk-space',name:'Disk capacity',group:'performance',description:'Filesystem space and capacity for the managed server.',binary:'df',args:['--block-size=1','--output=source,size,used,avail,pcent,target','/','/var/lib/devone','/home/devone-sites']},
 {id:'disk-inodes',name:'Filesystem inodes',group:'performance',description:'Detect inode exhaustion even when disk space remains.',binary:'df',args:['--inodes','--output=source,itotal,iused,iavail,ipcent,target','/','/var/lib/devone','/home/devone-sites']},
 {id:'memory',name:'Memory and swap',group:'performance',description:'Read current memory and swap usage in bytes.',binary:'free',args:['--bytes','--wide']},
 {id:'failed-services',name:'Failed services',group:'recovery',description:'List failed systemd units without restarting anything.',binary:'systemctl',args:['--failed','--no-pager','--plain','--no-legend']},
 {id:'nginx-check',name:'Validate NGINX',group:'hosting',description:'Test NGINX configuration without reloading the server.',binary:'nginx',args:['-t']},
 {id:'php-check',name:'Validate PHP-FPM',group:'hosting',description:'Test PHP 8.3-FPM configuration without changing pools.',binary:'php-fpm8.3',args:['-t']},
 {id:'redis-ping',name:'Redis connectivity',group:'hosting',description:'Check the local Redis listener. Authentication requirements are reported, not bypassed.',binary:'redis-cli',args:['-h','127.0.0.1','-p','6379','PING']},
 {id:'package-audit',name:'Package consistency',group:'recovery',description:'Read dpkg audit findings. Does not configure, repair or install packages.',binary:'dpkg',args:['--audit']},
 {id:'listeners',name:'Listening TCP ports',group:'security',description:'Inspect TCP listening addresses without process command lines.',binary:'ss',args:['-ltn']},
 {id:'api-log',name:'API warnings',group:'logs',description:'Last 100 warning-level API journal records from the past hour.',binary:'journalctl',args:['--unit=devone-api.service','--priority=warning','--since=-1hour','--lines=100','--no-pager','--output=short-iso']},
 {id:'agent-log',name:'Agent warnings',group:'logs',description:'Last 100 warning-level Agent journal records from the past hour.',binary:'journalctl',args:['--unit=devone-agent.service','--priority=warning','--since=-1hour','--lines=100','--no-pager','--output=short-iso']},
 {id:'nginx-log',name:'NGINX warnings',group:'logs',description:'Last 100 warning-level NGINX service journal records from the past hour. Access logs are excluded.',binary:'journalctl',args:['--unit=nginx.service','--priority=warning','--since=-1hour','--lines=100','--no-pager','--output=short-iso']},
 {id:'redis-log',name:'Redis warnings',group:'logs',description:'Last 100 warning-level Redis service journal records from the past hour.',binary:'journalctl',args:['--unit=redis-server.service','--priority=warning','--since=-1hour','--lines=100','--no-pager','--output=short-iso']}
] as const;
type RunResult={stdout:string;stderr:string};
type Runner=(binary:string,args:string[])=>Promise<RunResult>;
export function diagnosticCatalog(){return diagnosticTools.map(({id,name,group,description})=>({id,name,group,description}));}
// Best-effort masking, not a guarantee that arbitrary application logs contain no secrets.
export function redactDiagnosticOutput(raw:string):string{
 return raw
 .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[PRIVATE KEY REDACTED]')
 .replace(/((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|devone_session)["']?\s*[:=]\s*)"(?:\\.|[^"\\])*"/gi,'$1[REDACTED]')
 .replace(/((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|devone_session)["']?\s*[:=]\s*)'(?:\\.|[^'\\])*'/gi,'$1[REDACTED]')
 .replace(/(Bearer\s+)[^\s"',;]+/gi,'$1[REDACTED]')
 .replace(/((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|devone_session)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,'$1[REDACTED]')
 .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@')
 .replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|AIza[a-zA-Z0-9_-]{20,}|OAH_INST_[a-zA-Z0-9]+)\b/g,'[REDACTED]')
 .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
}
export class Diagnostics{
 private active=0;
 constructor(private run:Runner=async(binary,args)=>{const r=await exec(binary,args,{timeout:8000,maxBuffer:65536,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',LANG:'C',SYSTEMD_COLORS:'0',SYSTEMD_PAGER:'cat'}});return {stdout:r.stdout,stderr:r.stderr};}){}
 async execute(input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1)throw Error('invalid_diagnostic');
  const tool=diagnosticTools.find(t=>t.id===(input as {toolId?:unknown}).toolId);
  if(!tool)throw Error('invalid_diagnostic');
  if(this.active>=2)throw Error('diagnostics_busy');
  this.active++;
  const started=Date.now();
  try{
   try{
    const result=await this.run(tool.binary,[...tool.args]);
    const text=result.stdout+ (result.stderr?'\n'+result.stderr:'');
    return {toolId:tool.id,checkedAt:new Date().toISOString(),durationMs:Date.now()-started,status:'completed',exitCode:0,output:redactDiagnosticOutput(text).slice(0,24000),truncated:text.length>24000,readOnly:true};
   }catch(e){
    const error=e as {code?:unknown;stdout?:unknown;stderr?:unknown;killed?:boolean};
    const text=[error.stdout,error.stderr].filter(v=>typeof v==='string').join('\n');
    return {toolId:tool.id,checkedAt:new Date().toISOString(),durationMs:Date.now()-started,status:error.killed?'timed_out':error.code==='ENOENT'?'unavailable':'failed',exitCode:typeof error.code==='number'?error.code:null,output:redactDiagnosticOutput(text).slice(0,24000),truncated:text.length>24000,readOnly:true};
   }
  }finally{this.active--;}
 }
}
