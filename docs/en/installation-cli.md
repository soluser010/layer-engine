---
title: Installation and CLI
description: Installing the framework, using application CLI commands and configuring the environment.
audience: beginner
order: 20
status: documented
updated: 2026-10-29
---

# Installation and CLI

## Goal

Install the framework and start your first application. The local handbook command `guide` is available from version 0.1.1.

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


## Common mistakes

- `layer` is not found after local installation: use `npx layer` or npm scripts.
- `npm run dev` in the parent folder: enter `apps/hello-layer` first.
- No `guide` in 0.1.0: use the online handbook or upgrade to 0.1.1 or later.

## Failure contract

Missing packages must be restored using the application lockfile. An unsupported Node version fails with `CLI_NODE_UNSUPPORTED`. Invalid guide options fail with `CLI_ARGUMENT_UNKNOWN`; an occupied listener or missing guide asset is an explicit error/404, not a redirect to application files.

Next: [quick start](getting-started.md), [editor](editor-tooling.md), [deployment](deployment-diagnostics.md).
