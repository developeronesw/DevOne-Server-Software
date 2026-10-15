import {test} from 'node:test';
import assert from 'node:assert/strict';
import { securityParsers } from '../agent/dist/security.js';
import { listCatalog } from '../apps/api/dist/catalog.js';
test('catalog prioritizes DevOne CMS v2 and WordPress without claiming installed deployments',()=>{
 const catalog=listCatalog();
 assert.equal(catalog.installAvailable,false);
 assert.equal(catalog.items[0].id,'devone-cms-v2');
 assert.match(catalog.items[0].sourceUrl,/^https:\/\/github.com\/developeronesw\/DevOneCMS-v2$/);
 assert.equal(catalog.items[1].id,'wordpress');
 assert.equal(catalog.items[1].latestKnownVersion,'7.1.3');
 const ids=catalog.items.map(x=>x.id);
 assert.equal(new Set(ids).size,ids.length);
 for(const app of catalog.items){
  assert.match(app.sourceUrl,/^https:\/\//);
  assert.match(app.docsUrl,/^https:\/\//);
  assert.ok(app.runtime.length>=1);
 }
});
test('security scanner counts only all-interface port binds and handles missing configs',()=>{
 const listeners=[
 'LISTEN 0 511 0.0.0.0:22 0.0.0.0:*',
 'LISTEN 0 511 127.0.0.1:8787 0.0.0.0:*',
 'LISTEN 0 511 [::]:443 [::]:*',
 'LISTEN 0 511 0.0.0.0:3306 0.0.0.0:*',
 'LISTEN 0 511 0.0.0.0:3306 0.0.0.0:*'
 ].join('\n');
 assert.deepEqual(securityParsers.publicSockets(listeners),[22,443,3306]);
 assert.equal(securityParsers.publicSockets(null),null);
 const ssh=securityParsers.parseSshConfig('permitrootlogin no\npasswordauthentication no\n');
 assert.equal(ssh.get('permitrootlogin'),'no');
 assert.equal(ssh.get('passwordauthentication'),'no');
 assert.equal(securityParsers.parseSshConfig(null),null);
});
