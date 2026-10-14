import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listServices } from "./services.js";
const run = promisify(execFile);
// Inventory is read-only; binaries and arguments are hard-coded. No shell or user input.
const runtimeTools = [
  {name:"Node.js",binary:"node",args:["--version"],category:"app"},
  {name:"Python",binary:"python3",args:["--version"],category:"app"},
  {name:"PHP",binary:"php",args:["--version"],category:"app"},
  {name:"Docker",binary:"docker",args:["--version"],category:"app"},
  {name:"Git",binary:"git",args:["--version"],category:"app"},
  {name:"MariaDB",binary:"mariadb",args:["--version"],category:"database"},
  {name:"MySQL",binary:"mysql",args:["--version"],category:"database"},
  {name:"PostgreSQL",binary:"psql",args:["--version"],category:"database"},
  {name:"Redis",binary:"redis-server",args:["--version"],category:"database"}
] as const;
async function version(binary:string,args:readonly string[]){
  try{
    const result=await run(binary,[...args],{timeout:1800,maxBuffer:8192,env:{...process.env,LC_ALL:"C"}});
    const line=(result.stdout||result.stderr||"").split("\n")[0]?.trim()??"";
    return line.slice(0,160)||"Installed";
  }catch{return null;}
}
export async function discoverSoftware(){
  const [detected,services]=await Promise.all([
    Promise.all(runtimeTools.map(async tool=>({...tool,version:await version(tool.binary,tool.args)}))),
    listServices()
  ]);
  return {checkedAt:new Date().toISOString(),
    runtimes:detected.filter(x=>x.category==="app").map(x=>({name:x.name,installed:x.version!==null,version:x.version})),
    databases:detected.filter(x=>x.category==="database").map(x=>{
      const serviceName=x.name==="MariaDB"?"mariadb":x.name==="MySQL"?"mysql":x.name==="PostgreSQL"?"postgresql":"redis-server";
      const service=services.find(s=>s.service===serviceName);
      return {name:x.name,clientInstalled:x.version!==null,version:x.version,service:serviceName,serviceState:service?.ActiveState??"unknown"};
    }),
    capabilities:{applicationDeployments:false,databaseProvisioning:false,databaseRestore:false}
  };
}
