import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {validateDomain} from './site-files.js';
import type {SiteManager,Site} from './sites.js';

type Reply={status:number;body:string;location?:string};
type Probe=(site:Site,path:string)=>Promise<Reply>;
type Check={name:string;status:'pass'|'fail'|'blocked';detail:string};
const paths=new Set(['/','/wp-login.php','/wp-config.php','/api/health','/api/install/status','/runtime.mjs','/data/devone.sqlite','/data/devone.secret']);
export function probeInstalledApp(site:Site,path:string,ports={http:80,https:443}):Promise<Reply>{
 validateDomain(site.domain);if(!paths.has(path))throw Error('invalid_application_probe');
 return new Promise((resolve,reject)=>{
  const request=site.tls?httpsRequest:httpRequest;
  const req=request({hostname:'127.0.0.1',port:site.tls?ports.https:ports.http,path,method:'GET',headers:{Host:site.domain},agent:false,...(site.tls?{servername:site.domain,rejectUnauthorized:true}:{})},res=>{
   const chunks:Buffer[]=[];let bytes=0;
   res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>524288)req.destroy(Error('application_response_too_large'));else chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode??0,body:Buffer.concat(chunks).toString('utf8'),location:res.headers.location}));
  });
  const timer=setTimeout(()=>req.destroy(Error('application_probe_timeout')),3000);
  req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end();
 });
}
export class ApplicationQa{
 private busy=false;
 constructor(private sites:Pick<SiteManager,'list'>,private probe:Probe=probeInstalledApp){}
 async list(){return {applications:(await this.sites.list()).filter(s=>s.application).map(s=>({siteId:s.id,domain:s.domain,appId:s.application!.appId,version:s.application!.version,state:s.state,stage:s.application!.stage,tls:s.tls===true}))};}
 async check(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!/^site_[a-f0-9]{16}$/.test((value as {siteId:string}).siteId))throw Error('invalid_application_qa');
  if(this.busy)throw Error('application_qa_busy');this.busy=true;
  try{
   const site=(await this.sites.list()).find(s=>s.id===(value as {siteId:string}).siteId);
   if(!site?.application)throw Error('application_qa_not_found');
   const checks:Check[]=[];
   const ready=site.state==='ready'&&site.application.stage==='complete';
   checks.push({name:'installation.ready',status:ready?'pass':'blocked',detail:ready?'Managed installation is complete.':'Finish or recover this installation before checking HTTP endpoints.'});
   checks.push({name:'transport.https',status:site.tls?'pass':'blocked',detail:site.tls?'HTTPS is configured; endpoint requests below verify its trusted certificate and domain.':'Issue HTTPS for this site before credential reveal and browser login acceptance.'});
   if(ready){
    if(site.application.appId==='devone-cms-v2')checks.push({name:'runtime.service',status:site.appActive?'pass':'fail',detail:site.appActive?'Managed Node service is active.':'Managed Node service is not active.'});
    const run=async(name:string,path:string,valid:(r:Reply)=>boolean,success:string)=>{
     try{const r=await this.probe(site,path);checks.push({name,status:valid(r)?'pass':'fail',detail:valid(r)?success:`Unexpected response (HTTP ${r.status}); inspect the application and NGINX logs.`});}
     catch{checks.push({name,status:'fail',detail:'Local request failed: check service, routing and, when enabled, trusted HTTPS certificate/domain.'});}
    };
    const denied=(r:Reply)=>r.status===403||r.status===404;
    if(site.application.appId==='wordpress'){
     await Promise.all([
      run('wordpress.front','/',r=>r.status===200&&r.body.includes('wp-content/'),'WordPress front page served through NGINX/PHP.'),
      run('wordpress.login','/wp-login.php',r=>r.status===200&&r.body.includes('id="loginform"')&&r.body.includes('name="log"'),'WordPress login form served through NGINX/PHP.'),
      run('wordpress.private-config','/wp-config.php',denied,'HTTP access to wp-config.php is denied.')
     ]);
    }else{
     const json=(r:Reply)=>{try{return JSON.parse(r.body);}catch{return {};}};
     await Promise.all([
      run('cms.health','/api/health',r=>{const b=json(r);return r.status===200&&b.ok===true&&b.product==='DevOne CMS'&&b.version===site.application!.version;},'CMS health identifies the recorded product and version.'),
      run('cms.initialized','/api/install/status',r=>{const b=json(r);return r.status===200&&b.installed===true&&b.siteUrl===site.domain;},'CMS initialization matches this site domain.'),
      run('cms.dashboard','/',r=>r.status===200&&r.body.includes('/assets/'),'Built CMS dashboard served through NGINX.'),
      ...['/runtime.mjs','/data/devone.sqlite','/data/devone.secret'].map(path=>run('cms.private'+path,path,denied,'Private source/database/key path is denied.'))
     ]);
    }
   }
   return {scope:'installed-application-read-only',checkedAt:new Date().toISOString(),siteId:site.id,domain:site.domain,appId:site.application.appId,version:site.application.version,productionReady:false,
    state:checks.some(c=>c.status==='fail')?'failed':checks.some(c=>c.status==='blocked')?'blocked':'passed',checks,
    pending:['Administrator login and content changes','Data persistence and restore','Public DNS/ACME and rendered browser acceptance'],notice:'Read-only availability and HTTP protection checks. No credentials are read, no login/content changes are performed, and no resources are deleted. This is not full application or release acceptance.'};
  }finally{this.busy=false;}
 }
}
