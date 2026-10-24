#!/usr/bin/env python3
"""Streaming, no-follow DevOne migration archive I/O. Never uses extractall."""
import hashlib, io, json, os, pathlib, stat, sys, tarfile
MAX_FILES=200000
MAX_BYTES=1024**4
MAX_MANIFEST=32*1024*1024

def safe_name(name):
    if not isinstance(name,str) or len(name)>4096 or '\\' in name or any(ord(c)<32 for c in name): raise ValueError()
    parts=name.split('/')
    if any(p in ('','.','..') for p in parts) or name.startswith('/'): raise ValueError()
    return parts

def safe_link(name,link):
    parts=safe_name(name)
    if len(parts)<4 or parts[:2]!=['payload','sites'] or not isinstance(link,str) or len(link)>4096 or link.startswith('/') or '\\' in link or any(ord(c)<32 for c in link): raise ValueError()
    target=parts[:-1]
    for p in link.split('/'):
        if p in ('','.'): continue
        if p=='..':
            if len(target)<=3: raise ValueError()
            target.pop()
        else: target.append(p)

class BoundedTarInfo(tarfile.TarInfo):
    # Reject oversized extension headers before tarfile allocates their payloads.
    def _proc_pax(self,*args,**kwargs):
        if self.size>65536: raise ValueError()
        return super()._proc_pax(*args,**kwargs)
    def _proc_gnulong(self,*args,**kwargs):
        if self.size>4096: raise ValueError()
        return super()._proc_gnulong(*args,**kwargs)
    def _proc_sparse(self,*args,**kwargs): raise ValueError()
    def _proc_gnusparse_00(self,*args,**kwargs): raise ValueError()
    def _proc_gnusparse_01(self,*args,**kwargs): raise ValueError()
    def _proc_gnusparse_10(self,*args,**kwargs): raise ValueError()

class BoundedEntries(list):
    def __init__(self): super().__init__();self.bytes=0
    def append(self,value):
        self.bytes+=len(json.dumps(value))
        if self.bytes>MAX_MANIFEST-1024: raise ValueError()
        super().append(value)

class DigestReader:
    def __init__(self,file): self.file=file;self.hash=hashlib.sha256()
    def read(self,n=-1):
        b=self.file.read(n);self.hash.update(b);return b

def pack(plan):
    entries=BoundedEntries();total=0
    metadata=json.dumps(plan['metadata'],sort_keys=True,separators=(',',':')).encode()
    if len(metadata)>1048576: raise ValueError()
    with tarfile.open(fileobj=sys.stdout.buffer,mode='w|',format=tarfile.PAX_FORMAT) as tar:
        info=tarfile.TarInfo('metadata.json');info.size=len(metadata);info.mode=0o600;tar.addfile(info,io.BytesIO(metadata))
        def entry(fd,name,arc,device,uid):
            nonlocal total
            safe_name(arc)
            st=os.stat(name,dir_fd=fd,follow_symlinks=False)
            if st.st_dev!=device or st.st_uid not in (0,uid) or len(entries)>=MAX_FILES: raise ValueError()
            mode=stat.S_IMODE(st.st_mode)&0o777
            owner='root' if st.st_uid==0 else 'site'
            info=tarfile.TarInfo(arc);info.mode=mode;info.mtime=st.st_mtime;info.uname=owner
            if stat.S_ISDIR(st.st_mode):
                child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                try:
                    info.type=tarfile.DIRTYPE;tar.addfile(info);entries.append(dict(path=arc,type='directory',mode=mode,size=0,sha256='',owner=owner,mtime=st.st_mtime))
                    for n in sorted(os.listdir(child)): entry(child,n,arc+'/'+n,device,uid)
                finally: os.close(child)
            elif stat.S_ISLNK(st.st_mode):
                link=os.readlink(name,dir_fd=fd);safe_link(arc,link);info.type=tarfile.SYMTYPE;info.linkname=link;tar.addfile(info)
                entries.append(dict(path=arc,type='symlink',mode=mode,size=0,sha256=hashlib.sha256(link.encode()).hexdigest(),link=link,owner=owner,mtime=st.st_mtime))
            elif stat.S_ISREG(st.st_mode):
                if st.st_nlink!=1: raise ValueError()
                file=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
                with os.fdopen(file,'rb') as stream:
                    current=os.fstat(file)
                    if (current.st_ino,current.st_dev,current.st_size)!=(st.st_ino,st.st_dev,st.st_size): raise ValueError()
                    total+=st.st_size
                    if total>MAX_BYTES: raise ValueError()
                    info.size=st.st_size;reader=DigestReader(stream);tar.addfile(info,reader)
                    after=os.fstat(file)
                    if (after.st_size,after.st_mtime_ns,after.st_ctime_ns)!=(st.st_size,st.st_mtime_ns,st.st_ctime_ns): raise ValueError()
                    entries.append(dict(path=arc,type='file',mode=mode,size=st.st_size,sha256=reader.hash.hexdigest(),owner=owner,mtime=st.st_mtime))
            else: raise ValueError()
        for root in plan['roots']:
            source=os.path.abspath(root['source']);parent=os.open(os.path.dirname(source),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:
                st=os.stat(os.path.basename(source),dir_fd=parent,follow_symlinks=False)
                entry(parent,os.path.basename(source),root['archive'],st.st_dev,root.get('uid',0))
            finally: os.close(parent)
        manifest=json.dumps(dict(format=1,metadataSha256=hashlib.sha256(metadata).hexdigest(),bytes=total,entries=entries),sort_keys=True,separators=(',',':')).encode()
        if len(manifest)>MAX_MANIFEST: raise ValueError()
        info=tarfile.TarInfo('manifest.json');info.size=len(manifest);info.mode=0o600;tar.addfile(info,io.BytesIO(manifest))

def allowed(name):
    p=safe_name(name)
    if p[0]!='payload': raise ValueError()
    if len(p)==2 and p[1]=='control.devone': return
    if len(p)>=3 and p[1] in ('sites','databases','tls','accounts','backups','redis','container'): return
    raise ValueError()

def extract(source,destination):
    os.mkdir(destination,0o700)
    entries=BoundedEntries();seen=set();links=[];metadata=None;metadata_raw=None;manifest=None;total=0
    root=os.open(destination,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    def parents(parts):
        fd=os.dup(root)
        try:
            for part in parts:
                try: os.mkdir(part,0o700,dir_fd=fd)
                except FileExistsError: pass
                new=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=new
            return fd
        except: os.close(fd);raise
    try:
        with tarfile.open(source,mode='r|',tarinfo=BoundedTarInfo) as tar:
            for item in tar:
                if manifest is not None or item.issparse() or any(k.startswith('GNU.sparse') for k in item.pax_headers): raise ValueError()
                if item.name in seen or len(seen)>MAX_FILES+2 or item.size<0: raise ValueError()
                seen.add(item.name)
                if item.name in ('metadata.json','manifest.json'):
                    if not item.isfile() or item.size>(1048576 if item.name=='metadata.json' else MAX_MANIFEST): raise ValueError()
                    raw=tar.extractfile(item).read(item.size+1)
                    if len(raw)!=item.size: raise ValueError()
                    value=json.loads(raw)
                    if item.name=='metadata.json':
                        if metadata is not None or entries: raise ValueError()
                        metadata=value;metadata_raw=raw
                    else: manifest=value
                    continue
                if metadata is None: raise ValueError()
                allowed(item.name);parts=safe_name(item.name);mode=item.mode&0o777
                if item.uname not in ('root','site'): raise ValueError()
                parent=parents(parts[:-1]);digest='';kind=None;link=None
                try:
                    if item.isdir():
                        try: os.mkdir(parts[-1],0o700,dir_fd=parent)
                        except FileExistsError:
                            st=os.stat(parts[-1],dir_fd=parent,follow_symlinks=False)
                            if not stat.S_ISDIR(st.st_mode): raise ValueError()
                        kind='directory'
                    elif item.isfile():
                        total+=item.size
                        if total>MAX_BYTES: raise ValueError()
                        fd=os.open(parts[-1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
                        h=hashlib.sha256();remaining=item.size
                        with os.fdopen(fd,'wb') as out:
                            stream=tar.extractfile(item)
                            while remaining:
                                data=stream.read(min(1048576,remaining))
                                if not data: raise ValueError()
                                out.write(data);h.update(data);remaining-=len(data)
                            out.flush();os.fsync(out.fileno())
                        digest=h.hexdigest();kind='file'
                    elif item.issym():
                        safe_link(item.name,item.linkname);link=item.linkname;links.append((parts,link));digest=hashlib.sha256(link.encode()).hexdigest();kind='symlink'
                    else: raise ValueError()
                    value=dict(path=item.name,type=kind,mode=mode,size=item.size if kind=='file' else 0,sha256=digest,owner=item.uname,mtime=item.mtime)
                    if link is not None: value['link']=link
                    entries.append(value)
                finally: os.close(parent)
        if not isinstance(manifest,dict) or manifest.get('format')!=1 or manifest.get('bytes')!=total or manifest.get('metadataSha256')!=hashlib.sha256(metadata_raw).hexdigest() or manifest.get('entries')!=entries: raise ValueError()
        # No symlink may become an ancestor of another archive member.
        for parts,link in links:
            prefix='/'.join(parts)+'/'
            if any(n.startswith(prefix) for n in seen): raise ValueError()
            fd=parents(parts[:-1])
            try: os.symlink(link,parts[-1],dir_fd=fd)
            finally: os.close(fd)
        for name,value in [('metadata.json',metadata),('inventory.json',manifest)]:
            fd=os.open(name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600,dir_fd=root)
            with os.fdopen(fd,'w') as out: json.dump(value,out);out.flush();os.fsync(out.fileno())
        os.fsync(root)
        print(json.dumps(dict(files=len(entries),bytes=total)))
    finally: os.close(root)

def main():
    if sys.argv[1:]==['pack']:
        raw=sys.stdin.buffer.read(2*1024*1024+1)
        if len(raw)>2*1024*1024: raise ValueError()
        pack(json.loads(raw))
    elif len(sys.argv)==4 and sys.argv[1]=='extract': extract(sys.argv[2],sys.argv[3])
    else: raise ValueError()
if __name__=='__main__':
    try: main()
    except Exception:
        print('migration_archive_invalid',file=sys.stderr);sys.exit(1)
