---
title: Build, deployment, and diagnostics
description: Portable dist, Caddy HTTPS, supervisor, and startup diagnostics.
audience: advanced
order: 190
status: documented
updated: 2026-09-24
---

# Build, deployment, and diagnostics

## Security baseline and upstream connections

The minimum runtime is **Node.js 24.22.1**; the supported stable range is `>=24.22.1 <25`, with npm 11. CLI, doctor and the portable launcher check the full version. `CLI_NODE_UNSUPPORTED` / `DEPLOY_NODE_UNSUPPORTED` require upgrading Node and restarting the terminal, supervisor and every worker. Check the service executable: its version may differ from the SSH shell. `npm audit fix` does not upgrade Node itself.

Generated Caddy uses upstream `keepalive 4s`, while the Node runtime has a five-second idle timeout. The proxy retires an idle connection before the backend does, reducing POST 502 failures from reusing a closing socket. Four seconds is the idle time between requests, not an SSE duration limit. General POST retries are not enabled: losing a response does not roll back a command. Retry business commands with the original `commandId`.

Rebuild `dist` after upgrading the framework: existing deployments do not receive the new launcher/Caddyfile automatically. Verify staging before switching and retain the previous application release for rollback; rolling back the application must not restore a vulnerable Node version.

When investigating OOM, compare heapUsed/heap limit, RSS, external memory, stream count, PG pool and workload per worker. RSS growth alone does not prove a JavaScript leak. A heap snapshot can pause the process and require additional memory: capture it on an isolated test environment. Raising the heap limit without profiling does not prove a fix.

## Goal

Copy only `dist` to a server and run it under an external supervisor.

## Example

```text
npm run build
cd dist
npm run check
npm start
```

```text
LAYER_DOMAIN=app.example.com
LAYER_STATE_DIRECTORY=/var/lib/layer/application
```

## Expected result

The launcher verifies integrity, lockfile, and dependencies, safely installs pinned Caddy 2.11.4, starts private workers, waits for readiness, and keeps Caddy in the foreground.

## Explanation

`dist` contains package/lock, Caddyfile, runtime launcher, assets, and an optional server bundle. Certificates, embedded data, and the Caddy binary live outside the release in the state directory. systemd/PM2/a Windows service owns restart and logging.

## Common errors

- DNS/firewall or permission for ports 80/443 is missing.
- `LAYER_DOMAIN` is missing when `deployment.domain` is null.
- The registry is unavailable during the first locked install.
- A production secret is configured as a literal string.

## Failure contract

The fail-closed order is integrity → dependencies → Caddy checksum → config validation → workers/readiness → public Caddy. A backend error prevents the public listener from starting. SIGINT/SIGTERM drains HTTP/SSE.

Use `layer doctor`, `/health/live`, `/health/ready`, and bounded diagnostics. Secrets, stacks, and raw SQL are not logged.

Next: [Database runtime](database-runtime.md), [Security](security-auth.md), [production runbook](../runbooks/production-deployment.md).
