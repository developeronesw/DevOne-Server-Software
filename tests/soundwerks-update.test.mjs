import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SiteManager} from '../agent/dist/sites.js';
import {SiteFiles} from '../agent/dist/site-files.js';
import {soundwerksRelease} from '../agent/dist/soundwerks-release.js';
import {checkSoundwerksRelease,verifySoundwerksTarget,soundwerksUpdateInput,CSW_SOURCE} from '../agent/dist/soundwerks-updates.js';

const sha='a'.repeat(40);
const data={id:'app_0123456789abcdef',databaseId:'db_0123456789abcdef',
 databasePassword:'ab'.repeat(32),adminUsername:'creative_admin',
 adminPassword:'CreativeAdminPassword1234!',domain:'media.example.com',
 title:'Creative Soundwerks',email:'owner@example.com'};
const result={id:918,name:'Creative Soundwerks CI',head_sha:sha,head_branch:'main',
 event:'push',status:'completed',conclusion:'success'};

test('only official main commit with successful CI is accepted',async()=>{
 const calls=[];
 const fetcher=async path=>{
  calls.push(path);
  if(path==='/git/ref/heads/main')return {object:{sha}};
  if(path==='/actions/runs?head_sha='+sha+'&per_page=30')return {workflow_runs:[result]};
  throw Error('unexpected URL');
 };
 const remote=await checkSoundwerksRelease(fetcher);
 assert.equal(remote.latestSha,sha);assert.equal(remote.approved,true);
 assert.deepEqual(calls,['/git/ref/heads/main','/actions/runs?head_sha='+sha+'&per_page=30']);
 assert.match(remote.workflowUrl,/actions\/runs\/918$/);
 assert.equal((await verifySoundwerksTarget(sha,fetcher)).latestSha,sha);
 await assert.rejects(verifySoundwerksTarget('b'.repeat(40),fetcher),{message:'soundwerks_update_target_changed'});
 assert.equal(CSW_SOURCE,'https://github.com/developeronesw/CreativeSoundwerks2.git');
 for(const bad of [{id:data.id,siteId:'not-a-site',targetSha:sha,expectedRevision:2},
  {id:data.id,siteId:'site_0123456789abcdef',targetSha:'main',expectedRevision:2},
  {id:data.id,siteId:'site_0123456789abcdef',targetSha:sha,expectedRevision:2,sourceUrl:'evil'}])
  assert.throws(()=>soundwerksUpdateInput(bad));
 const failed=await checkSoundwerksRelease(async path=>path.startsWith('/git/')
  ?{object:{sha}}:{workflow_runs:[{...result,conclusion:'failure'}]});
 assert.equal(failed.approved,false);
 await assert.rejects(verifySoundwerksTarget(sha,async path=>path.startsWith('/git/')
  ?{object:{sha}}:{workflow_runs:[{...result,status:'in_progress',conclusion:null}]}),
  {message:'soundwerks_release_checks_not_passed'});
});

async function fixture(scenario='success'){
 const root=await mkdtemp(join(tmpdir(),'devone-soundwerks-update-'));
 const identities=new Map(),actions=[];
 const opts={
  base:join(root,'sites'),registry:join(root,'registry'),nginx:join(root,'nginx'),
  nodeUnitDir:join(root,'units'),panelDomain:'panel.example.com',
  requireRoot:false,ownership:async()=>{},command:async(command,args)=>{
   actions.push([command,...args]);
   if(command==='useradd')identities.set(args.at(-1),args[args.indexOf('--home-dir')+1]);
   if(command==='getent')return args[1]+':x:1000:1000::'+identities.get(args[1])+':/usr/sbin/nologin';
   if(command==='node')return 'v22.16.0';
   if(command==='systemctl'&&args[0]==='is-active')return 'inactive';
   return '';
  },
  worker:async site=>new SiteFiles(join(opts.base,site.id,'public')).list(''),
  soundwerksWorker:async(site,stage,privateDir)=>{
   await writeFile(join(stage,'server.mjs'),'previous-version');
   await writeFile(join(privateDir,'.env'),'DATABASE_URL=previous-private-config',{mode:0o600});
   await mkdir(join(privateDir,'media'),{mode:0o700});
   await writeFile(join(privateDir,'media/one.mp3'),'keep-media');
   await writeFile(join(privateDir,'schema-marker'),'previous-schema');
  },
  soundwerksHealth:async()=>{},
  soundwerksUpdateWorker:async(site,stage,privateDir,backup,target,mode)=>{
   actions.push(['worker',mode]);
   if(mode==='build'){
    await writeFile(join(stage,'server.mjs'),'updated-version');
    if(scenario==='build-failure')throw Error('build failed');
   }
   if(mode==='backup')await writeFile(backup,'previous-database-snapshot',{mode:0o600});
   if(mode==='migrate'){
    await writeFile(join(privateDir,'schema-marker'),'updated-schema');
    if(scenario==='migration-failure')throw Error('migration failed');
   }
   if(mode==='restore'){
    if(scenario==='restore-failure')throw Error('cannot restore');
    await writeFile(join(privateDir,'schema-marker'),'previous-schema');
   }
  },
  soundwerksUpdateHealth:async()=>{if(['health-failure','restore-failure'].includes(scenario))throw Error('bad new version');}
 };
 await mkdir(opts.nginx);await mkdir(opts.nodeUnitDir);
 const manager=new SiteManager(opts);
 await manager.installSoundwerks(data,{prepare:async()=>{},database:async()=>({state:'ready'})});
 const [site]=await manager.list();
 const home=join(opts.base,site.id);
 return {manager,root,site,home,actions};
}
const statusFrom=(site)=>({id:data.id,siteId:site.id,targetSha:sha,expectedRevision:site.revision});
const approvals={verify:async()=>{}};

test('staging update preserves private media and credentials, increments revision, retains previous version',async()=>{
 const fx=await fixture();
 try{
  const output=await fx.manager.updateSoundwerks(statusFrom(fx.site),approvals);
  assert.equal(output.currentSha,sha);
  const [site]=await fx.manager.list();
  assert.equal(site.state,'ready');assert.equal(site.revision,fx.site.revision+1);
  assert.equal(site.application.sourceRevision,sha);
  assert.equal(await readFile(join(fx.home,'public/server.mjs'),'utf8'),'updated-version');
  assert.equal(await readFile(join(fx.home,'data/.env'),'utf8'),'DATABASE_URL=previous-private-config');
  assert.equal(await readFile(join(fx.home,'data/media/one.mp3'),'utf8'),'keep-media');
  assert.equal(await readFile(join(fx.home,'data/schema-marker'),'utf8'),'updated-schema');
  const previous=(await readdir(fx.home)).filter(x=>x.startsWith('.soundwerks-previous-'));
  assert.equal(previous.length,1);
  assert.equal(await readFile(join(fx.home,previous[0],'server.mjs'),'utf8'),'previous-version');
  const snapshots=await readdir(join(fx.home,'data/update-backups'));
  assert.equal(snapshots.length,1);
  await assert.rejects(fx.manager.updateSoundwerks(
   {...statusFrom(site),expectedRevision:site.revision},approvals),{message:'soundwerks_already_current'});
  assert.ok(fx.actions.some(x=>x[0]==='systemctl'&&x[1]==='stop'));
  assert.ok(fx.actions.some(x=>x[0]==='systemctl'&&x[1]==='start'));
 }finally{await rm(fx.root,{recursive:true,force:true});}
});

for(const scenario of ['build-failure','migration-failure','health-failure','restore-failure']){
 test('update safely recovers from '+scenario,async()=>{
  const fx=await fixture(scenario);
  try{
   await assert.rejects(fx.manager.updateSoundwerks(statusFrom(fx.site),approvals),
    {message:scenario==='build-failure'?'soundwerks_update_build_failed':
     scenario==='restore-failure'?'soundwerks_update_requires_inspection':'soundwerks_update_rolled_back'});
   const [site]=await fx.manager.list();
   assert.equal(site.application.sourceRevision,soundwerksRelease.commit);
   assert.equal(site.state,scenario==='restore-failure'?'needs_inspection':'ready');
   assert.equal(await readFile(join(fx.home,'public/server.mjs'),'utf8'),'previous-version');
   assert.equal(await readFile(join(fx.home,'data/media/one.mp3'),'utf8'),'keep-media');
   assert.equal(await readFile(join(fx.home,'data/.env'),'utf8'),'DATABASE_URL=previous-private-config');
   if(scenario!=='restore-failure')
    assert.equal(await readFile(join(fx.home,'data/schema-marker'),'utf8'),'previous-schema');
  }finally{await rm(fx.root,{recursive:true,force:true});}
 });
}
test('GitHub CI rejection or target revision mismatch prevents all filesystem and DB work',async()=>{
 const fx=await fixture();
 try{
  await assert.rejects(fx.manager.updateSoundwerks(statusFrom(fx.site),
   {verify:async()=>{throw Error('soundwerks_release_checks_not_passed');}}),
   {message:'soundwerks_release_checks_not_passed'});
  const [site]=await fx.manager.list();
  assert.equal(site.state,'ready');
  assert.equal(await readFile(join(fx.home,'public/server.mjs'),'utf8'),'previous-version');
  assert.equal(await readFile(join(fx.home,'data/schema-marker'),'utf8'),'previous-schema');
  assert.ok(!(fx.actions.some(x=>x[0]==='worker')));
 }finally{await rm(fx.root,{recursive:true,force:true});}
});
