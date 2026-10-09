import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const main = readFileSync(new URL('../installer/install.sh', import.meta.url), 'utf8');
const prerequisites = readFileSync(new URL('../installer/install-prerequisites.sh', import.meta.url), 'utf8');

test('fresh installer validates edition and OS before running its prerequisite installer', () => {
  assert.match(main,/Legacy edition detected/);
  assert.match(main,/CloudPanel detected/);
  assert.match(main,/Ubuntu 24\.04 LTS/);
  assert.match(main,/Existing Node installation detected/);
  const prerequisitesCall = main.indexOf('bash "$SOURCE_DIR/installer/install-prerequisites.sh"');
  const commitLookup = main.indexOf('SOURCE_COMMIT="$(git -C');
  const firstDevoneDirectory = main.indexOf('log "Creating DevOne service account');
  assert.ok(prerequisitesCall > 0 && commitLookup > prerequisitesCall && firstDevoneDirectory > commitLookup);
  assert.match(main,/PNPM="\/opt\/devone\/toolchain\/node_modules\/\.bin\/pnpm"/);
  assert.match(main,/systemctl enable nginx devone-api devone-agent/);
});

test('signed distribution installs minimum Node, TLS, HTTP, git and OS utilities', () => {
  for (const packageName of [
    'ca-certificates','curl','gnupg','git','nginx','certbot','python3-certbot-nginx',
    'python3','build-essential','util-linux','openssl','acl'
  ]) {
    assert.ok(prerequisites.includes(packageName), `required package absent: ${packageName}`);
  }
  assert.match(prerequisites,/https:\/\/deb\.nodesource\.com\/gpgkey\/nodesource-repo\.gpg\.key/);
  assert.match(prerequisites,/Signed-By: \/usr\/share\/keyrings\/devone-nodesource\.gpg/);
  assert.match(prerequisites,/https:\/\/deb\.nodesource\.com\/node_22\.x/);
  assert.match(prerequisites,/--no-install-recommends nodejs/);
  assert.match(prerequisites,/node_compatible \|\| fail/);
  assert.match(prerequisites,/pnpm@10\.15\.1/);
  assert.match(prerequisites,/--prefix "\$TOOLCHAIN"/);
  assert.doesNotMatch(prerequisites,/curl[^\n]*\|\s*(?:sudo\s+)?bash/);
});

test('installer syntax remains valid without installing packages', () => {
  for (const script of ['installer/install.sh','installer/install-prerequisites.sh']) {
    assert.doesNotThrow(() => execFileSync('bash',['-n',script],{stdio:'pipe'}));
  }
});
