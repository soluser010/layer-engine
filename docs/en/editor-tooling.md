---
title: VS Code, IntelliSense, and live reload
description: Installing the Layer VS Code Extension, embedded HTML/CSS IntelliSense, snippets, and automatic browser refresh.
audience: beginner
order: 60
status: release-candidate
updated: 2026-09-24
---

# VS Code, IntelliSense, and live reload

## Goal

Get HTML/CSS highlighting, completion, and diagnostics inside *.layer.js while retaining native JavaScript IntelliSense in interpolations.

## Installing the extension

The application does not install an IDE extension automatically; the IDE requires a separate trusted user action. Build or use the local VSIX:

```text
npm run ide:test
npm run ide:package
```

In VS Code, select Extensions: Install from VSIX, choose artifacts/layer-engine-vscode-0.2.0.vsix, and run Developer: Reload Window. Marketplace publication has not been performed.

## Why Language Mode says JavaScript

That is expected. *.layer.js remains real JavaScript ESM. The extension injects HTML scopes only into html templates and CSS scopes into css templates. Inside an interpolation, control returns to the JavaScript language service.

```js
import {css, html, layerComponentCreate} from '@solcorp/layer';

export const styles = css`
.card {
    display: grid;
}
`;

export default layerComponentCreate(function Card( properties ){
    //Rendering escaped application data inside an HTML template
    return html`<section class="card">${properties.title}</section>`;

});
```

## Completions

- HTML tags, attributes, values, and ARIA;
- CSS selectors, properties, values, and custom properties;
- Layer bindings @click, .value, ?disabled, l-model, and ref;
- when/repeat, :global(...), and scoped-style snippets;
- hover and embedded diagnostics;
- file snippets layer-component, layer-page, layer-query, layer-command, and layer-events.

HTML completion is contextual: typing < opens the standard tag provider. Layer completion can also replace a typed element name with a complete tag pair. Inside ${...}, the embedded provider remains silent so JavaScript completion keeps ownership.

## File icon and formatter

The extension contributes a *.layer.js file icon, but VS Code may display the icon from another active theme. Select Layer Engine File Icons or a theme that honors the file/language association.

Layer does not require Prettier. If VS Code reports that esbenp.prettier-vscode is unavailable, remove that formatter association or install Prettier deliberately. Prefer the project JavaScript formatter and do not allow a formatter to rewrite tagged templates.

## Live reload

`layer dev` watches `src` and `public`, debounces file events, and performs an atomic build. After a successful build, a dev-only GET SSE channel publishes a revision and the page calls `location.reload()` with the same pathname, query, and hash.

A later build error keeps the last working dist, avoids reload, and displays a text-only overlay. Fixing the error clears the overlay, builds again, and reloads. Production dist never includes the dev client.

## Common errors

- Only syntax colors work: verify VSIX 0.2.0 is enabled for the workspace and reload the window.
- No HTML completion: the cursor must be inside a canonical html template, not an ordinary string.
- No Layer snippets: make sure the filename ends with *.layer.js.
- A config change was ignored: restart layer dev.

## Failure contract

The scanner never executes user JavaScript, enforces a document size limit, and supports cancellation. The compiler remains the final Layer contract check; IDE diagnostics do not replace layer build.

Next: [Syntax](authoring-layer-js.md), [Getting started](getting-started.md).
