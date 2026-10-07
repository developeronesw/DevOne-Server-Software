# Website and file-management port

This increment connects static website creation and the initial React file workspace to the API and root Agent. It is partial legacy parity, not production acceptance.

## Websites

`GET /api/sites` and `POST /api/sites` require owner/admin. Creation additionally requires the configured Origin, explicit confirmation and a request key. A durable `site.create` job provisions a locked Linux account with its own normal UID/GID, a root-owned home directory and a user-owned public directory. Validated domains cannot reuse the panel domain or a registered site domain. NGINX sites check the effective server-name configuration, use an exclusively created DevOne configuration, validate it and reload NGINX. Wildcards, regex and variable server names receive conservative conflict checks. Files-only workspaces need no NGINX command. Static sites initially serve HTTP; uploading an index.html supplies their first page.

Privileged identity metadata lives in `/var/lib/devone-agent` owned by root with mode 0700, separate from the API-writable database directory. Writes use atomic replacement and filesystem sync. Production systemd takes an Agent lock. One Agent process per registry is supported. Provisioning is serialized. Partial and interrupted attempts require inspection, never automatic replay. Failed NGINX configurations created by this operation are moved into the private registry for inspection; unknown or existing host files are not removed. This is conservative recovery, not comprehensive transactional rollback.

## File workspace

The React workspace supports listing, directory navigation, UTF-8 preview, binary download, new text files, uploads up to 1 MiB, folder creation, file deletion and empty-directory deletion. Existing destinations are never overwritten. API operations require owner/admin and the configured Origin; mutations additionally require confirmation and record audit metadata without file contents.

The Agent derives UID/GID and root from its registry and rechecks the passwd identity. The launcher clears supplementary groups, sets GID and UID, and only then loads the worker. Request JSON cannot choose UID, GID or root. The worker refuses root credentials and accepts only derived roots under `/home/devone-sites/site_<16 hex digits>/public`.

Directory descriptors and Linux `/proc/self/fd` anchor operations; every directory component opens with O_NOFOLLOW. Reads require regular files with one hard link and are bounded to 1 MiB. New files publish atomically without overwriting existing destinations. Removal is nonrecursive. Listings mark links and special files blocked. NGINX disables symlink following and denies dot paths. Site parent permissions and read ACLs isolate the account while allowing NGINX access. The Agent unit exposes only the site subtree through its home-directory protection.

## Verification and remaining parity

Temporary-directory tests exercise registry validation, domain conflicts, generated NGINX policy, serialization and failed provisioning. Host commands and ownership changes are injected fixtures: these tests do not create real users or modify host NGINX. Fastify tests cover authentication, role/Origin/confirmation checks, job dispatch and removal of caller-supplied identity/root fields. Existing file-boundary and persistence tests remain in the QA runner.

Actual Ubuntu user creation, UID isolation, inherited ACLs, NGINX serving, systemd sandbox visibility and browser flows remain live-VPS acceptance checks. Existing-file editing, rename, large uploads, site deletion, aliases, HTTPS, PHP/Node/Python runtimes and other legacy modules remain unfinished. Full legacy parity and measured performance are mandatory release requirements.
