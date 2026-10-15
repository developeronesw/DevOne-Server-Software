import {execFile} from "node:child_process";
import {promisify} from "node:util";

// Read-only bridge to the existing host pilot. No user-supplied command, path,
// package name outside this fixed allowlist, or unattended package installation.
const exec = promisify(execFile);
export const runtimePackages = ["php8.3-fpm", "redis-server"] as const;
export type RuntimePackage = (typeof runtimePackages)[number];
export type RuntimePreflight = {
  package:RuntimePackage;
  status:"ready"|"blocked";
  installAvailable:false;
  reason:string;
};
type Runner=(binary:string,args:string[],options:{timeout:number;maxBuffer:number})=>Promise<{stdout:string;stderr:string}>;
const SCRIPT="/opt/devone/current/scripts/software-runtime-pilot.sh";

export function parseRuntimePreflight(input:unknown):RuntimePackage {
  if(!input || typeof input!=="object" || Array.isArray(input))throw Error("invalid_software_preflight");
  const body=input as Record<string,unknown>;
  if(Object.keys(body).length!==1 || !Object.hasOwn(body,"package") ||
    !runtimePackages.includes(body.package as RuntimePackage))
    throw Error("invalid_software_preflight");
  return body.package as RuntimePackage;
}

export function softwareCapabilities(){
  return {
    mode:"read-only-preflight",
    installAvailable:false,
    options:runtimePackages.map(name=>({
      package:name,
      label:name==="php8.3-fpm"?"PHP 8.3 FPM":"Redis Server",
      installAvailable:false
    })),
    notice:"Preflight only. No dashboard package installation, removal or upgrade is authorized."
  };
}

export async function softwarePreflight(input:unknown,run:Runner=exec):Promise<RuntimePreflight>{
  const name=parseRuntimePreflight(input);
  try {
    const result=await run("/usr/bin/bash",[SCRIPT,"--check",name],{timeout:45000,maxBuffer:65536});
    const signature="Software Center pilot preflight passed: "+name+" ";
    if(!result.stdout.includes(signature))return {
      package:name,status:"blocked",installAvailable:false,reason:"preflight_output_invalid"
    };
    return {package:name,status:"ready",installAvailable:false,reason:"apt_simulation_accepted"};
  }catch {
    // Do not return root command output, stderr or paths to the browser.
    return {package:name,status:"blocked",installAvailable:false,reason:"host_preflight_requirements_not_met"};
  }
}
