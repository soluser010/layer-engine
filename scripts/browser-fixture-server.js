import {
    createReadStream,
    statSync
} from 'node:fs';
import {
    mkdtemp,
    readFile,
    writeFile,
    rm
} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {layerUpdateBrowserFixtureCreate} from './update-browser-fixture.js';
import {
    layerConfigLoad,
    layerConfigValidate,
    layerDevelopmentHostCreate,
    layerProjectBuild,
    layerProjectCreate
} from '@solcorp/layer-cli';

const serverRoot = path.resolve('.');
const browserApplicationTemporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-browser-application-'));
const browserApplicationProject = path.join(browserApplicationTemporaryRoot, 'application');
const browserDevelopmentProject = path.join(browserApplicationTemporaryRoot, 'development');
const serverPort = Number.parseInt(process.env.LAYER_BROWSER_PORT ?? '5330', 10);
const developmentPort = Number.parseInt(process.env.LAYER_BROWSER_DEV_PORT ?? '5331', 10);

await layerProjectCreate({
    targetDirectory: browserApplicationProject,
    projectName: 'browser-application'
});

//Keeping an actual SSR anchor available before the application module has downloaded
const startupPageFile = path.join(browserApplicationProject, 'src/pages/index.layer.js');
const startupPageSource = await readFile(startupPageFile, 'utf8');
await writeFile(startupPageFile, startupPageSource.replace('<h1>browser-application</h1>',
    '<h1>browser-application</h1><a id="startup-link" href="/second/?cold=1#draft">Open second page</a>'), 'utf8');

//Adding a second route so browser tests exercise a real screen transition.
const browserApplicationSecondPageSource = [
    "import {html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';",
    '',
    "export const page = layerPageCreate({render: 'csr', auth: 'none', offline: 'shell', cache: 'public', metadata: {title: 'Second Layer page'}});",
    '',
    'export default layerComponentCreate(function SecondPage(){',
    '    return html`<main><h1>second-browser-page</h1></main>`;',
    '',
    '});'
].join( String( '\n' ) );

await writeFile(
    path.join( browserApplicationProject, String( 'src/pages/second.layer.js' ) ),
    browserApplicationSecondPageSource,
    'utf8'
);

//Adding the real compiled viewport example to the isolated browser application
await writeFile(
    path.join(browserApplicationProject, 'src/pages/viewport.layer.js'),
    await readFile(path.join(serverRoot, 'browser-tests/fixtures/viewport.layer.js'), 'utf8'),
    'utf8'
);

//Installing the link scenario only in the isolated browser fixture
await writeFile(
    path.join(browserApplicationProject, 'src/pages/links.layer.js'),
    await readFile(path.join(serverRoot, 'browser-tests/fixtures/links.layer.js'), 'utf8'),
    'utf8'
);
const browserApplicationConfiguration = layerConfigValidate({
    //Exercising actual CSS lowering rather than only parsing modern CSS in modern browsers
    ...await layerConfigLoad(browserApplicationProject),
    css: {targets: {chrome: '100', safari: '15.4', firefox: '100'}},
    links: {external: {mode: 'viewer', allowedOrigins: ['http://localhost:' + serverPort]}}
});
await writeFile(
    path.join(browserApplicationProject, 'src/pages/css.layer.js'),
    await readFile(path.join(serverRoot, 'browser-tests/fixtures/css.layer.js'), 'utf8'),
    'utf8'
);
await layerProjectBuild({
    rootDirectory: browserApplicationProject,
    config: browserApplicationConfiguration,
    mode: 'development'
});

await layerProjectCreate({
    targetDirectory: browserDevelopmentProject,
    projectName: 'browser-development'
});

const browserApplicationRoot = path.join(browserApplicationProject, 'dist');
const browserDevelopmentSourceFile = path.join(browserDevelopmentProject, 'src/pages/index.layer.js');
const browserDevelopmentInitialSource = await readFile(browserDevelopmentSourceFile, 'utf8');
const browserDevelopmentChangeWaiters = new Set();

//Function for completing fixture requests after the real watcher finishes
const browserDevelopmentChangeComplete = function(statusData = String()){
    //Resolving every request waiting for this watcher result
    for (const changeResolve of browserDevelopmentChangeWaiters) {
        changeResolve( String( statusData ) );

    }

    browserDevelopmentChangeWaiters.clear();

};

//Function for waiting for one bounded development watcher result
const browserDevelopmentChangeWait = function(){
    return new Promise(function developmentChangeWaitCreate(resolve, reject){
        const changeTimeout = setTimeout(function developmentChangeTimeout(){
            //Rejecting a browser control request that did not receive a watcher result.
            browserDevelopmentChangeWaiters.delete( changeResolve );
            reject( new Error( String( 'Browser development rebuild timed out.' ) ) );

        }, 20000);
        const changeResolve = function(/** @type {string} */ statusData){
            //Completing this browser control request with the watcher result.
            clearTimeout( changeTimeout );
            resolve( statusData );

        };
        browserDevelopmentChangeWaiters.add( changeResolve );

    });

};

const browserDevelopmentHost = await layerDevelopmentHostCreate({
    rootDirectory: browserDevelopmentProject,
    config: layerConfigValidate({
        appName: 'browser-development',
        development: {
            host: '127.0.0.1',
            port: developmentPort,
            https: false,
            liveReload: true
        }
    }),
    onBuild() {
        //Reporting that the watched source produced a complete artifact set
        browserDevelopmentChangeComplete( String( 'build' ) );

    },
    onError() {
        //Reporting that the watched source retained the previous artifact set
        browserDevelopmentChangeComplete( String( 'error' ) );

    }
});
const contentTypes = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
});

const updateFixture = await layerUpdateBrowserFixtureCreate();
const fixtureServer = createServer(async function browserFixtureRequest(request, response) {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (await updateFixture.handle(request, response, requestUrl.pathname)) {
        return;

    }

    if (request.method === 'POST' && requestUrl.pathname === '/__test/live-reload') {
        const bodyChunks = [];
        let bodyBytes = 0;

        //Reading one bounded test action without accepting arbitrary source paths.
        for await (const bodyChunk of request) {
            bodyBytes += bodyChunk.length;

            if (bodyBytes > 4096) {
                response.writeHead(413, {'content-type': 'application/json; charset=utf-8'});
                response.end('{"status":"too-large"}');

                return;

            }

            bodyChunks.push(bodyChunk);

        }

        let actionData;

        try {
            actionData = JSON.parse(Buffer.concat(bodyChunks).toString('utf8')).action;

        } catch {
            response.writeHead(400, {'content-type': 'application/json; charset=utf-8'});
            response.end('{"status":"invalid"}');

            return;

        }

        let sourceData;

        if (actionData === 'reset') {
            sourceData = browserDevelopmentInitialSource;

        } else if (actionData === 'update') {
            sourceData = browserDevelopmentInitialSource
                .replace('<h1>browser-development</h1>', '<h1>Live reload updated</h1>')
                .replace('display: block;', 'display: grid;');

        } else if (actionData === 'error') {
            sourceData = 'export default ;\n';

        } else if (actionData === 'recover') {
            sourceData = browserDevelopmentInitialSource
                .replace('<h1>browser-development</h1>', '<h1>Live reload recovered</h1>')
                .replace('display: block;', 'display: flex;');

        } else {
            response.writeHead(400, {'content-type': 'application/json; charset=utf-8'});
            response.end('{"status":"unknown-action"}');

            return;

        }

        //Waiting before the write so a fast watcher result cannot be missed
        const developmentChangeResultPromise = browserDevelopmentChangeWait();

        //Saving the selected fixture so the real development watcher owns the rebuild.
        await writeFile(browserDevelopmentSourceFile, sourceData, 'utf8');
        const developmentChangeResult = await developmentChangeResultPromise;
        response.writeHead(202, {'content-type': 'application/json; charset=utf-8'});
        response.end(JSON.stringify({status: developmentChangeResult}));

        return;

    }

    if (request.method === 'POST' && requestUrl.pathname === '/api') {
        const bodyChunks = [];
        let bodyBytes = 0;

        //Reading one bounded protocol envelope for the real browser API smoke test.
        for await (const bodyChunk of request) {
            bodyBytes += bodyChunk.length;

            if (bodyBytes > 262144) {
                response.writeHead(413, {'content-type': 'application/json; charset=utf-8'});
                response.end('{"status":"too-large"}');

                return;

            }

            bodyChunks.push(bodyChunk);

        }

        try {
            const requestData = JSON.parse(Buffer.concat(bodyChunks).toString('utf8'));
            const responseData = JSON.stringify({
                protocol: 1,
                requestId: requestData.requestId,
                ok: true,
                data: {
                    source: 'browser-api'
                }
            });

            response.writeHead(200, {
                'content-length': String(Buffer.byteLength(responseData)),
                'content-type': 'application/json; charset=utf-8'
            });
            response.end(responseData);

        } catch {
            response.writeHead(400, {'content-type': 'application/json; charset=utf-8'});
            response.end('{"status":"invalid"}');

        }

        return;

    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, {'content-type': 'text/plain; charset=utf-8'});
        response.end('Method not allowed');

        return;

    }

    if (requestUrl.pathname === '/external-content' || requestUrl.pathname === '/external-denied') {
        //Serving a controlled foreign-origin page rather than relying on an Internet site
        const frameHeaders = /** @type {Record<string, string>} */ ({'content-type': 'text/html; charset=utf-8'});
        if (requestUrl.pathname === '/external-denied') {
            //Exercising a real embedding refusal without any framework bypass
            frameHeaders['content-security-policy'] = "frame-ancestors 'none'";

        }
        response.writeHead(200, frameHeaders);
        response.end('<!doctype html><h1>External test content</h1>');

        return;

    }
    if (requestUrl.pathname === '/health') {
        response.writeHead(200, {'content-type': 'text/plain; charset=utf-8'});
        response.end('ready');

        return;

    }

    let requestPath;

    try {
        //Decoding once before containment checks prevents encoded traversal.
        requestPath = decodeURIComponent(requestUrl.pathname);

    } catch {
        response.writeHead(400, {'content-type': 'text/plain; charset=utf-8'});
        response.end('Invalid path');

        return;

    }

    const applicationAssetStatus = requestPath === '/' || requestPath === '/index.html' || requestPath === '/css/' || requestPath === '/viewport/' || requestPath === '/links/' || requestPath === '/second/' ||
        requestPath === '/manifest.webmanifest' || requestPath === '/layer-service-worker.js' ||
        requestPath === '/layer-service-worker.js.map' || requestPath.startsWith('/_layer/');
    let selectedRoot = serverRoot;
    let selectedPath = requestPath;

    //Selecting generated application artifacts only for their declared URL surface.
    if (applicationAssetStatus) {
        selectedRoot = browserApplicationRoot;

    }

    //Mapping the application origin root to its generated offline shell.
    if (requestPath === '/' || requestPath === '/css/' || requestPath === '/viewport/' || requestPath === '/links/' || requestPath === '/second/') {
        selectedPath = '/index.html';

    }
    const filePath = path.resolve(selectedRoot, `.${selectedPath}`);
    const rootPrefix = `${selectedRoot}${path.sep}`;

    if (!filePath.startsWith(rootPrefix)) {
        response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
        response.end('Not found');

        return;

    }

    let fileStatus;

    try {
        fileStatus = statSync(filePath);

    } catch {
        response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
        response.end('Not found');

        return;

    }

    if (!fileStatus.isFile()) {
        response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
        response.end('Not found');

        return;

    }

    const contentType = contentTypes[/** @type {keyof typeof contentTypes} */ (path.extname(filePath))] ?? 'application/octet-stream';

    const responseHeaders = /** @type {Record<string, string>} */ ({
        'cache-control': 'no-store',
        'content-length': String(fileStatus.size),
        'content-type': contentType,
        'x-content-type-options': 'nosniff'
    });

    if (applicationAssetStatus) {
        //Applying the generated application's production CSP during browser startup tests.
        responseHeaders['content-security-policy'] = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'self' http://localhost:" + serverPort + "; worker-src 'self'; manifest-src 'self'; require-trusted-types-for 'script'";

    }

    response.writeHead(200, responseHeaders);

    if (request.method === 'HEAD') {
        response.end();

        return;

    }

    //Streaming repository fixtures without buffering large dependency files.
    createReadStream(filePath).pipe(response);

});

fixtureServer.listen(serverPort, '127.0.0.1', function browserFixtureListening() {
    //Reporting readiness for Playwright webServer supervision.
    process.stdout.write(`Layer browser fixtures: http://127.0.0.1:${serverPort}\n`);

});

function fixtureServerClose() {
    //Stopping cleanly when Playwright terminates the supervised process.
    fixtureServer.close(async function fixtureServerClosed() {
        await browserDevelopmentHost.close();
        await rm(browserApplicationTemporaryRoot, {recursive: true, force: true});

        //Returning a successful status after all sockets are closed.
        process.exit(0);

    });

}

process.once('SIGINT', fixtureServerClose);
process.once('SIGTERM', fixtureServerClose);
