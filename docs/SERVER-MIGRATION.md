# DevOne managed-server migration

This workflow moves DevOne-managed data from one supported Ubuntu VPS to a fresh DevOne installation, for example when upgrading RAM/storage. It is an encrypted application migration, not a bootable disk/OS image. Do not remove the source VPS until destination acceptance and DNS cutover are confirmed.

## Data coverage

| Resource | Migration behavior |
| --- | --- |
| Panel accounts, password hashes, roles, MFA, vault and saved app/SQL/provider credentials | Consistent online control-database/key backup; restore invalidates panel sessions and interrupts pending jobs |
| Managed websites | Whole site home, including hidden files, public files, application dependencies and private sibling data; stable site IDs/domains/aliases preserved |
| DevOne CMS private SQLite and encryption keys | Included in the stopped site's complete home; never limited to the public directory |
| Managed MariaDB/PostgreSQL | Logical dumps, matching database/account names and saved passwords; restore recreates isolated accounts and imports as the application user |
| Filesystem identities and hosting | Destination Linux UIDs/GIDs are assigned locally and mapped onto restored ownership; modes/timestamps are restored, public read ACLs and trusted hosting/runtime templates are regenerated |
| Active/retained managed site TLS certificates | Current certificate/key/chain, supported Let's Encrypt webroot account material and renewal configuration; domain/key compatibility checked |
| Redis installed through the supported local profile | Full RDB export, integrity validation and restore onto empty destination Redis; custom authentication/modules/AOF destination configuration can block migration |
| Fixed managed container websites | Site bind-mounted content and the source managed image; destination uses the existing restricted container adapter |
| Existing control backups | Included; migration archives themselves are excluded to avoid recursive backup growth |
| Destination identity | Its panel URL, Agent token/connection, environment paths, SSH/root accounts, network and firewall remain local |

Unregistered websites, SQL databases/accounts, Docker containers/volumes/networks, site crontabs and unsupported CrowdSec/custom site/runtime configuration block export when detected. Broken/incomplete managed resources also block it. This prevents a discovered coverage gap being silently labeled a complete migration. OS configuration, arbitrary services/mail/root cron, SSH/root credentials, external DNS/Cloudflare/provider resources, system journal and unsupported storage are outside this adapter. Review that scope explicitly before export; detection is not an exhaustive whole-OS inventory.

Both installations must currently use the **same reviewed Git commit**, Ubuntu 24.04 x86-64 and the supported runtime/database profiles. PostgreSQL 16 and MariaDB 10.11 are the supported migration SQL profiles. A newer target is not automatically schema-compatible with an old backup. Inspection exposes the source/target commit and compatibility blockers; apply independently checks again. Cross-version migration/conversion remains separate work.

## Source: create the backup

1. Update through Software Updates. Finish queued/running jobs first.
2. Open **Backups → Server migration → Create migration backup**.
3. Choose and confirm a separate 16–128 character migration passphrase. Save it separately from the archive. DevOne does not retain it.
4. Review scope and authorize a pause in managed website writes. Stop external writers to these application databases as well; DevOne cannot freeze clients on another machine.
5. For final cutover, choose **keep source websites paused after export**. Otherwise DevOne resumes them after export, and later writes will not be in that snapshot.
6. Approve with the current panel Owner password and fresh MFA/recovery code if enabled. Follow the durable server-side phases.
7. Download the completed encrypted `.devone-migration` file and retain its SHA-256. Keep another secure copy off the old VPS.

Export temporarily serves maintenance responses for managed public sites, stops active managed Node/Python/container workloads and the shared PHP service when PHP sites exist, then checks for remaining site-account processes. It captures SQL/private files in that window and resumes original hosting after a normal export. Final-cutover mode leaves the source paused intentionally with its panel available; its small root-owned resume journal is retained, while temporary dumps and key copies are removed. Resuming the source is a separate approved action, normally used when abandoning/rolling back cutover. Do not resume an old writable source while traffic is moving to the new server.

Archives stream through authenticated AES-256-GCM encryption with a random salt/IV and fixed scrypt work factors. Files have per-entry hashes and a bounded final manifest. They are not loaded wholesale into browser/API memory. Source disk must accommodate output plus temporary SQL/image exports; space preflights can refuse a backup. Limits are three source migration archives, three upload slots, up to 1 TiB per archive and 200,000 archive entries. The inner control database/key format currently retains its 32 MiB database limit. These are supported limits, not a promise that every machine can handle their maximum.

## Destination: upload, inspect, restore

1. Install DevOne normally on the larger VPS at the source backup's commit. Complete setup with a temporary Owner and a distinct panel hostname if any website would otherwise conflict with it. Do not add websites, databases or saved secrets to this destination.
2. Open **Backups → Server migration → Upload & restore**.
3. Choose the encrypted file, approve a new upload with the destination Owner password/MFA and upload it. Transfers use bounded chunks; after interruption choose the same slot and file to continue. A prefix hash and final authenticated archive validation reject mismatches.
4. Enter the migration passphrase and fresh destination Owner approval, then **Inspect encrypted backup**. The worker authenticates the whole archive before parsing it, verifies paths/hashes, tests the control/key recovery, checks credentials/TLS and creates a one-hour review plan. This stage creates private staging only.
5. Review the source/target, sites, databases, storage, supported packages, exclusions and blockers. A blocked plan can be viewed but cannot be applied. Fix destination prerequisites or use the correct software version, then inspect again.
6. Approve account replacement, type the destination panel hostname, enter fresh destination Owner password/MFA, and select **Restore this DevOne server**.
7. The worker installs missing supported package prerequisites, recreates identities/hosting, restores all listed content and databases, checks applications on loopback and then activates recovered panel records. The destination's Agent/network/panel identity is preserved. Site serving is held on loopback until checks and panel activation succeed.
8. The temporary destination session becomes invalid. Sign in with the **source server's** Owner credentials and MFA. Saved credentials decrypt with the restored source vault key. Review historical MFA recovery-code/account state and rotate credentials as appropriate after recovery.
9. Verify content, uploads, administrator logins, application actions, private-path protection, background tasks, TLS and database writes on the new server. Use a controlled client hosts override or equivalent private test routing before changing public DNS. Then change DNS/Cloudflare origin records deliberately. DNS is never changed automatically by restore.
10. Retain the old paused VPS and the verified archive through cutover. After verification, explicitly delete uploaded archives and private staging/rollback copies you no longer need. Expired plans cannot apply, but are not silently erased.

Existing application domains and IDs stay the same. Migration does not rewrite arbitrary IP literals, third-party callbacks or custom absolute paths inside customer code. Inventory those integrations and verify them before cutover. A domain change is a separate operation.

## Failure, interruption and rollback

API/Agent administrative writes and normal updater actions are blocked by migration maintenance guards while the root worker holds its durable lock. Jobs run in a separate transient systemd service and keep sanitized phases without passphrases or SQL passwords. A browser disconnect does not cancel a running server operation.

**Stop worker & recover** requires fresh Owner approval. It stops the known migration unit before attempting source resume, destination rollback or inspection discard. Following a reboot/outage, the retained journal and status identify interrupted work. Unknown/partial SQL or site creation is retained for inspection rather than blindly dropped. A rollback that cannot prove ownership/completeness leaves the guard active and reports inspection required. Never interpret that as a clean destination or a successful migration.

Before replacing panel state, the destination keeps private copies of its original control database, vault key and environment. A verified rollback restores them and removes only resources recorded as successfully created by this attempt. Installed prerequisite packages, cached container images and ACME-account material may remain; this is not an OS factory reset. Failure before package installation completes can require package repair. Neither recovery path resets or deletes the source VPS.

Recovery/rollback copies are sensitive. Root-owned staging is intentionally inaccessible through HTTP. Deleting a completed plan removes its local rollback evidence, so do that only after accepting or abandoning the restore. A worker/host failure can leave private temporary files; the durable state and explicit recovery process must resolve them.

## Validation and remaining acceptance

Local regression covers streaming archive roundtrips (hidden files/private SQLite/keys/binary data), tamper/wrong-passphrase handling, unsafe paths/links/devices/duplicate members, metadata completeness, resumable upload consistency, global locking/repeated recovery, API Owner/Origin/password/MFA/scope boundaries, fixed site IDs and destination identity remapping. A regression covers short-lived child stdout buffering during key derivation.

Isolated Ubuntu CI adds real MariaDB/PostgreSQL export/reset/recreate/import checks and malicious-client-command/privilege denial. A root fixture exercises the full export/inspect/file/control/vault restore, source pause/resume, final-cutover hold, nonempty-target refusal and failed-activation rollback. Its host service/account commands are stubbed; file copying, ownership, SQLite, vault encryption and archive processing are real. This is separate from actual systemd/APT/public TLS/network/browser/two-VPS migration acceptance.

The workflow remains developer-preview until live migration/reboot/interruption/certificate-renewal acceptance is recorded for an exact candidate. Full phase completion and stable release remain blocked. Never delete the only original data copy based solely on green isolated tests.
