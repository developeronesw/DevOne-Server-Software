"""Reproducible static scan. Does not run bundled executables or installers."""
from pathlib import Path
import hashlib, json, re, zipfile
root = Path(__file__).resolve().parent.parent
import runpy
runpy.run_path(str(root / 'scripts/assemble-distribution.py'), run_name='__main__')
archive = root / 'distributions/DevOne-Server-0.7.0-All-in-One.zip'
files, routes, source, binaries = [], set(), [], []
with zipfile.ZipFile(archive) as z:
    for entry in sorted(z.infolist(), key=lambda e: e.filename):
        if entry.is_dir(): continue
        data = z.read(entry)
        category = 'compiled-executable' if data.startswith(b'\x7fELF') else 'file'
        if category == 'compiled-executable': binaries.append(entry.filename)
        if entry.filename.endswith(('.go', '.ts', '.tsx', '.rs', '.c', '.cpp')):
            source.append(entry.filename)
        if entry.filename.endswith(('.js', '.jsfrag', '.go')) and '/vendor/' not in entry.filename:
            text = data.decode('utf-8')
            routes.update(re.findall(r'''["'`](/api/[A-Za-z0-9_/?=${}.:-]+)''', text))
        files.append({'path': entry.filename, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'kind': category})
result = {'archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'scope': 'Exact bundled Phase7 R3 + HF4/HF5/HF7/HF8 archive; other historical ZIPs were not scanned.', 'files': files, 'compiled_executables': binaries, 'backend_source_files': source, 'api_route_literals': sorted(routes), 'route_caveat': 'Static string inventory; dynamic routes may be truncated and route presence does not establish runtime behavior.'}
(root / 'docs/LEGACY-SCAN.json').write_text(json.dumps(result, indent=2) + '\n')
print(f'Scanned {len(files)} files: {len(binaries)} compiled payloads, {len(source)} backend source files, {len(routes)} API route literals.')
