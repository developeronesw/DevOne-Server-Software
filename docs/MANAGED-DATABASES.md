# Batch B: managed application databases

## Implemented scope

Software Center now offers Ubuntu `mariadb-server` and `postgresql` in addition to PHP-FPM, Redis and Docker. The same Owner password/MFA, verified Ubuntu APT origin, simulated dependency plan, protected-package restrictions, install lock, audit/jobs and service postchecks apply. MariaDB's package maps to the `mariadb` systemd unit. A SQL-engine install that observes a listener outside loopback reports `database_exposed`; it does not silently rewrite configuration or uninstall the engine. Shared engines are optional, not installed by the base installer.

The Databases page now allows the Owner to create a database and an application account for a selected ready managed website. Provisioning uses `database.create` durable jobs and a root-owned Agent registry. It serializes with site lifecycle operations. PostgreSQL supports the local PostgreSQL 16+ profile; MariaDB supports Ubuntu 24.04's MariaDB 10.11 profile. Existing engines must allow local administrative authentication (root via MariaDB socket; postgres via PostgreSQL peer authentication). Unsupported versions, another server type or unavailable admin authentication fail before SQL mutation. DevOne does not change existing administrator passwords or authentication settings.

Each generated identifier is derived from a random database ID, contains only a fixed prefix and hexadecimal digits, and is never chosen by the browser. The API generates a 32-byte random password and writes it to the existing encrypted vault before enqueueing. Job inputs/history/audit contain IDs, engine and site association, never the generated password, hashes or SQL. Repeated request keys reuse the original database identity and encrypted credential; a changed target/engine conflicts. Missing vault credentials block execution.

## Permissions and verification

MariaDB creates a localhost-only `mysql_native_password` account with privileges limited to its generated database, without global privileges or GRANT OPTION. Identifiers contain no SQL wildcard characters. The native authentication format is used for conventional application/WordPress client compatibility; authentication is local and uses a randomly generated secret. PostgreSQL creates an explicitly restricted login role (no superuser, database/role creation, inherited roles, replication or RLS bypass), a database owned by that role, and revokes PUBLIC permissions on that managed database. This is not a claim that pre-existing databases with PUBLIC grants are isolated: existing global grants and pg_hba.conf remain administrator-managed.

SQL receives password hashes through stdin, not plaintext passwords in arguments. PostgreSQL uses SCRAM-SHA-256; MariaDB receives the native password hash. A separate client connection checks the generated database and authenticated username before a record becomes ready. Temporary credentials are in mode-0600 files within a root-only directory and removed after verification. Client arguments, API responses and errors do not include raw database command output. The login check verifies the connection under existing engine authentication policy; it does not certify all host authentication rules or continuous health.

The Owner may reveal a ready database's password through a separate no-store endpoint after password/MFA step-up, recorded in the audit trail. The frontend hides it by default and clears it after 60 seconds or navigation. Credentials are not sent to AI providers. Database creation and credential reveal are not AI tools in this increment.

## Failure and lifecycle behavior

A persisted provisioning record is never replayed automatically. SQL objects are created without IF NOT EXISTS, so unrelated existing objects cannot be adopted or overwritten. A partial SQL operation or failed app connection marks the record `needs_inspection`; no automatic DROP is attempted. On Agent restart, orphaned provisioning records are shown as needing inspection. API restart leaves running jobs interrupted using the existing queue behavior. Preserve the registry and vault together during future full-server recovery.

Deleting a website does not delete its application databases or their credentials. Retained databases remain visible by their original site ID. Database deletion, password rotation, user/permission editing, phpMyAdmin, dumps/restores, application configuration and actual CMS installation remain unfinished. This increment is database provisioning, not completion of Phases 3–4.

## Standard delivery and acceptance

The API creates its additional control table with CREATE TABLE IF NOT EXISTS; there is no manual database patch. The Agent creates its restricted registry lazily. Both new installations and in-place updates build these modules through existing standard paths. Do not rerun the fresh installer on an installed VPS. Optional engines are installed through Software Center after updating.

Automated tests cover input/SQL boundaries, least-privilege statement generation, registry protections, temporary credential permissions/cleanup, actual-identity acceptance parsing, partial failures/no replay, engine preflight, secret-free job inputs, Owner-only execution, step-up, encrypted credential persistence, idempotency, service mapping and loopback listener checks. Command-injected fixtures do not prove real SQL behavior. Live Ubuntu acceptance must create databases on both engines, verify application logins and cross-managed-database denial, check reboot/update behavior and inspect permissions before certification.

Official references: [MariaDB authentication format](https://mariadb.com/docs/server/reference/plugins/authentication-plugins/authentication-plugin-mysql_native_password), [PostgreSQL CREATE ROLE](https://www.postgresql.org/docs/16/sql-createrole.html).
