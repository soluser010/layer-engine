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

## Framework verification

Run `npm run test:threats` to exercise the HTTP threat suite and generated inputs for operation code generation, hostile JSON keys, PostgreSQL row decoding and archive paths. fast-check reports a seed and shrink path for a failed property. `npm run check` also exercises tenant isolation with generated SQL filter values. Use a loopback test database for the opt-in PostgreSQL integration tests.

The GitHub security workflow analyzes JavaScript and TypeScript with CodeQL's security-extended suite and scans fetched Git history with Gitleaks. Run Gitleaks locally with `gitleaks git --config=.github/security/gitleaks.toml --redact=100 --log-opts="--all" .`. The exception for declaration fingerprints is limited to SHA-256 entries in the public API baseline, which `npm run api:check` independently verifies.

## Deployment boundary

Lightning CSS and its platform bindings are build-time dependencies of the CLI. Web Push uses the separate `web-push` dependency on the server. Their npm packages carry MPL-2.0 notices. Keep those notices when redistributing copies. The dependency versions and integrity hashes for each release are recorded in the lockfile and software bill of materials. [Lightning CSS source](https://github.com/parcel-bundler/lightningcss) · [web-push source](https://github.com/web-push-libs/web-push).

Node.js and Caddy do not provide volumetric DDoS protection. Production deployments require an external CDN/WAF, network-level controls, bounded PostgreSQL/Redis pools, and the application limits documented in [the DDoS runbook](docs/runbooks/ddos-and-capacity.md).
