# Security policy

Layer-Engine treats browser, protocol, storage, server, and deployment security as public compatibility commitments.

## Supported releases

Before `1.0.0`, security fixes are shipped from `main` and documented in the changelog. After the first stable release, the latest stable minor receives all fixes; the preceding minor receives critical fixes for 90 days. Unsupported versions may be affected even when a patch applies cleanly.

## Private reporting

Do not disclose an exploitable report in a public issue. Use GitHub private vulnerability reporting when it is enabled, or contact S.O.L CORP through the contact channel on [solcorp.ru](https://solcorp.ru). If no private channel is available, open a minimal issue asking for a security contact without including exploit details, secrets, affected tenants, or personal data.

Include the affected package/version, impact, prerequisites, a minimal reproduction, and whether exploitation is known. Never test against systems or data you do not own.

## Response process

- Critical reports are acknowledged within 24 hours; other reports within three business days.
- Initial severity and scope are targeted within 72 hours after acknowledgement.
- Confirmed issues receive a private remediation branch, regression test, advisory text, and coordinated release plan.
- Credentials, sessions, API keys, signing keys, and affected deployments are rotated or revoked when exposure is possible.
- Public disclosure follows availability of a fixed release and reasonable deployment time. Reporter credit is optional.

Security logs and reports must omit raw credentials, cookies, CSRF values, message bodies, encryption keys, and personal data.

## Deployment boundary

Node.js and Caddy do not provide volumetric DDoS protection. Production deployments require an external CDN/WAF, network-level controls, bounded PostgreSQL/Redis pools, and the application limits documented in [the DDoS runbook](docs/runbooks/ddos-and-capacity.md).
