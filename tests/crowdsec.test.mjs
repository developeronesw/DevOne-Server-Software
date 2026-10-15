import {test} from "node:test";
import assert from "node:assert/strict";
import {crowdSecReport} from "../agent/dist/crowdsec.js";
test("CrowdSec status does not equate installed packages/config presence with WAF protection",()=>{
 const absent=crowdSecReport({engine:null,version:null,collection:false,bouncer:false,appsecConfig:false,appsecService:null});
 assert.equal(absent.installed,false);
 assert.equal(absent.engineActive,false);
 assert.equal(absent.enforcementVerified,false);
 assert.equal(absent.appSecVerified,false);
 const configured=crowdSecReport({engine:"active",version:"v1.8.0",collection:true,bouncer:true,appsecConfig:true,appsecService:"active"});
 assert.equal(configured.installed,true);
 assert.equal(configured.engineActive,true);
 assert.equal(configured.nginxBouncerConfigPresent,true);
 assert.equal(configured.appSecAcquisitionPresent,true);
 assert.equal(configured.enforcementVerified,false);
 assert.equal(configured.appSecVerified,false);
 assert.ok(configured.guidance.some(x=>x.includes("disposable")));
 for(const field of ["API_KEY","token","ip","decisions"]){
  assert.equal(Object.keys(configured).some(k=>k.toLowerCase()===field.toLowerCase()),false);
 }
});
