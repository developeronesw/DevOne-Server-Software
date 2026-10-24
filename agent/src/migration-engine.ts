import {SiteManager,validRecord,type Site} from './sites.js';
import {DatabaseManager,type DatabaseRequest} from './databases.js';
import {migrationCommand as command,migrationStream,transferMigrationDatabase} from './migration-sql.js';
import {encryptMigration,decryptMigration,hashMigrationFile,migrationPassphrase} from './migration-crypto.js';
import {nodeUnitName,runtimeContainerName,nodeUnitConfig,pythonUnitConfig,phpPoolConfig,nodeUnitPath,phpPoolPath} from './site-runtimes.js';
import {softwareInstall} from './software.js';
import {DatabaseSync,backup} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {mkdir,lstat,readFile,writeFile,rename,rm,readdir,chown,chmod,lchown,cp,copyFile,symlink,realpath,statfs,open,utimes,lutimes} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,createPrivateKey,X509Certificate,randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
const helper=join(sourceRoot,'scripts/migration-archive.py');
const packageIds=['php8.3-fpm','redis-server','docker.io','mariadb-server','postgresql'] as const;
type SqlRecord={id:string;siteId:string;engine:'mariadb'|'postgresql';name:string;username:string;host:string;state:string};
type Tls={siteId:string;account:string;server:'acme-v02.api.letsencrypt.org'|'acme-staging-v02.api.letsencrypt.org';keyType:'rsa'|'ecdsa'};
export type MigrationMetadata={format:1;scope:'devone-managed-server';softwareVersion:'1.0.0-alpha.3';sourceCommit:string;architecture:'x64';os:'ubuntu-24.04';createdAt:string;sourcePanelUrl:string;sites:Site[];databases:SqlRecord[];packages:string[];tls:Tls[];redis:boolean;containerImage:string|null;settings:Record<string,string>;exclusions:string[]};
type Entry={path:string;type:'file'|'directory'|'symlink';mode:number;owner:'root'|'site';size:number;sha256:string;mtime:number;link?:string};
type Inventory={bytes:number;entries:Entry[]};
type Progress=(phase:string,extra?:Record<string,unknown>)=>Promise<void>;
export type MigrationConfig={root:string;base:string;registry:string;databaseRegistry:string;nginx:string;certificates:string;dbPath:string;keyPath:string;envPath:string;panelUrl:string;source:string;backups:string};
export const defaultMigrationConfig:MigrationConfig={root:'/var/lib/devone-agent/migrations',base:'/home/devone-sites',registry:'/var/lib/devone-agent',databaseRegistry:'/var/lib/devone-agent/databases',nginx:'/etc/nginx/conf.d',certificates:'/etc/letsencrypt',dbPath:'/var/lib/devone/devone.sqlite',keyPath:'/etc/devone/secrets.key',envPath:'/etc/devone/devone.env',panelUrl:'',source:'/opt/devone/current',backups:'/var/lib/devone/backups'};
export async function privateMigrationDirectory(path:string){await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)||s.uid!==process.getuid?.()||await realpath(path)!==path)throw Error('migration_unsafe_directory');}
export async function atomicMigrationJson(path:string,value:unknown){await privateMigrationDirectory(dirname(path));const tmp=path+'.'+randomUUID();await writeFile(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(tmp,path);const fd=await open(dirname(path),'r');try{await fd.sync();}finally{await fd.close();}}
export async function privateMigrationJson(path:string,limit=1048576){const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.nlink!==1||(s.mode&0o077)||s.uid!==process.getuid?.()||s.size>limit)throw Error('migration_unsafe_file');return JSON.parse(await f.readFile('utf8'));}finally{await f.close();}}
async function exists(path:string){return lstat(path).then(()=>true).catch((e)=>{if(e.code==='ENOENT')return false;throw e;});}
async function atomicFile(path:string,value:Buffer|string,mode=0o600,uid?:number,gid?:number){const tmp=path+'.migration-'+randomUUID();const f=await open(tmp,'wx',mode);try{await f.writeFile(value);if(uid!==undefined)await f.chown(uid,gid!);await f.sync();}finally{await f.close();}await rename(tmp,path);}
function safeSettings(env:string){const result:Record<string,string>={};for(const key of ['DEVONE_OPENCLAW_BASE_URL','DEVONE_OPENCLAW_AGENT_MODEL']){const line=env.split('\n').find(l=>l.startsWith(key+'='));if(line){const value=line.slice(key.length+1);if(key.endsWith('BASE_URL')){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname.replace(/\/$/,'')!=='/v1')throw Error('migration_unsupported_settings');}else if(!/^[a-zA-Z0-9._/-]{1,96}$/.test(value))throw Error('migration_unsupported_settings');result[key]=value;}}return result;}
export function validateMigrationMetadata(value:unknown):MigrationMetadata{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('migration_metadata_invalid');const m=value as MigrationMetadata;
 try{
  if(m.format!==1||m.scope!=='devone-managed-server'||m.softwareVersion!=='1.0.0-alpha.3'||m.architecture!=='x64'||m.os!=='ubuntu-24.04'||!/^([a-f0-9]{40})$/.test(m.sourceCommit)||!Number.isFinite(Date.parse(m.createdAt))||new URL(m.sourcePanelUrl).protocol!=='https:')throw Error();
  if(!Array.isArray(m.sites)||m.sites.length>100||m.sites.some(s=>!validRecord(s)||!['ready','disabled'].includes(s.state)||s.application&&s.application.stage!=='complete')||new Set(m.sites.map(s=>s.id)).size!==m.sites.length)throw Error();
  const hosts=m.sites.flatMap(s=>[s.domain,...s.aliases??[]]);if(new Set(hosts).size!==hosts.length)throw Error();
  if(!Array.isArray(m.databases)||m.databases.length>500||m.databases.some(d=>!/^db_[a-f0-9]{16}$/.test(d.id)||!m.sites.some(s=>s.id===d.siteId)||!['mariadb','postgresql'].includes(d.engine)||d.name!=='dv'+d.id.slice(3)||d.username!==d.name||d.host!==(d.engine==='mariadb'?'localhost':'127.0.0.1')||d.state!=='ready')||new Set(m.databases.map(d=>d.id)).size!==m.databases.length)throw Error();
  if(!Array.isArray(m.packages)||m.packages.some(p=>!packageIds.includes(p as any))||new Set(m.packages).size!==m.packages.length||typeof m.redis!=='boolean'||m.redis&&!m.packages.includes('redis-server')||m.containerImage!==null&&!/^sha256:[a-f0-9]{64}$/.test(m.containerImage))throw Error();
  if(!Array.isArray(m.tls)||m.tls.some(t=>!m.sites.some(s=>s.id===t.siteId&&(s.tls||s.certificateIssued))||!/^[a-f0-9]{32,64}$/.test(t.account)||!['acme-v02.api.letsencrypt.org','acme-staging-v02.api.letsencrypt.org'].includes(t.server)||!['rsa','ecdsa'].includes(t.keyType))||new Set(m.tls.map(t=>t.siteId)).size!==m.tls.length||m.sites.some(s=>(s.tls||s.certificateIssued)&&!m.tls.some(t=>t.siteId===s.id)))throw Error();
  if(!m.settings||JSON.stringify(safeSettings(Object.entries(m.settings).map(([k,v])=>k+'='+v).join('\n')))!==JSON.stringify(m.settings)||!Array.isArray(m.exclusions)||m.exclusions.some(x=>typeof x!=='string'||x.length>500))throw Error();
  for(const s of m.sites){if(s.siteType==='php'&&!m.packages.includes('php8.3-fpm')||s.siteType==='container'&&(!m.packages.includes('docker.io')||!m.containerImage)||s.application?.appId==='wordpress'&&!m.databases.some(d=>d.id===s.application!.databaseId&&d.siteId===s.id&&d.engine==='mariadb'))throw Error();}
  for(const d of m.databases)if(!m.packages.includes(d.engine==='mariadb'?'mariadb-server':'postgresql'))throw Error();
  return m;
 }catch{throw Error('migration_metadata_invalid');}
}
export function validateMigrationInventory(m:MigrationMetadata,i:Inventory){
 if(!i||!Array.isArray(i.entries)||i.entries.length>200000||!Number.isSafeInteger(i.bytes)||i.bytes<0||i.bytes>1024**4)throw Error('migration_inventory_invalid');
 const files=new Set(i.entries.filter(e=>e.type==='file').map(e=>e.path));
 for(const e of i.entries){
  const p=e.path.split('/');let allowed=false;
  if(p[0]==='payload'){
   if(e.path==='payload/control.devone')allowed=true;
   else if(p[1]==='sites'&&m.sites.some(s=>s.id===p[2]))allowed=true;
   else if(p[1]==='databases'&&p.length===3&&m.databases.some(d=>p[2]===d.id+(d.engine==='mariadb'?'.sql':'.dump')))allowed=true;
   else if(p[1]==='tls'&&m.tls.some(t=>t.siteId===p[2])&&(p.length===3&&e.type==='directory'||p.length===4&&['fullchain.pem','privkey.pem','cert.pem','chain.pem'].includes(p[3])&&e.type==='file'))allowed=true;
   else if(p[1]==='accounts'&&m.tls.some(t=>p[2]===t.server+'_'+t.account)&&(p.length===3&&e.type==='directory'||p.length===4&&['private_key.json','meta.json','regr.json'].includes(p[3])&&e.type==='file'))allowed=true;
   else if(p[1]==='redis'&&m.redis&&p.length===3&&p[2]==='dump.rdb'&&e.type==='file')allowed=true;
   else if(p[1]==='container'&&m.containerImage&&p.length===3&&p[2]==='image.tar'&&e.type==='file')allowed=true;
   else if(p[1]==='backups'&&e.type!=='symlink')allowed=true;
  }
  if(!allowed||!['root','site'].includes(e.owner)||!['file','directory','symlink'].includes(e.type)||e.path.includes('\\')||p.some(x=>!x||x==='.'||x==='..')||!Number.isSafeInteger(e.mode)||e.mode<0||e.mode>0o777||!Number.isFinite(e.mtime))throw Error('migration_inventory_invalid');
 }
 if(!files.has('payload/control.devone'))throw Error('migration_inventory_incomplete');
 for(const s of m.sites)if(!i.entries.some(e=>e.path==='payload/sites/'+s.id+'/public'&&e.type==='directory'))throw Error('migration_inventory_incomplete');
 for(const d of m.databases)if(!files.has('payload/databases/'+d.id+(d.engine==='mariadb'?'.sql':'.dump')))throw Error('migration_inventory_incomplete');
 for(const t of m.tls){for(const name of ['fullchain.pem','privkey.pem','cert.pem','chain.pem'])if(!files.has('payload/tls/'+t.siteId+'/'+name))throw Error('migration_inventory_incomplete');for(const name of ['private_key.json','meta.json','regr.json'])if(!files.has('payload/accounts/'+t.server+'_'+t.account+'/'+name))throw Error('migration_inventory_incomplete');}
 if(m.redis&&!files.has('payload/redis/dump.rdb')||m.containerImage&&!files.has('payload/container/image.tar'))throw Error('migration_inventory_incomplete');
}
export class MigrationEngine{
 readonly sites:SiteManager;readonly databases:DatabaseManager;
 private readonly run:typeof command;
 constructor(readonly config:MigrationConfig,private progress:Progress=async()=>{},private deps:{run?:typeof command;sites?:SiteManager;platform?:()=>Promise<boolean>;install?:typeof softwareInstall}={}){
  this.run=deps.run??command;
  this.sites=deps.sites??new SiteManager({registry:config.registry,base:config.base,nginx:config.nginx,panelDomain:new URL(config.panelUrl).hostname,certificates:join(config.certificates,'live')});
  this.databases=new DatabaseManager({registry:config.databaseRegistry,sites:()=>this.sites.list()});
 }
 private async recovery(){return import(join(sourceRoot,'apps/api/dist/recovery.js'));}
 private async sourceCommit(){const sha=await this.run('/usr/bin/git',['-C',this.config.source,'rev-parse','HEAD']);if(!/^[a-f0-9]{40}$/.test(sha))throw Error('migration_source_invalid');return sha;}
 private async requiredSpace(bytes:number){const s=await statfs(this.config.root);if(s.bavail*s.bsize<bytes+512*1024*1024)throw Error('migration_disk_space_low');}
 private async sqlRoot(engine:string,query:string){return engine==='mariadb'?command('/usr/bin/mariadb',['--no-defaults','--user=root','--protocol=socket','--batch','--skip-column-names'],query):command('/usr/sbin/runuser',['-u','postgres','--','/usr/bin/psql','-X','-w','--set=ON_ERROR_STOP=1','--dbname=postgres','--no-align','--tuples-only'],query);}
 private async coverage(records:SqlRecord[],packages:string[]){
  for(const engine of ['mariadb','postgresql']){
   if(!packages.includes(engine==='mariadb'?'mariadb-server':'postgresql'))continue;
   const all=(await this.sqlRoot(engine,engine==='mariadb'?'SHOW DATABASES;':"SELECT datname FROM pg_database WHERE NOT datistemplate;")).split('\n');
   if(all.some(name=>name&&!['mysql','sys','performance_schema','information_schema','postgres'].includes(name)&&!records.some(d=>d.name===name&&d.engine===engine)))throw Error('migration_unmanaged_database');
   const roles=(await this.sqlRoot(engine,engine==='mariadb'?"SELECT DISTINCT User FROM mysql.user;":"SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%';")).split('\n');
   if(roles.some(role=>role&&!['root','mysql','mariadb.sys','postgres'].includes(role)&&!records.some(d=>d.username===role&&d.engine===engine)))throw Error('migration_unmanaged_database_account');
   if(engine==='mariadb'&&!/^10\.11\./.test(await this.sqlRoot(engine,'SELECT VERSION();')))throw Error('migration_database_version_unsupported');
   if(engine==='postgresql'&&Number(await this.sqlRoot(engine,"SELECT COUNT(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');")))throw Error('migration_unmanaged_database');
   if(engine==='postgresql'&&!/^PostgreSQL 16\./.test(await this.sqlRoot(engine,'SELECT version();')))throw Error('migration_database_version_unsupported');

  }
  const sites=await this.sites.list(),known=new Set([new URL(this.config.panelUrl).hostname,'_','localhost',...sites.flatMap(s=>[s.domain,...s.aliases??[]])]);
  const effective=(await this.run('/usr/sbin/nginx',['-T'])).split('\n').filter(l=>!l.trim().startsWith('#')).join('\n');
  const names=[...effective.matchAll(/\bserver_name\s+([^;]+);/g)].flatMap(x=>x[1].split(/\s+/).map(n=>n.replace(/^['"]|['"]$/g,'')));
  if(names.some(n=>n&&!known.has(n)))throw Error('migration_unmanaged_website');
  for(const site of sites)if(await exists('/var/spool/cron/crontabs/'+site.user))throw Error('migration_unmanaged_site_cron');
  if(await exists('/etc/crowdsec'))throw Error('migration_unmanaged_security_configuration');
  if(packages.includes('docker.io')){
   const containers=(await this.run('/usr/bin/docker',['ps','-a','--format','{{.Names}}'])).split('\n').filter(Boolean),sites=await this.sites.list();
   if(containers.some(name=>!sites.some(s=>s.siteType==='container'&&runtimeContainerName(s.id)===name))||(await this.run('/usr/bin/docker',['volume','ls','-q'])).trim()||(await this.run('/usr/bin/docker',['network','ls','--format','{{.Name}}'])).split('\n').some(n=>n&&!['bridge','host','none'].includes(n)))throw Error('migration_unmanaged_container_resources');
  }
 }
 private async credentials(dbPath:string,keyPath:string,records:SqlRecord[]){
  const vault=await import(join(sourceRoot,'apps/api/dist/vault.js'));const key=vault.readMasterKey(keyPath),db=new DatabaseSync(dbPath,{readOnly:true});
  try{return records.map(record=>{const name='database.'+record.id+'.password';const row=db.prepare('SELECT envelope FROM secrets WHERE name=?').get(name) as {envelope:string}|undefined;if(!row)throw Error('migration_database_credentials_missing');const password=vault.open(key,name,row.envelope);if(!/^[a-f0-9]{64}$/.test(password))throw Error('migration_database_credentials_invalid');return {id:record.id,siteId:record.siteId,engine:record.engine,password} as DatabaseRequest;});}finally{key.fill(0);db.close();}
 }
 private async packages(){const out=[];for(const p of packageIds)if((await this.run('/usr/bin/dpkg-query',['-W','-f=${Status}',p]).catch(()=>'')).trim()==='install ok installed'||p==='postgresql'&&(await this.run('/usr/bin/dpkg-query',['-W','-f=${Status}','postgresql-16']).catch(()=>'')).trim()==='install ok installed')out.push(p);return out;}
 private async tlsExport(sites:Site[],work:string,roots:any[]){
  const result:Tls[]=[];
  for(const site of sites.filter(s=>s.tls||s.certificateIssued)){
   const name='devone-'+site.id,config=await readFile(join(this.config.certificates,'renewal',name+'.conf'),'utf8');
   if(/^(?:pre_hook|post_hook|renew_hook|deploy_hook)\s*=/m.test(config))throw Error('migration_custom_certificate_hook');
   const account=config.match(/^account\s*=\s*([a-f0-9]{32,64})\s*$/m)?.[1],server=config.match(/^server\s*=\s*https:\/\/(acme(?:-staging)?-v02\.api\.letsencrypt\.org)\/directory\s*$/m)?.[1];
   if(!account||!server||!/^authenticator\s*=\s*webroot\s*$/m.test(config))throw Error('migration_unsupported_certificate');
   const keyType=config.match(/^key_type\s*=\s*(rsa|ecdsa)\s*$/m)?.[1]??'rsa';result.push({siteId:site.id,account,server:server as Tls['server'],keyType:keyType as Tls['keyType']});
   const dir=join(work,'tls',site.id);await mkdir(dir,{recursive:true,mode:0o700});
   for(const file of ['fullchain.pem','privkey.pem','cert.pem','chain.pem']){
    const real=await realpath(join(this.config.certificates,'live',name,file));if(!real.startsWith(join(this.config.certificates,'archive',name)+'/'))throw Error('migration_unsafe_certificate');
    const st=await lstat(real);if(!st.isFile()||st.uid!==0||st.size>65536)throw Error('migration_unsafe_certificate');await writeFile(join(dir,file),await readFile(real),{mode:0o600,flag:'wx'});
   }
   this.checkCertificate(site,await readFile(join(dir,'fullchain.pem')),await readFile(join(dir,'privkey.pem')));roots.push({source:dir,archive:'payload/tls/'+site.id});
   const accountName=server+'_'+account,accountDir=join(work,'accounts',accountName);if(!await exists(accountDir)){
    await mkdir(accountDir,{recursive:true,mode:0o700});for(const file of ['private_key.json','meta.json','regr.json']){
     const path=join(this.config.certificates,'accounts',server,'directory',account,file),st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.size>65536)throw Error('migration_unsafe_certificate');
     await writeFile(join(accountDir,file),await readFile(path),{mode:0o600,flag:'wx'});
    }roots.push({source:accountDir,archive:'payload/accounts/'+accountName});
   }
  }return result;
 }
 private checkCertificate(site:Site,cert:Buffer,key:Buffer){const x=new X509Certificate(cert);if(![site.domain,...site.aliases??[]].every(d=>x.checkHost(d))||!x.checkPrivateKey(createPrivateKey(key)))throw Error('migration_certificate_mismatch');}
 private async pause(work:string,sites:Site[]){
  const journal={sites,configs:[] as {id:string;content:string;maintenance:string}[],php:false};
  journal.php=(await this.run('/usr/bin/systemctl',['is-active','php8.3-fpm']).catch(()=>'')).trim()==='active';
  for(const s of sites.filter(s=>s.webServer==='nginx')){const content=await readFile(join(this.config.nginx,'devone-'+s.id+'.conf'),'utf8');const hosts=[s.domain,...s.aliases??[]].join(' ');const maintenance=`server { listen 80; server_name ${hosts}; return 503; }\n`+(s.tls?`server { listen 443 ssl; server_name ${hosts}; ssl_certificate ${join(this.config.certificates,'live','devone-'+s.id,'fullchain.pem')}; ssl_certificate_key ${join(this.config.certificates,'live','devone-'+s.id,'privkey.pem')}; return 503; }\n`:'');journal.configs.push({id:s.id,content,maintenance});}
  await atomicMigrationJson(join(work,'resume.json'),journal);
  for(const c of journal.configs)await atomicFile(join(this.config.nginx,'devone-'+c.id+'.conf'),c.maintenance,0o644);
  await this.run('/usr/sbin/nginx',['-t']);await this.run('/usr/bin/systemctl',['reload','nginx']);
  if(journal.php&&sites.some(s=>s.siteType==='php'))await this.run('/usr/bin/systemctl',['stop','php8.3-fpm']);
  for(const s of sites){if(['node','python'].includes(s.siteType??'')&&s.appActive)await this.run('/usr/bin/systemctl',['stop',nodeUnitName(s.id)]);else if(s.siteType==='container'&&s.appActive)await this.run('/usr/bin/docker',['stop',runtimeContainerName(s.id)]);
   if(s.uid&&(await this.run('/usr/bin/pgrep',['-u',String(s.uid)]).catch(()=>'')).trim())throw Error('migration_unmanaged_site_process');}
 }
 async resume(work:string){
  if(!await exists(join(work,'resume.json')))return;
  const j=await privateMigrationJson(join(work,'resume.json'));if(!Array.isArray(j.sites)||j.sites.some((s:Site)=>!validRecord(s)))throw Error('migration_resume_requires_inspection');
  for(const c of j.configs){if(!j.sites.some((s:Site)=>s.id===c.id))throw Error('migration_resume_requires_inspection');const path=join(this.config.nginx,'devone-'+c.id+'.conf'),now=await readFile(path,'utf8');if(now!==c.maintenance&&now!==c.content)throw Error('migration_resume_requires_inspection');await atomicFile(path,c.content,0o644);}
  await this.run('/usr/sbin/nginx',['-t']);await this.run('/usr/bin/systemctl',['reload','nginx']);
  if(j.php&&j.sites.some((s:Site)=>s.siteType==='php'))await this.run('/usr/bin/systemctl',['start','php8.3-fpm']);
  for(const s of j.sites as Site[])if(s.appActive){if(['node','python'].includes(s.siteType??''))await this.run('/usr/bin/systemctl',['start',nodeUnitName(s.id)]);else if(s.siteType==='container')await this.run('/usr/bin/docker',['start',runtimeContainerName(s.id)]);}
  const current=await this.sites.list();for(const original of j.sites as Site[])if(original.appActive&&!current.find(s=>s.id===original.id)?.appActive)throw Error('migration_resume_requires_inspection');if(j.php&&j.sites.some((s:Site)=>s.siteType==='php')&&(await this.run('/usr/bin/systemctl',['is-active','php8.3-fpm'])).trim()!=='active')throw Error('migration_resume_requires_inspection');for(const site of j.sites as Site[])await this.siteHealth(site);
  await rm(join(work,'resume.json'));
 }
 async export(id:string,passphrase:string,keepSourcePaused=false){
  if(!migrationPassphrase(passphrase))throw Error('migration_passphrase_invalid');
  const work=join(this.config.root,'work',id);await privateMigrationDirectory(work);let paused=false,retainPaused=false;
  try{
   await this.progress('checking-source');const sites=await this.sites.migrationInventory(),databases=await this.databases.list() as SqlRecord[],packages=await this.packages();
   if(databases.some(d=>d.state!=='ready'))throw Error('migration_database_incomplete');await this.coverage(databases,packages);
   const control=new DatabaseSync(this.config.dbPath,{readOnly:true});try{if(Number((control.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued','running')").get() as {n:number}).n))throw Error('migration_jobs_pending');}finally{control.close();}
   if(sites.some(s=>s.siteType==='python')&&!/^Python 3\.12\./.test(await this.run('/usr/bin/python3.12',['--version'])))throw Error('migration_runtime_unavailable');
   const roots:any[]=[],tls=await this.tlsExport(sites,work,roots);
   let containerImage:string|null=null;
   if(sites.some(s=>s.siteType==='container')){containerImage=await this.run('/usr/bin/docker',['image','inspect','--format','{{.Id}}','nginxinc/nginx-unprivileged:stable-alpine']);if(!/^sha256:[a-f0-9]{64}$/.test(containerImage))throw Error('migration_container_image_invalid');}
   const settings=safeSettings(await readFile(this.config.envPath,'utf8'));
   const estimated=Number((await this.run('/usr/bin/du',['--bytes','--summarize',this.config.base],'',{},3600000)).split(/\s+/)[0]);if(!Number.isFinite(estimated))throw Error('migration_source_size_invalid');await this.requiredSpace(estimated*2);
   await this.progress('pausing-website-writes');paused=true;await this.pause(work,sites);
   const recovery=await this.recovery(),db=new DatabaseSync(this.config.dbPath,{readOnly:true});try{const result=await recovery.createRecoveryBundle(db,this.config.keyPath,passphrase,work);await writeFile(join(work,'control.devone'),result.bundle,{mode:0o600,flag:'wx'});}finally{db.close();}
   roots.push({source:join(work,'control.devone'),archive:'payload/control.devone'});
   const credentials=await this.credentials(this.config.dbPath,this.config.keyPath,databases);await this.progress('exporting-databases');
   for(const d of credentials){const path=join(work,d.id+(d.engine==='mariadb'?'.sql':'.dump'));await transferMigrationDatabase(d,path,'export',work);roots.push({source:path,archive:'payload/databases/'+d.id+(d.engine==='mariadb'?'.sql':'.dump')});}
   const redis=packages.includes('redis-server');if(redis){if((await this.run('/usr/bin/redis-cli',['--raw','MODULE','LIST'])).trim())throw Error('migration_redis_modules_unsupported');const path=join(work,'redis.rdb');await this.run('/usr/bin/redis-cli',['--rdb',path],'',{},3600000);await this.run('/usr/bin/redis-check-rdb',[path]);await chmod(path,0o600);roots.push({source:path,archive:'payload/redis/dump.rdb'});}
   if(containerImage){const path=join(work,'image.tar');await migrationStream('/usr/bin/docker',['image','save',containerImage],path,'export');roots.push({source:path,archive:'payload/container/image.tar'});}
   for(const s of sites)roots.push({source:join(this.config.base,s.id),archive:'payload/sites/'+s.id,uid:s.uid});
   if(await exists(this.config.backups)){const uid=Number(await this.run('/usr/bin/id',['-u','devone']));roots.push({source:this.config.backups,archive:'payload/backups',uid});}
   const metadata:MigrationMetadata={format:1,scope:'devone-managed-server',softwareVersion:'1.0.0-alpha.3',sourceCommit:await this.sourceCommit(),architecture:'x64',os:'ubuntu-24.04',createdAt:new Date().toISOString(),sourcePanelUrl:this.config.panelUrl,sites,databases,packages,tls,redis,containerImage,settings,exclusions:['OS image, SSH/root accounts and firewall/network settings','External DNS/Cloudflare/provider resources','Unmanaged applications, storage and custom host configuration','System journal and DevOne migration archives themselves']};validateMigrationMetadata(metadata);
   await this.progress('encrypting-websites-and-data');await this.requiredSpace(512*1024*1024);
   const packer=spawn('/usr/bin/python3',[helper,'pack'],{stdio:['pipe','pipe','ignore']});const closed=new Promise<void>((resolve,reject)=>{packer.on('error',()=>reject(Error('migration_archive_failed')));packer.on('close',code=>code===0?resolve():reject(Error('migration_archive_failed')));});closed.catch(()=>{});packer.stdin.on('error',()=>{});packer.stdin.end(JSON.stringify({metadata,roots}));
   const destination=join(this.config.root,'exports',id+'.devone-migration');await privateMigrationDirectory(dirname(destination));let result;
   try{result=await encryptMigration(packer.stdout,destination,passphrase);await closed;}catch{packer.kill('SIGKILL');await rm(destination,{force:true});throw Error('migration_archive_failed');}
   if(!keepSourcePaused){await this.progress('resuming-websites');await this.resume(work);paused=false;}
   const record={id,sourcePaused:keepSourcePaused,...result,createdAt:metadata.createdAt,sites:sites.length,databases:databases.length,sourcePanelUrl:metadata.sourcePanelUrl,scope:metadata.scope};await atomicMigrationJson(join(this.config.root,'exports',id+'.json'),record);if(keepSourcePaused){retainPaused=true;for(const name of await readdir(work))if(name!=='resume.json')await rm(join(work,name),{recursive:true,force:true});}return record;
  }finally{
   if(paused&&!retainPaused)await this.resume(work);if(!retainPaused)await rm(work,{recursive:true,force:true});
  }
 }
 async inspect(id:string,uploadId:string,passphrase:string){
  const source=join(this.config.root,'uploads',uploadId+'.devone-migration'),work=join(this.config.root,'plans',id);await privateMigrationDirectory(work);
  try{
   await this.progress('authenticating-upload');await this.requiredSpace((await lstat(source)).size*2);const tar=join(work,'verified.tar');await decryptMigration(source,tar,passphrase);
   await this.progress('verifying-files-and-inventory');await this.run('/usr/bin/python3',[helper,'extract',tar,join(work,'stage')],'',{},3600000);await rm(tar);
   const metadata=validateMigrationMetadata(await privateMigrationJson(join(work,'stage','metadata.json'))),inventory=await privateMigrationJson(join(work,'stage','inventory.json'),32*1024*1024) as Inventory;validateMigrationInventory(metadata,inventory);
   for(const t of metadata.tls){const dir=join(work,'stage','payload','tls',t.siteId);this.checkCertificate(metadata.sites.find(s=>s.id===t.siteId)!,await readFile(join(dir,'fullchain.pem')),await readFile(join(dir,'privkey.pem')));}
   const recovery=await this.recovery();await recovery.restoreRecoveryBundle(await readFile(join(work,'stage','payload','control.devone')),passphrase,join(work,'control'));
   await this.credentials(join(work,'control','control.sqlite'),join(work,'control','vault.key'),metadata.databases);
   let blockers:string[]=[];try{await this.preflight(metadata,inventory);}catch(e){blockers=[e instanceof Error&&/^migration_[a-z_]+$/.test(e.message)?e.message:'migration_preflight_failed'];}
   const plan={id,uploadId,compatible:blockers.length===0,blockers,sourceCommit:metadata.sourceCommit,targetCommit:await this.sourceCommit(),sha256:await hashMigrationFile(source),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),sourcePanelUrl:metadata.sourcePanelUrl,targetPanelUrl:this.config.panelUrl,sites:metadata.sites.map(s=>({domain:s.domain,type:s.siteType,aliases:s.aliases??[],tls:s.tls===true})),databases:metadata.databases.map(d=>({name:d.name,engine:d.engine})),bytes:inventory.bytes,packages:metadata.packages,redis:metadata.redis,controlAccountReplacement:true,dnsChanged:false,exclusions:metadata.exclusions};await atomicMigrationJson(join(work,'plan.json'),plan);return plan;
  }catch(error){await rm(work,{recursive:true,force:true});throw error;}
 }
 private async preflight(m:MigrationMetadata,i:Inventory){
  if(m.sourceCommit!==await this.sourceCommit())throw Error('migration_version_mismatch');
  const os=await readFile('/etc/os-release','utf8');if(this.deps.platform?!(await this.deps.platform()):process.arch!=='x64'||!/^ID=ubuntu$/m.test(os)||!/^VERSION_ID="24\.04"$/m.test(os))throw Error('migration_platform_mismatch');
  if((await this.sites.list()).length||(await this.databases.list()).length||(await readdir(this.config.base)).length)throw Error('migration_target_not_fresh');
  if(m.sites.some(s=>[s.domain,...s.aliases??[]].includes(new URL(this.config.panelUrl).hostname)))throw Error('migration_panel_domain_conflict');
  const db=new DatabaseSync(this.config.dbPath,{readOnly:true});try{if(Number((db.prepare('SELECT COUNT(*) AS n FROM users').get() as {n:number}).n)!==1||Number((db.prepare('SELECT COUNT(*) AS n FROM secrets').get() as {n:number}).n)||Number((db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued','running')").get() as {n:number}).n))throw Error('migration_target_not_fresh');}finally{db.close();}
  const installed=await this.packages();await this.coverage([],installed);
  for(const s of m.sites){if(await this.run('/usr/bin/getent',['passwd',s.user]).catch(()=>'')||await exists(join(this.config.nginx,'devone-'+s.id+'.conf'))||await exists(nodeUnitPath(s.id))||await exists(phpPoolPath(s.id)))throw Error('migration_target_conflict');await this.sites.preflight(s);}
  if(installed.includes('redis-server')&&(await this.run('/usr/bin/redis-cli',['--raw','CONFIG','GET','appendonly'])).split('\n').at(-1)!=='no')throw Error('migration_target_redis_configuration');
  if(installed.includes('redis-server')&&(await this.run('/usr/bin/redis-cli',['--raw','INFO','keyspace'])).split('\n').some(line=>/^db\d+:/.test(line)))throw Error('migration_target_redis_not_empty');
  if(await exists(this.config.backups)){const paths=i.entries.filter(e=>e.path.startsWith('payload/backups/'));for(const p of paths)if(await exists(join(this.config.backups,p.path.slice('payload/backups/'.length))))throw Error('migration_target_backup_conflict');}
  for(const t of m.tls)if(await exists(join(this.config.certificates,'live','devone-'+t.siteId))||await exists(join(this.config.certificates,'archive','devone-'+t.siteId))||await exists(join(this.config.certificates,'renewal','devone-'+t.siteId+'.conf')))throw Error('migration_target_certificate_conflict');
  await this.requiredSpace(i.bytes*3);
 }
 async apply(id:string,confirmation:string){
  const work=join(this.config.root,'plans',id),plan=await privateMigrationJson(join(work,'plan.json'));
  if(plan.compatible!==true)throw Error('migration_plan_blocked');
  if(confirmation!==new URL(this.config.panelUrl).hostname||Date.parse(plan.expiresAt)<Date.now())throw Error('migration_plan_expired_or_unconfirmed');
  const metadata=validateMigrationMetadata(await privateMigrationJson(join(work,'stage','metadata.json'))),inventory=await privateMigrationJson(join(work,'stage','inventory.json'),32*1024*1024) as Inventory;
  validateMigrationInventory(metadata,inventory);if(plan.sha256!==await hashMigrationFile(join(this.config.root,'uploads',plan.uploadId+'.devone-migration')))throw Error('migration_upload_changed');
  await this.preflight(metadata,inventory);await this.progress('installing-required-packages');
  const installed=await this.packages();for(const p of metadata.packages)if(!installed.includes(p as any))await (this.deps.install??softwareInstall)({package:p,confirmed:true});
  for(const [pkg,unit] of [['php8.3-fpm','php8.3-fpm'],['redis-server','redis-server'],['mariadb-server','mariadb'],['postgresql','postgresql'],['docker.io','docker']])if(metadata.packages.includes(pkg))await this.run('/usr/bin/systemctl',['start',unit]);
  const journal={sites:[] as string[],databases:[] as SqlRecord[],certificates:[] as string[],backups:[] as string[],controlSwapped:false,redis:false,metadata,pendingSite:'',pendingDatabase:'',pendingCertificate:''};await atomicMigrationJson(join(work,'apply.json'),journal);
  const devoneUid=Number(await this.run('/usr/bin/id',['-u','devone'])),devoneGid=Number(await this.run('/usr/bin/id',['-g','devone']));
  try{
   await this.progress('restoring-sites-and-private-data');
   for(const source of metadata.sites){journal.pendingSite=source.id;await atomicMigrationJson(join(work,'apply.json'),journal);const site=await this.sites.migrationCreate(source);journal.sites.push(source.id);journal.pendingSite='';await atomicMigrationJson(join(work,'apply.json'),journal);
    const path=join(this.config.base,site.id);await cp(join(work,'stage','payload','sites',site.id),path,{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true,filter:async(src,dst)=>{if(dst===path||dst===join(path,'public'))return true;return true;}});
    await this.restoreModes(inventory,'payload/sites/'+site.id,path,site.uid!,site.gid!);await chown(path,0,site.gid!);await chmod(path,0o750);
    if(site.webServer==='nginx'){await this.run('/usr/bin/setfacl',['-m','u:www-data:rx',path]);await this.run('/usr/bin/setfacl',['-R','-m','u:www-data:rX',join(path,'public')]);await this.run('/usr/bin/setfacl',['-m','d:u:www-data:rx',join(path,'public')]);}
   }
   await this.progress('restoring-application-databases');const credentials=await this.credentials(join(work,'control','control.sqlite'),join(work,'control','vault.key'),metadata.databases);
   for(const d of credentials){journal.pendingDatabase=d.id;await atomicMigrationJson(join(work,'apply.json'),journal);await this.databases.createForLockedSite(d,d.siteId);journal.databases.push(metadata.databases.find(r=>r.id===d.id)!);journal.pendingDatabase='';await atomicMigrationJson(join(work,'apply.json'),journal);await transferMigrationDatabase(d,join(work,'stage','payload','databases',d.id+(d.engine==='mariadb'?'.sql':'.dump')),'import',work);}
   await this.progress('restoring-certificates-and-supporting-data');
   for(const t of metadata.tls){journal.pendingCertificate=t.siteId;await atomicMigrationJson(join(work,'apply.json'),journal);await this.restoreTls(t,work);journal.certificates.push(t.siteId);journal.pendingCertificate='';await atomicMigrationJson(join(work,'apply.json'),journal);}
   if(metadata.redis){await this.run('/usr/bin/redis-check-rdb',[join(work,'stage','payload','redis','dump.rdb')]);await this.run('/usr/bin/systemctl',['stop','redis-server']);if(await exists('/var/lib/redis/dump.rdb'))await copyFile('/var/lib/redis/dump.rdb',join(work,'redis-before.rdb'));journal.redis=true;await atomicMigrationJson(join(work,'apply.json'),journal);await copyFile(join(work,'stage','payload','redis','dump.rdb'),'/var/lib/redis/dump.rdb');await chown('/var/lib/redis/dump.rdb',Number(await this.run('/usr/bin/id',['-u','redis'])),Number(await this.run('/usr/bin/id',['-g','redis'])));await chmod('/var/lib/redis/dump.rdb',0o600);await this.run('/usr/bin/systemctl',['start','redis-server']);if(await this.run('/usr/bin/redis-cli',['PING'])!=='PONG')throw Error('migration_redis_restore_failed');}
   if(metadata.containerImage){await migrationStream('/usr/bin/docker',['image','load'],join(work,'stage','payload','container','image.tar'),'import');await this.run('/usr/bin/docker',['tag',metadata.containerImage,'nginxinc/nginx-unprivileged:stable-alpine']);if(await this.run('/usr/bin/docker',['image','inspect','--format','{{.Id}}','nginxinc/nginx-unprivileged:stable-alpine'])!==metadata.containerImage)throw Error('migration_container_image_invalid');}
   const backups=join(work,'stage','payload','backups');if(await exists(backups)){await mkdir(this.config.backups,{recursive:true,mode:0o700});for(const name of await readdir(backups)){journal.backups.push(name);await atomicMigrationJson(join(work,'apply.json'),journal);await cp(join(backups,name),join(this.config.backups,name),{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true});}await this.restoreModes(inventory,'payload/backups',this.config.backups,devoneUid,devoneGid);await chown(this.config.backups,devoneUid,devoneGid);}
   await this.progress('starting-and-checking-applications');for(const s of metadata.sites){await this.sites.migrationActivate(s,true);await this.siteHealth(s);}
   await this.progress('activating-recovered-panel-accounts');
   await this.run('/usr/bin/systemctl',['stop','devone-api']);
   await copyFile(this.config.dbPath,join(work,'target-before.sqlite'));await copyFile(this.config.keyPath,join(work,'target-before.key'));await copyFile(this.config.envPath,join(work,'target-before.env'));
   journal.controlSwapped=true;await atomicMigrationJson(join(work,'apply.json'),journal);
   await rm(this.config.dbPath+'-wal',{force:true});await rm(this.config.dbPath+'-shm',{force:true});
   await atomicFile(this.config.dbPath,await readFile(join(work,'control','control.sqlite')),0o600,devoneUid,devoneGid);await atomicFile(this.config.keyPath,await readFile(join(work,'control','vault.key')),0o640,0,devoneGid);
   let env=await readFile(this.config.envPath,'utf8');for(const [key,value] of Object.entries(metadata.settings)){env=env.split('\n').filter(l=>!l.startsWith(key+'=')).join('\n')+'\n'+key+'='+value+'\n';}await atomicFile(this.config.envPath,env,0o640,0,devoneGid);
   await this.run('/usr/bin/systemctl',['start','devone-api']);await this.panelHealth();await this.sites.migrationPublish(metadata.sites);
   const result={id,status:'succeeded',sites:metadata.sites.length,databases:metadata.databases.length,sourcePanelUrl:metadata.sourcePanelUrl,targetPanelUrl:this.config.panelUrl,dnsChanged:false,needsDnsCutover:true,loginWithSourceAccount:true,finishedAt:new Date().toISOString()};await atomicMigrationJson(join(work,'result.json'),result);return result;
  }catch(error){await this.progress('rolling-back-destination');try{await this.rollback(id);}catch{throw Error('migration_rollback_requires_inspection');}throw error;}
 }
 private async restoreModes(i:Inventory,prefix:string,root:string,uid:number,gid:number){
  for(const entry of [...i.entries].filter(e=>e.path===prefix||e.path.startsWith(prefix+'/')).reverse()){
   const path=entry.path===prefix?root:join(root,entry.path.slice(prefix.length+1));if(entry.type==='symlink'){await lchown(path,entry.owner==='root'?0:uid,gid);await lutimes(path,entry.mtime,entry.mtime);continue;}await chown(path,entry.owner==='root'?0:uid,gid);await chmod(path,entry.mode);await utimes(path,entry.mtime,entry.mtime);
  }
 }
 private async restoreTls(t:Tls,work:string){
  const root=this.config.certificates,name='devone-'+t.siteId,stage=join(work,'stage','payload','tls',t.siteId),archive=join(root,'archive',name),live=join(root,'live',name);
  await mkdir(archive,{mode:0o700});await mkdir(live,{mode:0o700});
  for(const file of ['cert','chain','fullchain','privkey']){await copyFile(join(stage,file+'.pem'),join(archive,file+'1.pem'),constants.COPYFILE_EXCL);await chmod(join(archive,file+'1.pem'),0o600);await symlink('../../archive/'+name+'/'+file+'1.pem',join(live,file+'.pem'));}
  const account=join(root,'accounts',t.server,'directory',t.account);await mkdir(account,{recursive:true,mode:0o700});for(const f of ['private_key.json','meta.json','regr.json']){const data=await readFile(join(work,'stage','payload','accounts',t.server+'_'+t.account,f));JSON.parse(data.toString('utf8'));if(await exists(join(account,f))){if(!data.equals(await readFile(join(account,f))))throw Error('migration_certificate_account_conflict');}else await writeFile(join(account,f),data,{mode:0o600,flag:'wx'});}
  const config=`version = 2.9.0\narchive_dir = ${archive}\ncert = ${live}/cert.pem\nprivkey = ${live}/privkey.pem\nchain = ${live}/chain.pem\nfullchain = ${live}/fullchain.pem\n\n[renewalparams]\naccount = ${t.account}\nserver = https://${t.server}/directory\nauthenticator = webroot\nwebroot_path = /var/www/devone-acme,\nkey_type = ${t.keyType}\n`;
  await writeFile(join(root,'renewal',name+'.conf'),config,{mode:0o600,flag:'wx'});
 }
 private async siteHealth(s:Site){
  if(s.webServer==='none'||['node','python','container'].includes(s.siteType??'')&&!s.appActive)return;const path=s.application?.appId==='wordpress'?'/wp-login.php':s.application?.appId==='devone-cms-v2'?'/api/health':'/';
  // Inspect loopback using the registered Host and trusted TLS/SNI before DNS moves.
  const result=await new Promise<{status:number;body:string}>((resolve,reject)=>{const r=(s.tls?httpsRequest:httpRequest)({host:'127.0.0.1',port:s.tls?443:80,servername:s.domain,path,headers:{Host:s.domain},timeout:5000},response=>{let body='';response.on('data',b=>{body+=b;if(Buffer.byteLength(body)>512*1024)r.destroy(Error());});response.on('end',()=>resolve({status:response.statusCode??0,body}));});r.on('timeout',()=>r.destroy(Error()));r.on('error',reject);r.end();});
  if(s.state==='disabled'){if(result.status!==410&&result.status!==301)throw Error('migration_site_health_failed');return;}
  else if(result.status<200||result.status>=500)throw Error('migration_site_health_failed');
  if(s.application?.appId==='wordpress'&&!result.body.includes('wp-login'))throw Error('migration_application_health_failed');
  if(s.application?.appId==='devone-cms-v2'){let value:any;try{value=JSON.parse(result.body);}catch{throw Error('migration_application_health_failed');}if(value.ok!==true)throw Error('migration_application_health_failed');}
 }
 private async panelHealth(){for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:8787/api/health',{signal:AbortSignal.timeout(1000),redirect:'error'});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('migration_panel_health_failed');}
 async rollback(id:string){
  const work=join(this.config.root,'plans',id),j=await privateMigrationJson(join(work,'apply.json'));validateMigrationMetadata(j.metadata);if(j.pendingSite||j.pendingDatabase||j.pendingCertificate)throw Error('migration_rollback_requires_inspection');await this.run('/usr/bin/systemctl',['stop','devone-api']);
  if(j.controlSwapped){const uid=Number(await this.run('/usr/bin/id',['-u','devone'])),gid=Number(await this.run('/usr/bin/id',['-g','devone']));await rm(this.config.dbPath+'-wal',{force:true});await rm(this.config.dbPath+'-shm',{force:true});await atomicFile(this.config.dbPath,await readFile(join(work,'target-before.sqlite')),0o600,uid,gid);await atomicFile(this.config.keyPath,await readFile(join(work,'target-before.key')),0o640,0,gid);await atomicFile(this.config.envPath,await readFile(join(work,'target-before.env')),0o640,0,gid);}
  for(const id of [...j.sites].reverse()){
   if(!/^site_[a-f0-9]{16}$/.test(id)||!j.metadata.sites.some((s:Site)=>s.id===id))throw Error('migration_rollback_requires_inspection');
   await this.run('/usr/bin/systemctl',['disable','--now',nodeUnitName(id)]).catch(()=>{});const label=await this.run('/usr/bin/docker',['inspect','--format','{{index .Config.Labels "devone.site"}}',runtimeContainerName(id)]).catch(()=>'');if(label&&label!==id)throw Error('migration_rollback_requires_inspection');if(label)await this.run('/usr/bin/docker',['rm','-f',runtimeContainerName(id)]);
   const tracked=(await this.sites.list()).find(s=>s.id===id);const vhost=join(this.config.nginx,'devone-'+id+'.conf');if(await exists(vhost)&&tracked?.configHash&&createHash('sha256').update(await readFile(vhost)).digest('hex')!==tracked.configHash)throw Error('migration_rollback_requires_inspection');
   for(const path of [vhost,nodeUnitPath(id),phpPoolPath(id)])if(await exists(path)){const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.uid!==0)throw Error('migration_rollback_requires_inspection');await rm(path);}
   const user='dvs_'+id.slice(5),passwd=await this.run('/usr/bin/getent',['passwd',user]).catch(()=>'');if(passwd){if(passwd.split(':')[5]!==join(this.config.base,id))throw Error('migration_rollback_requires_inspection');await this.run('/usr/sbin/userdel',[user]);}
   const home=join(this.config.base,id);if(await exists(home)){const st=await lstat(home);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0)throw Error('migration_rollback_requires_inspection');await rm(home,{recursive:true});}
  }
  for(const d of j.databases as SqlRecord[]){if(!j.metadata.databases.some((x:SqlRecord)=>x.id===d.id&&x.name===d.name)||!/^dv[a-f0-9]{16}$/.test(d.name))throw Error('migration_rollback_requires_inspection');await this.sqlRoot(d.engine,d.engine==='mariadb'?`DROP DATABASE IF EXISTS \`${d.name}\`; DROP USER IF EXISTS '${d.name}'@'localhost';`:`DROP DATABASE IF EXISTS "${d.name}"; DROP ROLE IF EXISTS "${d.name}";`);}
  for(const id of j.certificates){if(!j.metadata.tls.some((t:Tls)=>t.siteId===id))throw Error('migration_rollback_requires_inspection');for(const path of [join(this.config.certificates,'live','devone-'+id),join(this.config.certificates,'archive','devone-'+id),join(this.config.certificates,'renewal','devone-'+id+'.conf')])await rm(path,{force:true,recursive:true});}
  for(const name of j.backups){if(typeof name!=='string'||name.includes('/')||name==='.'||name==='..')throw Error('migration_rollback_requires_inspection');await rm(join(this.config.backups,name),{recursive:true,force:true});}
  if(j.redis){await this.run('/usr/bin/systemctl',['stop','redis-server']);if(await exists(join(work,'redis-before.rdb')))await copyFile(join(work,'redis-before.rdb'),'/var/lib/redis/dump.rdb');else await rm('/var/lib/redis/dump.rdb',{force:true});await this.run('/usr/bin/systemctl',['start','redis-server']);}
  await atomicMigrationJson(join(this.config.registry,'sites.json'),[]);await atomicMigrationJson(join(this.config.databaseRegistry,'databases.json'),[]);
  await this.run('/usr/bin/systemctl',['daemon-reload']);await this.run('/usr/sbin/nginx',['-t']);await this.run('/usr/bin/systemctl',['reload','nginx']);await this.run('/usr/bin/systemctl',['reload','php8.3-fpm']).catch(()=>{});await this.run('/usr/bin/systemctl',['start','devone-api']);await this.panelHealth();await atomicMigrationJson(join(work,'rolled-back.json'),{at:new Date().toISOString()});
 }
}
