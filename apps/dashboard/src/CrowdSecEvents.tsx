import {useEffect,useState} from "react";
type Count={name:string;count:number};
type Sample={available:boolean;sampleSize:number;error:string|null;scenarioCounts?:Count[];decisionTypes?:Count[]};
type Report={checkedAt:string;hostWide:boolean;window:string;alerts:Sample;decisions:Sample;enforcementVerified:boolean;notes:string[]};
export function CrowdSecEvents(){
 const [report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function refresh(){
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/security/crowdsec/events",{credentials:"same-origin",cache:"no-store"});
   if(!response.ok)throw Error("Could not retrieve local CrowdSec activity");
   setReport(await response.json() as Report);
  }catch(e){setError(e instanceof Error?e.message:"Events unavailable");}
  finally{setBusy(false);}
 }
 useEffect(()=>{void refresh();},[]);
 return <section className="crowdsec-events" aria-label="Recent CrowdSec host activity">
  <div className="section-heading"><div><h3>Detection activity</h3><p>Recent host-wide CrowdSec sample · no customer IPs or raw request logs</p></div><button disabled={busy} className="ops-secondary" onClick={()=>void refresh()}>{busy?"Loading…":"Refresh activity"}</button></div>
  {report&&<><div className="crowdsec-activity-stats"><div><small>Sampled alerts</small><strong>{report.alerts.available?report.alerts.sampleSize:"Unknown"}</strong></div><div><small>Sampled decisions</small><strong>{report.decisions.available?report.decisions.sampleSize:"Unknown"}</strong></div><div><small>Enforcement</small><strong>Not verified</strong></div></div>
   <div className="crowdsec-activity-tables">
    <div><strong>Detected scenarios</strong>{report.alerts.available&&report.alerts.scenarioCounts?.length?report.alerts.scenarioCounts.map(x=><div className="crowdsec-activity-row" key={x.name}><span>{x.name}</span><b>{x.count}</b></div>):<p className="ops-subtext">{report.alerts.available?"No scenarios in recent sample":"Alert inventory unavailable"}</p>}</div>
    <div><strong>Decision types</strong>{report.decisions.available&&report.decisions.decisionTypes?.length?report.decisions.decisionTypes.map(x=><div className="crowdsec-activity-row" key={x.name}><span>{x.name}</span><b>{x.count}</b></div>):<p className="ops-subtext">{report.decisions.available?"No decisions in recent sample":"Decision inventory unavailable"}</p>}</div>
   </div>
   <p className="ops-note">These are limited samples, not totals or website-specific attack counts. A CrowdSec decision does not establish that a web bouncer or AppSec is enforcing blocks.</p>
  </>}
  {error&&<p role="alert" className="inline-error">{error}</p>}
 </section>;
}