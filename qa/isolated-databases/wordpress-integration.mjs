// Real WordPress/NGINX/PHP-FPM/MariaDB inside the disposable QA container.
// systemctl is adapted to real daemon signals: this does not certify systemd.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat,readdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {SiteManager} from './agent/dist/sites.js';
import {DatabaseManager} from './agent/dist/databases.js';
export async function runWordPressChecks(check,command){
 await mkdir('/run/php',{recursive:true});
 await command('/usr/sbin/php-fpm8.3',['--daemonize']);await command('/usr/sbin/nginx',[]);
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
 const databases=new DatabaseManager({registry:'/var/lib/devone-agent/databases',sites:()=>manager.list(),withSite:(id,work)=>manager.withReadySite(id,work)});
 const request=domain=>({id:'app_'+randomBytes(8).toString('hex'),databaseId:'db_'+randomBytes(8).toString('hex'),databasePassword:randomBytes(32).toString('hex'),adminPassword:randomBytes(32).toString('hex'),title:'DevOne QA WordPress',email:'qa@example.test',domain});
 const deps={prepare:async()=>{},database:(site,b)=>databases.createForLockedSite({id:b.databaseId,siteId:site.id,engine:'mariadb',password:b.databasePassword},site.id)};
 const first=request('wordpress.example.test');let site;
 const web=(path,options={})=>fetch('http://127.0.0.1'+path,{redirect:'manual',...options,headers:{Host:first.domain,...options.headers},signal:AbortSignal.timeout(15000)});
 await check('wordpress.new-site-install',async()=>{
  const result=await manager.installWordPress(first,deps);site=(await manager.list()).find(s=>s.id===result.siteId);
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
  const b=request();delete b.domain;b.siteId=existing.id;b.expectedRevision=1;
  const result=await manager.installWordPress(b,deps);assert.equal(result.siteId,existing.id);
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
