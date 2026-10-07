import { SiteFiles, MAX_FILE_BYTES } from "./site-files.js";

// The Agent must spawn this worker with a site's uid/gid and an independently
// trusted registry root. Never run filesystem operations with Agent privileges.
async function main() {
  if (!process.getuid || process.getuid() === 0 || !process.getgid || process.getgid() === 0) throw new Error("unprivileged_worker_required");
  const root = process.env.DEVONE_SITE_ROOT;
  if (!root || !/^\/home\/devone-sites\/site_[a-f0-9]{16}\/public$/.test(root)) throw new Error("invalid_site_root");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > MAX_FILE_BYTES * 2) throw new Error("body_too_large");
  }
  const request = JSON.parse(input) as { operation: string; path: string; content?: string; kind?: string };
  const files = new SiteFiles(root);
  let result: unknown;
  switch (request.operation) {
    case "list": result = await files.list(request.path); break;
    case "read": result = { content: (await files.read(request.path)).toString("base64") }; break;
    case "create": {
      if (typeof request.content !== "string" || request.content.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.content)) throw new Error("invalid_content");
      await files.create(request.path, Buffer.from(request.content, "base64")); result = { ok: true }; break;
    }
    case "mkdir": await files.mkdir(request.path); result = { ok: true }; break;
    case "remove":
      if (request.kind !== "file" && request.kind !== "directory") throw new Error("invalid_kind");
      await files.remove(request.path, request.kind); result = { ok: true }; break;
    default: throw new Error("invalid_operation");
  }
  process.stdout.write(JSON.stringify(result));
}
main().catch(() => { process.stdout.write(JSON.stringify({ error: "file_operation_failed" })); process.exitCode = 1; });
