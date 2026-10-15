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
  assert.doesNotMatch(main,/Initial Owner (?:email|password)/);
  assert.match(main,/scripts\/issue-setup-link\.sh/);
  assert.match(main,/certbot certonly --webroot/);
  assert.match(main,/https:\/\/\$DOMAIN\/api\/health/);
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


const readScript = relative => readFileSync(new URL('../'+relative,import.meta.url),'utf8');
test('fresh installer prepares readable runtime assets before starting service accounts', () => {
  assert.match(main,/umask 022/);
  const builds=main.indexOf('\"$PNPM\" --filter @devone/dashboard build');
  const prepare=main.indexOf('scripts/prepare-runtime-files.sh');
  const start=main.indexOf('systemctl restart nginx devone-api devone-agent');
  assert.ok(builds>=0 && prepare>builds && start>prepare);
});

test('in-place updater preserves data, applies runtime permissions and verifies the unprivileged API identity', () => {
  const prepare=readScript('scripts/prepare-runtime-files.sh');
  const updater=readScript('scripts/update-in-place.sh');
  assert.match(updater,/umask 022/);
  assert.match(updater,/git merge-base --is-ancestor/);
  assert.match(updater,/sqlite3\.connect/);
  assert.match(updater,/BACKUP=/);
  assert.match(updater,/trap rollback ERR/);
  assert.match(updater,/scripts\/prepare-runtime-files\.sh/);
  const buildPos=updater.indexOf('@devone/dashboard build');
  const permissionsPos=updater.indexOf('scripts/prepare-runtime-files.sh',buildPos);
  const restartPos=updater.indexOf('systemctl restart devone-agent',permissionsPos);
  assert.ok(buildPos>=0 && permissionsPos>buildPos && restartPos>permissionsPos);
  assert.match(updater,/HTTP_CODE.*401/);
  assert.match(prepare,/chown -R root:devone "\$API_DIST"/);
  assert.match(prepare,/chmod 750/);
  assert.match(prepare,/chmod 640/);
  assert.match(prepare,/runuser -u devone -- \/usr\/bin\/node --check "\$API_DIST\/control.js"/);
  assert.match(prepare,/runuser -u www-data -- test -r/);
  assert.doesNotMatch(prepare,/chmod -R 777|chown -R devone:devone "\$APP"/);
});

test('installer syntax remains valid without installing packages', () => {
  for (const script of ['installer/install.sh','installer/install-prerequisites.sh','scripts/issue-setup-link.sh','scripts/prepare-runtime-files.sh','scripts/update-in-place.sh']) {
    assert.doesNotThrow(() => execFileSync('bash',['-n',script],{stdio:'pipe'}));
  }
});
