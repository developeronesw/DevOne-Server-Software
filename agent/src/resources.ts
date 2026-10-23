import {cpus,loadavg,totalmem,uptime} from 'node:os';
import {readFile,lstat,statfs} from 'node:fs/promises';
export function parseMemory(text:string){
 const fields=new Map(text.split('\n').map(line=>{const m=/^(\w+):\s+(\d+) kB$/.exec(line.trim());return m?[m[1]!,Number(m[2])*1024] as const:['',0] as const;}));
 const total=fields.get('MemTotal'),available=fields.get('MemAvailable'),swapTotal=fields.get('SwapTotal'),swapFree=fields.get('SwapFree');
 if(!total||available===undefined||available>total||swapTotal===undefined||swapFree===undefined||swapFree>swapTotal)return null;
 return {totalBytes:total,availableBytes:available,usedPercent:Number((100*(1-available/total)).toFixed(1)),swapTotalBytes:swapTotal,swapUsedBytes:swapTotal-swapFree};
}
export async function resourceSnapshot(){
 const [memory,disks,reboot]=await Promise.all([
  readFile('/proc/meminfo','utf8').then(parseMemory).catch(()=>null),
  Promise.all(['/','/var/lib/devone','/home/devone-sites'].map(async path=>{
   try{
    const fs=await statfs(path);const total=fs.blocks*fs.bsize,available=fs.bavail*fs.bsize;
    return {path,status:'known' as const,totalBytes:total,availableBytes:available,usedPercent:total?Number((100*(1-fs.bfree/fs.blocks)).toFixed(1)):null,inodesTotal:fs.files,inodesFree:fs.ffree,inodesUsedPercent:fs.files?Number((100*(1-fs.ffree/fs.files)).toFixed(1)):null};
   }catch{return {path,status:'unknown' as const};}
  })),
  lstat('/var/run/reboot-required').then(()=>true).catch((e:NodeJS.ErrnoException)=>e.code==='ENOENT'?false:null)
 ]);
 const cores=cpus().length,load=loadavg();
 return {checkedAt:new Date().toISOString(),cpu:{cores,load,loadPerCore:cores?Number(((load[0]??0)/cores).toFixed(2)):null},memory:memory??{totalBytes:totalmem(),availableBytes:null,usedPercent:null,swapTotalBytes:null,swapUsedBytes:null},disks,rebootRequired:reboot,uptimeSeconds:uptime(),scope:'current-resource-observation',productionReady:false};
}
