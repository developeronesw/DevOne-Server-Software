import { constants } from "node:fs";
import { open, readdir, mkdir, unlink, rmdir, link, rename, lstat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";

export function revision(content: Uint8Array) { return createHash("sha256").update(content).digest("hex"); }
export const MAX_FILE_BYTES = 1024 * 1024;
export function validateDomain(value: unknown): string {
  if (typeof value !== "string" || value.length > 253 || value !== value.toLowerCase() || !value.includes(".")) throw new Error("invalid_domain");
  const labels = value.split(".");
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/^[a-z]{2,63}$/.test(labels.at(-1)!)) throw new Error("invalid_domain");
  return value;
}
export function relativeParts(value: unknown, allowRoot = false): string[] {
  if (allowRoot && value === "") return [];
  if (typeof value !== "string" || value.length > 1024 || /[\\\x00-\x1f\x7f%]/.test(value)) throw new Error("invalid_path");
  const parts = value.split("/");
  if (parts.length > 32 || parts.some(part => !part || part === "." || part === ".." || Buffer.byteLength(part) > 255)) throw new Error("invalid_path");
  return parts;
}
// Linux directory descriptors pin every parent. Never resolve a checked path a
// second time: /proc/self/fd keeps operations anchored even during rename races.
async function anchored<T>(root: string, parts: string[], work: (path: string) => Promise<T>): Promise<T> {
  const handles: FileHandle[] = [];
  try {
    let handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(handle);
    for (const part of parts) {
      handle = await open(`/proc/self/fd/${handle.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      handles.push(handle);
    }
    return await work(`/proc/self/fd/${handle.fd}`);
  } finally { await Promise.all(handles.map(handle => handle.close())); }
}
async function readRegular(file: string): Promise<Buffer> {
  const handle = await open(file,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE_BYTES) throw new Error("invalid_file");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1); let size = 0;
    while (size < buffer.length) {
      const read = await handle.read(buffer,size,buffer.length-size,null);
      if (!read.bytesRead) break; size += read.bytesRead;
    }
    if (size > MAX_FILE_BYTES) throw new Error("file_too_large");
    return buffer.subarray(0,size);
  } finally { await handle.close(); }
}
export class SiteFiles {
  constructor(private readonly root: string) {}
  async list(path = "") {
    return anchored(this.root, relativeParts(path, true), async directory => {
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.length > 1000) throw new Error("directory_too_large");
      return entries.map(entry => ({ name: entry.name, kind: entry.isSymbolicLink() ? "blocked" : entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "blocked" })).sort((a,b) => a.name.localeCompare(b.name));
    });
  }
  async read(path: string): Promise<Buffer> {
    const parts = relativeParts(path), leaf = parts.pop()!;
    return anchored(this.root,parts,directory => readRegular(`${directory}/${leaf}`));
  }
  async create(path: string, content: Uint8Array) {
    if (content.byteLength > MAX_FILE_BYTES) throw new Error("file_too_large");
    const parts = relativeParts(path), leaf = parts.pop()!;
    return anchored(this.root, parts, async directory => {
      const temporary = `${directory}/.devone-${randomUUID()}`;
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
      try {
        await handle.writeFile(content); await handle.sync();
        // Hard-link publication is atomic and fails if any destination exists,
        // including a symlink. The temporary name is always removed afterward.
        await link(temporary, `${directory}/${leaf}`);
      } finally { await handle.close(); await unlink(temporary); }
    });
  }
  async replace(path: string, content: Uint8Array, expectedRevision: string) {
    if (content.byteLength > MAX_FILE_BYTES) throw new Error("file_too_large");
    if (!/^[a-f0-9]{64}$/.test(expectedRevision)) throw new Error("invalid_revision");
    const parts = relativeParts(path), leaf = parts.pop()!;
    return anchored(this.root, parts, async directory => {
      // The Agent serializes a site's requests. External writers must stop while
      // editing: POSIX rename has no compare-and-swap against their writes.
      const current = await readRegular(`${directory}/${leaf}`);
      if (revision(current) !== expectedRevision) throw new Error("file_conflict");
      const stat = await lstat(`${directory}/${leaf}`);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error("invalid_file");
      const temporary = `${directory}/.devone-${randomUUID()}`;
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, stat.mode & 0o777);
      try {
        await handle.chmod(stat.mode & 0o777);
        await handle.writeFile(content); await handle.sync();
        if (revision(await readRegular(`${directory}/${leaf}`)) !== expectedRevision) throw new Error("file_conflict");
        const latest = await lstat(`${directory}/${leaf}`);
        if (latest.dev !== stat.dev || latest.ino !== stat.ino || !latest.isFile() || latest.nlink !== 1) throw new Error("file_conflict");
        await rename(temporary,`${directory}/${leaf}`);
      } finally {
        await handle.close();
        try { await unlink(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      return { revision: revision(content) };
    });
  }
  async renameFile(path: string, destination: string, expectedRevision: string) {
    if (!/^[a-f0-9]{64}$/.test(expectedRevision)) throw new Error("invalid_revision");
    const sourceParts = relativeParts(path), sourceLeaf = sourceParts.pop()!;
    const targetParts = relativeParts(destination), targetLeaf = targetParts.pop()!;
    return anchored(this.root,sourceParts,sourceDirectory => anchored(this.root,targetParts,async targetDirectory => {
      if (revision(await readRegular(`${sourceDirectory}/${sourceLeaf}`)) !== expectedRevision) throw new Error("file_conflict");
      const source = `${sourceDirectory}/${sourceLeaf}`, target = `${targetDirectory}/${targetLeaf}`;
      const before = await lstat(source);
      if (!before.isFile() || before.nlink !== 1) throw new Error("invalid_file");
      // link refuses an existing destination, preserving mode and ACLs. This
      // move has a brief two-name interval and is intentionally files-only.
      await link(source,target);
      try {
        const after = await lstat(source), published = await lstat(target);
        if (!published.isFile() || after.nlink !== 2 || published.nlink !== 2 || before.dev !== published.dev || before.ino !== published.ino || after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("file_conflict");
        await unlink(source);
      } catch (error) { await unlink(target); throw error; }
      return { revision: expectedRevision };
    }));
  }
  async mkdir(path: string) {
    const parts = relativeParts(path), leaf = parts.pop()!;
    return anchored(this.root, parts, directory => mkdir(`${directory}/${leaf}`, { mode: 0o750 }));
  }
  async remove(path: string, kind: "file" | "directory") {
    const parts = relativeParts(path), leaf = parts.pop()!;
    // unlink never follows a final symlink; rmdir never recursively removes data.
    return anchored(this.root, parts, directory => kind === "directory" ? rmdir(`${directory}/${leaf}`) : unlink(`${directory}/${leaf}`));
  }
}
