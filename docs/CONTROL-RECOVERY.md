# Encrypted control-data recovery

## Dashboard workflow

Update through Software Updates, then open **Backups → Protect your panel data**. Panel HTTPS and an Owner account are required.

1. Choose a separate recovery passphrase of 16–128 characters and confirm it. Keep it in a password manager separately from the downloaded bundle. DevOne does not retain it. Losing it makes the bundle unrecoverable.
2. Approve creation with your panel Owner password and a fresh MFA/recovery code if enabled.
3. Download the encrypted `.devone` bundle to another device or protected backup location. A copy stored only on this VPS does not protect against losing the VPS.
4. Select **Test restore**, enter that bundle's recovery passphrase and fresh Owner approval. DevOne decrypts into a private temporary directory, checks SQLite integrity/foreign keys, verifies every vault and MFA record decrypts, and exercises the offline restore transformation. Temporary restored files are removed after pass/failure. The live database, sessions, vault key and host services are not restored or replaced. Normal audit and drill-history records are written to the live panel.
5. A successful drill records its time and the encrypted file's SHA-256. A failed drill clears the displayed earlier pass. The timestamp is historical evidence, not a continuous integrity check. Downloading a file alone is not a restore drill.

The limit is ten encrypted bundles and a 32 MiB control database per bundle. A free-space preflight reserves 128 MiB beyond estimated temporary/output needs. There is no automatic retention deletion. Download and verify the copies you need, then explicitly approve deletion of selected server copies. Downloads require the current Owner session; creation, verification and deletion additionally require Origin validation, confirmation, password/MFA and bounded step-up attempts. Operations serialize within the single API process. Recovery passphrases/passwords never enter jobs, AI plans, audit details or response metadata.

## Included and excluded

The versioned authenticated AES-256-GCM bundle contains a consistent SQLite online backup and its 32-byte vault master key. A random salt and fixed scrypt parameters (N=32768, r=8, p=1) derive the encryption key; the application stores no recovery-passphrase verifier. Fixed work factors, bounded files and one-operation concurrency limit memory/work amplification. The bundle includes control users/password hashes, MFA records, encrypted saved secrets, jobs and panel records. Protect both bundle and passphrase accordingly.

This is **control-data recovery**, not a full-server image. Website files, WordPress/application SQL databases, DevOne CMS private SQLite/key files, Agent site/database registry, Linux users, application services, certificates, NGINX configuration, panel environment/Agent token and external DNS state are excluded. Restoring control records without those resources does not reconstruct a running server. Their backup/reconciliation workflows remain release blockers.

Existing **Control database snapshots** remain available. Those `.sqlite` files are not encrypted archives and do not include the vault key; they are not equivalent to the new encrypted bundle.

## Offline verification and restore

Use a trusted checkout/build containing this recovery format. The helper imports the standard compiled API module; the normal installer/updater includes it. No new packages or host configuration changes are needed. Current format 1 supports the current `1.0.0-alpha.3` control schema; cross-version migration is not implemented.

On a separate trusted recovery machine, place the downloaded bundle and a passphrase file inside an existing private directory. The directory must be mode 0700 and files mode 0600. No symlink paths are accepted. Enter the passphrase into the private file with a secure editor; do not put it in command arguments, shell history, Git or shared logs. One final newline is accepted. These commands take a path to that file, never the passphrase itself:

```bash
node scripts/control-recovery.mjs verify /secure/recovery/control-ID.devone --passphrase-file /secure/recovery/passphrase
node scripts/control-recovery.mjs restore /secure/recovery/control-ID.devone --passphrase-file /secure/recovery/passphrase /secure/recovery/restored-copy
```

`restored-copy` must not already exist, including an empty directory. Its parent must be private and must not resolve through symlinks. Successful restore writes only `control.sqlite`, `vault.key` and `recovery.json` with private permissions. It invalidates saved sessions and marks queued/running jobs interrupted with `recovery_requires_review`; it never executes pending operations. It does not start services, change DNS, install packages or activate the recovered database. The output always says `activated: false`.

Treat missing success output or a missing `recovery.json` as incomplete recovery. Abrupt process/host loss can leave private temporary/partial files; this is not proof of a completed restore. Inspect those remnants on the isolated recovery machine before rerunning into a different new directory. Routine handled failures remove their temporary output.

Keep the original live server/data untouched while checking the recovered copy. Actual activation needs a separately reviewed host/configuration/Agent reconciliation procedure, matching software and explicit operational approval; this increment intentionally provides no live replacement endpoint. A historical backup also restores historical authorization and MFA recovery-code state. Review accounts and rotate/re-enroll MFA/recovery codes and affected credentials before activating any recovered environment. Do not expose the restored copy publicly just because the isolated drill passed.

## Acceptance evidence

`tests/recovery.test.mjs` exercises real SQLite online snapshots and offline restoration, Owner password-hash preservation, saved-vault decryptability, MFA preservation, session invalidation, pending-job interruption, source-data preservation, wrong passphrases/tampering/truncation, overwrite refusal, symlink/private-permission/size guards, independent API Owner/Origin/password/MFA enforcement, rate/concurrency limits, real create/download/drill/delete, redacted audit metadata and the standalone command.

This is isolated automated recovery evidence. Full-server backup/restore, rendered browser interaction, systemd/reboot/target-host recovery, offsite scheduling and phase/stable release acceptance remain open.
