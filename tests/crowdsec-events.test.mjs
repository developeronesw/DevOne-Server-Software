import {test} from "node:test";
import assert from "node:assert/strict";
import {summarizeCrowdSecEvents} from "../agent/dist/crowdsec-events.js";
test("event summaries include only bounded scenario/type aggregates, never private fields",()=>{
 const alerts=[{scenario:"crowdsecurity/http-bad-user-agent",source:{ip:"198.51.100.11"},events:[{raw:"VERY PRIVATE"}]},{scenario:"crowdsecurity/http-bad-user-agent",source:{ip:"198.51.100.99"}},{scenario:"198.51.100.10",message:"test"},{scenario:"custom-user:secrets"}];
 const decisions=[{type:"ban",value:"203.0.113.4",scope:"Ip"},{type:"CAPTCHA",value:"192.0.2.2"},{type:"evil<script>",value:"private"}];
 const report=summarizeCrowdSecEvents(JSON.stringify(alerts),JSON.stringify(decisions));
 assert.equal(report.hostWide,true);
 assert.equal(report.alerts.available,true);
 assert.equal(report.alerts.sampleSize,4);
 assert.deepEqual(report.alerts.scenarioCounts,[{name:"crowdsecurity/http-bad-user-agent",count:2},{name:"other/custom",count:2}]);
 assert.deepEqual(report.decisions.decisionTypes,[{name:"ban",count:1},{name:"captcha",count:1},{name:"other",count:1}].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)));
 const serialized=JSON.stringify(report);
 for(const secret of ["198.51.100","203.0.113","192.0.2","VERY PRIVATE","evil<script>","custom-user"]){assert.equal(serialized.includes(secret),false);}
 assert.equal(report.enforcementVerified,false);
});
test("invalid, oversized, partial or failed cli results remain unknown",()=>{
 const unknown=summarizeCrowdSecEvents(null,"invalid json");
 assert.equal(unknown.alerts.available,false);
 assert.equal(unknown.decisions.available,false);
 assert.equal(unknown.alerts.sampleSize,0);
 const bad=summarizeCrowdSecEvents(JSON.stringify(Array(51).fill({scenario:"crowdsecurity/test"})),JSON.stringify({unexpected:true}));
 assert.equal(bad.alerts.available,false);
 assert.equal(bad.decisions.available,false);
});
