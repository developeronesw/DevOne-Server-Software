// Real WordPress/NGINX/PHP-FPM/MariaDB inside the disposable QA container.
// systemctl is adapted to real daemon signals: this does not certify systemd.
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {readFile,writeFile,mkdir,stat,readdir} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {waitForQaWebsite} from './agent/dist/disposable-qa.js';
import {SiteManager} from './agent/dist/sites.js';
import {DatabaseManager} from './agent/dist/databases.js';
export async function runWordPressChecks(check,command){
 await mkdir('/run/php',{recursive:true});
 // Docker's CPU quota does not change the host CPU count seen by nginx auto.
 const nginxConfig=await readFile('/etc/nginx/nginx.conf','utf8');await writeFile('/etc/nginx/nginx.conf',nginxConfig.replace(/worker_processes\s+auto;/,'worker_processes 2;'));
 console.log('WordPress bootstrap: PHP-FPM');
 try{await command('/usr/sbin/php-fpm8.3',['--daemonize']);}catch(e){console.error('QA PHP-FPM bootstrap failed',e.stderr);throw Error('qa_php_bootstrap_failed');}
 console.log('WordPress bootstrap: NGINX');
 try{await command('/usr/sbin/nginx',[]);}catch(e){console.error('QA NGINX bootstrap failed',e.stderr);throw Error('qa_nginx_bootstrap_failed');}
 console.log('WordPress bootstrap: ready');
 const commandAdapter=async(c,a)=>{
  if(c==='systemctl'){
   if(a[1]!=='php8.3-fpm'&&a[1]!=='nginx')throw Error('unexpected_service');
   const pid=Number((await readFile(a[1]==='nginx'?'/run/nginx.pid':'/run/php/php8.3-fpm.pid','utf8')).trim());process.kill(pid,0);
   if(a[0]==='is-active')return 'active';
   if(a[0]==='reload'){
    if(a[1]==='php8.3-fpm')process.kill(pid,'SIGUSR2');else await command('/usr/sbin/nginx',['-s','reload']);
    await new Promise(r=>setTimeout(r,200));return '';
   }
   throw Error('unexpected_service_action');
  }
  return (await command(c,a)).stdout;
 };
 const manager=new SiteManager({base:'/home/devone-sites',registry:'/var/lib/devone-agent',nginx:'/etc/nginx/conf.d',panelDomain:'panel.example.test',command:commandAdapter});
 // Exercise real reload signals without the compatibility adapter's delay.
 const immediateReload=async(c,a)=>{
  if(c==='systemctl'&&a[0]==='reload'){
   if(a[1]==='nginx')await command('/usr/sbin/nginx',['-s','reload']);
   else if(a[1]==='php8.3-fpm')process.kill(Number((await readFile('/run/php/php8.3-fpm.pid','utf8')).trim()),'SIGUSR2');
   else throw Error('unexpected_service');
   return '';
  }
  return commandAdapter(c,a);
 };
 const hosting=new SiteManager({base:'/home/devone-sites',registry:'/var/lib/devone-agent',nginx:'/etc/nginx/conf.d',panelDomain:'panel.example.test',command:immediateReload});
 for(const type of ['static','php'])await check('hosting.'+type+'-reload-readiness',async()=>{
  // Repeat immediate provisioning to cover multiple reloads/old-worker handoffs.
  for(let i=0;i<3;i++){
   const marker='DEVONE_QA_'+randomBytes(12).toString('hex');
   const site=await hosting.create({domain:'reload-'+randomBytes(8).toString('hex')+'.invalid',siteType:type,webServer:'nginx',...(type==='php'?{runtimeVersion:'8.3'}:{})});
   try{
    await hosting.files({siteId:site.id,operation:'create',path:type==='php'?'index.php':'index.html',content:Buffer.from(type==='php'?"<?php echo '"+marker.slice(0,16)+"'.'"+marker.slice(16)+"';":marker).toString('base64')});
    const response=await waitForQaWebsite(site.domain,marker);
    assert.equal(response.status,200);assert.equal(response.matched,true);
   }finally{await hosting.action({siteId:site.id,action:'delete',confirmDomain:site.domain,expectedRevision:site.revision});}
   assert.equal((await hosting.list()).some(s=>s.id===site.id),false);
  }
 });
 const databases=new DatabaseManager({registry:'/var/lib/devone-agent/databases',sites:()=>manager.list(),withSite:(id,work)=>manager.withReadySite(id,work)});
 const request=domain=>({id:'app_'+randomBytes(8).toString('hex'),databaseId:'db_'+randomBytes(8).toString('hex'),databasePassword:randomBytes(32).toString('hex'),adminPassword:randomBytes(32).toString('hex'),title:'DevOne QA WordPress',email:'qa@example.test',domain});
 const deps={prepare:async()=>{},database:(site,b)=>databases.createForLockedSite({id:b.databaseId,siteId:site.id,engine:'mariadb',password:b.databasePassword},site.id)};
 const first=request('wordpress.example.test');let site;
 // Native fetch ignores an explicit Host header in supported Node releases.
 // Use the HTTP client so every request actually reaches this site's vhost.
 const web=(path,options={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port:80,path,method:options.method??'GET',headers:{Host:first.domain,...options.headers}},res=>{
   const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const headers=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)headers.append(res.rawHeaders[i],res.rawHeaders[i+1]);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});res.on('error',reject);
  });req.on('error',reject);req.setTimeout(15000,()=>req.destroy(Error('http_timeout')));req.end(options.body?.toString());
 });
 await check('wordpress.new-site-install',async()=>{
  let result;try{result=await manager.installWordPress(first,deps);}catch{const states=await manager.list();console.error('WordPress stage evidence',JSON.stringify(states.map(s=>({state:s.state,stage:s.application?.stage}))));throw Error('wordpress_install_failed');}site=(await manager.list()).find(s=>s.id===result.siteId);
  assert.equal(site.state,'ready');assert.equal(site.application.stage,'complete');
  const home=await web('/');assert.equal(home.status,200);assert.ok((await home.text()).includes('DevOne QA WordPress'));
 });
 await check('wordpress.real-administrator-login',async()=>{
  const result=await web('/wp-login.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:'wordpress_test_cookie=WP%20Cookie%20check'},body:new URLSearchParams({log:'devone_admin',pwd:first.adminPassword,'wp-submit':'Log In',testcookie:'1',redirect_to:'http://'+first.domain+'/wp-admin/'})});
  assert.equal(result.status,302);assert.ok(result.headers.get('location').includes('/wp-admin/'));
  const cookie=result.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');assert.ok(cookie.includes('wordpress_logged_in_'));
  const admin=await web('/wp-admin/',{headers:{Cookie:cookie}});assert.equal(admin.status,200);assert.ok((await admin.text()).includes('wpadminbar'));
 });
 await check('wordpress.private-unprivileged-files',async()=>{
  const file=await stat('/home/devone-sites/'+site.id+'/public/wp-config.php');assert.equal(file.uid,site.uid);assert.equal(file.mode&0o777,0o600);
  assert.ok(!(await readFile('/var/lib/devone-agent/sites.json','utf8')).includes(first.adminPassword));
  await assert.rejects(manager.installWordPress(first,deps),/already_recorded/);
 });
 await check('wordpress.nginx-config-and-upload-protection',async()=>{
  assert.equal((await web('/wp-config.php')).status,403);
  const uploads='/home/devone-sites/'+site.id+'/public/wp-content/uploads';await mkdir(uploads,{recursive:true});await writeFile(uploads+'/qa.php','<?php echo "must-not-run";');
  assert.equal((await web('/wp-content/uploads/qa.php')).status,403);
 });
 await check('wordpress.nonempty-site-preserved',async()=>{
  const existing=await manager.create({domain:'occupied.example.test',webServer:'nginx',siteType:'php',runtimeVersion:'8.3'});
  await manager.files({siteId:existing.id,operation:'create',path:'index.html',content:Buffer.from('preserve this').toString('base64')});
  const b=request();delete b.domain;b.siteId=existing.id;b.expectedRevision=1;
  let called=false;await assert.rejects(manager.installWordPress(b,{prepare:async()=>{called=true;},database:async()=>{called=true;}}),/app_target_not_empty/);assert.equal(called,false);
  assert.equal(await readFile('/home/devone-sites/'+existing.id+'/public/index.html','utf8'),'preserve this');
 });
 await check('wordpress.existing-empty-site-install',async()=>{
  const existing=await manager.create({domain:'existing.example.test',webServer:'nginx',siteType:'php',runtimeVersion:'8.3'});
  // Emulate a managed PHP site created before the WordPress protections shipped.
  const configPath='/etc/nginx/conf.d/devone-'+existing.id+'.conf';
  const old=(await readFile(configPath,'utf8')).split('\n').filter(line=>!line.includes('wp-config')&&!line.includes('wp-content/uploads')).join('\n');
  await writeFile(configPath,old);const records=JSON.parse(await readFile('/var/lib/devone-agent/sites.json','utf8'));records.find(s=>s.id===existing.id).configHash=createHash('sha256').update(old).digest('hex');await writeFile('/var/lib/devone-agent/sites.json',JSON.stringify(records));
  await command('/usr/sbin/nginx',['-t']);await commandAdapter('systemctl',['reload','nginx']);
  assert.equal((await web('/wp-content/uploads/qa.php',{headers:{Host:existing.domain}})).status,404);
  const b=request();delete b.domain;b.siteId=existing.id;b.expectedRevision=1;
  const result=await manager.installWordPress(b,deps);assert.equal(result.siteId,existing.id);
  assert.equal((await web('/wp-config.php',{headers:{Host:existing.domain}})).status,403);
  assert.equal((await web('/wp-content/uploads/qa.php',{headers:{Host:existing.domain}})).status,403);
 });
 await check('wordpress.failed-health-restores-empty-root',async()=>{
  const b=request('failed.example.test');const broken=new SiteManager({base:'/home/devone-sites',registry:'/var/lib/devone-agent',nginx:'/etc/nginx/conf.d',panelDomain:'panel.example.test',command:commandAdapter,wordpressHealth:async()=>{throw Error('injected_health_failure');}});
  await assert.rejects(broken.installWordPress(b,deps),/wordpress_install_requires_inspection/);
  const retained=(await broken.list()).find(s=>s.application?.id===b.id);assert.equal(retained.state,'needs_inspection');assert.deepEqual(await readdir('/home/devone-sites/'+retained.id+'/public'),[]);
  assert.ok((await stat('/home/devone-sites/'+retained.id+'/.wordpress-'+b.id+'/wp-config.php')).isFile());
  assert.equal((await databases.list()).find(d=>d.id===b.databaseId).state,'ready');
 });
 await check('wordpress.http-to-https-url-transition',async()=>{
  // Exercise the generated config against the same real application without a
  // public DNS/ACME dependency. Real certificate issuance remains host acceptance.
  const root='/home/devone-sites/'+site.id+'/public';
  const script="$_SERVER['HTTPS']='on';define('WP_USE_THEMES',false);require '"+root+"/wp-load.php';echo get_option('home');";
  const result=await command('/usr/sbin/runuser',['-u',site.user,'--','/usr/bin/php8.3','-r',script]);assert.equal(result.stdout,'https://'+site.domain);
 });
 await command('/usr/sbin/nginx',['-s','stop']);
 process.kill(Number((await readFile('/run/php/php8.3-fpm.pid','utf8')).trim()),'SIGQUIT');
}
