import { constants } from 'node:fs';
import { open, mkdir, lstat, rename, chown, rmdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID, createHash, X509Certificate } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDomain, relativeParts, MAX_FILE_BYTES } from './site-files.js';

const exec = promisify(execFile);
export type Site = { id: string; domain: string; user: string; uid?: number; gid?: number; webServer: 'nginx' | 'none'; state: 'provisioning' | 'ready' | 'disabled' | 'updating' | 'needs_inspection'; createdAt: string; aliases?: string[]; revision?: number; configHash?: string; tls?: boolean; certificateIssued?: boolean };
type Options = { registry: string; base: string; nginx: string; panelDomain: string; requireRoot?: boolean; certificates?: string; ownership?: typeof chown; worker?: (site: Site,request: Record<string,unknown>) => Promise<unknown>; command?: (command: string, args: string[]) => Promise<string> };
export function siteInput(input: unknown): { domain: string; webServer: 'nginx' | 'none' } {
  if (!input || typeof input !== 'object') throw new Error('invalid_site');
  const body = input as Record<string,unknown>;
  const domain = validateDomain(body.domain);
  if (body.webServer !== 'nginx' && body.webServer !== 'none') throw new Error('invalid_web_server');
  return { domain, webServer: body.webServer };
}
function validRecord(site: Site) {
  return /^site_[a-f0-9]{16}$/.test(site.id) && site.user === `dvs_${site.id.slice(5)}` && validateDomain(site.domain) === site.domain && ['nginx','none'].includes(site.webServer) && ['provisioning','ready','disabled','updating','needs_inspection'].includes(site.state) && (site.aliases === undefined || Array.isArray(site.aliases) && site.aliases.length <= 20 && site.aliases.every(alias => validateDomain(alias) === alias)) && (site.revision === undefined || Number.isSafeInteger(site.revision) && site.revision >= 1) && (site.tls === undefined || typeof site.tls === 'boolean') && (site.certificateIssued === undefined || typeof site.certificateIssued === 'boolean') && (site.configHash === undefined || /^[a-f0-9]{64}$/.test(site.configHash)) && (site.uid === undefined || Number.isInteger(site.uid) && site.uid >= 1000) && (site.gid === undefined || Number.isInteger(site.gid) && site.gid >= 1000);
}
export class SiteManager {
  private runningSite: string | null = null;
  private fileActive = 0;
  private filePending = 0;
  private fileQueues = new Map<string,Promise<unknown>>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly command: (command: string, args: string[]) => Promise<string>;
  constructor(private options: Options) {
    this.command = options.command ?? (async (command,args) => (await exec(command,args,{timeout:command === 'certbot' ? 180000 : 30000,maxBuffer:command === 'nginx' && args[0] === '-T' ? 1048576 : 65536})).stdout);
  }
  private async registry(): Promise<Site[]> {
    if (this.options.requireRoot !== false && process.getuid?.() !== 0) throw new Error('root_agent_required');
    await mkdir(this.options.registry, { mode: 0o700, recursive: true });
    const directory = await lstat(this.options.registry);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) || (this.options.requireRoot !== false && directory.uid !== 0)) throw new Error('unsafe_registry');
    let handle;
    try { handle = await open(join(this.options.registry,'sites.json'), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1048576 || (stat.mode & 0o077) || (this.options.requireRoot !== false && stat.uid !== 0)) throw new Error('unsafe_registry');
      const sites = JSON.parse(await handle.readFile('utf8')) as Site[];
      if (!Array.isArray(sites) || sites.length > 100 || sites.some(site => !validRecord(site)) || new Set(sites.map(site => site.id)).size !== sites.length || new Set(sites.flatMap(site=>[site.domain,...(site.aliases ?? [])])).size !== sites.flatMap(site=>[site.domain,...(site.aliases ?? [])]).length) throw new Error('invalid_registry');
      return sites;
    } finally { await handle.close(); }
  }
  private async save(sites: Site[]) {
    const temporary = join(this.options.registry,`.sites-${randomUUID()}`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify(sites)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary,join(this.options.registry,'sites.json'));
    const directory = await open(this.options.registry,constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async list() {
    const sites = await this.registry();
    // In-progress provisioning is never replayed automatically after a restart.
    return sites.map(site => ({ ...site, state: ['provisioning','updating'].includes(site.state) && this.runningSite !== site.id ? 'needs_inspection' : site.state }));
  }
  private serial<T>(work:()=>Promise<T>,siteId?:unknown) {
    const operation = this.queue.then(async()=>{
      this.runningSite = typeof siteId === 'string' ? siteId : null;
      try {return await work();}finally{this.runningSite=null;}
    });
    this.queue=operation.catch(()=>{});return operation;
  }
  // Advisory only: queued changes revalidate conflicts before mutation.
  async preflight(input: unknown) {
    const body = input as {domain?:unknown;webServer?:unknown;aliases?:unknown;siteId?:unknown;expectedRevision?:unknown} | null;
    if (!body || !['nginx','none'].includes(body.webServer as string)) throw new Error('invalid_web_server');
    const domain = validateDomain(body.domain);
    const aliases = body.aliases === undefined ? [] : body.aliases;
    if (!Array.isArray(aliases) || aliases.length > 20 || aliases.some(alias=>validateDomain(alias) !== alias)) throw new Error('invalid_aliases');
    const hosts = [domain,...aliases] as string[];
    if (new Set(hosts).size !== hosts.length || hosts.includes(this.options.panelDomain)) throw new Error('domain_in_use');
    const sites = await this.registry();
    const existing = body.siteId === undefined ? null : sites.find(site=>site.id === body.siteId);
    if (body.siteId !== undefined && (!existing || existing.revision !== body.expectedRevision || !['ready','disabled'].includes(existing.state) || existing.tls || existing.webServer !== body.webServer)) throw new Error('site_not_ready');
    if (sites.some(site=>site.id !== existing?.id && [site.domain,...(site.aliases ?? [])].some(name=>hosts.includes(name)))) throw new Error('domain_in_use');
    if (body.webServer === 'nginx') {
      const config = await this.command('nginx',['-T']);
      const ownPath = existing ? join(this.options.nginx,`devone-${existing.id}.conf`) : null;
      let own = false;
      const filtered = config.split('\n').filter(line=>{
        if (line.startsWith('# configuration file ')) own = ownPath !== null && line === `# configuration file ${ownPath}:`;
        return !own;
      }).join('\n');
      const names = [...filtered.matchAll(/\bserver_name\s+([^;]+);/g)].flatMap(match=>match[1].split(/\s+/).map(name=>name.replace(/^[\x27\x22]|[\x27\x22]$/g,'')));
      if (names.some(name=>hosts.some(host=>name === host || name.startsWith('~') || name.charCodeAt(0) === 36 || (name.startsWith('*.') && host.endsWith(name.slice(1))) || (name.startsWith('.') && (host === name.slice(1) || host.endsWith(name))) || (name.endsWith('.*') && host.startsWith(name.slice(0,-1)))))) throw new Error('domain_in_use');
    }
    return {available:true,hosts,webServer:body.webServer,advisory:true};
  }
  create(input: unknown) { return this.serial(()=>this.provision(input)); }
  private async provision(input: unknown) {
    const {domain,webServer} = siteInput(input);
    const sites = await this.registry();
    if (domain === this.options.panelDomain || sites.some(site => [site.domain,...(site.aliases ?? [])].includes(domain))) throw new Error('domain_in_use');
    if (sites.length >= 100) throw new Error('site_limit');
    if (webServer === 'nginx') {
      // Refuse duplicate or wildcard ownership anywhere in effective configuration.
      const config = await this.command('nginx',['-T']);
      const names = [...config.matchAll(/\bserver_name\s+([^;]+);/g)].flatMap(match => match[1].split(/\s+/).map(name => name.replace(/^['"]|['"]$/g,'')));
      if (names.some(name => name === domain || name.startsWith('~') || name.startsWith('$') || (name.startsWith('*.') && domain.endsWith(name.slice(1))) || (name.startsWith('.') && (domain === name.slice(1) || domain.endsWith(name))) || (name.endsWith('.*') && domain.startsWith(name.slice(0,-1))))) throw new Error('domain_in_use');
    }
    const id = `site_${randomBytes(8).toString('hex')}`;
    const site: Site = {id,domain,user:`dvs_${id.slice(5)}`,webServer,state:'provisioning',createdAt:new Date().toISOString(),aliases:[],revision:1};
    this.runningSite = id;
    sites.push(site); await this.save(sites);
    let ownedConfig: string | undefined;
    try {
      await this.command('useradd',['--user-group','--no-create-home','--home-dir',join(this.options.base,id),'--shell','/usr/sbin/nologin',site.user]);
      const passwd = (await this.command('getent',['passwd',site.user])).trim().split(':');
      site.uid = Number(passwd[2]); site.gid = Number(passwd[3]);
      if (passwd[0] !== site.user || !Number.isInteger(site.uid) || site.uid < 1000 || !Number.isInteger(site.gid) || site.gid < 1000 || passwd[5] !== join(this.options.base,id) || passwd[6] !== '/usr/sbin/nologin') throw new Error('invalid_site_identity');
      await mkdir(this.options.base,{recursive:true,mode:0o755});
      const base = await lstat(this.options.base);
      if (!base.isDirectory() || base.isSymbolicLink() || (base.mode & 0o022) || (this.options.requireRoot !== false && base.uid !== 0)) throw new Error('unsafe_site_base');
      const home = join(this.options.base,id), publicRoot = join(home,'public');
      await mkdir(home,{mode:0o750}); await (this.options.ownership ?? chown)(home,process.getuid!(),site.gid);
      await mkdir(publicRoot,{mode:0o750}); await (this.options.ownership ?? chown)(publicRoot,site.uid,site.gid);
      if (webServer === 'nginx') {
        await this.command('setfacl',['-m','u:www-data:rx',home]);
        await this.command('setfacl',['-m','u:www-data:rx,d:u:www-data:rx',publicRoot]);
        const destination = join(this.options.nginx,`devone-${id}.conf`);
        // Exclusive creation never replaces host-owned configurations.
        const config = await open(destination,constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,0o644);
        ownedConfig = destination;
        try { const content = this.configuration(site); await config.writeFile(content); await config.sync(); site.configHash = this.digest(content); } finally { await config.close(); }
        await this.command('nginx',['-t']); await this.command('systemctl',['reload','nginx']);
      }
      site.state = 'ready'; await this.save(sites); return site;
    } catch {
      if (ownedConfig) {
        try { await rename(ownedConfig,join(this.options.registry,`${id}.nginx-quarantine`)); await this.command('nginx',['-t']); await this.command('systemctl',['reload','nginx']); } catch { /* Recovery needs operator inspection. */ }
      }
      site.state = 'needs_inspection'; await this.save(sites);
      // Preserve partial resources for inspection; never delete unknown host data.
      throw new Error('site_provisioning_requires_inspection');
    }
  }
  private digest(content: string) { return createHash('sha256').update(content).digest('hex'); }
  private configuration(site: Site) {
    const hosts = [site.domain,...(site.aliases ?? [])].join(' ');
    const challenge = ' location ^~ /.well-known/acme-challenge/ { root /var/www/devone-acme; try_files $uri =404; }\n';
    const body = site.state === 'disabled' ? ' location / { return 410; }\n' : ` root ${join(this.options.base,site.id,'public')};\n index index.html;\n disable_symlinks on;\n location / { try_files $uri $uri/ =404; }\n location ~ /\\. { deny all; }\n`;
    const http = `server {\n listen 80;\n listen [::]:80;\n server_name ${hosts};\n${challenge}${site.tls && site.state !== 'disabled' ? ' location / { return 301 https://$host$request_uri; }\n' : body}}\n`;
    if (!site.tls) return http;
    const certificate = join(this.options.certificates ?? '/etc/letsencrypt/live',`devone-${site.id}`);
    return http+`server {\n listen 443 ssl;\n listen [::]:443 ssl;\n server_name ${hosts};\n ssl_certificate ${certificate}/fullchain.pem;\n ssl_certificate_key ${certificate}/privkey.pem;\n ssl_protocols TLSv1.2 TLSv1.3;\n${body}}\n`;
  }
  async tlsStatus(siteId: unknown) {
    if (typeof siteId !== 'string' || !/^site_[a-f0-9]{16}$/.test(siteId)) throw new Error('invalid_site');
    const site = (await this.registry()).find(site=>site.id === siteId);
    if (!site) throw new Error('site_not_found');
    if (site.webServer !== 'nginx') return {siteId,enabled:false,status:'not_applicable',expiresAt:null,daysRemaining:null};
    const certificatePath = join(this.options.certificates ?? '/etc/letsencrypt/live',`devone-${site.id}`,'fullchain.pem');
    try {
      const certificate = new X509Certificate(await readFile(certificatePath));
      const expires = Date.parse(certificate.validTo);
      const coversDomains = [site.domain,...(site.aliases ?? [])].every(domain=>Boolean(certificate.checkHost(domain)));
      const daysRemaining = Number.isFinite(expires) ? Math.floor((expires-Date.now())/86400000) : null;
      const status = !coversDomains ? 'domain_mismatch' : daysRemaining === null ? 'invalid' : daysRemaining < 0 ? 'expired' : daysRemaining <= 30 ? 'expiring' : 'valid';
      return {siteId,enabled:site.tls === true,status,expiresAt:Number.isFinite(expires) ? new Date(expires).toISOString() : null,daysRemaining,coversDomains};
    } catch (error) {
      return {siteId,enabled:site.tls === true,status:(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid',expiresAt:null,daysRemaining:null};
    }
  }
  tls(input: unknown) { return this.serial(()=>this.certificate(input),(input as {siteId?:unknown}|null)?.siteId); }
  private async certificate(input: unknown) {
    const body = input as {siteId?:unknown;action?:unknown;expectedRevision?:unknown;email?:unknown;agreeTerms?:unknown} | null;
    if (!body || typeof body.siteId !== 'string' || !['issue','renew','disable'].includes(body.action as string) || !Number.isSafeInteger(body.expectedRevision)) throw new Error('invalid_tls_operation');
    if (body.action === 'issue' && (body.agreeTerms !== true || typeof body.email !== 'string' || body.email.length > 254 || !/^[a-zA-Z0-9][a-zA-Z0-9._+%-]*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/.test(body.email))) throw new Error('invalid_tls_consent');
    const sites = await this.registry(),site = sites.find(site=>site.id === body.siteId);
    if (!site || site.state !== 'ready' || site.webServer !== 'nginx') throw new Error('site_not_ready');
    if ((site.revision ?? 1) !== body.expectedRevision) throw new Error('site_revision_conflict');
    if (body.action === 'renew' && !site.tls) throw new Error('invalid_tls_operation');
    const destination = join(this.options.nginx,`devone-${site.id}.conf`);
    const handle = await open(destination,constants.O_RDONLY | constants.O_NOFOLLOW);
    let previous: string;
    try {const stat=await handle.stat();if(!stat.isFile() || stat.nlink !== 1 || stat.size > 65536 || (this.options.requireRoot !== false && stat.uid !== 0)) throw new Error('unsafe_site_config');previous=await handle.readFile('utf8');}finally{await handle.close();}
    if (!site.configHash || this.digest(previous) !== site.configHash) throw new Error('site_config_changed');
    const before={...site};site.state='updating';await this.save(sites);
    try {
      // Include a challenge location before requesting, without changing other
      // virtual hosts or accepting a caller-supplied certificate path.
      site.state='ready';await this.writeConfig(destination,this.configuration(site));
      await this.command('nginx',['-t']);await this.command('systemctl',['reload','nginx']);
      const certName=`devone-${site.id}`;
      if (body.action === 'issue') await this.command('certbot',['certonly','--webroot','--webroot-path','/var/www/devone-acme','--cert-name',certName,'--non-interactive','--agree-tos','--email',body.email as string,'--keep-until-expiring','--renew-with-new-domains',...[site.domain,...(site.aliases ?? [])].flatMap(domain=>['-d',domain])]);
      else if(body.action === 'renew') await this.command('certbot',['renew','--cert-name',certName,'--non-interactive']);
      site.tls=body.action !== 'disable';
      if(body.action === 'issue') site.certificateIssued=true;
      await this.writeConfig(destination,this.configuration(site));await this.command('nginx',['-t']);await this.command('systemctl',['reload','nginx']);
      site.configHash=this.digest(this.configuration(site));site.revision=(before.revision ?? 1)+1;await this.save(sites);return site;
    } catch {
      try {await this.writeConfig(destination,previous);await this.command('nginx',['-t']);await this.command('systemctl',['reload','nginx']);}catch{ /* Inspection required. */ }
      Object.assign(site,before,{state:'needs_inspection'});await this.save(sites);throw new Error('site_tls_requires_inspection');
    }
  }
  action(input: unknown) { return this.serial(()=>this.lifecycle(input),(input as {siteId?:unknown}|null)?.siteId); }
  private async lifecycle(input: unknown) {
    const body = input as {siteId?:unknown;action?:unknown;expectedRevision?:unknown;domain?:unknown;aliases?:unknown;confirmDomain?:unknown} | null;
    if (!body || typeof body.siteId !== 'string' || !['update','disable','enable','delete'].includes(body.action as string) || !Number.isSafeInteger(body.expectedRevision)) throw new Error('invalid_site_action');
    const sites = await this.registry(), site = sites.find(site=>site.id === body.siteId);
    if (!site || !['ready','disabled'].includes(site.state)) throw new Error('site_not_ready');
    if ((site.revision ?? 1) !== body.expectedRevision) throw new Error('site_revision_conflict');
    const before = {...site,aliases:[...(site.aliases ?? [])]};
    if (body.action === 'delete' && body.confirmDomain !== site.domain) throw new Error('invalid_delete_confirmation');
    if (body.action === 'update' && site.tls) throw new Error('invalid_tls_domain_change');
    const domain = body.action === 'update' ? validateDomain(body.domain) : site.domain;
    const aliases = body.action === 'update' ? body.aliases : site.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.length > 20 || aliases.some(alias=>validateDomain(alias) !== alias)) throw new Error('invalid_aliases');
    const hosts = [domain,...aliases];
    if (new Set(hosts).size !== hosts.length || hosts.includes(this.options.panelDomain) || sites.some(other=>other.id !== site.id && [other.domain,...(other.aliases ?? [])].some(host=>hosts.includes(host)))) throw new Error('domain_in_use');
    const destination = join(this.options.nginx,`devone-${site.id}.conf`);
    let previous: string | undefined;
    if (site.webServer === 'nginx') {
      const handle = await open(destination,constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536 || (this.options.requireRoot !== false && stat.uid !== 0)) throw new Error('unsafe_site_config');
        previous = await handle.readFile('utf8');
      } finally { await handle.close(); }
      if (!site.configHash || this.digest(previous) !== site.configHash) throw new Error('site_config_changed');
      if (body.action === 'update') {
        const effective = await this.command('nginx',['-T']);
        // NGINX -T identifies each source file; exclude only the tracked one.
        let own = false; const lines: string[] = [];
        for (const line of effective.split('\n')) {
          if (line.startsWith('# configuration file ')) own = line === `# configuration file ${destination}:`;
          if (!own) lines.push(line);
        }
        const names = [...lines.join('\n').matchAll(/\bserver_name\s+([^;]+);/g)].flatMap(match=>match[1].split(/\s+/).map(name=>name.replace(/^['"]|['"]$/g,'')));
        if (names.some(name=>hosts.some(host=>name === host || name.startsWith('~') || name.startsWith('$') || name.startsWith('*.') && host.endsWith(name.slice(1)) || name.startsWith('.') && (host === name.slice(1) || host.endsWith(name)) || name.endsWith('.*') && host.startsWith(name.slice(0,-1))))) throw new Error('domain_in_use');
      }
    }
    site.state = 'updating'; await this.save(sites);
    let destructiveStarted = false;
    try {
      await this.fileQueues.get(site.id)?.catch(()=>{});
      site.domain = domain; site.aliases = aliases;
      site.state = body.action === 'disable' ? 'disabled' : body.action === 'enable' ? 'ready' : before.state;
      if (previous !== undefined) {
        if (body.action === 'delete') await rename(destination,join(this.options.registry,`${site.id}.deleted-nginx`));
        else await this.writeConfig(destination,this.configuration(site));
        await this.command('nginx',['-t']); await this.command('systemctl',['reload','nginx']);
        if (body.action !== 'delete') site.configHash = this.digest(this.configuration(site));
      }
      if (body.action === 'delete') {
        const home = join(this.options.base,site.id), stat = await lstat(home);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (this.options.requireRoot !== false && stat.uid !== 0)) throw new Error('unsafe_site_home');
        const passwd = (await this.command('getent',['passwd',site.user])).trim().split(':');
        if (passwd[0] !== site.user || Number(passwd[2]) !== site.uid || Number(passwd[3]) !== site.gid || passwd[5] !== home || passwd[6] !== '/usr/sbin/nologin') throw new Error('site_identity_changed');
        // userdel refuses an account with running processes. No force or -r:
        // contents are purged by the unprivileged worker; root only uses rmdir.
        destructiveStarted = true;
        await this.command('userdel',[site.user]);
        await this.invokeWorker(site,{operation:'purge',path:''});
        await rmdir(join(home,'public'));await rmdir(home);
        if(site.certificateIssued || site.tls) await this.command('certbot',['delete','--cert-name',`devone-${site.id}`,'--non-interactive']);
        sites.splice(sites.indexOf(site),1); await this.save(sites); return {ok:true,deleted:site.id};
      }
      site.revision = (before.revision ?? 1)+1; await this.save(sites); return site;
    } catch {
      if (previous !== undefined) {
        try { await this.writeConfig(destination,destructiveStarted ? this.configuration({...before,state:'disabled',tls:false}) : previous); await this.command('nginx',['-t']); await this.command('systemctl',['reload','nginx']); } catch { /* Keep the inspection state if recovery fails. */ }
      }
      Object.assign(site,before,{state:'needs_inspection'}); await this.save(sites);
      throw new Error('site_lifecycle_requires_inspection');
    }
  }
  private async writeConfig(destination: string,content: string) {
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const handle = await open(temporary,constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,0o644);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary,destination);
  }
  files(input: unknown) {
    const siteId = (input as {siteId?:unknown} | null)?.siteId;
    if (typeof siteId !== 'string' || !/^site_[a-f0-9]{16}$/.test(siteId)) return Promise.reject(new Error('invalid_site'));
    if (this.filePending >= 32) return Promise.reject(new Error('files_busy'));
    this.filePending++;
    const operation = (this.fileQueues.get(siteId) ?? Promise.resolve()).catch(()=>{}).then(()=>this.performFiles(input));
    this.fileQueues.set(siteId,operation);
    return operation.finally(()=>{this.filePending--;if(this.fileQueues.get(siteId)===operation) this.fileQueues.delete(siteId);});
  }
  private async performFiles(input: unknown) {
    const body = input as {siteId?:unknown;operation?:unknown;path?:unknown;content?:unknown;kind?:unknown;expectedRevision?:unknown;destination?:unknown} | null;
    if (!body || typeof body.siteId !== 'string' || !['list','read','create','replace','rename','copy','mkdir','remove'].includes(body.operation as string)) throw new Error('invalid_file_operation');
    relativeParts(body.path,body.operation === 'list');
    if (['create','replace'].includes(body.operation as string) && (typeof body.content !== 'string' || body.content.length > Math.ceil(MAX_FILE_BYTES/3)*4)) throw new Error('invalid_content');
    if (['replace','rename','copy'].includes(body.operation as string) && (typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedRevision))) throw new Error('invalid_revision');
    if (body.operation === 'rename' || body.operation === 'copy') relativeParts(body.destination);
    const site = (await this.registry()).find(site => site.id === body.siteId && ['ready','disabled'].includes(site.state));
    if (!site || !site.uid || !site.gid) throw new Error('site_not_ready');
    const passwd = (await this.command('getent',['passwd',site.user])).trim().split(':');
    if (passwd[0] !== site.user || Number(passwd[2]) !== site.uid || Number(passwd[3]) !== site.gid || passwd[5] !== join(this.options.base,site.id) || passwd[6] !== '/usr/sbin/nologin') throw new Error('site_identity_changed');
    if(this.fileActive >= 4) throw new Error('files_busy');
    this.fileActive++;
    try {return await this.invokeWorker(site,{operation:body.operation,path:body.path,content:body.content,kind:body.kind,expectedRevision:body.expectedRevision,destination:body.destination});}
    finally{this.fileActive--;}
  }
  private async invokeWorker(site: Site,request:Record<string,unknown>) {
    if(this.options.worker) return this.options.worker(site,request);
    if (this.options.base !== '/home/devone-sites') throw new Error('invalid_worker_base');
    const launcher = join(dirname(fileURLToPath(import.meta.url)),'site-file-launcher.js');
    return new Promise<unknown>((resolve,reject) => {
      const child = execFile(process.execPath,[launcher],{timeout:15000,maxBuffer:MAX_FILE_BYTES*2,env:{PATH:'/usr/bin:/bin',DEVONE_SITE_ROOT:join(this.options.base,site.id,'public'),DEVONE_SITE_UID:String(site.uid),DEVONE_SITE_GID:String(site.gid),...(request.operation === 'purge' ? {DEVONE_SITE_PURGE:'1'} : {})}},(error,stdout) => {
        try { const result = JSON.parse(stdout); if (result.error && ['file_conflict','destination_exists','invalid_revision','invalid_path','invalid_file','file_too_large','invalid_content'].includes(result.error)) reject(new Error(result.error)); else if (error || result.error) reject(new Error('file_operation_failed')); else resolve(result); } catch { reject(new Error('file_operation_failed')); }
      });
      child.stdin?.on('error',()=>{}); child.stdin?.end(JSON.stringify(request));
    });
  }
}
