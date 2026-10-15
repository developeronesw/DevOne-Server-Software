// CrowdSec's local alerts and decisions are host-wide. Do not expose IPs, ranges,
// usernames, machine IDs, raw log messages, tokens or arbitrary CLI output.
import {execFile} from "node:child_process";
import {promisify} from "node:util";
const exec=promisify(execFile);
type Summary={available:boolean;sampleSize:number;scenarioCounts:Array<{name:string;count:number}>;decisionTypes:Array<{name:string;count:number}>;error:string|null};
function asRecords(raw:string|null):unknown[]|null{
 if(raw===null)return null;
 try{
  const data:unknown=JSON.parse(raw);
  if(!Array.isArray(data)||data.length>50)return null;
  return data;
 }catch{return null;}
}
function scenario(value:unknown):string{
 // Avoid echoing arbitrary custom strings/IPs into the dashboard.
 return typeof value==="string"&&/^crowdsecurity\/[a-zA-Z0-9_./-]{1,80}$/.test(value)&&!/(?:\d{1,3}\.){3}\d{1,3}/.test(value)?"crowdsecurity/"+value.slice("crowdsecurity/".length):"other/custom";
}
function action(value:unknown):string{
 return typeof value==="string"&&["ban","captcha","throttle"].includes(value.toLowerCase())?value.toLowerCase():"other";
}
export function summarizeCrowdSecEvents(alertsRaw:string|null,decisionsRaw:string|null){
 const alerts=asRecords(alertsRaw),decisions=asRecords(decisionsRaw);
 const groups=new Map<string,number>(),actions=new Map<string,number>();
 if(alerts)for(const row of alerts){
  if(!row||typeof row!=="object"||Array.isArray(row))continue;
  const name=scenario((row as {scenario?:unknown}).scenario);
  groups.set(name,(groups.get(name)??0)+1);
 }
 if(decisions)for(const row of decisions){
  if(!row||typeof row!=="object"||Array.isArray(row))continue;
  const name=action((row as {type?:unknown}).type);
  actions.set(name,(actions.get(name)??0)+1);
 }
 const order=(map:Map<string,number>)=>[...map].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,8);
 return {
  checkedAt:new Date().toISOString(),
  hostWide:true,
  window:"Recent local CLI samples; not an all-time count or per-site attribution",
  alerts:{available:alerts!==null,sampleSize:alerts?.length??0,scenarioCounts:order(groups),error:alerts===null?"alerts_unavailable":null},
  decisions:{available:decisions!==null,sampleSize:decisions?.length??0,decisionTypes:order(actions),error:decisions===null?"decisions_unavailable":null},
  enforcementVerified:false,
  notes:["CrowdSec decisions can exist without an active NGINX bouncer.","No source IP addresses, usernames, request payloads or raw logs are returned.","This host-wide sample cannot reliably attribute incidents to individual websites."]
 };
}
async function call(args:string[]):Promise<string|null>{
 try{
  const result=await exec("/usr/bin/cscli",args,{timeout:6000,maxBuffer:262144,env:{LC_ALL:"C",PATH:"/usr/sbin:/usr/bin:/sbin:/bin"}});
  return result.stdout;
 }catch{return null;}
}
export async function recentCrowdSecEvents(){
 const [alerts,decisions]=await Promise.all([
  call(["alerts","list","-o","json","-l","20"]),
  call(["decisions","list","-o","json","-l","50"])
 ]);
 return summarizeCrowdSecEvents(alerts,decisions);
}
