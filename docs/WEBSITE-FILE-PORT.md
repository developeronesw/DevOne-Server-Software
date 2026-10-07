# Website and file-management port

The first port increment supplies Linux file operations and an unprivileged worker. It is not yet exposed through the HTTP Agent, API, or dashboard. Website accounts, the root-owned site registry, NGINX provisioning, and queued provisioning are the next integration increment.

`agent/src/site-files.ts` validates lowercase DNS names and relative paths. Directory descriptors and Linux `/proc/self/fd` anchor operations; every directory component opens with `O_NOFOLLOW`. Reads accept only regular files with one hard link and are limited to 1 MiB. New files are published atomically without overwriting existing destinations. Removal is nonrecursive; nonempty directories cannot be removed. Directory listings mark symbolic links and special files as blocked.

`agent/src/site-file-worker.ts` refuses root UID or GID and accepts only derived site roots under `/home/devone-sites/site_<16 hex digits>/public`. The future Agent integration must obtain UID, GID, and root from its own root-owned registry and launch this process with those credentials. Request input must never supply authority over UID, GID, or root. Filesystem tests currently run in temporary directories, not customer directories.

Existing-file editing, rename, large uploads, PHP/Node runtimes, DNS, TLS, and site deletion are not implemented by this increment. Deployment validation still requires an isolated Ubuntu VPS; temporary-directory tests do not prove host provisioning or permissions are correct.
