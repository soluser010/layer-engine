# Security and reliability incident response

## Roles and evidence

Assign an incident commander, operations lead, security lead, communications owner, and scribe. Preserve timestamps, deployment digests, SBOM/provenance, redacted request IDs, audit records, infrastructure events, and volatile metrics. Do not copy payloads, cookies, keys, or personal data into the incident channel.

## First 30 minutes

1. Classify user impact, data exposure, active exploitation, and blast radius.
2. Stabilize: rate-limit, isolate a tenant/integration, disable an operation, drain a version, or apply a WAF rule.
3. Preserve evidence before destructive cleanup.
4. Revoke exposed sessions/API keys and rotate affected credentials/signing material.
5. Establish an update cadence and a single source of truth.

## Investigation

Correlate safe `requestId`, authenticated subject hash, tenant, operation, result code, deployment version, and PostgreSQL audit records. For event issues, verify journal sequence before Redis. For offline replay, compare `commandId` and base revision. For supply-chain concerns, compare installed package digests with lockfile, SBOM, archives, and signed provenance.

## Recovery and follow-up

Use the deployment/restore runbooks, validate canaries, and monitor recurrence. Publish a blameless review with timeline, root cause, contributing controls, user impact, detection gap, corrective owners, and due dates. Add a regression test or automated gate for every technically preventable recurrence.
