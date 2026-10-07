import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SiteManager } from '../agent/dist/sites.js';
async function fixture(callback, nginxConfig = '') {
  const directory = await mkdtemp(join(tmpdir(),'devone-sites-'));
  const commands=[], identities = new Map();
  const options = {registry:join(directory,'registry'),base:join(directory,'sites'),nginx:join(directory,'nginx'),panelDomain:'panel.example.com',requireRoot:false,ownership:async(path,uid,gid)=>{commands.push(['chown-fixture',[path,uid,gid]]);}};
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
