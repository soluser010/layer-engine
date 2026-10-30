# Production deployment and rollback

## Required topology

Traffic terminates at an external CDN/WAF, then Caddy automatic HTTPS, then private Node.js instances. Node reaches PostgreSQL and Redis on private networks only. PostgreSQL is the source of truth; Redis is disposable coordination and fan-out state.

Production must not fall back to HTTP when certificate issuance fails. Only localhost development, ACME handling, and HTTP-to-HTTPS redirects use plaintext HTTP.

## Portable bundle contract

Run `layer build` in the application and deploy only its generated `dist`
directory. The directory is a complete release unit: browser assets, immutable
build metadata, generated Caddyfile, exact production package lock, launcher,
and an optional bundled Node server entry. Do not copy the workspace
`node_modules`, source tree, npm credentials, or a developer `.env` into it.

Static routes declared with `render: 'ssr'` are emitted as route-owned HTML
documents. Generated Caddy resolves those documents first and uses
`/_layer/shell.html` only for dynamic/CSR navigation. Verify both the no-JavaScript
HTML content and the subsequent hydration path during canary checks.

The target host must already provide Node.js >=24.22.1 <25 and npm 11. Configure:

- `LAYER_DOMAIN` when `deployment.domain` was left `null`; environment wins over the build value;
- `LAYER_STATE_DIRECTORY` when the OS user-state default is unsuitable;
- optional `LAYER_ORIGIN_PORT`, which remains loopback-only;
- optional `LAYER_CADDY_ADMIN_PORT` for the loopback-only Caddy admin endpoint; by default Layer places it after the reserved worker port range;
- `LAYER_HTTP_PORT`/`LAYER_HTTPS_PORT` only for controlled staging or non-standard edge layouts.

Run `npm run check` before opening listeners. It verifies the integrity manifest,
runtime versions, exact npm tree, pinned Caddy 2.11.4 executable, and Caddyfile.
When `node_modules` is absent or does not match the lock, the launcher runs only
`npm ci --omit=dev --ignore-scripts --no-audit --no-fund`. A failed registry,
partial tree, concurrent install timeout, checksum mismatch, unsupported platform,
or missing domain stops deployment.

`npm start` is a foreground command. Put it under systemd, PM2, or a Windows
service manager with restart limits and graceful `SIGTERM`. The service identity
needs access to ports 80/443 (or an explicit equivalent), its state directory,
and no broader filesystem privileges. DNS and firewall rules must be correct
before start. Caddy data and certificates stay in persistent state outside the
release directory, so an atomic release-directory swap does not discard them.

The launcher calls `layerServerCreate(context)` with the generated loopback
`trustedProxy` contract. The server entry must pass `context.trustedProxy` to
`layerHttpRuntimeCreate` so rate limiting and audit identity use the nearest
untrusted forwarded address. The HTTP runtime ignores forwarded headers when
that explicit contract is absent.

## Preflight

1. Verify the reviewed commit, changelog, provenance/SBOM evidence required by the release class, package digests, and `npm run release:check` result. A stable tag is not required for an internal test deployment.
2. Copy `dist` into an isolated release directory and run `npm run check`; never continue after a non-zero result.
3. Confirm database backup freshness and perform a restore rehearsal in an isolated environment.
4. Confirm Redis eviction policy, persistence choice, memory ceiling, and failover alerts.
5. Confirm CDN/WAF origin authentication, body/connection limits, bot controls, and emergency rules.
6. Run migrations in expand-only mode and record duration/locks.
7. Run Chrome, Edge, Firefox and Playwright WebKit smoke gates against staging. Native Safari is an optional, explicitly scoped best-effort device check, not a mandatory certification gate.

## Deploy

Deploy one canary release directory with the new application and unchanged shared schema. Start `npm start` under the supervisor and verify HTTPS redirect, security/cache headers, navigation fallback, asset 404, metadata denial, readiness, login/CSRF, one query, one idempotent command, SSE flush, event replay, offline command replay, SSR/hydration, Service Worker reload/waiting/activation, and audit delivery. Increase traffic gradually while observing error rate, p95/p99 latency, event lag, pool saturation, Redis errors, memory, and process restarts.

During replacement, mark an instance draining, stop accepting new streams, emit `server-drain`, wait for bounded operations, and then terminate. Never kill all event-stream nodes simultaneously.

## Rollback

Stop rollout and route new traffic to the last verified release directory. Drain affected instances, stop the supervisor, switch the release pointer, run that directory's `npm run check`, and restart it. Roll back code only if the database is still backward compatible. Do not reverse a migration by editing its checksum. If a data correction is required, ship a new reviewed forward migration.

For a bad Service Worker, publish a higher version that repairs caches and honors saved drafts/outbox; do not reuse a version identifier. For Redis failure, keep durable writes in PostgreSQL, disable presence as needed, restore Redis, then replay confirmed events from the journal.

## Post-deploy

Keep the previous artifacts and deployment configuration for the documented rollback window. Record migration IDs, package digests, provenance signature, operator, timestamps, canary metrics, and any waived gate in the deployment record.
