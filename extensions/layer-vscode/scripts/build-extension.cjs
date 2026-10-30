const { readFileSync } = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

const extensionDirectory = path.dirname(require.resolve('../package.json'));
const extensionEntryPath = path.join(extensionDirectory, 'src', 'extension.js');
const extensionBundlePath = path.join(extensionDirectory, 'dist', 'extension.cjs');

// Build one deployable file without hoisted workspace dependencies.
buildSync({
    entryPoints: [extensionEntryPath],
    outfile: extensionBundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    mainFields: ['module', 'main'],
    conditions: ['module', 'import', 'node'],
    external: ['vscode'],
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'info'
});

const extensionBundleSource = readFileSync(extensionBundlePath, 'utf8');

if (/\brequire\d*\(['"]\.{1,2}\//.test(extensionBundleSource)) {
    throw new Error('Extension bundle contains an unresolved relative require.');

}
