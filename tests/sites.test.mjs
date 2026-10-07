import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SiteFiles } from '../agent/dist/site-files.js';
import { SiteManager } from '../agent/dist/sites.js';
async function fixture(callback, nginxConfig = '') {
  const directory = await mkdtemp(join(tmpdir(),'devone-sites-'));
  const commands=[], identities = new Map();
  const options = {registry:join(directory,'registry'),base:join(directory,'sites'),nginx:join(directory,'nginx'),panelDomain:'panel.example.com',requireRoot:false,ownership:async(path,uid,gid)=>{commands.push(['chown-fixture',[path,uid,gid]]);}};
  options.worker=async(site,request)=>{assert.equal(request.operation,'purge');await new SiteFiles(join(options.base,site.id,'public')).purge();return {ok:true};};
  await mkdir(options.nginx);
  const uid = process.getuid() === 0 ? 1000 : process.getuid(), gid = process.getgid() === 0 ? 1000 : process.getgid();
  options.command = async (command,args) => {
    commands.push([command,args]);
    if(command === 'nginx' && args[0] === '-T') return nginxConfig;
    if(command === 'useradd') {identities.set(args.at(-1),args[args.indexOf('--home-dir')+1]);return '';}
    if(command === 'getent') return `${args[1]}:x:${uid}:${gid}::${identities.get(args[1])}:/usr/sbin/nologin\n`;
    return '';
  };
  try {await callback(new SiteManager(options),options,commands);} finally {await rm(directory,{recursive:true,force:true});}
}
test('sites serialize provisioning, derive identities, persist and reject duplicate domains',async()=>fixture(async(manager,options,commands)=>{
  const sites = await Promise.all([manager.create({domain:'one.example.com',webServer:'none'}),manager.create({domain:'two.example.com',webServer:'none'})]);
  assert.equal(sites.length,2); assert.equal(sites[0].state,'ready');
  assert.match(sites[0].user,/^dvs_[a-f0-9]{16}$/);
  assert.equal((await new SiteManager(options).list()).length,2);
  await assert.rejects(manager.create({domain:'one.example.com',webServer:'none'}),/domain_in_use/);
  await assert.rejects(manager.create({domain:'panel.example.com',webServer:'none'}),/domain_in_use/);
  await assert.rejects(manager.create({domain:'evil;id.com',webServer:'none'}),/invalid_domain/);
  assert.equal(commands.filter(([command])=>command==='useradd').length,2);
  await chmod(options.registry,0o755); await assert.rejects(manager.list(),/unsafe_registry/);
}));
test('NGINX sites validate configuration and never overwrite an existing domain',async()=>{
  await fixture(async(manager,options,commands)=>{
    const site=await manager.create({domain:'static.example.com',webServer:'nginx'});
    const config=await readFile(join(options.nginx,`devone-${site.id}.conf`),'utf8');
    assert.match(config,/disable_symlinks on/); assert.match(config,/server_name static.example.com;/);
    assert.ok(commands.some(([command,args])=>command==='nginx' && args[0]==='-t'));
    assert.ok(commands.some(([command,args])=>command==='systemctl' && args.join(' ')==='reload nginx'));
  });
  await fixture(async(manager,options,commands)=>{
    await assert.rejects(manager.create({domain:'static.example.com',webServer:'nginx'}),/domain_in_use/);
    assert.equal(commands.filter(([command])=>command==='useradd').length,0);
  },'server { server_name *.example.com; }');
});
test('failed provisioning preserves inspectable metadata and quarantines its own NGINX config',async()=>fixture(async(manager,options)=>{
  const original = options.command;
  options.command = async(command,args)=>{if(command==='nginx' && args[0]==='-t') throw new Error('test failure');return original(command,args);};
  manager = new SiteManager(options);
  await assert.rejects(manager.create({domain:'broken.example.com',webServer:'nginx'}),/requires_inspection/);
  const [site]=await manager.list(); assert.equal(site.state,'needs_inspection');
  assert.equal((await readdir(options.nginx)).length,0);
  assert.ok((await readdir(options.registry)).some(name=>name.endsWith('.nginx-quarantine')));
  await assert.rejects(manager.files({siteId:site.id,operation:'list',path:''}),/site_not_ready/);
  const records=JSON.parse(await readFile(join(options.registry,'sites.json'),'utf8')); records[0].state='provisioning';
  const {writeFile}=await import('node:fs/promises');await writeFile(join(options.registry,'sites.json'),JSON.stringify(records));
  assert.equal((await new SiteManager(options).list())[0].state,'needs_inspection');
}));
test('launcher drops supplementary groups before GID and UID, and fails closed',async()=>{
  const {dropSiteIdentity}=await import('../agent/dist/site-identity.js');
  const calls=[];let uid=0,gid=0;
  const credentials={getuid:()=>uid,getgid:()=>gid,setgroups:groups=>calls.push(['groups',groups]),setgid:value=>{calls.push(['gid',value]);gid=value;},setuid:value=>{calls.push(['uid',value]);uid=value;}};
  dropSiteIdentity(1001,1002,credentials);
  assert.deepEqual(calls,[['groups',[]],['gid',1002],['uid',1001]]);
  assert.throws(()=>dropSiteIdentity(1001,1002,credentials),/invalid_site_identity/);
  uid=0;assert.throws(()=>dropSiteIdentity(0,1002,credentials),/invalid_site_identity/);
  const failed={...credentials,setgroups:()=>{throw new Error('denied');}};
  calls.length=0;assert.throws(()=>dropSiteIdentity(1001,1002,failed),/denied/);assert.equal(calls.length,0);
});
test('file dispatch serializes a site while bounding total queued requests',async()=>fixture(async(manager)=>{
  const first='site_0123456789abcdef',second='site_fedcba9876543210';let active=0,max=0;
  // Inject only the dispatch implementation to observe the scheduling boundary.
  manager.performFiles=async()=>{max=Math.max(max,++active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {ok:true};};
  await Promise.all([manager.files({siteId:first}),manager.files({siteId:first}),manager.files({siteId:first})]);assert.equal(max,1);
  const pending=Array.from({length:32},()=>manager.files({siteId:second}));
  await assert.rejects(manager.files({siteId:second}),/files_busy/);await Promise.all(pending);
  assert.equal(manager.filePending,0);assert.equal(manager.fileQueues.size,0);
}));
test('site lifecycle updates aliases, disables/enables and rejects stale jobs',async()=>fixture(async(manager,options)=>{
  const site=await manager.create({domain:'life.example.com',webServer:'nginx'});
  const updated=await manager.action({siteId:site.id,action:'update',expectedRevision:1,domain:'new.example.com',aliases:['alias.example.com']});
  assert.equal(updated.revision,2);assert.deepEqual(updated.aliases,['alias.example.com']);
  await assert.rejects(manager.action({siteId:site.id,action:'disable',expectedRevision:1}),/site_revision_conflict/);
  await assert.rejects(manager.create({domain:'alias.example.com',webServer:'none'}),/domain_in_use/);
  const disabled=await manager.action({siteId:site.id,action:'disable',expectedRevision:2});assert.equal(disabled.state,'disabled');
  const path=join(options.nginx,`devone-${site.id}.conf`);assert.match(await readFile(path,'utf8'),/return 410/);
  const enabled=await manager.action({siteId:site.id,action:'enable',expectedRevision:3});assert.equal(enabled.state,'ready');assert.match(await readFile(path,'utf8'),/root /);
  const {writeFile}=await import('node:fs/promises');await writeFile(path,'server { listen 80; server_name manual.example.com; }');
  await assert.rejects(manager.action({siteId:site.id,action:'disable',expectedRevision:4}),/site_config_changed/);
  assert.match(await readFile(path,'utf8'),/manual.example.com/);
}));
test('site deletion needs matching domain and removes only derived home, never a linked outside target',async()=>fixture(async(manager,options,commands)=>{
  const site=await manager.create({domain:'delete.example.com',webServer:'none'});
  const {writeFile,symlink}=await import('node:fs/promises');const outside=join(options.registry,'outside');await writeFile(outside,'keep');
  await symlink(outside,join(options.base,site.id,'public','outside-link'));
  const outsideDirectory=join(options.registry,'outside-directory');await mkdir(outsideDirectory);await writeFile(join(outsideDirectory,'keep.txt'),'keep directory');await symlink(outsideDirectory,join(options.base,site.id,'public','outside-directory-link'));
  await mkdir(join(options.base,site.id,'public','nested'));await writeFile(join(options.base,site.id,'public','nested','delete.txt'),'delete');
  await assert.rejects(manager.action({siteId:site.id,action:'delete',expectedRevision:1,confirmDomain:'wrong.example.com'}),/invalid_delete_confirmation/);
  assert.equal(commands.filter(([command])=>command==='userdel').length,0);
  const result=await manager.action({siteId:site.id,action:'delete',expectedRevision:1,confirmDomain:site.domain});assert.equal(result.deleted,site.id);
  assert.equal((await manager.list()).length,0);assert.equal(await readFile(outside,'utf8'),'keep');assert.equal(await readFile(join(outsideDirectory,'keep.txt'),'utf8'),'keep directory');
  assert.deepEqual(commands.find(([command])=>command==='userdel')[1],[site.user]);
}));
test('failed deletion marks inspection and does not restore an active site config',async()=>fixture(async(manager,options)=>{
  const site=await manager.create({domain:'failed-delete.example.com',webServer:'nginx'});
  const original=options.command;options.command=async(command,args)=>{if(command==='userdel') throw new Error('running processes');return original(command,args);};
  manager=new SiteManager(options);
  await assert.rejects(manager.action({siteId:site.id,action:'delete',expectedRevision:1,confirmDomain:site.domain}),/requires_inspection/);
  assert.equal((await manager.list())[0].state,'needs_inspection');
  assert.match(await readFile(join(options.nginx,`devone-${site.id}.conf`),'utf8'),/return 410/);
}));
test('HTTPS uses derived Certbot targets, validates consent and can disable without deleting certificates',async()=>fixture(async(manager,options,commands)=>{
  const site=await manager.create({domain:'tls.example.com',webServer:'nginx'});
  await assert.rejects(manager.tls({siteId:site.id,action:'issue',expectedRevision:1,email:'owner@example.com'}),/invalid_tls_consent/);
  const secured=await manager.tls({siteId:site.id,action:'issue',expectedRevision:1,email:'owner@example.com',agreeTerms:true});assert.equal(secured.tls,true);
  const command=commands.find(([command])=>command==='certbot');assert.ok(command);assert.equal(command[1][command[1].indexOf('--cert-name')+1],`devone-${site.id}`);assert.ok(command[1].includes('--webroot'));assert.ok(command[1].includes('--renew-with-new-domains'));
  const path=join(options.nginx,`devone-${site.id}.conf`),config=await readFile(path,'utf8');assert.match(config,/listen 443 ssl/);assert.match(config,/location \^~ \/\.well-known\/acme-challenge/);assert.match(config,/return 301 https/);
  await assert.rejects(manager.action({siteId:site.id,action:'update',expectedRevision:2,domain:'other.example.com',aliases:[]}),/invalid_tls_domain_change/);
  const renewed=await manager.tls({siteId:site.id,action:'renew',expectedRevision:2});assert.equal(renewed.revision,3);
  const plain=await manager.tls({siteId:site.id,action:'disable',expectedRevision:3});assert.equal(plain.tls,false);assert.ok(!(await readFile(path,'utf8')).includes('listen 443'));
  assert.ok(!commands.some(([command,args])=>command==='certbot' && args[0]==='delete'));
}));
test('certificate failure restores previous configuration and requires inspection',async()=>fixture(async(manager,options)=>{
  const site=await manager.create({domain:'bad-tls.example.com',webServer:'nginx'});
  const path=join(options.nginx,`devone-${site.id}.conf`),previous=await readFile(path,'utf8');
  const original=options.command;options.command=async(command,args)=>{if(command==='certbot') throw new Error('challenge failed');return original(command,args);};manager=new SiteManager(options);
  await assert.rejects(manager.tls({siteId:site.id,action:'issue',expectedRevision:1,email:'owner@example.com',agreeTerms:true}),/requires_inspection/);
  assert.equal(await readFile(path,'utf8'),previous);assert.equal((await manager.list())[0].state,'needs_inspection');
}));
test('deleting a previously secured site removes only its derived certificate lineage',async()=>fixture(async(manager,options,commands)=>{
  const site=await manager.create({domain:'retire-tls.example.com',webServer:'nginx'});
  await manager.tls({siteId:site.id,action:'issue',expectedRevision:1,email:'owner@example.com',agreeTerms:true});
  await manager.tls({siteId:site.id,action:'disable',expectedRevision:2});
  await manager.action({siteId:site.id,action:'delete',expectedRevision:3,confirmDomain:site.domain});
  const deletion=commands.find(([command,args])=>command==='certbot' && args[0]==='delete');
  assert.deepEqual(deletion[1],['delete','--cert-name',`devone-${site.id}`,'--non-interactive']);
  assert.equal((await manager.list()).length,0);
}));
test('live provisioning status differs from orphaned work after Agent restart',async()=>fixture(async(manager,options)=>{
  const original=options.command;let unblock,started;
  const ready=new Promise(resolve=>{started=resolve;});
  options.command=async(command,args)=>{if(command==='useradd'){started();await new Promise(resolve=>{unblock=resolve;});}return original(command,args);};
  manager=new SiteManager(options);const pending=manager.create({domain:'inflight.example.com',webServer:'none'});
  await ready;
  assert.equal((await manager.list())[0].state,'provisioning');
  assert.equal((await new SiteManager(options).list())[0].state,'needs_inspection');
  unblock();await pending;assert.equal((await manager.list())[0].state,'ready');
}));
