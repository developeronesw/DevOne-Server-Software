// Read-only, bounded host hardening checks. Not an active penetration test or CVE scanner.
// Never accept commands, paths or ports from a browser request.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstatSync } from "node:fs";
const run=promisify(execFile);
export type Finding={id:string;title:string;severity:"high"|"medium"|"low"|"info";status:"pass"|"warning"|"unknown";detail:string;recommendation:string};
async function command(binary:string,args:string[],timeout=4500):Promise<string|null>{
  try{const r=await run(binary,args,{timeout,maxBuffer:131072,env:{PATH:"/usr/sbin:/usr/bin:/sbin:/bin",LC_ALL:"C"}});return (r.stdout||r.stderr).slice(0,131072);}
  catch{return null;}
}
function add(list:Finding[],id:string,title:string,severity:Finding["severity"],status:Finding["status"],detail:string,recommendation:string){list.push({id,title,severity,status,detail,recommendation});}
function parseSshConfig(config:string|null){
 if(config===null)return null;
 const options=new Map<string,string>();
 for(const line of config.split("\n")){
   const parts=line.trim().split(/\s+/);
   if(parts.length>=2)options.set(parts[0].toLowerCase(),parts.slice(1).join(" ").toLowerCase());
 }
 return options;
}
function publicSockets(text:string|null){
 if(text===null)return null;
 const unique=new Set<number>();
 for(const line of text.split("\n")){
  const fields=line.trim().split(/\s+/);
  const addr=fields.length>=4?fields[3]:"";
  const match=addr.match(/^(?:0\.0\.0\.0|\*|\[::\]|\[::0\]|::):(\d+)$/);
  if(match){const port=Number(match[1]);if(Number.isInteger(port)&&port>0&&port<=65535)unique.add(port);}
 }
 return [...unique].sort((a,b)=>a-b);
}
export async function inspectSecurity():Promise<{checkedAt:string;mode:string;findings:Finding[];summary:{warnings:number;passed:number;unknown:number};limitations:string[]}>{
 const findings:Finding[]=[];
 const [ufw,sshd,ports,packages]=await Promise.all([
   command("/usr/sbin/ufw",["status"]),
   command("/usr/sbin/sshd",["-T"]),
   command("/usr/bin/ss",["-ltnH"]),
   command("/usr/bin/apt",["list","--upgradable"],7000)
 ]);
 if(ufw===null)add(findings,"firewall","Host firewall","medium","unknown","UFW status could not be verified.","Review UFW and your cloud provider's security groups.");
 else if(/Status:\s*active/i.test(ufw))add(findings,"firewall","Host firewall","medium","pass","UFW reports active.","Maintain least-privilege inbound rules.");
 else add(findings,"firewall","Host firewall","medium","warning","UFW reports inactive. Cloud security groups may still filter traffic.","Verify AWS security groups and enable a tested host firewall without locking out SSH.");
 const opts=parseSshConfig(sshd);
 if(!opts)add(findings,"ssh","SSH authentication hardening","high","unknown","Effective sshd configuration could not be evaluated.","Check SSH server installation and effective root/password login policies.");
 else{
  const root=opts.get("permitrootlogin");
  const password=opts.get("passwordauthentication");
  const rootSafe=root==="no"||root==="prohibit-password"||root==="forced-commands-only";
  add(findings,"ssh-root","SSH root login","high",rootSafe?"pass":"warning",root===undefined?"Effective root-login value unavailable.":"Effective root login: "+root, "Disable direct root SSH access when feasible.");
  add(findings,"ssh-password","SSH password authentication","medium",password==="no"?"pass":"warning",password===undefined?"Effective password-authentication value unavailable.":"Effective password authentication: "+password,"Prefer SSH keys; test access before disabling passwords.");
 }
 const exposed=publicSockets(ports);
 if(exposed===null)add(findings,"ports","Public listening ports","medium","unknown","Socket inventory could not be read.","Inspect public listeners with ss and provider firewall rules.");
 else{
  const unexpected=exposed.filter(p=>![22,80,443].includes(p));
  add(findings,"ports","Public listening ports","high",unexpected.length?"warning":"pass",unexpected.length?"Additional all-interface TCP listener ports detected: "+unexpected.join(", "):"Only expected HTTP/HTTPS/SSH ports (or none) are listening on all interfaces.","Verify every public listener is intended; restrict database/admin ports using firewall rules. This is not an external exposure test.");
 }
 try{
  const info=lstatSync("/etc/devone/secrets.key");
  const ok=info.isFile()&&(info.mode&0o007)===0;
  add(findings,"vault-key","DevOne encryption key","high",ok?"pass":"warning",ok?"Vault key is not readable by other local users.":"Vault key permissions or file type require review.","Limit the master key to privileged accounts; do not change it without a backup.");
 }catch{add(findings,"vault-key","DevOne encryption key","high","unknown","Unable to inspect vault key.","Check /etc/devone/secrets.key securely on the host.");}
 const lines=packages?.split("\n").filter(s=>/\/[a-z-]+ .+ \[upgradable from:/.test(s))??[];
 if(packages===null)add(findings,"patches","Available package upgrades","medium","unknown","APT could not read upgrade inventory.","Run apt update and review security updates during a maintenance window.");
 else add(findings,"patches","Available package upgrades","medium",lines.length?"warning":"pass",lines.length?lines.length+" installed packages report newer candidate versions.":"APT package metadata reports no upgradable packages.","Review and schedule updates; this does not confirm CVE exposure or fresh package indexes.");
 return {checkedAt:new Date().toISOString(),mode:"passive-local-baseline",findings,summary:{warnings:findings.filter(f=>f.status==="warning").length,passed:findings.filter(f=>f.status==="pass").length,unknown:findings.filter(f=>f.status==="unknown").length},
   limitations:["No remote network penetration test performed.","No CVE feed, package advisory correlation or web application vulnerability scan performed.","AWS security groups and external CDN policies are not observable by the local Agent.","Unknown results are not proof of safety."]};
}
export const securityParsers={parseSshConfig,publicSockets};
