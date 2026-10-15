# Security hardening — Phase 2 (MFA) and CrowdSec AppSec readiness

## Owner authenticator MFA

New TOTP (RFC 6238, 6-digit SHA1, 30-second steps) enrollment and login challenge for the Owner. MFA setup is **optional** until the Owner activates it. The Owner re-enters the current password, manually registers the secret with an authenticator, and confirms a current six-digit code. The secret is encrypted at rest with the DevOne master encryption key using AES-GCM and separate authenticated associated data; the secret is never exposed again. Successful confirmation creates eight random, one-time recovery codes stored as one-way hashes; codes appear **only once**.

Once MFA is enabled, password-only authentication returns a challenge indication with NO session cookie. A valid authenticator code or unused recovery code is required to create a session. Accepted time-step counters cannot be replayed. Enabling or disabling MFA invalidates the Owner's earlier sessions and issues a new cookie. Owner password and current MFA/recovery code are required to disable it.

Important limits: This version does not provide passkeys/WebAuthn, device trust, remote MFA reset or hardware key recovery. Lost authenticator **and** all recovery codes require documented offline administrative recovery; DevOne does not expose a browser bypass. Restoring the database also requires preserving the separate master key. A compromised Owner session before MFA enrollment can still make changes permitted by existing authorization; further step-up on other high-risk operations and MFA for other admin roles need follow-on work. The existing IP-based authentication rate limit remains active. Use a trusted HTTPS connection, record recovery codes securely, and test login before ending the original session.

## CrowdSec detection and AppSec readiness

Security Center now includes a **read-only** CrowdSec status integration. It checks whether cscli is available, whether the CrowdSec engine reports active, whether NGINX is active, and whether expected acquisition, NGINX bouncer and AppSec acquisition configuration files are present. Those are **readiness signals, not proof** of active rule enforcement. No CrowdSec credentials, log entries, tokens, IP bans or local content are exposed by the API.

CrowdSec Security Engine, NGINX remediation component and AppSec WAF are separately deployed pieces. Installing only the engine does NOT block requests. DevOne does not yet automatically install the CrowdSec repository, NGINX Lua components, bouncer or AppSec rule packs, and does not turn on customer blocking in this release. There is no remote arbitrary-command endpoint for installation.

Official verified instructions:
- CrowdSec Linux installation: https://docs.crowdsec.net/u/getting_started/installation/linux/
- NGINX remediation component: https://docs.crowdsec.net/docs/bouncers/nginx/
- CrowdSec AppSec and NGINX reverse proxy example: https://docs.crowdsec.net/u/user_guides/waf_rp_howto/

Pilot rollout protocol, **not yet verified on the user's Lightsail**:
1. On a disposable Ubuntu VPS of the same NGINX version, snapshot all NGINX and DevOne configs and test rollback.
2. Install signed CrowdSec apt packages using upstream-maintained repository instructions, not curl-pipe-shell in a dashboard operation. Install NGINX Lua prerequisites after confirming compatibility with the installed NGINX build.
3. Configure safe NGINX log acquisition; confirm detection and inspect resource usage.
4. Install official NGINX remediation component on the disposable host, with its API key restricted and the DevOne panel excluded.
5. Enable AppSec acquisition locally and load recommended upstream rule collections in **detection-first** mode; test malicious and legitimate traffic, TLS, per-site exceptions, log interpretation and recoverability.
6. Integrate separate site-scoped bouncer/AppSec settings with audit, config validation and atomic rollback before adding an Enforce switch to DevOne.
7. Verify DNS/CDN real-IP trust rather than accepting untrusted X-Forwarded-For and take explicit measures to avoid locking out the control plane.

The existing per-site NGINX rate-limiting rules continue independently of CrowdSec. Volumetric DDoS and authoritative DNS attacks require upstream mitigations beyond host-local WAF.
