---
title: Getting started
description: Creating a first application, dev server, and reactive page.
audience: beginner
order: 30
status: documented
updated: 2026-10-31
---

# Getting Started

[Capability map](capabilities.md)

## Goal

Create an application in the required `apps` directory, start the development server, and render a reactive value.

## Example

Install the complete framework through one dependency, then create and install the application:

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

Use ordinary JavaScript and a tagged template. The complete file remains an ESM module:

```js
import {
    html,
    layerComponentCreate,
    layerSignalCreate
} from '@solcorp/layer';

export default layerComponentCreate(function HomePage(){
    //Creating component-owned counter state
    const counterSignal = layerSignalCreate( Number( 0 ) );

    //Creating the user action for increasing the counter
    const counterIncrease = function(){
        //Updating the counter from its latest value
        counterSignal.update(function counterUpdate( counterData ){
            //CallBack THE NUMBER
            return Number( counterData ) + Number( 1 );

        });

    };

    //Rendering the button with one reactive text binding
    return html`<button @click=${counterIncrease}>Count: ${counterSignal}</button>`;

});
```

## Expected result

The CLI prints a local URL. Saving a file triggers an atomic rebuild and dev-only SSE reloads the page without WebSocket.

## Explanation

The file remains JavaScript, so native JS IntelliSense owns `${...}`. The `html``…``` template is compiled ahead of time and the signal updates only its bound DOM region.

## Common errors

- `layer` is missing: use `npx layer` for a local installation or the application npm scripts.
- The name contains non-Latin characters: use Latin letters, digits, and hyphens.
- The port is busy: change `development.port` and restart the dev server.

## Failure contract

An initial build error stops `layer dev`. A later error preserves the last working `dist` and appears in a text-only overlay.

Next: [Installation and CLI](installation-cli.md), [Project Structure](project-structure.md).
