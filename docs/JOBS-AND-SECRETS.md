# Durable service jobs and encrypted secrets

This conversion step adds a shared foundation; it does not complete the website, database, container, deployment, hosting or AI ports.

## Service jobs

`POST /api/services/action` requires an authenticated owner/admin, the configured panel Origin, `confirmed: true`, and a `requestKey` of 16–128 ASCII letters, digits, hyphens or underscores. Use one key for retries of the same request. The response is HTTP 202 with `{job}`; it no longer means the host action has already finished. Reusing the same key/input returns that job; reusing it with different input returns 409. Missing confirmation, invalid units/actions and revoked roles cannot dispatch an operation.

Jobs persist in SQLite with queued, running, succeeded, failed and interrupted states. Enqueue/state changes and their audit rows commit together. An audit/storage failure stops dispatch rather than allowing an unaudited host mutation. Pending work is bounded to 100 entries; history reads are bounded to the latest 100. History is retained without automatic deletion in this initial version.

One API worker drains the queue in submission order. The Agent independently serializes service actions, including when an earlier request survives API process loss. The systemd API unit takes an exclusive `flock` on `/var/lib/devone/api.lock`; only one API instance per database is supported. Direct development launches must also use one instance. Multi-host/distributed scheduling is not implemented.

Queued jobs survive restart and their actor's current owner/admin role is checked again at execution. Running jobs at startup are marked interrupted and are never automatically replayed. Network timeouts and Agent 5xx responses have uncertain outcomes and are also interrupted. Inspect the host before deliberately submitting a new action. This is not an exactly-once or automatic rollback guarantee.

`GET /api/jobs` and `GET /api/jobs/:id` require login. Owner/admin may inspect all jobs; other roles can inspect only their own. Job inputs contain service/action, site domain/web-server choice, revision-checked site lifecycle requests, or certificate-operation metadata, never file contents or integration credentials. UI history is refreshed with the overview. No public cancel/retry endpoint is added.

Graceful API shutdown waits for the active request (up to its Agent timeout (35 seconds for services, 120 seconds for site lifecycle, 240 seconds for certificate operations)) and leaves remaining jobs queued. The systemd stop timeout is 45 seconds.

## Secrets

The owner can put/delete credentials using `/api/secrets/:name`. Mutations require the configured panel Origin. Names are lowercase and restricted to 64 safe characters; values are nonempty and bounded to 8 KiB. `GET /api/secrets` returns names and timestamps only. There is no plaintext HTTP read route. Internal provider adapters can retrieve credentials when implemented.

Each value uses AES-256-GCM with a random 12-byte IV, authenticated tag and the secret name as authenticated data. Encryption occurs before insertion into SQLite. Ciphertext copied to another name, altered data and incorrect keys fail decryption. The raw value is absent from job/audit rows and is not logged by these endpoints. A database or API-memory compromise still requires separate operational response; encryption is not a substitute for access control.

The 32-byte master key is `/etc/devone/secrets.key` by default (`DEVONE_MASTER_KEY_FILE` can override it for controlled installs/tests). It must be a regular file with no permissions for other users. Symlinks are rejected. Fresh installs provision it as root:devone 0640 and never replace an existing key. The key is separate from SQLite and is not returned to browsers or committed to git.

Existing Node test installations can provision a missing key with:

```bash
sudo bash /opt/devone/current/scripts/provision-vault-key.sh
```

The helper preserves existing files. The API returns 503 for secret writes when the key is missing/invalid; it does not generate a replacement. Back up the original key securely, separately from SQLite. Losing it makes existing secrets unrecoverable. Automatic rotation/migration is not implemented.

## Validation

Tests cover serialization, duplicate requests, conflicting request keys, API restart persistence, interrupted work, role revocation, submission rollback on audit failure, unauthorized routes, origin checks, ciphertext tampering/name binding, key permissions and limits, metadata-only reads, and absence of raw values in SQLite secret/audit rows. API integration uses a mock Agent and performs no real host service restart. Production installation, browser end-to-end flows, hard host reboot and systemd lock behavior remain live-VPS acceptance tests.
