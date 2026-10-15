# DevOne Security Shield — CrowdSec activity and privileged MFA step-up

## Implemented in this increment

### Host-wide CrowdSec activity
The privileged Agent runs only two fixed, bounded CrowdSec CLI reads:
- cscli alerts list -o json -l 20
- cscli decisions list -o json -l 50

Commands have a six-second timeout and a 256 KiB output cap each. API requests do not pass flags, shell arguments, paths or arbitrary commands to the Agent. Returned information is restricted to aggregate counts of known scenario labels and decision types; IPs, ranges, machine details, raw logs, arbitrary custom scenario descriptions, credentials and request payloads are not exposed. Failed or unparseable commands report **unavailable**, never zero threats. The Owner/Admin dashboard uses a 30-second cached endpoint and labels the records as **recent host-wide samples**, not complete totals or per-site event attribution.

Detection and CrowdSec decisions do **not** establish that NGINX is actively blocking traffic. The AppSec/bouncer enforcement states remain unverified, even if a config file exists.

### MFA step-up for security-sensitive actions
With authenticator MFA enabled on the Owner account, the following actions now require a fresh authenticator or unused recovery code **in addition to** the Owner password and existing same-origin checks:
- Install an approved DevOne Server update from the dashboard.
- Change a per-site NGINX Security Shield policy.

MFA is optional until enabled. A consumed TOTP time step or recovery code cannot be replayed to approve another action. A failed or inaccessible downstream Agent may require checking operation state before retrying; do not automatically repeat a sensitive action. Other Owner operations such as database backups, secrets changes, service control and account recovery still need a broader step-up coverage review.

## Test status / acceptance gates

GitHub CI tests CrowdSec JSON parsing and confidentiality, error handling for unavailable CLI, API Owner/Admin authorization, MFA-required behavior, reused-code rejection, frontend type-check and build, and installer syntax.

The following **real-host tests remain required** and are not implied by passing GitHub CI:

1. On a disposable Ubuntu 24.04 host matching production, verify CrowdSec package signing, apt origin, installed version, NGINX/Lua compatibility, log acquisition and memory overhead.
2. Before installing detection, snapshot NGINX/DevOne config, preserve root access and SSH, verify existing website TLS and panel access.
3. Install only the signed CrowdSec detection engine following the official manual repository instructions. Confirm the Agent reports installation/running status, and the event inventory transitions from unavailable to an empty/real sample. Do not deploy remediation.
4. Test CrowdSec NGINX bouncer on an isolated **test website** only, in simulation/detection mode with known benign and malicious traffic; record live logs and false positives. Explicitly exclude panel health, login and ACME challenges.
5. Introduce AppSec/WAF inspection with pinned upstream rule collections, controlled exception scope, clear rule provenance, and a rollback that restores a verified NGINX configuration.
6. Exercise failure recovery: CrowdSec service stopped, local API unreachable, bad NGINX config, maintenance reboot, update rollback, and proxied/NAT client IP trust. A large volumetric DDoS still requires provider-level network mitigation.
7. Only after host acceptance, implement bouncer/AppSec per-site enforcement in the dashboard with time-limited exceptions, event audit, and site-scoped detection/blocks.

Next milestones: disposable VPS CrowdSec **engine installation**, per-site AppSec bouncer pilot, CVE advisory scanner integration, and complete Owner/Admin hardening across all privileged operations. No untested automatic package install or WAF blocking should ship to the live control panel.
