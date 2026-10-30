# Runtime support matrix

Layer-Engine production support is intentionally narrower than incidental protocol compatibility. A dependency outside this matrix may help diagnose a regression, but it cannot satisfy a stable release gate.

## Server and edge

| Component | Supported production range | Release evidence |
| --- | --- | --- |
| Node.js | >=24.22.1 <25 | `engines`, locked npm workspace, complete `release:check` |
| npm | 11.x | `packageManager`, lockfile install, real isolated tarball consumers |
| PostgreSQL | 16.x–18.x while supported upstream | migrations, transactional outbox, backup/restore rehearsal on every release environment |
| Redis | 7.2.x, 7.4.x, or supported 8.x | connection, bounded reconnect, rate-limit Lua, pub/sub fan-out, empty-Redis replay |
| Caddy | exactly 2.11.4 in generated bundles | official release SHA-512, `caddy validate`, HTTP redirect, automatic HTTPS and origin proxy rehearsal |

Generated bundles support Linux x64/arm64 and Windows x64/arm64. Linux remains the recommended production host and the GitVerse deployment gate runs on Linux x64; Windows x64 is additionally rehearsed locally, while ARM adapters are unit-tested. PostgreSQL and Redis must be private network dependencies; Caddy must sit behind the deployment's external CDN/WAF when volumetric attacks are in scope.

The event bus uses RESP2 deliberately because Layer-Engine needs only portable publish/subscribe operations. That wire choice does not expand the supported Redis range below 7.2. Connection attempts are time-bounded and fail closed when reconnects are exhausted.

## Browsers and PWA capabilities

The automated matrix covers current Chrome, Edge, Firefox, and Playwright WebKit. Native Safari is a capability-based, best-effort target and is not a mandatory stable gate, as agreed with the owner. Playwright WebKit is not native Safari certification. Record any real-device checks with their exact iOS/macOS version, device, browser/installed mode and scenario; a limited result does not certify the whole Safari matrix.

Service Worker, install, push, background sync, badging, share target, file/protocol handlers, and launch queue remain capability-detected. Unsupported capabilities return the documented fallback; they are never claimed through a fictitious polyfill. Service Worker and install-sensitive PWA behavior require HTTPS, except for browser-defined trustworthy localhost development.

## Update policy

Patch releases within the ranges above are expected and should be applied through normal infrastructure maintenance. A new major is admitted only after CI, staging, backup/restore, failure/reconnect, and rollback checks. If an upstream release leaves security support, Layer-Engine removes it from this matrix even when basic tests still pass.
