import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {
    LayerCliError,
    layerCliErrorDiagnosticCreate,
    layerCliErrorDiagnosticFormat,
    layerCliRun,
    layerConfigLoad,
    layerConfigValidate,
    layerDevelopmentHostCreate,
    layerDevelopmentServerCreate,
    layerDevelopmentWatchCreate,
    layerDoctorRun,
    layerProjectBuild,
    layerProjectCreate
} from '../src/index.js';

async function localPortFind() {
    const portServer = createServer();

    await new Promise(function localPortListen(resolve, reject) {
        portServer.once('error', reject);
        portServer.listen(0, '127.0.0.1', function localPortListening() {
            resolve(undefined);
        });
    });

    const addressData = portServer.address();

    if (addressData === null || typeof addressData === 'string') {
        throw new Error('Local test port was not assigned.');

    }

    await new Promise(function localPortClose(resolve, reject) {
        portServer.close(function localPortCloseComplete(closeError) {
            if (closeError !== undefined) {
                reject(closeError);

                return;

            }

            resolve(undefined);
        });
    });

    return addressData.port;
}

/**
 * @param {string} projectDirectory
 * @param {number} portData
 */
async function projectDevelopmentPortSet(projectDirectory, portData) {
    const configurationFile = path.join(projectDirectory, 'layer.config.js');
    const configurationData = await readFile(configurationFile, 'utf8');
    await writeFile(configurationFile, configurationData.replace('port: 5173', `port: ${portData}`), 'utf8');
}

async function temporaryProjectCreate() {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-cli-'));
    const projectDirectory = path.join(temporaryRoot, 'messenger');

    await layerProjectCreate({
        targetDirectory: projectDirectory,
        projectName: 'messenger'
    });

    return {
        temporaryRoot,
        projectDirectory
    };
}

/**
 * @param {ReadableStreamDefaultReader<Uint8Array>} streamReader
 * @param {string} eventName
 */
async function developmentEventWait(streamReader, eventName) {
    const decoderData = new TextDecoder();
    let streamData = '';

    //Reading bounded chunks until the requested SSE event is complete.
    return Promise.race([
        (async function developmentEventRead() {
            while (streamData.includes(`event: ${eventName}\n`) === false) {
                const streamReadResult = await streamReader.read();

                if (streamReadResult.done) {
                    throw new Error(`Development event stream ended before ${eventName}.`);

                }

                streamData += decoderData.decode(streamReadResult.value, {stream: true});

                if (streamData.length > 64 * 1024) {
                    throw new Error('Development event stream exceeded the test limit.');

                }

            }

            return streamData;

        })(),
        new Promise(function developmentEventTimeout(_resolve, reject) {
            setTimeout(() => reject(new Error(`Development event ${eventName} timed out.`)), 20000);

        })
    ]);

}

test('CLI config validates strict project and development contracts', () => {
    const configData = layerConfigValidate({
        appName: 'messenger',
        appVersion: '1.2.0',
        development: {
            host: 'localhost',
            port: 5200,
            https: false
        }
    });

    assert.equal(configData.sourceDirectory, 'src');
    assert.equal(configData.outputDirectory, 'dist');
    assert.equal(configData.development.port, 5200);
    assert.equal(configData.development.liveReload, true);
    assert.deepEqual(configData.deployment, {
        domain: null,
        serverEntry: null,
        originPort: 8787,
        dependencies: {}
    });
    const deploymentConfig = layerConfigValidate({
        appName: 'messenger',
        deployment: {
            domain: 'chat.example.com',
            serverEntry: 'server/index.js',
            originPort: 9000,
            dependencies: {
                postgres: '3.4.8+layer.1'
            }
        }
    });

    assert.equal(deploymentConfig.deployment.domain, 'chat.example.com');
    assert.equal(deploymentConfig.deployment.serverEntry, 'server/index.js');
    assert.equal(deploymentConfig.deployment.originPort, 9000);
    assert.deepEqual(deploymentConfig.deployment.dependencies, {postgres: '3.4.8+layer.1'});
    const secureConfig = layerConfigValidate({
        appName: 'messenger',
        development: {
            https: {
                keyFile: 'certificates/local.key',
                certificateFile: 'certificates/local.crt'
            }
        }
    });
    assert.deepEqual(secureConfig.development.https, {
        keyFile: 'certificates/local.key',
        certificateFile: 'certificates/local.crt'
    });
    const liveReloadDisabledConfig = layerConfigValidate({
        appName: 'messenger',
        development: {
            liveReload: false
        }
    });
    assert.equal(liveReloadDisabledConfig.development.liveReload, false);
    assert.throws(() => layerConfigValidate({
        appName: 'messenger',
        typo: true
    }), LayerCliError);
    assert.throws(() => layerConfigValidate({
        appName: 'messenger',
        outputDirectory: '../outside'
    }), LayerCliError);
    assert.throws(() => layerConfigValidate({
        appName: 'messenger',
        development: {
            host: '0.0.0.0'
        }
    }), LayerCliError);
    assert.throws(() => layerConfigValidate({
        appName: 'messenger',
        development: {
            https: true
        }
    }), LayerCliError);
    assert.throws(() => layerConfigValidate({
        appName: 'messenger',
        development: {
            liveReload: 'yes'
        }
    }), LayerCliError);
    for ( const deploymentData of [
        {domain: 'https://example.com'},
        {domain: '*.example.com'},
        {serverEntry: '../server.js'},
        {serverEntry: 'server/index.ts'},
        {originPort: 80},
        {dependencies: {postgres: '^3.4.8'}},
        {unknown: true}
    ] ){
        assert.throws(() => layerConfigValidate({
            appName: 'messenger',
            deployment: deploymentData
        }), LayerCliError);

    }
});

test('CLI config diagnostics identify the field, source position, and known repair safely', async (testContext) => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-config-diagnostic-'));
    testContext.after(async () => rm(temporaryRoot, {recursive: true, force: true}));
    await writeFile(path.join(temporaryRoot, 'layer.config.js'), `export default {
    appName: 'diagnostic-app',
    database: {
        postgres: [{
            name: 'primary',
            role: 'primary',
            host: '127.0.0.1',
            port: 5432,
            database: 'diagnostic_app',
            username: 'postgres',
            password: null,
            tls: {
                mode: 'disabled'
            }
        }]
    }
};
`, 'utf8');

    await assert.rejects(() => layerConfigLoad(temporaryRoot), function configurationDiagnosticCheck(errorData) {
        assert.ok(errorData instanceof LayerCliError);
        assert.equal(errorData.code, 'CLI_CONFIG_INVALID');
        assert.equal(errorData.details?.file, 'layer.config.js');
        assert.equal(errorData.details?.path, 'database.postgres[0].tls.mode');
        assert.equal(errorData.details?.line, 13);
        assert.equal(errorData.details?.column, 17);
        assert.deepEqual(errorData.details?.suggestions, [
            "Use tls.mode: 'disable', 'require', or 'verify-full'.",
            "Use 'disable' only with 127.0.0.1, localhost, or ::1."
        ]);

        const diagnosticData = layerCliErrorDiagnosticCreate(errorData);
        const diagnosticOutputData = layerCliErrorDiagnosticFormat(diagnosticData);

        assert.equal(diagnosticData.code, 'CLI_CONFIG_INVALID');
        assert.equal(diagnosticData.path, 'database.postgres[0].tls.mode');
        assert.match(diagnosticOutputData, /File: layer[.]config[.]js:13:17/u);
        assert.match(diagnosticOutputData, /Solution: Use tls[.]mode/u);
        assert.equal(diagnosticOutputData.includes('password'), false);

        return true;
    });
});

test('CLI diagnostics redact arbitrary details and unexpected errors', () => {
    const expectedDiagnosticData = layerCliErrorDiagnosticCreate(new LayerCliError(
        'CLI_CONFIG_INVALID',
        'Configuration is invalid.',
        {
            file: 'layer.config.js',
            path: 'redis.password',
            password: 'must-not-leak',
            suggestions: ['Use an ENV reference.']
        }
    ));
    const unexpectedDiagnosticData = layerCliErrorDiagnosticCreate(new Error('private implementation failure'));

    assert.equal(JSON.stringify(expectedDiagnosticData).includes('must-not-leak'), false);
    assert.equal(expectedDiagnosticData.path, 'redis.password');
    assert.equal(unexpectedDiagnosticData.code, 'CLI_INTERNAL_ERROR');
    assert.equal(unexpectedDiagnosticData.message.includes('private implementation failure'), false);
});

test('CLI create supports dry-run and refuses a non-empty target', async (testContext) => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-create-'));
    const projectDirectory = path.join(temporaryRoot, 'social-app');
    testContext.after(async () => rm(temporaryRoot, {recursive: true, force: true}));

    const dryRunResult = await layerProjectCreate({
        targetDirectory: projectDirectory,
        projectName: 'Social App',
        dryRun: true
    });

    assert.equal(dryRunResult.projectName, 'social-app');
    assert.equal(dryRunResult.files.includes('src/pages/index.layer.js'), true);
    assert.equal(dryRunResult.files.includes('src/operations.js'), true);
    assert.equal(dryRunResult.files.includes('public/icon.svg'), true);
    await layerProjectCreate({
        targetDirectory: projectDirectory,
        projectName: 'Social App'
    });
    const projectConfigurationSource = await readFile(path.join(projectDirectory, 'layer.config.js'), 'utf8');

    assert.match(projectConfigurationSource, /appName: 'social-app'/);
    assert.match(projectConfigurationSource, /\[\] enables embedded PGlite/u);
    assert.match(projectConfigurationSource, /null disables Redis/u);
    assert.match(projectConfigurationSource, /null creates a static PWA/u);
    assert.match(projectConfigurationSource, /Local PostgreSQL without a password/u);
    assert.match(projectConfigurationSource, /password: null/u);
    assert.match(projectConfigurationSource, /mode: 'disable'/u);
    assert.match(projectConfigurationSource, /Remote PostgreSQL primary and replica/u);
    assert.match(projectConfigurationSource, /password: \{env: 'LAYER_POSTGRES_PRIMARY_PASSWORD'\}/u);
    assert.match(projectConfigurationSource, /Development HTTPS/u);
    assert.match(projectConfigurationSource, /maximum: 'auto'/u);
    assert.match(projectConfigurationSource, /Embedded OAuth 2\.1/u);
    assert.match(projectConfigurationSource, /dpop: 'required'/u);
    assert.match(projectConfigurationSource, /External OpenID Connect sign-in providers/u);
    assert.match(projectConfigurationSource, /LAYER_OIDC_COMPANY_SECRET/u);
    assert.match(projectConfigurationSource, /never auto-links an existing account/u);

    const projectConfigurationData = await layerConfigLoad(projectDirectory);

    assert.deepEqual(projectConfigurationData.database.postgres, []);
    assert.equal(projectConfigurationData.redis, null);
    assert.equal(projectConfigurationData.runtime.workers.maximum, 1);
    assert.equal(projectConfigurationData.deployment.serverEntry, null);
    const projectShellData = await readFile(path.join(projectDirectory, 'public/index.html'), 'utf8');

    assert.match(projectShellData, /<link rel="icon" href="\/icon[.]svg" type="image\/svg[+]xml">/);
    await assert.rejects(() => layerProjectCreate({
        targetDirectory: projectDirectory,
        projectName: 'Social App'
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_CREATE_TARGET_NOT_EMPTY');
});

test('CLI build compiles pages, routes, integrity, public files, and documentation', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    const pageFile = path.join(projectData.projectDirectory, 'src/pages/index.layer.js');
    const pageSource = await readFile(pageFile, 'utf8');

    assert.match(pageSource, /layerComponentCreate/);
    const sourceManifestFile = path.join(projectData.projectDirectory, 'public/manifest.webmanifest');
    const sourceManifestData = JSON.parse(await readFile(sourceManifestFile, 'utf8'));

    sourceManifestData.share_target = {
        action: '/share?source=os',
        method: 'POST',
        enctype: 'multipart/form-data',
        params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{
                name: 'files',
                accept: [
                    'image/png',
                    '.png'
                ]
            }]
        }
    };
    await writeFile(sourceManifestFile, `${JSON.stringify(sourceManifestData, null, 4)}\n`, 'utf8');

    const configData = await layerConfigLoad(projectData.projectDirectory);
    const dryRunResult = await layerProjectBuild({
        rootDirectory: projectData.projectDirectory,
        config: configData,
        dryRun: true,
        operations: [{
            name: 'chat.dialog.get',
            type: 'query',
            auth: 'session',
            permissions: ['chat.read']
        }],
        plugins: [{
            name: '@example/chat-plugin',
            version: '1.0.0',
            engine: '^0.1.0',
            capabilities: ['operations']
        }]
    });
    const dryRunRoute = dryRunResult.routes[0];

    assert.ok(dryRunRoute);
    assert.equal(dryRunRoute.path, '/');
    assert.equal(dryRunRoute.auth, 'none');
    assert.match(dryRunResult.documentation, /chat\.dialog\.get/);
    assert.match(dryRunResult.documentation, /@example\/chat-plugin/);
    await assert.rejects(() => readFile(path.join(projectData.projectDirectory, 'dist/_layer/routes.json'), 'utf8'));

    const buildResult = await layerProjectBuild({
        rootDirectory: projectData.projectDirectory,
        config: configData
    });
    const routeArtifact = JSON.parse(await readFile(path.join(projectData.projectDirectory, 'dist/_layer/routes.json'), 'utf8'));
    const publicManifest = await readFile(path.join(projectData.projectDirectory, 'dist/manifest.webmanifest'), 'utf8');
    const publicManifestData = JSON.parse(publicManifest);
    const applicationShell = await readFile(path.join(projectData.projectDirectory, 'dist/index.html'), 'utf8');
    const clientShell = await readFile(path.join(projectData.projectDirectory, 'dist/_layer/shell.html'), 'utf8');
    const applicationBundle = await readFile(path.join(projectData.projectDirectory, 'dist/_layer/application.mjs'), 'utf8');
    const serviceWorkerBundle = await readFile(path.join(projectData.projectDirectory, 'dist/layer-service-worker.js'), 'utf8');
    const versionManifest = JSON.parse(await readFile(path.join(projectData.projectDirectory, 'dist/_layer/version.json'), 'utf8'));
    const buildManifest = JSON.parse(await readFile(path.join(projectData.projectDirectory, 'dist/_layer/build.json'), 'utf8'));
    const deploymentPackage = JSON.parse(await readFile(path.join(projectData.projectDirectory, 'dist/package.json'), 'utf8'));
    const deploymentLock = JSON.parse(await readFile(path.join(projectData.projectDirectory, 'dist/package-lock.json'), 'utf8'));
    const deploymentManifest = JSON.parse(await readFile(path.join(projectData.projectDirectory, 'dist/_layer/deployment.json'), 'utf8'));
    const deploymentRunner = await readFile(path.join(projectData.projectDirectory, 'dist/_layer/deployment/run.mjs'), 'utf8');
    const deploymentCaddyfile = await readFile(path.join(projectData.projectDirectory, 'dist/Caddyfile'), 'utf8');
    const componentFile = path.join(projectData.projectDirectory, 'dist', routeArtifact[0].component);
    const componentModule = await import(pathToFileURL(componentFile).href);
    const componentStyle = await readFile(path.join(projectData.projectDirectory, 'dist', routeArtifact[0].style), 'utf8');

    assert.equal(routeArtifact[0].component.startsWith('_layer/components/'), true);
    assert.equal(routeArtifact[0].component.endsWith('.mjs'), true);
    assert.equal(componentModule.page.auth, 'none');
    assert.equal(componentModule.component.componentId.includes('src/pages/index'), true);
    assert.equal(componentModule.definition.component, componentModule.component);
    assert.equal(typeof componentModule.mount, 'function');
    assert.equal(typeof componentModule.hydrate, 'function');
    assert.equal(typeof componentModule.renderToString, 'function');
    assert.match(componentModule.css, /data-layer-scope/);
    assert.match(componentStyle, /data-layer-scope/);
    assert.equal(publicManifestData.name, 'messenger');
    assert.equal(publicManifestData.scope, '/');
    assert.equal(publicManifestData.id, '/');
    assert.equal(deploymentPackage.dependencies['@node-rs/argon2'], undefined);
    assert.equal(deploymentPackage.dependencies['oidc-provider'], undefined);
    assert.equal(publicManifestData.icons[0].src, '/icon.svg');
    assert.equal(publicManifestData.share_target.action, '/share?source=os');
    assert.equal(publicManifestData.share_target.method, 'POST');
    assert.match(applicationShell, /<script type="module" src="\/_layer\/application\.mjs"><\/script>/);
    assert.match(applicationShell, /data-layer-ssr="index"/);
    assert.match(applicationShell, /<h1[^>]*>messenger<\/h1>/);
    assert.match(applicationBundle, /layerAuthEnabled = false/);
    assert.match(applicationShell, /data-layer-page-style/);
    assert.match(applicationShell, /data-layer-shell-content="messenger"/);
    assert.doesNotMatch(clientShell, /data-layer-ssr=/);
    assert.doesNotMatch(clientShell, /<h1[^>]*>messenger<\/h1>/);
    assert.match(applicationBundle, /layerApplication/);
    assert.match(applicationBundle, /layerApiClientCreate/);
    assert.match(applicationBundle, /layerApplicationApiCreate/);
    assert.match(applicationBundle, /layerRouteMetadataDocumentCreate/);
    assert.match(applicationBundle, /data-layer-route-metadata/);
    assert.match(applicationBundle, /documentElementAttributeApply/);
    assert.match(applicationBundle, /layerCommandRuntimeCreate/);
    assert.match(applicationBundle, /layerEventSubscriptionsCreate/);
    assert.match(applicationBundle, /layerOfflineOutboxCreate/);
    assert.match(applicationBundle, /layerWorkerOutboxConfigure/);
    assert.match(applicationBundle, /storagePurge/);
    assert.match(applicationBundle, /layer-outbox/);
    assert.match(applicationBundle, /layerPwaCapabilitiesCreate/);
    assert.match(applicationBundle, /layerApplicationUpdatesCreate/);
    assert.match(applicationBundle, /layer-update-activate/);
    assert.match(applicationBundle, /applicationVersion = "0\.1\.0"/);
    assert.match(applicationBundle, /update: pwaUpdate/);
    assert.match(applicationBundle, /layer-share-target/);
    assert.match(applicationBundle, /layerShareId/);
    assert.match(applicationBundle, /shareTargetConsume/);
    assert.match(serviceWorkerBundle, /activate-update/);
    assert.match(serviceWorkerBundle, /layerWorkerOutboxDrainCreate/);
    assert.match(serviceWorkerBundle, /Layer outbox still contains retryable commands/);
    assert.match(serviceWorkerBundle, /appId: "messenger"/);
    assert.match(serviceWorkerBundle, /layer-share-target/);
    assert.match(serviceWorkerBundle, /layerShareId/);
    assert.match(serviceWorkerBundle, /SHARE_TARGET_SIZE_EXCEEDED/);
    assert.doesNotMatch(serviceWorkerBundle, /WebSocket/);
    assert.equal(versionManifest.offlineShellUrl, '/_layer/shell.html');
    assert.equal(versionManifest.assets.filter(
        (/** @type {any} */ assetData) => assetData.url === '/manifest.webmanifest'
    ).length, 1);
    assert.equal(versionManifest.assets.some((/** @type {any} */ assetData) => assetData.url === '/_layer/application.mjs'), true);
    assert.equal(buildResult.artifacts.includes('_layer/application.mjs'), true);
    assert.equal(buildResult.artifacts.includes('_layer/operations.mjs'), true);
    assert.equal(buildResult.artifacts.includes('_layer/operations.d.mts'), true);
    assert.equal(buildResult.artifacts.includes('_layer/operations.json'), true);
    assert.equal(buildResult.artifacts.includes('_layer/version.json'), true);
    assert.equal(buildResult.artifacts.includes('_layer/shell.html'), true);
    assert.equal(buildResult.artifacts.includes('layer-service-worker.js'), true);
    assert.equal(deploymentPackage.private, true);
    assert.equal(deploymentPackage.type, 'module');
    assert.equal(deploymentPackage.imports['#layer/operations'], './_layer/operations.mjs');
    assert.equal(deploymentPackage.scripts.start.includes('run.mjs'), true);
    assert.equal(deploymentPackage.dependencies.tar, '7.5.22');
    assert.equal(deploymentPackage.dependencies.yauzl, '3.4.0');
    assert.equal(deploymentLock.lockfileVersion, 3);
    assert.equal(deploymentManifest.caddy.version, '2.11.4');
    assert.equal(deploymentManifest.serverEntry, false);
    assert.match(deploymentRunner, /npm[\s\S]*ci/);
    assert.match(deploymentCaddyfile, /LAYER_HTTPS_PORT/);
    assert.match(deploymentCaddyfile, /LAYER_CADDY_ADMIN_PORT:2019/);
    assert.match(deploymentCaddyfile, /\/_layer\/types\/\*/);
    assert.match(deploymentCaddyfile, /\/_layer\/layouts\/\*\.d\.mts/);
    assert.match(deploymentCaddyfile, /\/_layer\/layouts\.json/);
    assert.match(deploymentCaddyfile, /\/_layer\/layouts\/\*/);
    assert.match(deploymentCaddyfile, /\{path\}\/index\.html \/_layer\/shell\.html/);
    assert.doesNotMatch(deploymentCaddyfile, /reverse_proxy/);
    assert.match(deploymentCaddyfile, /style-src 'self'/);
    assert.doesNotMatch(deploymentCaddyfile, /style-src 'self' 'unsafe-inline'/);
    assert.equal(buildResult.artifacts.includes('package.json'), true);
    assert.equal(buildResult.artifacts.includes('package-lock.json'), true);
    assert.equal(buildResult.artifacts.includes('Caddyfile'), true);
    assert.equal(buildResult.artifacts.includes('_layer/database.d.ts'), true);
    assert.equal(buildResult.artifacts.includes('_layer/types/layer-auth.d.ts'), true);
    assert.match(
        await readFile(path.join(projectData.projectDirectory, 'dist/_layer/database.d.ts'), 'utf8'),
        /export interface LayerDatabaseTables/
    );
    assert.match(
        await readFile(path.join(projectData.projectDirectory, 'dist/_layer/types/layer-auth.d.ts'), 'utf8'),
        /ReturnType<typeof layerAuthBrowserCreate>/
    );
    assert.equal(buildResult.artifacts.includes('_layer/deployment/run.mjs'), true);
    assert.equal(buildManifest.integrity['package.json'].startsWith('sha256-'), true);
    assert.equal(buildManifest.integrity['_layer/deployment/run.mjs'].startsWith('sha256-'), true);
    assert.equal(Object.keys(buildManifest.integrity).length, buildResult.artifacts.length);
});

test('CLI build precaches bounded public/assets with verified hashes', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    const assetsDirectory = path.join(projectData.projectDirectory, 'public/assets');
    const stylesheetDirectory = path.join(assetsDirectory, 'css');
    const iconDirectory = path.join(assetsDirectory, 'icons');
    const stylesheetContent = 'body { color: blue; }\n';
    const optimizedStylesheetContent = 'body{color:#00f}';
    const iconContent = '<svg xmlns="http://www.w3.org/2000/svg"/>\n';

    await mkdir(stylesheetDirectory, {recursive: true});
    await mkdir(iconDirectory, {recursive: true});
    await writeFile(path.join(stylesheetDirectory, 'page.css'), stylesheetContent, 'utf8');
    await writeFile(path.join(iconDirectory, 'chat.svg'), iconContent, 'utf8');

    const configData = await layerConfigLoad(projectData.projectDirectory);

    await layerProjectBuild({rootDirectory: projectData.projectDirectory, config: configData});

    const versionManifest = JSON.parse(await readFile(
        path.join(projectData.projectDirectory, 'dist/_layer/version.json'),
        'utf8'
    ));
    const stylesheetAsset = versionManifest.assets.find((/** @type {{url: string}} */ assetData) =>
        assetData.url === '/assets/css/page.css');
    const iconAsset = versionManifest.assets.find((/** @type {{url: string}} */ assetData) =>
        assetData.url === '/assets/icons/chat.svg');

    assert.deepEqual(stylesheetAsset, {
        url: '/assets/css/page.css',
        hash: `sha256-${createHash('sha256').update(optimizedStylesheetContent).digest('base64')}`,
        required: true,
        policy: 'immutable'
    });
    assert.equal(iconAsset?.required, true);
    assert.equal(await readFile(path.join(projectData.projectDirectory, 'dist/assets/css/page.css'), 'utf8'), optimizedStylesheetContent);

    await writeFile(path.join(iconDirectory, 'too-large.svg'), Buffer.alloc(2 * 1024 * 1024 + 1));
    await assert.rejects(() => layerProjectBuild({
        rootDirectory: projectData.projectDirectory,
        config: configData
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_BUILD_PUBLIC_ASSETS_LIMIT');
    assert.equal(await readFile(path.join(projectData.projectDirectory, 'dist/assets/css/page.css'), 'utf8'), optimizedStylesheetContent);
});

test('CLI build bundles an explicit server entry and preserves dist after atomic failure', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    const serverDirectory = path.join(projectData.projectDirectory, 'src/server');
    const serverFile = path.join(serverDirectory, 'index.js');
    const configurationFile = path.join(projectData.projectDirectory, 'layer.config.js');
    const {mkdir} = await import('node:fs/promises');

    await mkdir(serverDirectory, {recursive: true});
    await writeFile(serverFile, `export const layerServerCreate = function layerServerCreate(){
    return {
        async start(){},
        async stop(){},
        isReady(){ return true; }
    };
};
`, 'utf8');
    const configurationSource = await readFile(configurationFile, 'utf8');
    await writeFile(
        configurationFile,
        configurationSource
            .replace('auth: null,', `auth: {
        enabled: true,
        secret: {env: 'LAYER_AUTH_SECRET'},
        registration: {mode: 'open'},
        identifiers: {email: true, username: false},
        emailVerification: {required: false, lifetimeMs: 86400000},
        password: {minimumLength: 12, maximumLength: 128, commonPasswordBlocklist: true},
        passwordRecovery: {enabled: false, lifetimeMs: 1800000},
        session: {
            idleLifetimeMs: 1800000,
            absoluteLifetimeMs: 43200000,
            rememberIdleLifetimeMs: 604800000,
            rememberAbsoluteLifetimeMs: 2592000000,
            touchIntervalMs: 300000,
            maximumPerUser: 20,
            dataMaximumBytes: 16384
        },
        smtp: null,
        passkey: null,
        totp: null,
        oauth: {
            issuer: 'https://auth.example.test',
            interactionUrl: '/auth/oauth',
            scopes: ['openid', 'offline_access'],
            clients: [{
                id: 'browser-client',
                displayName: 'Browser client',
                type: 'public',
                grantTypes: ['authorization_code', 'refresh_token'],
                redirectUris: ['https://app.example.test/oauth/callback'],
                scopes: ['openid', 'offline_access'],
                dpop: 'optional'
            }]
        },
        oidc: []
    },`)
            .replace('serverEntry: null', "serverEntry: 'server/index.js'"),
        'utf8'
    );

    const configData = await layerConfigLoad(projectData.projectDirectory);
    await layerProjectBuild({
        rootDirectory: projectData.projectDirectory,
        config: configData
    });

    const serverBundleFile = path.join(projectData.projectDirectory, 'dist/_layer/server/application.mjs');
    const serverBundleSourceData = await readFile(serverBundleFile, 'utf8');
    const caddyfileSource = await readFile(path.join(projectData.projectDirectory, 'dist/Caddyfile'), 'utf8');
    const deploymentPackageData = JSON.parse(await readFile(path.join(projectData.projectDirectory, 'dist/package.json'), 'utf8'));

    assert.match(serverBundleSourceData, /layerServerCreate/);
    assert.match(
        await readFile(path.join(projectData.projectDirectory, 'dist/_layer/application.mjs'), 'utf8'),
        /layerAuthEnabled = true/
    );
    assert.equal(deploymentPackageData.dependencies['@node-rs/argon2'], '2.2.1');
    assert.equal(deploymentPackageData.dependencies.nodemailer, '10.2.1');
    assert.equal(deploymentPackageData.engines.node, '>=24.22.1 <25');
    assert.match(await readFile(path.join(projectData.projectDirectory, 'dist/_layer/deployment/runtime-version.js'), 'utf8'), /layerNodeVersionSupported/);
    assert.equal(deploymentPackageData.dependencies['oidc-provider'], '9.12.2');
    assert.match(caddyfileSource, /reverse_proxy .*127\.0\.0\.1/);
    assert.match(caddyfileSource, /lb_policy least_conn/);
    assert.match(caddyfileSource, /keepalive 4s/);
    assert.match(caddyfileSource, /\/\.well-known\/openid-configuration/);
    assert.match(caddyfileSource, /\/oauth\/\*/);
    assert.match(caddyfileSource, /\/auth\/oauth\/\*/);
    assert.match(caddyfileSource, /media-src 'self' blob:/);
    assert.equal(await readFile(path.join(projectData.projectDirectory, 'dist/_layer/server/pglite.data')).then(
        (assetData) => assetData.byteLength > 0
    ), true);
    await rm(serverFile, {force: true});
    await assert.rejects(() => layerProjectBuild({
        rootDirectory: projectData.projectDirectory,
        config: configData
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_BUILD_SERVER_ENTRY_INVALID');
    assert.equal(await readFile(serverBundleFile, 'utf8'), serverBundleSourceData);
});

test('doctor and inspect CLI expose safe machine-readable results', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    const configData = await layerConfigLoad(projectData.projectDirectory);
    const doctorResult = await layerDoctorRun({
        rootDirectory: projectData.projectDirectory,
        config: configData,
        nodeVersion: '24.22.1'
    });
    const wrongNodeResult = await layerDoctorRun({
        rootDirectory: projectData.projectDirectory,
        config: configData,
        nodeVersion: '23.0.0'
    });
    const outputRecords = /** @type {string[]} */ ([]);
    const inspectResult = await layerCliRun({
        argv: ['inspect'],
        cwd: projectData.projectDirectory,
        write: (outputData) => outputRecords.push(outputData)
    });

    assert.equal(doctorResult.ok, true);
    assert.equal(wrongNodeResult.ok, false);
    assert.equal(inspectResult.code, 0);
    assert.match(outputRecords[0] ?? '', /"routes"/);
    assert.doesNotMatch(outputRecords[0] ?? '', /csrf|password|secret/i);
});

test('doctor classifies configured infrastructure versions without exposing credentials', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    const configData = layerConfigValidate({
        appName: 'doctor-infrastructure',
        database: {
            postgres: [{
                name: 'primary',
                role: 'primary',
                host: '127.0.0.1',
                port: 5432,
                database: 'layer_stable_messenger',
                username: 'postgres',
                password: null,
                tls: {mode: 'disable'}
            }]
        },
        redis: {
            host: '127.0.0.1',
            port: 6379,
            username: null,
            password: null,
            database: 15,
            tls: {mode: 'disable'}
        }
    });
    const doctorResultData = await layerDoctorRun({
        rootDirectory: projectData.projectDirectory,
        config: configData,
        nodeVersion: '24.22.1',
        async infrastructureProbe(){
            //Returning the local legacy versions without opening sockets
            return Object.freeze({postgres: '14.2', redis: '5.0.14.1'});
        }
    });
    const postgresCheckData = doctorResultData.checks.find((checkData) => checkData.name === 'postgresql-version');
    const redisCheckData = doctorResultData.checks.find((checkData) => checkData.name === 'redis-version');

    //Checking legacy infrastructure remains usable but explicitly non-certified
    assert.equal( doctorResultData.ok, true );
    assert.equal( postgresCheckData?.code, 'INFRASTRUCTURE_VERSION_LEGACY' );
    assert.equal( redisCheckData?.code, 'INFRASTRUCTURE_VERSION_LEGACY' );
    assert.equal( JSON.stringify( doctorResultData ).includes( 'password' ), false );

    const unavailableResultData = await layerDoctorRun({
        rootDirectory: projectData.projectDirectory,
        config: configData,
        nodeVersion: '24.22.1',
        async infrastructureProbe(){
            //Simulating one bounded infrastructure connection failure
            throw new Error( 'connection contains a secret and must be hidden' );
        }
    });

    assert.equal( unavailableResultData.ok, false );
    assert.equal( unavailableResultData.checks.some((checkData) => checkData.code === 'INFRASTRUCTURE_UNAVAILABLE'), true );
    assert.equal( JSON.stringify( unavailableResultData ).includes( 'secret' ), false );
});

test('CLI dispatcher runs public commands and rejects incomplete commands', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    await projectDevelopmentPortSet(projectData.projectDirectory, await localPortFind());
    const outputRecords = /** @type {string[]} */ ([]);
    const writeOutput = (/** @type {string} */ outputData) => outputRecords.push(outputData);
    const helpResult = await layerCliRun({argv: [], write: writeOutput});
    const helpAliasResult = await layerCliRun({
        argv: ['--help'],
        cwd: projectData.temporaryRoot,
        write: writeOutput
    });
    const versionResult = await layerCliRun({
        argv: ['--version'],
        cwd: projectData.temporaryRoot,
        write: writeOutput
    });
    const namedCreateResult = await layerCliRun({
        argv: ['create', 'Named', 'Application', '--dry-run'],
        cwd: projectData.temporaryRoot,
        write: writeOutput
    });
    const defaultCreateResult = await layerCliRun({
        argv: ['create', 'Default App'],
        cwd: projectData.temporaryRoot,
        write: writeOutput
    });
    const buildResult = await layerCliRun({
        argv: ['build', '--dry-run'],
        cwd: projectData.projectDirectory,
        write: writeOutput
    });
    const doctorResult = await layerCliRun({
        argv: ['doctor'],
        cwd: projectData.projectDirectory,
        write: writeOutput
    });
    const docsResult = await layerCliRun({
        argv: ['docs'],
        cwd: projectData.projectDirectory,
        write: writeOutput
    });
    const developmentResult = await layerCliRun({
        argv: ['dev'],
        cwd: projectData.projectDirectory,
        write: writeOutput
    });
    const development = /** @type {{close: () => boolean}} */ (developmentResult.result);
    testContext.after( function(){
        //Closing the listener even when an assertion fails before explicit shutdown
        development.close();

    });

    assert.equal(helpResult.command, 'help');
    assert.equal(helpAliasResult.command, 'help');
    assert.equal(versionResult.command, 'version');
    const cliManifestData = JSON.parse( await readFile( new URL( '../package.json', import.meta.url ), 'utf8' ) );
    assert.equal(versionResult.result, cliManifestData.version);
    assert.equal(namedCreateResult.command, 'create');
    assert.equal(defaultCreateResult.command, 'create');
    assert.equal(/** @type {any} */ (namedCreateResult.result).projectName, 'named-application');
    assert.equal(
        /** @type {any} */ (namedCreateResult.result).targetDirectory,
        path.join(projectData.temporaryRoot, 'apps', 'named-application')
    );
    assert.equal(/** @type {any} */ (defaultCreateResult.result).projectName, 'default-app');
    assert.match(
        await readFile(path.join(projectData.temporaryRoot, 'apps', 'default-app', 'layer.config.js'), 'utf8'),
        /appName: 'default-app'/
    );
    assert.equal(buildResult.command, 'build');
    assert.equal(doctorResult.code, 0);
    assert.equal(docsResult.command, 'docs');
    assert.equal(await development.close(), true);
    assert.equal(outputRecords.some((outputData) => outputData.includes('# named-app') || outputData.includes('named-app')), true);
    assert.equal(outputRecords.some((outputData) => outputData.includes('# messenger — Layer application')), true);
    assert.equal(outputRecords.some((outputData) => outputData.includes('Usage: layer <command>')), true);
    await assert.rejects(() => layerCliRun({
        argv: ['create'],
        cwd: projectData.temporaryRoot,
        write: writeOutput
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_ARGUMENT_REQUIRED');
    await assert.rejects(() => layerCliRun({
        argv: ['create', 'Новое приложение', '--dry-run'],
        cwd: projectData.temporaryRoot,
        write: writeOutput
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_CREATE_NAME_CYRILLIC_FORBIDDEN');
    await assert.rejects(() => layerCliRun({
        argv: ['create', '../outside', '--dry-run'],
        cwd: projectData.temporaryRoot,
        write: writeOutput
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_CREATE_NAME_INVALID');
    await assert.rejects(() => layerCliRun({
        argv: ['create', 'new-app', '--name', 'override', '--dry-run'],
        cwd: projectData.temporaryRoot,
        write: writeOutput
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_ARGUMENT_UNKNOWN');
    await assert.rejects(() => layerCliRun({
        argv: ['database', 'schema', 'apply', 'invalid'],
        cwd: projectData.projectDirectory,
        write: writeOutput
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_ARGUMENT_REQUIRED');
    await assert.rejects(() => layerCliRun({
        argv: ['database', 'schema', 'plan'],
        cwd: projectData.projectDirectory,
        write: writeOutput
    }), (errorData) => /** @type {any} */ (errorData).code === 'APPLICATION_DATABASE_REQUIRED');
    await assert.rejects(() => layerCliRun({
        argv: ['unknown'],
        cwd: projectData.projectDirectory,
        write: writeOutput
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_COMMAND_UNKNOWN');
});

test('development host serves the application shell on loopback only', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    await projectDevelopmentPortSet(projectData.projectDirectory, await localPortFind());
    const configData = await layerConfigLoad(projectData.projectDirectory);
    const development = await layerDevelopmentHostCreate({
        rootDirectory: projectData.projectDirectory,
        config: configData
    });
    testContext.after(async () => {
        await development.close();
    });

    const shellResponse = await fetch(`${development.origin}/`, {
        headers: {
            accept: 'text/html'
        }
    });
    const clientResponse = await fetch(`${development.origin}/_layer/dev-client.mjs`);
    const styleResponse = await fetch(`${development.origin}/_layer/dev-client.css`);
    const applicationModuleResponse = await fetch(`${development.origin}/_layer/application.mjs`);
    const deploymentMetadataResponse = await fetch(`${development.origin}/_layer/deployment.json`);
    const databaseDeclarationResponse = await fetch(`${development.origin}/_layer/database.d.ts`);
    const serverMapResponse = await fetch(`${development.origin}/_layer/server/application.mjs.map`);
    const navigationResponse = await fetch(`${development.origin}/chat/dialog-1`, {
        headers: {
            accept: 'text/html'
        }
    });
    const missingResponse = await fetch(`${development.origin}/missing.js`);
    const methodResponse = await fetch(`${development.origin}/api`, {method: 'POST'});
    const headResponse = await fetch(`${development.origin}/`, {method: 'HEAD'});

    assert.equal(development.protocol, 'http');
    assert.equal(shellResponse.status, 200);
    const shellSource = await shellResponse.text();
    assert.match(shellSource, /data-layer-root/);
    assert.match(shellSource, /_layer\/dev-client\.mjs\?revision=1/);
    const developmentContentSecurityPolicy = shellResponse.headers.get('content-security-policy');
    assert.equal(developmentContentSecurityPolicy?.includes("default-src 'self'"), true);
    assert.equal(developmentContentSecurityPolicy?.includes("connect-src 'self'"), true);
    assert.equal(developmentContentSecurityPolicy?.includes("img-src 'self' data: blob:"), true);
    assert.equal(developmentContentSecurityPolicy?.includes("media-src 'self' blob:"), true);
    assert.equal(developmentContentSecurityPolicy?.includes("style-src 'self' 'unsafe-inline'"), true);
    assert.equal(developmentContentSecurityPolicy?.includes("script-src 'self' 'unsafe-inline'"), false);
    assert.equal(clientResponse.status, 200);
    assert.equal(clientResponse.headers.get('cache-control'), 'no-store');
    assert.match(await clientResponse.text(), /window\.location\.reload\(\)/);
    assert.equal(styleResponse.status, 200);
    assert.match(await styleResponse.text(), /#layer-development-error/);
    assert.equal(applicationModuleResponse.status, 200);
    assert.equal(applicationModuleResponse.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(deploymentMetadataResponse.status, 404);
    assert.equal(databaseDeclarationResponse.status, 404);
    assert.equal(serverMapResponse.status, 404);
    assert.equal(navigationResponse.status, 200);
    const navigationSource = await navigationResponse.text();
    assert.match(navigationSource, /data-layer-root/);
    assert.doesNotMatch(navigationSource, /data-layer-ssr=/);
    assert.doesNotMatch(navigationSource, /<h1[^>]*>messenger<\/h1>/);
    assert.equal(missingResponse.status, 404);
    assert.equal(methodResponse.status, 405);
    assert.equal(methodResponse.headers.get('allow'), 'GET, HEAD');
    assert.equal(headResponse.status, 200);
    assert.equal(await headResponse.text(), '');
    assert.equal(await development.close(), true);
    assert.equal(await development.close(), false);
});

test('development host starts serverEntry and proxies API and health through one origin', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    const developmentPort = await localPortFind();
    const originPort = await localPortFind();
    const configFile = path.join(projectData.projectDirectory, 'layer.config.js');
    const serverDirectory = path.join(projectData.projectDirectory, 'src/server');
    const serverFile = path.join(serverDirectory, 'index.js');
    const configSource = (await readFile(configFile, 'utf8'))
        .replace('port: 5173', `port: ${developmentPort}`)
        .replace('serverEntry: null', "serverEntry: 'server/index.js'")
        .replace('originPort: 8787', `originPort: ${originPort}`);

    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    await mkdir(serverDirectory, {recursive: true});
    await writeFile(configFile, configSource, 'utf8');
    await writeFile(serverFile, `import {createServer} from 'node:http';

export async function layerServerCreate(contextData) {
    let readyStatus = false;
    let streamClosedStatus = false;
    let serverData = null;

    return {
        async start(listenOptions) {
            serverData = createServer(function requestHandle(requestData, responseData) {
                if (requestData.url === '/api?not-ready') {
                    readyStatus = false;
                }

                if (requestData.url === '/api?stream') {
                    streamClosedStatus = false;
                    responseData.writeHead(200, {
                        'cache-control': 'no-store',
                        'content-type': 'text/event-stream; charset=utf-8'
                    });
                    responseData.flushHeaders();
                    const streamTimeout = setTimeout(function streamComplete() {
                        responseData.end('event: complete\\ndata: {}\\n\\n');
                    }, 5000);
                    responseData.once('close', function streamCloseHandle() {
                        streamClosedStatus = true;
                        clearTimeout(streamTimeout);
                    });
                    return;
                }

                responseData.setHeader('content-type', 'application/json; charset=utf-8');
                responseData.end(JSON.stringify({
                    path: requestData.url,
                    environment: contextData.environment,
                    databaseKind: contextData.databaseRuntime.kind,
                    systemSchema: contextData.databaseRuntime.systemSchema,
                    eventBusAvailable: typeof contextData.eventBus?.publish === 'function',
                    leasesAvailable: typeof contextData.leases?.acquire === 'function',
                    queryCacheAvailable: contextData.queryCache !== null,
                    rateLimiterAvailable: typeof contextData.rateLimiter?.consume === 'function',
                    redisConfigured: contextData.redis?.configured,
                    trustedProxy: contextData.trustedProxy,
                    forwardedFor: requestData.headers['x-forwarded-for'] ?? null,
                    streamClosed: streamClosedStatus
                }));
            });
            await new Promise(function serverListen(resolve, reject) {
                serverData.once('error', reject);
                serverData.listen(listenOptions.port, listenOptions.host, resolve);
            });
            readyStatus = true;
        },
        async stop() {
            readyStatus = false;
            if (serverData === null) {
                return;
            }
            await new Promise(function serverClose(resolve, reject) {
                serverData.close(function serverCloseComplete(closeError) {
                    if (closeError !== undefined) {
                        reject(closeError);
                        return;
                    }
                    resolve();
                });
            });
            serverData = null;
        },
        isReady() {
            return readyStatus;
        }
    };
}
`, 'utf8');

    const configData = await layerConfigLoad(projectData.projectDirectory);
    const development = await layerDevelopmentHostCreate({
        rootDirectory: projectData.projectDirectory,
        config: configData
    });
    testContext.after(async () => {
        await development.close();
    });

    const healthResponse = await fetch(`${development.origin}/health/ready`);
    const apiResponse = await fetch(`${development.origin}/api`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: '{}'
    });
    const healthData = await healthResponse.json();
    const apiData = await apiResponse.json();

    assert.equal(healthResponse.status, 200);
    assert.equal(healthData.path, '/health/ready');
    assert.equal(healthData.environment, 'development');
    assert.equal(healthData.databaseKind, 'embedded');
    assert.equal(healthData.systemSchema, 'layer_messenger');
    assert.equal(healthData.eventBusAvailable, true);
    assert.equal(healthData.leasesAvailable, true);
    assert.equal(healthData.queryCacheAvailable, false);
    assert.equal(healthData.rateLimiterAvailable, true);
    assert.equal(healthData.redisConfigured, false);
    assert.deepEqual(healthData.trustedProxy.addresses, ['loopback']);
    assert.equal(apiResponse.status, 200);
    assert.equal(apiData.path, '/api');
    assert.match(apiData.forwardedFor, /127\.0\.0\.1|::1/);

    const streamResponse = await fetch(`${development.origin}/api?stream`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: '{}',
        signal: AbortSignal.timeout(5000)
    });

    assert.equal(streamResponse.status, 200);
    assert.equal(streamResponse.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    await streamResponse.body?.cancel();
    let streamClosedStatus = false;

    for (let attemptNumber = 0; attemptNumber < 40; attemptNumber += 1) {
        const streamStatusResponse = await fetch(`${development.origin}/api?stream-status`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: '{}'
        });
        streamClosedStatus = (await streamStatusResponse.json()).streamClosed;

        if (streamClosedStatus) {
            break;

        }

        await new Promise(function streamCloseWait(resolve) {
            setTimeout(resolve, 50);
        });

    }

    assert.equal(streamClosedStatus, true, 'cancelling a streamed response closes its upstream connection');

    await fetch(`${development.origin}/api?not-ready`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: '{}'
    });
    const recoveringHealthResponse = await fetch(`${development.origin}/health/ready`);
    const blockedApiResponse = await fetch(`${development.origin}/api`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: '{}'
    });

    assert.equal(recoveringHealthResponse.status, 200);
    assert.equal((await recoveringHealthResponse.json()).path, '/health/ready');
    assert.equal(blockedApiResponse.status, 503);
});

test('development backend proxies only configured OAuth interoperability paths', async (testContext) => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-cli-oauth-proxy-'));
    const serverDirectory = path.join(temporaryRoot, 'dist', '_layer', 'server');
    const serverFile = path.join(serverDirectory, 'application.mjs');
    const originPort = await localPortFind();
    const publicPort = await localPortFind();
    const configData = layerConfigValidate({
        appName: 'oauth-proxy-fixture',
        auth: {
            enabled: true,
            secret: {env: 'LAYER_AUTH_SECRET'},
            registration: {mode: 'open'},
            oauth: {
                issuer: `http://127.0.0.1:${publicPort}`,
                interactionUrl: '/auth/oauth',
                scopes: ['openid', 'offline_access'],
                clients: [{
                    id: 'browser-client',
                    displayName: 'Browser client',
                    type: 'public',
                    grantTypes: ['authorization_code', 'refresh_token'],
                    redirectUris: [`http://127.0.0.1:${publicPort}/oauth/callback`],
                    scopes: ['openid', 'offline_access'],
                    dpop: 'optional'
                }]
            }
        },
        deployment: {
            serverEntry: 'server/index.js',
            originPort
        }
    });
    const developmentBackendData = layerDevelopmentServerCreate({
        rootDirectory: temporaryRoot,
        config: configData
    });

    testContext.after(async () => {
        await developmentBackendData.close();
        await rm(temporaryRoot, {recursive: true, force: true});
    });

    await mkdir(serverDirectory, {recursive: true});
    await writeFile(serverFile, `import {createServer} from 'node:http';

export async function layerServerCreate() {
    let readyStatus = false;
    let serverData = null;

    return {
        async start(listenOptions) {
            serverData = createServer(function requestHandle(requestData, responseData) {
                responseData.setHeader('content-type', 'application/json; charset=utf-8');
                responseData.end(JSON.stringify({path: requestData.url}));
            });
            await new Promise(function serverListen(resolve, reject) {
                serverData.once('error', reject);
                serverData.listen(listenOptions.port, listenOptions.host, resolve);
            });
            readyStatus = true;
        },
        async stop() {
            readyStatus = false;

            if (serverData === null) {
                return;
            }

            await new Promise(function serverClose(resolve, reject) {
                serverData.close(function serverCloseComplete(closeError) {
                    if (closeError !== undefined) {
                        reject(closeError);
                        return;
                    }

                    resolve();
                });
            });
            serverData = null;
        },
        isReady() {
            return readyStatus;
        }
    };
}
`, 'utf8');
    await developmentBackendData.update(/** @type {any} */ ({
        integrity: {
            '_layer/server/application.mjs': 'oauth-proxy-fixture'
        }
    }));

    const publicServerData = createServer(function publicRequestHandle(requestData, responseData) {
        const handledStatusData = developmentBackendData.requestHandle(
            requestData,
            responseData,
            new URL(requestData.url ?? '/', 'http://layer.local').pathname,
            'http'
        );

        if (handledStatusData === false) {
            responseData.statusCode = 404;
            responseData.end();
        }
    });
    testContext.after(async () => {
        await new Promise(function publicServerClose(resolve, reject) {
            publicServerData.close(function publicServerCloseComplete(closeError) {
                if (closeError !== undefined) {
                    reject(closeError);
                    return;
                }

                resolve( undefined );
            });
        });
    });
    await new Promise(function publicServerListen(resolve, reject) {
        publicServerData.once('error', reject);
        publicServerData.listen(publicPort, '127.0.0.1', function publicServerListening(){
            resolve( undefined );

        });
    });

    const discoveryResponseData = await fetch(`http://127.0.0.1:${publicPort}/.well-known/openid-configuration`);
    const interactionResponseData = await fetch(`http://127.0.0.1:${publicPort}/auth/oauth/interaction-1`);
    const forbiddenResponseData = await fetch(`http://127.0.0.1:${publicPort}/private/runtime`);

    assert.equal(discoveryResponseData.status, 200);
    assert.equal((await discoveryResponseData.json()).path, '/.well-known/openid-configuration');
    assert.equal(interactionResponseData.status, 200);
    assert.equal((await interactionResponseData.json()).path, '/auth/oauth/interaction-1');
    assert.equal(forbiddenResponseData.status, 404);
});

test('development backend converts trusted application failures into stable CLI codes', async (testContext) => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-cli-server-failure-'));
    const serverDirectory = path.join(temporaryRoot, 'dist', '_layer', 'server');
    const serverFile = path.join(serverDirectory, 'application.mjs');
    const configData = layerConfigValidate({
        appName: 'failure-fixture',
        deployment: {
            serverEntry: 'server/index.js',
            originPort: await localPortFind()
        }
    });
    const developmentBackendData = layerDevelopmentServerCreate({
        rootDirectory: temporaryRoot,
        config: configData
    });

    testContext.after(async () => {
        await developmentBackendData.close();
        await rm(temporaryRoot, {recursive: true, force: true});
    });
    await mkdir(serverDirectory, {recursive: true});
    await writeFile(serverFile, "export async function layerServerCreate(){ throw new Error('private create reason'); }\n", 'utf8');

    //Checking factory failures never escape as generic internal or build errors.
    await assert.rejects(
        developmentBackendData.update(/** @type {any} */ ({integrity: {'_layer/server/application.mjs': 'create-failure'}})),
        (errorData) => /** @type {any} */ (errorData).code === 'CLI_DEV_SERVER_CREATE_FAILED'
    );

    await writeFile(serverFile, `export async function layerServerCreate(){
    return {
        async start(){ throw new Error('private start reason'); },
        async stop(){},
        isReady(){ return false; }
    };
}
`, 'utf8');

    //Checking listener failures receive a separate actionable diagnostic code.
    await assert.rejects(
        developmentBackendData.update(/** @type {any} */ ({integrity: {'_layer/server/application.mjs': 'start-failure'}})),
        (errorData) => /** @type {any} */ (errorData).code === 'CLI_DEV_SERVER_START_FAILED'
    );

});

test('development live reload publishes build, error, and recovery events without changing dist', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    await projectDevelopmentPortSet(projectData.projectDirectory, await localPortFind());
    const configData = await layerConfigLoad(projectData.projectDirectory);
    const watcherRecords = /** @type {{close: () => void, callback: (...callbackArguments: any[]) => void}[]} */ ([]);
    const development = await layerDevelopmentHostCreate({
        rootDirectory: projectData.projectDirectory,
        config: configData,
        debounceMs: 10,
        watchCreate: /** @type {any} */ ((
            /** @type {string} */ _directoryData,
            /** @type {Record<string, unknown>} */ _watchOptions,
            /** @type {(...callbackArguments: any[]) => void} */ callbackData
        ) => {
            const watcherRecord = {
                callback: callbackData,
                close() {
                    //The host owns this synthetic watcher lifecycle.

                }
            };
            watcherRecords.push(watcherRecord);

            return watcherRecord;
        })
    });
    testContext.after(async () => {
        await development.close();
    });

    const eventAbortController = new AbortController();
    const eventResponse = await fetch(`${development.origin}/_layer/dev/events`, {
        signal: eventAbortController.signal
    });
    const eventReader = eventResponse.body?.getReader();

    assert.equal(eventResponse.status, 200);
    assert.equal(eventResponse.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.ok(eventReader);
    assert.match(await developmentEventWait(eventReader, 'layer-ready'), /"revision":1/);

    const sourceFile = path.join(projectData.projectDirectory, 'src/pages/index.layer.js');
    const initialSource = await readFile(sourceFile, 'utf8');
    const changedSource = initialSource.replace('<h1>messenger</h1>', '<h1>Updated messenger</h1>');
    const sourceWatcher = watcherRecords[0];
    assert.ok(sourceWatcher);
    await writeFile(sourceFile, changedSource, 'utf8');
    sourceWatcher.callback('change', 'pages/index.layer.js');
    assert.match(await developmentEventWait(eventReader, 'layer-build'), /"revision":2/);

    const builtShellBeforeError = await readFile(path.join(projectData.projectDirectory, 'dist/index.html'), 'utf8');
    assert.equal(builtShellBeforeError.includes('/_layer/dev-client.mjs'), false);
    await writeFile(sourceFile, 'export default ;\n', 'utf8');
    sourceWatcher.callback('change', 'pages/index.layer.js');
    const errorEventData = await developmentEventWait(eventReader, 'layer-error');
    assert.match(errorEventData, /"code":"CLI_/);
    assert.equal(await readFile(path.join(projectData.projectDirectory, 'dist/index.html'), 'utf8'), builtShellBeforeError);

    await writeFile(sourceFile, initialSource, 'utf8');
    sourceWatcher.callback('change', 'pages/index.layer.js');
    assert.match(await developmentEventWait(eventReader, 'layer-build'), /"revision":3/);

    eventAbortController.abort();
    await eventReader.cancel().catch(function eventReaderCancelFailure(cancelError) {
        //Ignoring the expected abort after the live reload assertions complete.
        void cancelError;

    });
});

test('development live reload can be disabled without exposing generated endpoints', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    const configData = layerConfigValidate({
        appName: 'messenger',
        development: {
            port: await localPortFind(),
            liveReload: false
        }
    });
    const development = await layerDevelopmentHostCreate({
        rootDirectory: projectData.projectDirectory,
        config: configData
    });
    testContext.after(async () => {
        await development.close();
    });

    const shellResponse = await fetch(`${development.origin}/`);
    const eventResponse = await fetch(`${development.origin}/_layer/dev/events`);

    assert.equal((await shellResponse.text()).includes('/_layer/dev-client.mjs'), false);
    assert.equal(eventResponse.status, 404);
});

test('CLI configuration and build reject unsafe or incomplete projects', async (testContext) => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-cli-invalid-'));
    const emptyProject = path.join(temporaryRoot, 'empty-project');
    const invalidPublicProject = path.join(temporaryRoot, 'invalid-public-project');
    const invalidManifestProject = path.join(temporaryRoot, 'invalid-manifest-project');
    const secureProject = path.join(temporaryRoot, 'secure-project');
    testContext.after(async () => rm(temporaryRoot, {recursive: true, force: true}));

    assert.throws(() => layerConfigValidate(null), LayerCliError);
    assert.throws(() => layerConfigValidate({appName: 'A'}), LayerCliError);
    assert.throws(() => layerConfigValidate({
        appName: 'valid-app',
        sourceDirectory: 'same',
        publicDirectory: 'same'
    }), LayerCliError);
    assert.throws(() => layerConfigValidate({
        appName: 'valid-app',
        development: {unknown: true}
    }), LayerCliError);
    assert.throws(() => layerConfigValidate({
        appName: 'valid-app',
        development: {port: 80}
    }), LayerCliError);
    await assert.rejects(() => layerConfigLoad(temporaryRoot), (errorData) => /** @type {any} */ (errorData).code === 'CLI_CONFIG_LOAD_FAILED');
    await assert.rejects(() => layerProjectBuild(/** @type {any} */ (null)), (errorData) => /** @type {any} */ (errorData).code === 'CLI_BUILD_INVALID');
    await assert.rejects(() => layerProjectCreate(/** @type {any} */ (null)), (errorData) => /** @type {any} */ (errorData).code === 'CLI_CREATE_INVALID');
    await assert.rejects(() => layerProjectCreate({
        targetDirectory: path.parse(temporaryRoot).root,
        projectName: 'unsafe-root'
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_CREATE_TARGET_UNSAFE');

    await layerProjectCreate({
        targetDirectory: emptyProject,
        projectName: 'empty-project'
    });
    await rm(path.join(emptyProject, 'src/pages'), {recursive: true, force: true});
    const emptyConfig = await layerConfigLoad(emptyProject);
    await assert.rejects(() => layerProjectBuild({
        rootDirectory: emptyProject,
        config: emptyConfig
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_BUILD_NO_PAGES');

    await layerProjectCreate({
        targetDirectory: invalidPublicProject,
        projectName: 'invalid-public-project'
    });
    await rm(path.join(invalidPublicProject, 'public'), {recursive: true, force: true});
    await writeFile(path.join(invalidPublicProject, 'public'), 'not a directory', 'utf8');
    const invalidPublicConfig = await layerConfigLoad(invalidPublicProject);
    await assert.rejects(() => layerProjectBuild({
        rootDirectory: invalidPublicProject,
        config: invalidPublicConfig
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_BUILD_PUBLIC_INVALID');
    await assert.rejects(() => layerDevelopmentWatchCreate({
        rootDirectory: invalidPublicProject,
        config: invalidPublicConfig,
        debounceMs: 5
    }), TypeError);

    await layerProjectCreate({
        targetDirectory: invalidManifestProject,
        projectName: 'invalid-manifest-project'
    });
    await writeFile(
        path.join(invalidManifestProject, 'public/manifest.webmanifest'),
        '{"name":"broken"',
        'utf8'
    );
    const invalidManifestConfig = await layerConfigLoad(invalidManifestProject);
    await assert.rejects(() => layerProjectBuild({
        rootDirectory: invalidManifestProject,
        config: invalidManifestConfig
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_BUILD_MANIFEST_INVALID');

    await layerProjectCreate({
        targetDirectory: secureProject,
        projectName: 'secure-project'
    });
    const secureConfig = layerConfigValidate({
        appName: 'secure-project',
        development: {
            port: await localPortFind(),
            https: {
                keyFile: 'certificates/missing.key',
                certificateFile: 'certificates/missing.crt'
            }
        }
    });
    await assert.rejects(() => layerDevelopmentHostCreate({
        rootDirectory: secureProject,
        config: secureConfig
    }), (errorData) => /** @type {any} */ (errorData).code === 'CLI_DEV_HOST_FAILED');
});

test('development watch rebuilds changes and closes every owned watcher', async (testContext) => {
    const projectData = await temporaryProjectCreate();
    testContext.after(async () => rm(projectData.temporaryRoot, {recursive: true, force: true}));
    const configData = await layerConfigLoad(projectData.projectDirectory);
    const watcherRecords = /** @type {{closeCount: number, callback: (...callbackArguments: any[]) => void}[]} */ ([]);
    let buildCount = 0;
    let secondBuildResolve = /** @type {(value: unknown) => void} */ ((_value) => {});
    let secondBuildReject = /** @type {(reason: unknown) => void} */ ((_reason) => {});
    const secondBuildPromise = new Promise(function secondBuildWait(resolve, reject) {
        secondBuildResolve = resolve;
        secondBuildReject = reject;
    });
    const development = await layerDevelopmentWatchCreate({
        rootDirectory: projectData.projectDirectory,
        config: configData,
        debounceMs: 10,
        watchCreate: /** @type {any} */ ((
            /** @type {string} */ _directoryData,
            /** @type {Record<string, unknown>} */ _watchOptions,
            /** @type {(...callbackArguments: any[]) => void} */ callbackData
        ) => {
            const watcherRecord = {
                closeCount: 0,
                callback: callbackData,
                close() {
                    watcherRecord.closeCount += 1;
                }
            };
            watcherRecords.push(watcherRecord);

            return watcherRecord;
        }),
        onBuild() {
            buildCount += 1;

            if (buildCount === 2) {
                secondBuildResolve(undefined);
            }

        },
        onError(buildError) {
            secondBuildReject(buildError);

        }
    });

    await writeFile(path.join(projectData.projectDirectory, 'public/change.txt'), 'changed', 'utf8');
    const firstWatcher = watcherRecords[0];
    assert.ok(firstWatcher);
    firstWatcher.callback('change', 'change.txt');
    await Promise.race([
        secondBuildPromise,
        new Promise(function developmentTimeout(_resolve, reject) {
            setTimeout(() => reject(new Error('Development rebuild timed out.')), 20000);
        })
    ]);

    assert.equal(buildCount, 2);
    assert.equal(development.close(), true);
    assert.equal(development.close(), false);
    assert.equal(watcherRecords.every((watcherData) => watcherData.closeCount === 1), true);
});
