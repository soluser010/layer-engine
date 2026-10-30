import {execFileSync} from 'node:child_process';

const workspaceBuildOrder = Object.freeze([
    '@solcorp/layer-docs',
    '@solcorp/layer-protocol',
    '@solcorp/layer-compiler',
    '@solcorp/layer-render',
    '@solcorp/layer-storage',
    '@solcorp/layer-runtime',
    '@solcorp/layer',
    '@solcorp/layer-pwa',
    '@solcorp/layer-router',
    '@solcorp/layer-database',
    '@solcorp/layer-events',
    '@solcorp/layer-security',
    '@solcorp/layer-server',
    '@solcorp/layer-auth',
    '@solcorp/layer-notifications',
    '@solcorp/layer-plugin-sdk',
    '@solcorp/layer-cli',
    '@solcorp/layer-testkit'
]);

const npmCliPath = process.env.npm_execpath;

if (npmCliPath === undefined) {
    throw new Error('npm_execpath is required to build Layer-Engine workspaces.');

}

//Building public declarations in dependency order for clean installations.
for (const workspaceName of workspaceBuildOrder) {
    execFileSync(process.execPath, [
        npmCliPath,
        'run',
        'build',
        '--workspace',
        workspaceName
    ], {
        stdio: 'inherit'
    });

}
