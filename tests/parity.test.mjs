import test from 'node:test';
import assert from 'node:assert/strict';
import { validateParity } from '../scripts/verify-parity.mjs';
const scan={archive_sha256:'a'.repeat(64),api_route_literals:['/api/sites']};
const row={legacy:'/api/sites',equivalent:['/api/sites'],status:'partial',acceptanceEvidence:[]};
const manifest=()=>({schemaVersion:1,legacyArchiveSha256:scan.archive_sha256,routes:[structuredClone(row)]});
test('parity inventory refuses dropped routes, changed baselines and unsupported acceptance claims',async()=>{
  assert.deepEqual(await validateParity(scan,manifest()),{total:1,verified:0,outstanding:1});
  await assert.rejects(validateParity(scan,{...manifest(),routes:[]}),/missing_or_duplicated/);
  await assert.rejects(validateParity(scan,{...manifest(),legacyArchiveSha256:'b'.repeat(64)}),/invalid_parity_baseline/);
  const accepted=manifest();accepted.routes[0].status='verified';await assert.rejects(validateParity(scan,accepted),/evidence_required/);
  accepted.routes[0].acceptanceEvidence=['qa/evidence/site-test.json'];
  await assert.rejects(validateParity(scan,accepted,async()=>({result:'pass'})),/insufficient_parity_evidence/);
  const evidence={legacyArchiveSha256:scan.archive_sha256,routes:['/api/sites'],result:'pass',environment:'disposable-vps',legacyComparison:true,securityChecks:true,uiChecks:true};
  assert.equal((await validateParity(scan,accepted,async()=>evidence)).verified,1);
  accepted.routes[0].acceptanceEvidence=['../../secret'];await assert.rejects(validateParity(scan,accepted),/invalid_parity_evidence_path/);
});
