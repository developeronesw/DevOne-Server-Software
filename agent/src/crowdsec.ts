// Passive CrowdSec readiness inventory. No installation, service mutation or
// arbitrary commands. A present file is not proof its contents are valid.
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {lstat} from "node:fs/promises";
const exec=promisify(execFile);
async function safeExec(binary:string,args:string[],timeout=3500):Promise<string|null>{
 try{const data=await exec(binary,args,{timeout,maxBuffer:8192,env:{PATH:"/usr/sbin:/usr/bin:/sbin:/bin",LC_ALL:"C"}});return(data.stdout||data.stderr||"").trim();}
 catch{return null;}
}
async function regular(path:string):Promise<boolean>{
 try{const s=await lstat(path);return s.isFile()&&!s.isSymbolicLink();}catch{return false;}
}
export async function crowdSecReadiness(){
 const [engine,version,collection,bouncer,appsecConfig,appsecService]=await Promise.all([
  safeExec("/usr/bin/systemctl",["is-active","crowdsec"]),
  safeExec("/usr/bin/cscli",["version"]),
  regular("/etc/crowdsec/acquis.yaml"),
  regular("/etc/crowdsec/bouncers/crowdsec-nginx-bouncer.conf"),
  regular("/etc/crowdsec/acquis.d/appsec.yaml"),
  safeExec("/usr/bin/systemctl",["is-active","nginx"])
 ]);
 return crowdSecReport({engine,version,collection,bouncer,appsecConfig,appsecService});
}
export function crowdSecReport(signals:{engine:string|null;version:string|null;collection:boolean;bouncer:boolean;appsecConfig:boolean;appsecService:string|null}){
 const {engine,version,collection,bouncer,appsecConfig,appsecService}=signals;
 const installed=version!==null;
 const active=engine==="active";
 const nginxActive=appsecService==="active";
 return {
  checkedAt:new Date().toISOString(),
  phase:"detection-readiness",
  installed,engineActive:active,nginxActive,
  nginxBouncerConfigPresent:bouncer,
  appSecAcquisitionPresent:appsecConfig,
  logAcquisitionFilePresent:collection,
  enforcementVerified:false,
  appSecVerified:false,
  effectiveRequestProtection:"unknown",
  guidance:[
   "Install the CrowdSec Security Engine from its signed package repository in a reviewed maintenance window.",
   "Configure and test NGINX log acquisition; detection alone does not block requests.",
   "Verify NGINX Lua module compatibility and install the official CrowdSec NGINX remediation component separately.",
   "Pilot AppSec acquisition and WAF rules on a disposable VPS in detection mode. Verify per-site exceptions and the panel bypass before enforcement.",
   "Run NGINX configuration tests, record a rollback snapshot and confirm false-positive behavior before enabling blocking."
  ],
  notes:["File presence is not validation of a configuration. No credentials or NGINX logs are exposed.","This is a read-only integration. The DevOne dashboard cannot yet install CrowdSec or turn on AppSec enforcement."]
 };
}
