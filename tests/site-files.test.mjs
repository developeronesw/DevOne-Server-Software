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
