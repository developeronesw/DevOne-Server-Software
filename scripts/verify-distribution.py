"""Verify the exact bundled distribution without executing host mutations."""
from pathlib import Path
import hashlib, subprocess, tempfile, zipfile
root = Path(__file__).resolve().parent.parent
import runpy
runpy.run_path(str(root / 'scripts/assemble-distribution.py'), run_name='__main__')
archive = root / 'distributions/DevOne-Server-0.7.0-All-in-One.zip'
expected = (root / 'distributions/checksums.sha256').read_text().split()[0]
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected
with tempfile.TemporaryDirectory() as work, zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for name in z.namelist():
        p = Path(name)
        assert not p.is_absolute() and '..' not in p.parts
    z.extractall(work)
    bundle = Path(work) / 'DevOne-Server-0.7.0-All-in-One'
    subprocess.run(['bash', 'install.sh', '--verify-only'], cwd=bundle, check=True, stdout=subprocess.DEVNULL)
    for script in bundle.rglob('*.sh'):
        subprocess.run(['bash', '-n', str(script)], check=True)
print('Distribution archive, payload checksums and shell syntax: PASS')
