import { constants } from "node:fs";
import { open, readdir, mkdir, unlink, rmdir, link } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";

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
    return anchored(this.root, parts, async directory => {
      const handle = await open(`${directory}/${leaf}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE_BYTES) throw new Error("invalid_file");
        const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
        let size = 0;
        while (size < buffer.length) {
          const read = await handle.read(buffer, size, buffer.length - size, null);
          if (!read.bytesRead) break;
          size += read.bytesRead;
        }
        if (size > MAX_FILE_BYTES) throw new Error("file_too_large");
        return buffer.subarray(0, size);
      } finally { await handle.close(); }
    });
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
