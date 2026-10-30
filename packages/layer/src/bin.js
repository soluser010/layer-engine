#!/usr/bin/env node

//Resolving the installed CLI beside its public entry without loading the browser API
const cliEntryUrlData = import.meta.resolve( '@solcorp/layer-cli' );
const cliExecutableUrlData = new URL( './bin.js', cliEntryUrlData );

//Delegating arguments, diagnostics and shutdown to the shared executable
await import( cliExecutableUrlData.href );
