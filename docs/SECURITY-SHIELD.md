DevOne Security Shield — Phase 1

The control plane and website security policies are separate. Website operators cannot edit the DevOne panel virtual host; its authentication and administrative protections are independent of sites.

The first integrated site protection uses the native NGINX request-rate limiter. Per-site policies are saved in the server Agent's root-protected site registry and applied to managed NGINX server blocks. Off does not restrict traffic; Monitor uses limit_req_dry_run, logging exceeded rates without blocking; Enforce returns HTTP 429 for exceeded rates. Client-controlled values are limited to 1-50 requests per second and a burst of 1-100 requests. ACME challenge routes are excluded. If TLS is enabled, normal site content is protected under HTTPS; the HTTP redirect itself is not separately rate limited.

An Owner password recheck, same-origin request, explicit confirmation, revision match, hashed config match, NGINX syntax validation and reload are required for every site policy update. Failed applications attempt to restore the prior site configuration and require operator inspection if restoration fails. No ad hoc NGINX config, file path, client-defined address or arbitrary command is accepted. No site policy affects the control-panel domain.

This is NOT YET a general-purpose web application firewall: it does not inspect HTTP bodies for OWASP vulnerabilities, match bot fingerprints, solve CAPTCHA, integrate CrowdSec threat intelligence, scan CVEs or protect a saturated upstream DDoS link. NGINX dry-run events can be seen in host logs but dashboard incident ingestion is not implemented. Sites begin with Off rather than silent blocking.

Next security steps: Owner MFA; hardened sessions and Agent authentication; CrowdSec deployment and AppSec/bouncer evaluation; independent rule sets and per-site exceptions; false-positive review and WAF log ingestion; Trivy vulnerability advisory feeds; DNSSEC provider checks and provider-level volumetric DDoS mitigation. Every adapter requires version pinning, rollback and disposable VPS validation prior to automatic installation. Upstream DNS attacks cannot be fully mitigated by a VPS WAF.

Proxy warning: NGINX currently keys its limiter on the directly connected remote address. Sites behind Cloudflare, another reverse proxy or NAT may put unrelated users under the same rate-limit key. Enforce should not be enabled until a correctly scoped trusted proxy real-IP policy is separately configured and tested. Never trust arbitrary incoming X-Forwarded-For headers.
