import { SiteFiles, MAX_FILE_BYTES, revision } from "./site-files.js";

// The Agent must spawn this worker with a site's uid/gid and an independently
// trusted registry root. Never run filesystem operations with Agent privileges.
async function main() {
  if (!process.getuid || process.getuid() === 0 || !process.getgid || process.getgid() === 0) throw new Error("unprivileged_worker_required");
  const root = process.env.DEVONE_SITE_ROOT;
  if (!root || !/^\/home\/devone-sites\/site_[a-f0-9]{16}\/public$/.test(root)) throw new Error("invalid_site_root");
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > MAX_FILE_BYTES * 2) throw new Error("body_too_large");
  }
  const request = JSON.parse(input) as { operation: string; path: string; content?: string; kind?: string; expectedRevision?: string; destination?: string };
  const files = new SiteFiles(root);
  let result: unknown;
  switch (request.operation) {
    case "list": result = await files.list(request.path); break;
    case "read": { const content = await files.read(request.path); result = { content: content.toString("base64"), revision: revision(content) }; break; }
    case "create":
    case "replace": {
      if (typeof request.content !== "string" || request.content.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.content)) throw new Error("invalid_content");
      const content = Buffer.from(request.content,"base64");
      result = request.operation === "replace" ? await files.replace(request.path,content,request.expectedRevision ?? "") : await files.create(request.path,content);
      result = { ok:true, ...(result as object | undefined) }; break;
    }
    case "rename": result = {ok:true,...await files.renameFile(request.path,request.destination ?? "",request.expectedRevision ?? "")}; break;
    case "purge":
      if (process.env.DEVONE_SITE_PURGE !== "1") throw new Error("invalid_operation");
      await files.purge(); result={ok:true}; break;
    case "mkdir": await files.mkdir(request.path); result = { ok: true }; break;
    case "remove":
      if (request.kind !== "file" && request.kind !== "directory") throw new Error("invalid_kind");
      await files.remove(request.path, request.kind); result = { ok: true }; break;
    default: throw new Error("invalid_operation");
  }
  process.stdout.write(JSON.stringify(result));
}
main().catch(error => {
  const code = error instanceof Error && ["file_conflict","invalid_revision","invalid_path","invalid_file","file_too_large","invalid_content"].includes(error.message) ? error.message : error?.code === "EEXIST" ? "destination_exists" : "file_operation_failed";
  process.stdout.write(JSON.stringify({error:code})); process.exitCode = 1;
});
