---
title: Installation and CLI
description: Source workspace installation, Layer CLI commands, and environment setup.
audience: beginner
order: 20
status: release-candidate
updated: 2026-10-29
---

# Installation and CLI

## Goal

Install the complete framework and start a first application. npm 0.1.0 is published; local `guide` is added in the upcoming 0.1.1 release.

## Requirements

Node.js **>=24.22.1 <25**, npm 11. HTTPS or localhost is required for Service Worker APIs. Git is needed only for a source checkout; VS Code is optional.

## Example

```text
mkdir my-workspace
cd my-workspace
npm init -y
npm install @solcorp/layer
npx layer create hello-layer
cd apps/hello-layer
npm install
npm run dev
```

## Expected result

Open the address printed by dev. `apps/hello-layer` contains the application; the root directory provides the local CLI. All framework modules are automatic dependencies of `@solcorp/layer`.

## Explanation

`layer create` writes files; it does not install dependencies. The install inside the generated application creates its own lockfile and makes it independently portable. New projects pin the framework version. Upgrade coordinated Layer packages together; `CLI_FRAMEWORK_VERSION_MISMATCH` rejects mixed versions.

For a global command:

```text
npm install --global @solcorp/layer
layer create hello-layer
```

The global npm bin directory must be on PATH. Global tooling does not replace application dependencies. Creation accepts an application name, not a path. Spaces and case are normalized; Cyrillic, traversal and `--name` are rejected.

## Commands

| Command | Purpose |
| --- | --- |
| npm run dev | Build, watch and live reload |
| npm run build | Portable production dist |
| npm run doctor | Configuration and infrastructure diagnostics |
| npm run inspect | Routes and build plan |
| npm run docs | Generated application API |
| npm run database:plan | Incompatible database schema plan |
| npm run database:apply | Explicitly approved schema changes |
| npx layer guide --lang en | Offline framework handbook, from 0.1.1 |

`guide` needs no project configuration, binds only to loopback and prints its URL. `--lang ru` selects Russian; `--open` requests a browser window. Ctrl+C closes the listener. Search and code highlighting use local files. External reference links still require a network. The handbook matches the installed framework version and is excluded from production bundles.

## Source installation

For framework contributors, clone the public repository and use the workspace:

```text
git clone https://github.com/soluser010/layer-engine.git
cd layer-engine
npm ci --ignore-scripts
npm run build
npm run cli:install
```

## Common mistakes

- `layer` is not found after local installation: use `npx layer` or npm scripts.
- `npm run dev` in the parent folder: enter `apps/hello-layer` first.
- No `guide` in 0.1.0: use the online handbook until 0.1.1 is published.
- Node ExperimentalWarning from passkey probing in 0.1.0: the next CLI loads infrastructure only when needed; this is not an installation failure.

## Failure contract

Missing packages must be restored using the application lockfile. An unsupported Node version fails with `CLI_NODE_UNSUPPORTED`. Invalid guide options fail with `CLI_ARGUMENT_UNKNOWN`; an occupied listener or missing guide asset is an explicit error/404, not a redirect to application files.

Next: [quick start](getting-started.md), [editor](editor-tooling.md), [deployment](deployment-diagnostics.md).

## Programmatic guide lifecycle

`layerGuideServe({lang, port})` from `@solcorp/layer-docs` returns `{origin, url, close}` for custom tools. `port: 0` selects a free loopback port; `await close()` releases the listener. Invalid options reject with TypeError; port binding errors propagate to the caller. This is a tooling API, not an application runtime API.
