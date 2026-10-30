# Dependency risk acceptance

## Autocannon development-only chain

Recorded: 2026-09-21. Review before the release candidate is signed.

`npm audit` reports the moderate `GHSA-w5hq-g745-h8pq` advisory through `autocannon@8.0.0 → hyperid@3.3.0 → uuid@8.3.2`. The affected UUID behavior is the v3/v5/v6 API when a caller supplies a destination buffer.

Layer uses Autocannon only from the local stable-test runner. The runner does not accept an untrusted UUID buffer, the packages are dev dependencies, and none of them are copied into an application production bundle. The registry currently offers no compatible Autocannon upgrade that removes the chain; npm proposes an unrelated downgrade to `2.0.1`.

Temporary decision: retain the plan-pinned `autocannon@8.0.0`, do not force an out-of-range UUID major through `overrides`, and treat any high/critical advisory or production-bundle inclusion as an immediate release blocker. Recheck the advisory and upstream dependency graph before signing the candidate.
