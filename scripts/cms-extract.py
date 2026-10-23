"""Unprivileged extraction of the pinned core archive. Never use extractall()."""
import os
import pathlib
import shutil
import sys
import tarfile


def extract(archive, destination):
    root = pathlib.Path(destination)
    seen = set()
    total = 0
    with tarfile.open(archive, 'r:gz') as source:
        for number, member in enumerate(source, 1):
            parts = member.name.rstrip('/').split('/')
            if number > 100 or parts[0] != 'devone-cms' or any(p in ('', '.', '..') or '\\' in p or '\x00' in p for p in parts):
                raise ValueError('unsafe_archive')
            if not member.isdir() and not member.isfile():
                raise ValueError('unsafe_archive')
            if len(parts) == 1:
                if not member.isdir():
                    raise ValueError('unsafe_archive')
                continue
            relative = '/'.join(parts[1:])
            if relative in seen or len(relative) > 240 or member.size > 4 * 1024 * 1024:
                raise ValueError('unsafe_archive')
            seen.add(relative)
            total += member.size
            if total > 8 * 1024 * 1024 or parts[1] not in {'runtime.mjs', 'bootstrap.mjs', 'web', 'migrations', 'release.json', 'DEVONE-CMS-2.0-LICENSE.md', 'NOTICE.txt'}:
                raise ValueError('unsafe_archive')
            target = root.joinpath(*parts[1:])
            # Every ancestor is made by us; all links and special entries are rejected.
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
            if member.isdir():
                target.mkdir(exist_ok=True, mode=0o750)
            else:
                with source.extractfile(member) as data, open(target, 'xb') as output:
                    os.chmod(target, 0o640)
                    shutil.copyfileobj(data, output)
    if not (root / 'runtime.mjs').is_file() or not (root / 'bootstrap.mjs').is_file():
        raise ValueError('incomplete_archive')


if __name__ == '__main__':
    try:
        extract(sys.argv[1], sys.argv[2])
    except Exception:
        print('cms_archive_invalid', file=sys.stderr)
        sys.exit(1)
