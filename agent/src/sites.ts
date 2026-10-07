import { constants } from 'node:fs';
import { open, mkdir, lstat, rename, chown } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDomain, relativeParts, MAX_FILE_BYTES } from './site-files.js';

const exec = promisify(execFile);
export type Site = { id: string; domain: string; user: string; uid?: number; gid?: number; webServer: 'nginx' | 'none'; state: 'provisioning' | 'ready' | 'needs_inspection'; createdAt: string };
type Options = { registry: string; base: string; nginx: string; panelDomain: string; requireRoot?: boolean; ownership?: typeof chown; command?: (command: string, args: string[]) => Promise<string> };
export function siteInput(input: unknown): { domain: string; webServer: 'nginx' | 'none' } {
  if (!input || typeof input !== 'object') throw new Error('invalid_site');
  const body = input as Record<string,unknown>;
  const domain = validateDomain(body.domain);
  if (body.webServer !== 'nginx' && body.webServer !== 'none') throw new Error('invalid_web_server');
  return { domain, webServer: body.webServer };
}
function validRecord(site: Site) {
  return /^site_[a-f0-9]{16}$/.test(site.id) && site.user === `dvs_${site.id.slice(5)}` && validateDomain(site.domain) === site.domain && ['nginx','none'].includes(site.webServer) && ['provisioning','ready','needs_inspection'].includes(site.state) && (site.uid === undefined || Number.isInteger(site.uid) && site.uid >= 1000) && (site.gid === undefined || Number.isInteger(site.gid) && site.gid >= 1000);
}
export class SiteManager {
  private fileActive = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly command: (command: string, args: string[]) => Promise<string>;
  constructor(private options: Options) {
    this.command = options.command ?? (async (command,args) => (await exec(command,args,{timeout:30000,maxBuffer:65536})).stdout);
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
      if (!Array.isArray(sites) || sites.length > 100 || sites.some(site => !validRecord(site)) || new Set(sites.map(site => site.id)).size !== sites.length || new Set(sites.map(site => site.domain)).size !== sites.length) throw new Error('invalid_registry');
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
    return sites.map(site => ({ ...site, state: site.state === 'provisioning' ? 'needs_inspection' : site.state }));
  }
  create(input: unknown) {
    const operation = this.queue.then(() => this.provision(input));
    this.queue = operation.catch(() => {});
    return operation;
  }
  private async provision(input: unknown) {
    const {domain,webServer} = siteInput(input);
    const sites = await this.registry();
    if (domain === this.options.panelDomain || sites.some(site => site.domain === domain)) throw new Error('domain_in_use');
    if (sites.length >= 100) throw new Error('site_limit');
    if (webServer === 'nginx') {
      // Refuse duplicate or wildcard ownership anywhere in effective configuration.
      const config = await this.command('nginx',['-T']);
      const names = [...config.matchAll(/\bserver_name\s+([^;]+);/g)].flatMap(match => match[1].split(/\s+/).map(name => name.replace(/^['"]|['"]$/g,'')));
      if (names.some(name => name === domain || name.startsWith('~') || name.startsWith('$') || (name.startsWith('*.') && domain.endsWith(name.slice(1))) || (name.startsWith('.') && (domain === name.slice(1) || domain.endsWith(name))) || (name.endsWith('.*') && domain.startsWith(name.slice(0,-1))))) throw new Error('domain_in_use');
    }
    const id = `site_${randomBytes(8).toString('hex')}`;
    const site: Site = {id,domain,user:`dvs_${id.slice(5)}`,webServer,state:'provisioning',createdAt:new Date().toISOString()};
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
        try { await config.writeFile(`server {\n listen 80;\n server_name ${domain};\n root ${publicRoot};\n index index.html;\n disable_symlinks on;\n location / { try_files $uri $uri/ =404; }\n location ~ /\\. { deny all; }\n}\n`); await config.sync(); } finally { await config.close(); }
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
  async files(input: unknown) {
    const body = input as {siteId?:unknown;operation?:unknown;path?:unknown;content?:unknown;kind?:unknown} | null;
    if (!body || typeof body.siteId !== 'string' || !['list','read','create','mkdir','remove'].includes(body.operation as string)) throw new Error('invalid_file_operation');
    relativeParts(body.path,body.operation === 'list');
    if (body.operation === 'create' && (typeof body.content !== 'string' || body.content.length > Math.ceil(MAX_FILE_BYTES/3)*4)) throw new Error('invalid_content');
    const site = (await this.registry()).find(site => site.id === body.siteId && site.state === 'ready');
    if (!site || !site.uid || !site.gid) throw new Error('site_not_ready');
    const passwd = (await this.command('getent',['passwd',site.user])).trim().split(':');
    if (passwd[0] !== site.user || Number(passwd[2]) !== site.uid || Number(passwd[3]) !== site.gid || passwd[5] !== join(this.options.base,site.id) || passwd[6] !== '/usr/sbin/nologin') throw new Error('site_identity_changed');
    if (this.options.base !== '/home/devone-sites') throw new Error('invalid_worker_base');
    const launcher = join(dirname(fileURLToPath(import.meta.url)),'site-file-launcher.js');
    if (this.fileActive >= 4) throw new Error('files_busy');
    this.fileActive++;
    try { return await new Promise<unknown>((resolve,reject) => {
      const child = execFile(process.execPath,[launcher],{timeout:15000,maxBuffer:MAX_FILE_BYTES*2,env:{PATH:'/usr/bin:/bin',DEVONE_SITE_ROOT:join(this.options.base,site.id,'public'),DEVONE_SITE_UID:String(site.uid),DEVONE_SITE_GID:String(site.gid)}},(error,stdout) => {
        if (error) reject(new Error('file_operation_failed')); else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error('file_operation_failed')); } }
      });
      child.stdin?.on('error',()=>{}); child.stdin?.end(JSON.stringify({operation:body.operation,path:body.path,content:body.content,kind:body.kind}));
    }); } finally { this.fileActive--; }
  }
}
