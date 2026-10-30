# Creative Soundwerks 2 — DevOne Software Center

**Status:** managed installer integration, developer preview. Use a staging VPS and a new/empty website. No production release or live server deployment is asserted by this repository update.

## Dashboard install

1. Update DevOne Server Software to a reviewed `main` commit whose GitHub CI checks passed. Do not rerun the fresh DevOne installer on an existing panel.
2. Open **Software Center → Creative Soundwerks 2 → Install Creative Soundwerks**, or select it under **Install an application**.
3. Choose **Create a new website** and enter the domain, or select an existing **empty Node.js 22 website**. A non-empty website is refused.
4. Enter a platform name, administrator username, administrator email, and a strong password twice. This is the *Creative Soundwerks* account, not the DevOne panel account.
5. Enter your **DevOne Owner password**, fresh MFA/recovery code if enabled, and approve installation of PostgreSQL, FFmpeg, and Creative Soundwerks on this site.
6. Follow the installation job in the same panel. DevOne creates a site-scoped PostgreSQL database, prepares private storage, builds the pinned Soundwerks source as the website's dedicated unprivileged Linux user, publishes the Node.js service, creates the first administrator and checks the website.
7. Use **Websites & Files → Enable HTTPS** for the domain; public DNS must resolve to this VPS and ports 80/443 must be accessible.
8. Return to **Software Center → recent installations → Unlock saved login**. Confirm your DevOne Owner password/MFA again to reveal the Soundwerks administrator email/password. The credentials display expires and is never included in the job logs.
9. Open `https://YOUR-DOMAIN/login`; configure creator/listener membership prices, Stripe server secrets and media settings in Creative Soundwerks.

## DevOne integration

- The install entry appears in the curated catalog and application installer, alongside WordPress and DevOne CMS.
- API endpoints: `GET /api/apps/soundwerks`, `POST /api/apps/soundwerks/install`, `GET /api/apps/soundwerks/:id`, `POST /api/apps/soundwerks/:id/credentials`.
- The authenticated API records the install reservation and job, with encrypted Vault secrets. Persisted job JSON contains **only the install ID**, never passwords or database credentials.
- The privileged Agent validates the immutable, pinned Creative Soundwerks source revision. It builds npm code **only after dropping root privileges and supplementary groups** to the site's Linux identity.
- Data and `.env` live outside the public document root at `/home/devone-sites/<SITE_ID>/data`; the Node process uses `CSW_CONFIG_PATH` to locate its private configuration.
- DevOne manages one Node systemd site service and Nginx reverse proxy. Creative Soundwerks uses that service's fixed loopback port, not a competing VPS-wide Nginx installation.
- A staged install that fails marks the website `needs_inspection` and retains its database and staged media for review. Do not silently delete these resources or assume an unsuccessful job is safe to retry.

## Requirements and limitations

- Ubuntu 24.04 on a DevOne-supported host; Node.js 22 and working Nginx.
- PostgreSQL and FFmpeg/FFprobe are installed as needed through the Agent's audited, fixed-package installer, not by a browser shell command.
- Enough disk/RAM/bandwidth to run PostgreSQL plus media streaming. Large movie libraries need capacity planning; the installation feature does not imply HLS transcoding or DRM support.
- DevOne pins a **reviewed source commit** of Creative Soundwerks rather than executing an arbitrary repository URL or live `main` contents; update the pin through a reviewed DevOne source change with test evidence.
- Stripe credentials, payout onboarding, external DNS records and license/content-rights policies are **not** automatically provisioned.
- This creates a fresh installation; in-place upgrades, full app removal and full media/database restore need separate lifecycle operations.
- CI covers builds, isolated authorization tests and mock site/DB worker flows. **Real Ubuntu host installation, TLS, reboot and browser acceptance must still be verified** before declaring stable.

## Diagnostics

In DevOne, check **Activity & Jobs** for the installation job and **Websites & Files** for the website status. On the VPS, a trusted administrator may inspect the site-specific unit using `systemctl status devone-<SITE_ID>.service` and `journalctl -u devone-<SITE_ID>.service`. Do not copy passwords, environment files, setup tokens or database secrets into support tickets.

The normal DevOne in-place updater is used to deploy this feature onto an existing panel, after its target commit passes both GitHub checks. Do not re-run DevOne's fresh server install script.
