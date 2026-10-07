"""Reassemble the bundled legacy ZIP and verify its original SHA-256."""
from pathlib import Path
import hashlib, json
root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'distributions/parts.json').read_text())
target = root / manifest['archive']
def assemble():
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == manifest['sha256']:
        return
    temporary = target.with_suffix('.zip.tmp')
    try:
        with temporary.open('wb') as output:
            for part in manifest['parts']:
                data = (root / part['path']).read_bytes()
                if hashlib.sha256(data).hexdigest() != part['sha256']:
                    raise ValueError(f"Corrupted archive part: {part['path']}")
                output.write(data)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != manifest['sha256']:
            raise ValueError('Reassembled archive checksum mismatch')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    print('Legacy archive reassembled and verified.')

assemble()
