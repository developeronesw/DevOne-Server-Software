# DevOne repository delivery requirements

- Deliver completed, validated changes into `main`; a draft PR or feature branch alone is not completion. Temporary branches are allowed for development/review, and merges must preserve concurrent work.
- Ship fixes through the standard fresh installer and in-place updater. Include required prerequisites and migrations; do not rely on one-off edits to a single VPS or ask users to repeat code patches on new servers.
- Preserve server-specific configuration, encrypted credentials, sites and databases during updates. Do not rerun the fresh installer against an existing installation.
- Validate the affected code and required repository checks before integrating it. Keep production updates pinned to a reviewed commit; merging into main does not by itself authorize remote server access or deployment.
- Follow docs/MASTER-PLAN.md and maintain docs/STABLE-1.0-STATUS.md when milestones change. Do not label developer-preview features or green unit tests as stable production acceptance.
