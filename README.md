# Layer-Engine

[Русский](https://github.com/soluser010/layer-engine/blob/main/README.ru.md) · [English handbook](https://github.com/soluser010/layer-engine/blob/main/docs/en/README.md) · [Руководство RU](https://github.com/soluser010/layer-engine/blob/main/docs/ru/README.md) · [npm](https://www.npmjs.com/package/@solcorp/layer)

**Layer-Engine is a JavaScript framework for full PWA applications, interactive services and messengers.** Write components with familiar JavaScript, HTML and CSS. Layer provides reactive DOM updates, routing, server operations, authentication, offline storage, realtime events and application updates.

Develop your application, build a portable `dist`, and start it on a server. The included launcher prepares the runtime and Caddy; Caddy obtains and renews HTTPS certificates for your configured public domain.

Created by **S.O.L CORP** · [solcorp.ru](https://solcorp.ru) · Apache-2.0.

## Contents

- [Capabilities](#capabilities)
- [Quick start](#quick-start)
- [Your first component](#your-first-component)
- [Production and automatic HTTPS](#production-and-automatic-https)
- [Offline documentation](#offline-documentation)
- [Agent skill](#agent-skill)
- [VS Code extension](#vs-code-extension)
- [Packages and contributions](#packages-and-contributions)

## Capabilities

- JavaScript ESM components in `.layer.js`, tagged HTML/CSS templates and typed editor hints.
- Signals, partial DOM updates, component composition, file routing, SSR and hydration.
- Validated server operations, permissions, sessions, auth providers and resource limits.
- PostgreSQL for application data; PGlite for single-worker system storage; optional Redis acceleration.
- IndexedDB, offline outbox, Service Worker updates, Web Push and capability-based PWA APIs.
- HTTP operations and Fetch event streams; no WebSocket dependency.
- Portable production bundles with automatic dependency installation and HTTPS.

UI design, forms and project-specific business rules remain under your control. Native Safari is a best-effort target; capabilities vary by browser. See [browser support](https://github.com/soluser010/layer-engine/blob/main/docs/en/browser-support.md).

## Quick start

Requirements: **Node.js >=24.22.1 <25** and **npm 11**.

```sh
mkdir my-workspace
cd my-workspace
npm init -y
npm install @solcorp/layer
npx layer create my-app
cd apps/my-app
npm install
npm run dev
```

Open the local address printed by `dev`. The first install supplies the complete framework and CLI. `create` writes `apps/my-app`; the second install creates that application's own dependency lockfile. There is no need to install individual Layer packages. Alternatively, `npm install --global @solcorp/layer` provides a global `layer` command when npm's bin directory is on PATH.

```text
apps/my-app/
├── layer.config.js        Application and deployment settings
├── package.json           dev / build / doctor commands
├── src/
│   ├── pages/             Pages and file routes
│   ├── app.js             Application lifecycle
│   ├── operations.js      Public operation contracts
│   └── server/            Server-owned code and database schema
├── public/                Manifest, icons and static assets
└── dist/                  Generated deployment bundle after build
```

## Your first component

Replace `apps/my-app/src/pages/index.layer.js` with:

```js
import {html, layerComponentCreate, layerSignalCreate} from '@solcorp/layer';

export default layerComponentCreate(function Counter(){
    //Keeping reactive state owned by this component
    const count = layerSignalCreate( 0 );
    const increase = function(){
        //Updating only the bindings that depend on this signal
        count.set( count.get() + 1 );

    };

    return html`<button @click=${increase}>Count: ${count}</button>`;

});
```

Save the file while `npm run dev` is running. The page rebuilds and reloads; clicking the button updates its text. Continue with [components](https://github.com/soluser010/layer-engine/blob/main/docs/en/components.md), [server operations](https://github.com/soluser010/layer-engine/blob/main/docs/en/operations.md) and [configuration](https://github.com/soluser010/layer-engine/blob/main/docs/en/configuration.md). Server operations are explicitly enabled through `deployment.serverEntry`; adding an `operations.js` file alone does not start a backend.

## Production and automatic HTTPS

Build locally:

```sh
npm run build
```

Copy the **contents of `dist`** to your server. From that directory on Linux:

```sh
export LAYER_DOMAIN=app.example.com
export LAYER_STATE_DIRECTORY=/var/lib/my-app
npm start
```

The server requires the supported Node/npm versions. Create a writable persistent state directory, point the domain's A/AAAA records to the server, and allow Caddy to bind externally reachable ports 80/443. Internet access is needed for initial dependencies, the pinned Caddy download and certificate issuance. Keep production secrets in environment variables.

Caddy automatically obtains and renews a public TLS certificate and redirects HTTP to HTTPS. No manual certificate installation or hand-written proxy configuration is needed for this standard setup. Localhost uses local certificates instead. DNS, firewall, existing reverse proxies and port permissions remain deployment responsibilities.

Keep `npm start` under systemd, PM2 or another supervisor. Preserve the state directory between deployments: it contains certificates and any embedded system data. Static applications do not start an extra Node API worker. See [deployment](https://github.com/soluser010/layer-engine/blob/main/docs/en/deployment-diagnostics.md) and [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

## Offline documentation

Starting with **0.1.1**, the main package automatically includes `@solcorp/layer-docs`:

```sh
npx layer guide --lang en
npx layer guide --lang ru --open
```

The guide serves version-matched English/Russian articles, examples, highlighted code and local search on `127.0.0.1`. It works offline after installation; Ctrl+C stops it. `--open` optionally opens your browser. The existing `layer docs` command still generates the application's API documentation. Until 0.1.1 is published, use the linked online handbook.

## Agent skill

**[Layer-Engine agent skill](https://github.com/soluser010/layer-engine/blob/main/skills/layer-engine/SKILL.md)** teaches compatible coding agents to locate the installed version's documentation, use `.layer.js`, respect browser/server boundaries and work through supported APIs. [Installation and usage](https://github.com/soluser010/layer-engine/blob/main/skills/layer-engine/README.md).

The skill is optional and does not grant access to your accounts, deploy applications or install itself.

## VS Code extension

**[Layer-Engine for VS Code](https://github.com/soluser010/layer-engine/blob/main/extensions/layer-vscode/README.md)** adds embedded HTML/CSS completion, syntax highlighting, snippets, hover, diagnostics and file icons while preserving JavaScript IntelliSense inside `${...}`.

Marketplace publication has not occurred. From the framework source checkout, run `npm ci --ignore-scripts`, `npm run ide:test` and `npm run ide:package`; then use **Extensions: Install from VSIX** with `artifacts/layer-engine-vscode-0.2.0.vsix`. It is installed separately with your approval. [Editor setup](https://github.com/soluser010/layer-engine/blob/main/docs/en/editor-tooling.md).

## Packages and contributions

`@solcorp/layer` is the single installation entry. Other `@solcorp/layer-*` packages are implementation modules installed automatically, not a shopping list of prerequisites. Documentation is not bundled into your production application.

- [Source and issues](https://github.com/soluser010/layer-engine)
- [Contributing](https://github.com/soluser010/layer-engine/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/soluser010/layer-engine/blob/main/SECURITY.md)
- [Changelog](https://github.com/soluser010/layer-engine/blob/main/CHANGELOG.md)
- [Apache-2.0 license](https://github.com/soluser010/layer-engine/blob/main/LICENSE)

The dedicated site `layer.solcorp.ru` is planned; the GitHub handbook is the current documentation destination. No 1.0.0 or native Safari certification is claimed.
