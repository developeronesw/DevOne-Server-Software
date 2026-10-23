import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('WordPress archive extraction rejects traversal, links and unexpected config without touching outside files',()=>{
 const result=spawnSync('python3',['-c',String.raw`
import importlib.util, io, pathlib, tarfile, tempfile
spec=importlib.util.spec_from_file_location('extractor','scripts/wordpress-extract.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
 root=pathlib.Path(folder)
 for number,kind in enumerate(['valid','traversal','symlink','hardlink','config','large']):
  archive=root/(str(number)+'.tar.gz');destination=root/str(number);destination.mkdir()
  with tarfile.open(archive,'w:gz') as out:
   for name in ['wordpress/wp-includes/version.php','wordpress/wp-admin/install.php']:
    info=tarfile.TarInfo(name);info.size=2;out.addfile(info,io.BytesIO(b'QA'))
   if kind!='valid':
    info=tarfile.TarInfo('wordpress/'+{'traversal':'../outside','config':'wp-config.php'}.get(kind,'evil'))
    if kind=='symlink':info.type=tarfile.SYMTYPE;info.linkname='/etc/shadow'
    if kind=='hardlink':info.type=tarfile.LNKTYPE;info.linkname='../../outside'
    if kind=='large':info.size=17*1024*1024
    if kind!='large':out.addfile(info)
    else:out.addfile(info,io.BytesIO(b'0'*info.size))
  try:m.extract(archive,destination);passed=True
  except Exception:passed=False
  assert passed==(kind=='valid'),kind
 assert not (root/'outside').exists()
`],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);
});
