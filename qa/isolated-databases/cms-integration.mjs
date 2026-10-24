// Real CMS processes run under the site's user; systemd is adapted in this container.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,stat,mkdir,readdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {SiteManager} from './agent/dist/sites.js';
import {nodeSitePort} from './agent/dist/site-runtimes.js';
import {ApplicationQa} from './agent/dist/application-qa.js';
import {cmsRelease} from './agent/dist/cms-release.js';
export async function runCmsChecks(check,command){
 await command('/usr/sbin/nginx',[]);const processes=new Map();
 const registry='/var/lib/devone-agent';
 async function stop(id){const child=processes.get(id);if(!child)return;processes.delete(id);if(child.exitCode!==null)return;await new Promise(resolve=>{const t=setTimeout(()=>{child.kill('SIGKILL');resolve();},5000);child.once('exit',()=>{clearTimeout(t);resolve();});child.kill('SIGTERM');});}
 const adapter=async(c,a)=>{
  if(c!=='systemctl')return (await command(c,a)).stdout;
  if(a[0]==='daemon-reload')return '';
  if(a[0]==='reload'&&a[1]==='nginx'){await command('/usr/sbin/nginx',['-s','reload']);await new Promise(r=>setTimeout(r,150));return '';}
  const unit=a.at(-1),id=/^devone-(site_[a-f0-9]{16})\.service$/.exec(unit)?.[1];if(!id)throw Error('unexpected_unit');
  if(a[0]==='is-active')return processes.get(id)?.exitCode===null?'active':'inactive';
  if(a[0]==='disable'){await stop(id);return '';}
  if(a[0]==='enable'){
   const sites=JSON.parse(await readFile(registry+'/sites.json','utf8')),site=sites.find(s=>s.id===id);if(!site)throw Error('unknown_site');
   if(processes.get(id)?.exitCode===null)return '';
   const p=spawn('/usr/sbin/runuser',['-u',site.user,'--','/usr/bin/node','/home/devone-sites/'+id+'/public/server.mjs'],{env:{PATH:'/usr/bin:/bin',HOST:'127.0.0.1',PORT:String(nodeSitePort(id)),NODE_ENV:'production'},stdio:'ignore'});processes.set(id,p);p.on('error',()=>{});return '';
  }
  throw Error('unexpected_service_action');
 };
 const options={base:'/home/devone-sites',registry,nginx:'/etc/nginx/conf.d',panelDomain:'panel.example.test',command:adapter};const manager=new SiteManager(options);
 const request=domain=>({id:'app_'+randomBytes(8).toString('hex'),adminPassword:'Chosen!CMS-Password-2026🔐',adminUsername:'cms_owner',domain,title:'Managed CMS',email:'admin@example.test'});
 const b=request('cms.example.test');let site,cookie,csrf;
 function web(path,method='GET',body,headers={}){return new Promise((resolve,reject)=>{
  const p=httpRequest({hostname:'127.0.0.1',port:80,path,method,headers:{Host:b.domain,...headers}},r=>{const chunks=[];r.on('data',v=>chunks.push(v));r.on('end',()=>{const h=new Headers();for(let i=0;i<r.rawHeaders.length;i+=2)h.append(r.rawHeaders[i],r.rawHeaders[i+1]);resolve(new Response(Buffer.concat(chunks),{status:r.statusCode,headers:h}));});r.on('error',reject);});p.on('error',reject);p.setTimeout(15000,()=>p.destroy(Error('http_timeout')));p.end(body?JSON.stringify(body):undefined);
 });}
 // NGINX intentionally overwrites forwarded protocol. Use a direct loopback
 // request to simulate a TLS proxy for authenticated API checks; real ACME is separate.
 const secured=(path,method='GET',body,extra={})=>fetch('http://127.0.0.1:'+nodeSitePort(site.id)+path,{method,headers:{origin:'https://'+b.domain,'x-forwarded-proto':'https','content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 try{
  await check('cms.new-site-install-and-nginx',async()=>{const result=await manager.installCms(b);site=(await manager.list()).find(s=>s.id===result.siteId);assert.equal(site.state,'ready');assert.equal(site.application.stage,'complete');assert.equal(site.appActive,true);const health=await web('/api/health');assert.equal(health.status,200);assert.equal((await health.json()).version,cmsRelease.version);assert.ok((await(await web('/')).text()).includes('/assets/'));});
  await check('cms.read-only-acceptance',async()=>{
   const report=await new ApplicationQa(manager).check({siteId:site.id});
   assert.equal(report.scope,'installed-application-read-only');assert.equal(report.productionReady,false);assert.equal(report.state,'blocked');
   assert.ok(report.checks.every(c=>c.status==='pass'||c.name==='transport.https'&&c.status==='blocked'),JSON.stringify(report.checks));
  });
  await check('cms.private-state-and-source-isolation',async()=>{const root='/home/devone-sites/'+site.id;for(const name of ['devone.sqlite','devone.secret']){const s=await stat(root+'/data/'+name);assert.equal(s.uid,site.uid);assert.equal(s.mode&0o777,0o600);assert.equal((await web('/data/'+name)).status,404);}assert.equal((await web('/runtime.mjs')).status,404);assert.equal((await stat(root+'/public/server.mjs')).uid,site.uid);assert.ok((await readFile('/etc/systemd/system/devone-'+site.id+'.service','utf8')).includes(root+'/data'));});
  await check('cms.real-login-and-secure-cookie',async()=>{assert.equal((await secured('/api/auth/login','POST',{username:b.adminUsername,password:'wrong'})).status,401);const r=await secured('/api/auth/login','POST',{username:b.adminUsername,password:b.adminPassword});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Secure/);cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrf_token;});
  await check('cms.setup-origin-and-csrf-protection',async()=>{assert.equal((await secured('/api/install','POST',{})).status,403);assert.equal((await secured('/api/auth/login','POST',{username:b.adminUsername,password:b.adminPassword},{origin:'https://evil.test'})).status,403);assert.equal((await secured('/api/core/content','POST',{title:'Denied',slug:'denied',content:''},{cookie})).status,403);const r=await secured('/api/core/content','POST',{title:'Persisted page',slug:'persisted',content:'<p>saved</p>'},{cookie,'x-devone-csrf':csrf});assert.equal(r.status,201);});
  await check('cms.restart-preserves-data-and-login',async()=>{await manager.action({siteId:site.id,expectedRevision:site.revision,action:'stop'});await manager.action({siteId:site.id,expectedRevision:site.revision,action:'start'});const r=await secured('/api/core/content','GET',undefined,{cookie});assert.equal(r.status,200);assert.ok((await r.json()).pages.some(p=>p.slug==='persisted'));});
  await check('cms.existing-empty-node-site',async()=>{const existing=await manager.create({domain:'existing-cms.example.test',webServer:'nginx',siteType:'node',runtimeVersion:'22'});const next=request();delete next.domain;next.siteId=existing.id;next.expectedRevision=1;assert.equal((await manager.installCms(next)).siteId,existing.id);});
  await check('cms.nonempty-site-and-repeat-protection',async()=>{await assert.rejects(manager.installCms(b),/already_recorded/);const existing=await manager.create({domain:'occupied-cms.example.test',webServer:'nginx',siteType:'node',runtimeVersion:'22'});await manager.files({siteId:existing.id,operation:'create',path:'keep.txt',content:Buffer.from('preserve').toString('base64')});const next=request();delete next.domain;next.siteId=existing.id;next.expectedRevision=1;await assert.rejects(manager.installCms(next),/app_target_not_empty/);assert.equal(await readFile('/home/devone-sites/'+existing.id+'/public/keep.txt','utf8'),'preserve');});
  await check('cms.failed-health-retains-private-data',async()=>{const failed=request('failed-cms.example.test'),broken=new SiteManager({...options,cmsHealth:async()=>{throw Error('injected');}});await assert.rejects(broken.installCms(failed),/cms_install_requires_inspection/);const s=(await broken.list()).find(s=>s.application?.id===failed.id);assert.equal(s.state,'needs_inspection');assert.deepEqual(await readdir('/home/devone-sites/'+s.id+'/public'),[]);assert.ok((await stat('/home/devone-sites/'+s.id+'/data/devone.sqlite')).isFile());assert.ok((await stat('/home/devone-sites/'+s.id+'/.cms-'+failed.id+'/runtime.mjs')).isFile());assert.equal(processes.has(s.id),false);});
 }finally{for(const id of [...processes.keys()])await stop(id);await command('/usr/sbin/nginx',['-s','stop']);}
}
