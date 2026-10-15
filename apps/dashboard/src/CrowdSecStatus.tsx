import {useEffect,useState} from "react";
type CrowdSec={checkedAt:string;phase:string;installed:boolean;engineActive:boolean;nginxActive:boolean;nginxBouncerConfigPresent:boolean;appSecAcquisitionPresent:boolean;logAcquisitionFilePresent:boolean;enforcementVerified:boolean;appSecVerified:boolean;guidance:string[];notes:string[]};
export function CrowdSecStatus(){
 const [data,setData]=useState<CrowdSec|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 async function refresh(){
  setLoading(true);setError("");
  try{
   const response=await fetch("/api/security/crowdsec",{credentials:"same-origin",cache:"no-store"});
   if(!response.ok)throw Error("CrowdSec status cannot be verified.");
   setData(await response.json() as CrowdSec);
  }catch(e){setError(e instanceof Error?e.message:"Integration unavailable");}finally{setLoading(false);}
 }
 useEffect(()=>{void refresh();},[]);
 const states=data?[{label:"Security Engine installed",value:data.installed},{label:"Security Engine running",value:data.engineActive},{label:"NGINX is running",value:data.nginxActive},{label:"NGINX bouncer configuration detected",value:data.nginxBouncerConfigPresent},{label:"AppSec acquisition configuration detected",value:data.appSecAcquisitionPresent}]:[];
 return <article className="surface-card glass crowdsec-console">
  <div className="section-heading"><div><h2>CrowdSec / AppSec readiness</h2><p>Host integration assessment before enabling third-party WAF enforcement</p></div><button className="ops-secondary" onClick={()=>void refresh()} disabled={loading}>{loading?"Checking…":"Refresh status"}</button></div>
  <p className="ops-note">CrowdSec detection, its NGINX remediation component and AppSec payload inspection are separate components. This page inspects readiness only and does not install packages, activate blocking or alter customer traffic.</p>
  <div className="crowdsec-steps">{states.map(item=><div key={item.label}><span>{item.label}</span><strong className={"state-chip "+(item.value?"good":"neutral")}>{item.value?"Detected":"Not verified"}</strong></div>)}</div>
  {data&&<><p className="ops-warning">Request enforcement: not verified. WAF payload inspection: not verified. Configuration-file presence does not prove rules are active or functioning.</p><h3>Next deployment checks</h3><ol className="crowdsec-guide">{data.guidance.map(line=><li key={line}>{line}</li>)}</ol></>}
  <p className="ops-subtext">Official installation and integration instructions: <a href="https://docs.crowdsec.net/u/getting_started/installation/linux/" target="_blank" rel="noopener noreferrer">CrowdSec Security Engine ↗</a> · <a href="https://docs.crowdsec.net/docs/bouncers/nginx/" target="_blank" rel="noopener noreferrer">NGINX remediation component ↗</a></p>
  {error&&<p role="alert" className="inline-error">{error}</p>}
 </article>;
}
