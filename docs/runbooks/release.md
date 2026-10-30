# Stable release

Stable publishing is deliberately manual. The workflow never runs on an ordinary push.

## Owner acceptance and documentation gate

npm publication, a stable tag, and version `1.0.0` remain forbidden until all of these conditions are recorded:

1. The project owner has completed real-world application tests and explicitly accepted their results.
2. The complete public documentation set exists in equivalent Russian and English editions; a single translated article does not close this gate.
3. Examples, failure contracts, and generated declarations match the reviewed runtime behavior in both editions.
4. The owner gives a new explicit authorization for the exact publish run after reviewing the candidate commit and artifacts.

Authorization to push ordinary commits does not authorize npm publication. CI credentials, a passing workflow, or an earlier release discussion must never be interpreted as publish approval.

## Prepare

1. Choose a version using the SemVer policy and update the root plus all workspace package versions and internal dependency pins.
2. Build declarations, review public API impact, and run `npm run api:snapshot` only after that review.
3. Move the changelog entries from Unreleased into a dated version section.
4. Run `npm run release:check`, dependency audit, restore rehearsal, deployment rehearsal, and Playwright WebKit. Native Safari remains an optional best-effort check for this version.
5. Commit the reviewed state and create an annotated `vX.Y.Z` tag from that exact commit.

## CI secrets and signing

The stable workflow requires an npm automation token scoped to `@solcorp`, a protected cosign private key, its password, and the matching trusted public key. Store them as `NPM_TOKEN`, `COSIGN_PRIVATE_KEY`, `COSIGN_PASSWORD`, and `COSIGN_PUBLIC_KEY` in protected GitVerse secrets. Rotate private credentials after suspected disclosure and according to organization policy. The workflow pins cosign 3.1.3, signs the in-toto provenance into a Sigstore bundle with transparency-log evidence, and verifies that bundle with the independently configured public key before upload. The provenance names every package archive digest, lockfile, API baseline, SBOM, commit, Node version, and package-manager version.

Create the encrypted key pair locally only when the owner is ready for the signing rehearsal:

```text
cosign generate-key-pair
```

Enter a strong unique password when prompted. Move `cosign.key` into protected secret storage immediately; do not add it, its password, or a secret export to Git or Obsidian. Keep `cosign.pub` as the independently distributable verification key. Add the exact encrypted contents of `cosign.key`, its password, and `cosign.pub` to protected GitVerse secrets named `COSIGN_PRIVATE_KEY`, `COSIGN_PASSWORD`, and `COSIGN_PUBLIC_KEY`. The first workflow run must use `publish=false`; verify its bundle before any publication authorization. Delete unprotected working copies after confirming recoverable protected storage.

## Execute

Run `release-stable.yml` for the exact tag version with `publish=false`. Download the signed artifact, verify archive digests and `layer-engine.intoto.sigstore.json` against the trusted public key, then install the archives into an isolated consumer and repeat smoke checks. A local ephemeral-key bundle without transparency-log evidence validates tooling only and never counts as release trust evidence. Only after the owner acceptance and bilingual documentation gate is recorded may the same tagged workflow be rerun with `publish=true` under two-person approval; npm publication remains disabled until that separate authorization.

The workflow uses ordinary authenticated npm publishing because GitVerse is not assumed to satisfy npm's hosted-provider provenance allowlist. Signed in-toto provenance remains a separate downloadable release record; documentation must not claim npm-native provenance unless the registry verifies it.

## After publication

Verify package metadata and tarball digests from the public registry, create the GitVerse release pointing to the signed record, deploy canary applications, and monitor. npm versions are immutable: a bad release is deprecated and replaced by a new patch; it is never overwritten.
