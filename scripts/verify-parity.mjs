import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function validateParity(scan,manifest,readEvidence=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'))) {
  if(manifest.schemaVersion!==1 || manifest.legacyArchiveSha256!==scan.archive_sha256 || !Array.isArray(manifest.routes)) throw new Error('invalid_parity_baseline');
  const recorded=manifest.routes.map(route=>route.legacy);
  if(new Set(recorded).size !== recorded.length || [...recorded].sort().join('\n') !== [...scan.api_route_literals].sort().join('\n')) throw new Error('legacy_route_missing_or_duplicated');
  for(const route of manifest.routes) {
    if(!['pending','partial','verified'].includes(route.status) || !Array.isArray(route.equivalent) || !route.equivalent.every(path=>typeof path==='string' && path.startsWith('/api/')) || !Array.isArray(route.acceptanceEvidence)) throw new Error('invalid_parity_record');
    if(route.status==='verified' && (!route.equivalent.length || !route.acceptanceEvidence.length)) throw new Error('parity_evidence_required');
    for(const path of route.acceptanceEvidence) {
      if(typeof path!=='string' || !/^qa\/evidence\/[a-zA-Z0-9_-]+\.json$/.test(path)) throw new Error('invalid_parity_evidence_path');
      const evidence=await readEvidence(path);
      if(evidence.legacyArchiveSha256!==scan.archive_sha256 || !Array.isArray(evidence.routes) || !evidence.routes.includes(route.legacy) || evidence.result!=='pass' || evidence.environment!=='disposable-vps' || evidence.legacyComparison!==true || evidence.securityChecks!==true || evidence.uiChecks!==true) throw new Error('insufficient_parity_evidence');
    }
  }
  return {total:recorded.length,verified:manifest.routes.filter(route=>route.status==='verified').length,outstanding:manifest.routes.filter(route=>route.status!=='verified').length};
}
export async function parityStatus() {
  const scan=JSON.parse(await readFile(resolve(root,'docs/LEGACY-SCAN.json'),'utf8'));
  const manifest=JSON.parse(await readFile(resolve(root,'qa/legacy-parity.json'),'utf8'));
  return validateParity(scan,manifest);
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) parityStatus().then(result=>console.log(`Legacy route inventory: ${result.total} accounted for, ${result.verified} accepted, ${result.outstanding} still require parity evidence.`)).catch(error=>{console.error(error.message);process.exitCode=1;});
