import {execFile} from "node:child_process";
import {promisify} from "node:util";

const exec=promisify(execFile);
export const runtimePackages=["php8.3-fpm","redis-server","docker.io"] as const;
export type RuntimePackage=(typeof runtimePackages)[number];
export type RuntimePreflight={package:RuntimePackage;status:"ready"|"blocked";installAvailable:false;reason:string};
export type RuntimeState={package:RuntimePackage;installed:boolean;version:string|null;serviceActive:boolean};
type Runner=(binary:string,args:string[],options:{timeout:number;maxBuffer:number})=>Promise<{stdout:string;stderr:string}>;
const SCRIPT="/opt/devone/current/scripts/software-runtime-pilot.sh";
export const installFailureReasons=[
 "agent_permissions","unsupported_ubuntu","unsupported_architecture","install_lock_busy",
 "nginx_inactive","nginx_configuration_invalid","devone_service_inactive",
 "disk_inventory_failed","disk_space_low","apt_policy_unavailable","apt_candidate_unavailable",
 "candidate_sources_unavailable","repository_metadata_unavailable","repository_origin_unverified",
 "apt_simulation_failed","protected_package_change","apt_transaction_failed","nginx_postcheck_failed",
 "devone_postcheck_failed","package_service_inactive","redis_socket_check_failed","redis_exposed"
] as const;
export type InstallFailureReason=(typeof installFailureReasons)[number]|"unclassified";
export class SoftwareInstallFailure extends Error{
 constructor(public readonly reason:InstallFailureReason){
  super("software_install_requires_inspection");
  this.name="SoftwareInstallFailure";
 }
}
export function parseInstallFailure(stderr:unknown):InstallFailureReason{
 if(typeof stderr!=="string")return "unclassified";
 const match=stderr.match(/(?:^|\n)DEVONE_INSTALL_ERROR:([a-z0-9_]+)(?:\r?\n|$)/);
 if(!match)return "unclassified";
 return installFailureReasons.includes(match[1] as typeof installFailureReasons[number])
  ? match[1] as InstallFailureReason:"unclassified";
}

let installing=false;
export function parseRuntimePreflight(input:unknown):RuntimePackage{
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("invalid_software_preflight");
 const body=input as Record<string,unknown>;
 if(Object.keys(body).length!==1||!Object.hasOwn(body,"package")||
   !runtimePackages.includes(body.package as RuntimePackage))throw Error("invalid_software_preflight");
 return body.package as RuntimePackage;
}
export function parseRuntimeInstall(input:unknown):RuntimePackage{
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("invalid_software_install");
 const body=input as Record<string,unknown>;
 if(Object.keys(body).length!==2||body.confirmed!==true||
   !runtimePackages.includes(body.package as RuntimePackage))throw Error("invalid_software_install");
 return body.package as RuntimePackage;
}
export function softwareCapabilities(){
 return {
  mode:"managed-install",installAvailable:true,
  options:runtimePackages.map(name=>({
   package:name,label:name==="php8.3-fpm"?"PHP 8.3 FPM":name==="docker.io"?"Docker Engine":"Redis Server",installAvailable:true
  })),
  notice:"Owner-approved, audited installs of Ubuntu packages only. CMS/framework catalog entries are not deployable yet."
 };
}
export async function softwareStatus(run:Runner=exec):Promise<{packages:RuntimeState[];installAvailable:true}>{
 const packages=await Promise.all(runtimePackages.map(async name=>{
  let installed=false,version:string|null=null,serviceActive=false;
  try{
   const {stdout}=await run("/usr/bin/dpkg-query",["-W","-f=${Status} ${Version}",name],{timeout:4500,maxBuffer:4096});
   if(stdout.startsWith("install ok installed ")){
    const found=stdout.slice("install ok installed ".length).trim();
    if(found&&found.length<=100&&/^[a-zA-Z0-9.+~:-]+$/.test(found)){installed=true;version=found;}
   }
  }catch{}
  if(installed){
   try{
    const {stdout}=await run("/usr/bin/systemctl",["is-active",(name==="docker.io"?"docker":name)+".service"],{timeout:4500,maxBuffer:4096});
    serviceActive=stdout.trim()==="active";
   }catch{}
  }
  return {package:name,installed,version,serviceActive};
 }));
 return {packages,installAvailable:true};
}
export async function softwarePreflight(input:unknown,run:Runner=exec):Promise<RuntimePreflight>{
 const name=parseRuntimePreflight(input);
 try{
  const {stdout}=await run("/usr/bin/bash",[SCRIPT,"--check",name],{timeout:45000,maxBuffer:65536});
  if(!stdout.includes("Software Center pilot preflight passed: "+name+" "))
   return {package:name,status:"blocked",installAvailable:false,reason:"preflight_output_invalid"};
  return {package:name,status:"ready",installAvailable:false,reason:"apt_simulation_accepted"};
 }catch{return {package:name,status:"blocked",installAvailable:false,reason:"host_preflight_requirements_not_met"};}
}
export async function softwareInstall(input:unknown,run:Runner=exec):Promise<RuntimeState>{
 const name=parseRuntimeInstall(input);
 if(installing)throw Error("software_install_busy");
 installing=true;
 let phase="apt_install";
 try{
  // The Agent is a dedicated privileged service; no shell or user-supplied
  // commands. The fixed script performs policy checks before any mutation.
  await run("/usr/bin/bash",[SCRIPT,"--managed-install",name],{timeout:300000,maxBuffer:4194304});
  phase="verify_package_and_service";
  const info=(await softwareStatus(run)).packages.find(x=>x.package===name)!;
  if(!info.installed||!info.serviceActive)throw Error("software_install_requires_inspection");
  return info;
 }catch(error){
  const cause=error as Error&{code?:string|number;signal?:string;stderr?:string};
  const reason=phase==="verify_package_and_service"?"package_service_inactive":parseInstallFailure(cause?.stderr);
  // Log only allowlisted diagnostics. Never expose raw APT stderr, output, or
  // command arguments in browser responses or audit records.
  console.error("devone_software_install_requires_inspection",{
   package:name,phase,reason,
   exitCode:typeof cause?.code==="number"?cause.code:null,
   timedOut:cause?.signal==="SIGTERM"
  });
  throw new SoftwareInstallFailure(reason);
 }finally{installing=false;}
}
