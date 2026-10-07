import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile, link, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SiteFiles, relativeParts, validateDomain, MAX_FILE_BYTES } from '../agent/dist/site-files.js';

test('website domains and relative paths reject ambiguous input', () => {
  assert.equal(validateDomain('www.example.com'), 'www.example.com');
  for (const domain of ['Example.com','127.0.0.1','a;id.com','-bad.com','a..com','localhost','a.com\n']) assert.throws(() => validateDomain(domain));
  for (const path of ['/etc/passwd','../secret','a/../b','a//b','a\\b','%2e%2e/file','a\0b','.','']) assert.throws(() => relativeParts(path));
  assert.deepEqual(relativeParts('', true), []);
});
test('site files are bounded, reject links, and never overwrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'devone-files-'));
  const root = join(directory, 'public');
  const files = new SiteFiles(root);
  try {
    const { mkdir } = await import('node:fs/promises'); await mkdir(root);
    await files.mkdir('assets');
    await files.create('assets/index.txt', Buffer.from('hello'));
    assert.equal((await files.read('assets/index.txt')).toString(), 'hello');
    await assert.rejects(files.create('assets/index.txt', Buffer.from('overwrite')));
    await writeFile(join(directory, 'secret'), 'outside');
    await symlink(directory, join(root, 'escape'));
    await symlink(join(directory, 'secret'), join(root, 'secret-link'));
    await assert.rejects(files.read('escape/secret'));
    await assert.rejects(files.create('escape/new', Buffer.from('bad')));
    await assert.rejects(files.read('secret-link'));
    await assert.rejects(files.create('secret-link', Buffer.from('bad')));
    await link(join(directory, 'secret'), join(root, 'hardlink'));
    await assert.rejects(files.read('hardlink'));
    await assert.rejects(files.create('large', Buffer.alloc(MAX_FILE_BYTES + 1)));
    await writeFile(join(root, 'large'), Buffer.alloc(MAX_FILE_BYTES + 1));
    await assert.rejects(files.read('large'));
    assert.equal((await files.list()).find(entry => entry.name === 'escape').kind, 'blocked');
    await assert.rejects(files.remove('assets', 'directory'));
    await files.remove('assets/index.txt', 'file'); await files.remove('assets', 'directory');
    assert.equal(await readFile(join(directory, 'secret'), 'utf8'), 'outside');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('worker refuses privileged execution or untrusted root configuration', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['agent/dist/site-file-worker.js'], {
    input: JSON.stringify({ operation: 'list', path: '' }),
    env: { PATH: process.env.PATH, DEVONE_SITE_ROOT: '/etc' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { error: 'file_operation_failed' });
});
test('text replacement detects stale revisions and rejects link/path escapes',async()=>{
  const {revision}=await import('../agent/dist/site-files.js');
  const {mkdir,stat,chmod}=await import('node:fs/promises');
  const directory=await mkdtemp(join(tmpdir(),'devone-edit-')), root=join(directory,'public');
  try {
    await mkdir(root);const files=new SiteFiles(root),original=Buffer.from('first');
    await files.create('index.html',original);await chmod(join(root,'index.html'),0o600);
    const updated=await files.replace('index.html',Buffer.from('second'),revision(original));
    assert.equal(updated.revision,revision(Buffer.from('second')));
    assert.equal((await files.read('index.html')).toString(),'second');
    assert.equal((await stat(join(root,'index.html'))).mode & 0o777,0o600);
    await assert.rejects(files.replace('index.html',Buffer.from('stale draft'),revision(original)),/file_conflict/);
    assert.equal((await files.read('index.html')).toString(),'second');
    await assert.rejects(files.replace('index.html',Buffer.alloc(MAX_FILE_BYTES+1),updated.revision),/file_too_large/);
    await writeFile(join(directory,'outside'),'outside');await symlink(join(directory,'outside'),join(root,'escape'));
    await assert.rejects(files.replace('escape',Buffer.from('bad'),revision(Buffer.from('outside'))));
    await link(join(directory,'outside'),join(root,'hardlink'));
    await assert.rejects(files.replace('hardlink',Buffer.from('bad'),revision(Buffer.from('outside'))));
    await assert.rejects(files.replace('../outside',Buffer.from('bad'),updated.revision),/invalid_path/);
    assert.equal(await readFile(join(directory,'outside'),'utf8'),'outside');
    assert.ok(!(await files.list()).some(entry=>entry.name.startsWith('.devone-')));
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('file moves preserve contents, refuse existing destinations and require current revision',async()=>{
  const {revision}=await import('../agent/dist/site-files.js');const {mkdir}=await import('node:fs/promises');
  const directory=await mkdtemp(join(tmpdir(),'devone-move-')),root=join(directory,'public');
  try {
    await mkdir(root);const files=new SiteFiles(root);await files.mkdir('assets');await files.create('old.txt',Buffer.from('data'));
    const version=revision(Buffer.from('data'));
    await assert.rejects(files.renameFile('old.txt','assets/new.txt','0'.repeat(64)),/file_conflict/);
    await files.create('taken.txt',Buffer.from('keep'));
    await assert.rejects(files.renameFile('old.txt','taken.txt',version));
    assert.equal((await files.read('taken.txt')).toString(),'keep');assert.equal((await files.read('old.txt')).toString(),'data');
    await files.renameFile('old.txt','assets/new.txt',version);
    await assert.rejects(files.read('old.txt'));assert.equal((await files.read('assets/new.txt')).toString(),'data');
    await symlink(root,join(root,'escape'));await assert.rejects(files.renameFile('assets/new.txt','escape/bad.txt',version));
    await assert.rejects(files.renameFile('assets/new.txt','../outside',version),/invalid_path/);
    await files.mkdir('folder');await assert.rejects(files.renameFile('folder','other',version));
  } finally {await rm(directory,{recursive:true,force:true});}
});
