# Static hosting acceptance — site, files, domains, HTTPS

This phase hardens the four existing partial Node hosting flows. It **does not** claim full legacy hosting parity or production acceptance.

## Implemented behaviors

| Area | Available in this branch | Still requires live evidence |
| --- | --- | --- |
| Site creation | Isolated site account, static NGINX/files-only workspace, persistent jobs, rollback-to-inspection on partial failure, advisory domain preflight | Fresh Ubuntu install, real UID/GID/ACL, HTTP serving, failed-provisioning recovery |
| File workspace | Read/list/create/edit with SHA-256 conflict detection, download/upload up to 1 MiB, rename, independent safe copy, mkdir/delete; no root-privileged file reads | Browser upload, large file streaming, directory moves, SFTP/external-write conflicts |
| Domains | Validate primary/aliases, check registry and effective NGINX conflicts, preflight before queue, apply revision-checked alias changes | Live NGINX name routing; DNS resolution, negative tests for varied existing vhosts |
| TLS | Issue, renew, disable through derived Certbot lineage; show parsed certificate expiry/domain coverage status without exposing keys | Public ACME issuance, renewal timer + deploy hook, redirects, invalid cert recovery |

The preflight result is **advisory**. It never reserves a domain. The queued Agent mutation repeats authoritative checks. The TLS status reader reports installed certificate contents only: a status of `valid` does not prove live public reachability.

## Clean disposable VPS acceptance (mandatory before turning yellow to green)

Use **Ubuntu 24.04 amd64 on a dedicated test VPS**. Do not deploy alongside CloudPanel or legacy DevOne. Keep port 80/443 open and configure a real test domain you control.

1. Verify pinned installation, Agent/API boot, authenticated Owner login, secure cookies, reboot persistence and `nginx -t`.
2. Create a static site. Record job ID, site ID, root UID/GID and permissions. Serve an `index.html` over HTTP. Verify a different site account cannot read it.
3. Exercise preflight with new, duplicate, aliased, wildcard and externally managed hostnames. Confirm domain/alias edits route correctly; stale revisions and panel-domain claims must fail.
4. Upload a 1 MiB or smaller file, download it byte-identically, edit with revision control, simulate conflict, copy to a distinct inode, rename, delete, and reject traversal/symlinks/overwrites. Verify no other site changes.
5. Point a public test DNS name to the VPS; issue Let's Encrypt certificate with recorded consent. Confirm SAN coverage, verified TLS, HTTP-to-HTTPS redirect, and matching status/expiry shown in UI.
6. Perform renew check and ensure Certbot timer/deploy hook reload only on valid NGINX configuration; test failed validation and remediation on disposable assets.
7. Disable/re-enable a site and HTTPS, checking response codes. Remove only a dedicated test site, confirming other host files, NGINX vhosts and certificate lineages survive.
8. Confirm failed/aborted operations set `needs_inspection` and retain forensic metadata. Reboot mid-job on disposable data to validate interrupted-state handling.
9. Capture browser screenshots, sanitized request/response samples, Git commit SHA, systemd journal excerpts (redact tokens), Certbot status, `nginx -T` hostname proof, QA JSON, and performance comparison with 0.7.0.

## Automation and release gate

- `pnpm qa` runs isolated tests on GitHub CI; fixtures do not require root.
- `pnpm qa:release` MUST remain blocked until the VPS/browser/integration evidence above exists, remaining hosting features are implemented, and legacy parity is verified.
- Never commit passwords, bearer tokens, full certificate keys, account secrets or customer content to QA evidence.
- Development success is not production certification.
