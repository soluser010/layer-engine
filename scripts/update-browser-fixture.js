import {createServer} from 'node:http';
import {readFile, writeFile, mkdtemp, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {layerConfigLoad, layerConfigValidate, layerProjectBuild, layerProjectCreate} from '@solcorp/layer-cli';
import {layerContentSecurityPolicyCreate} from '../packages/cli/src/content-security-policy.js';

//Function for preparing two real production releases without editing any workspace app
export const layerUpdateBrowserFixtureCreate = async function(){
    //Building into one disposable project and retaining only immutable fixture bytes
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-update-browser-'));
    await layerProjectCreate({targetDirectory: projectRoot, projectName: 'update-fixture'});
    await writeFile(path.join(projectRoot, 'src/app.js'), await readFile('browser-tests/fixtures/update-app.js', 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(projectRoot, 'public/manifest.webmanifest'), 'utf8'));
    Object.assign(manifest, {name: 'Тест обновлений', short_name: 'Тест', lang: 'ru',
        description: 'Карточка приложения', theme_color: '#2454b8', background_color: '#ffffff'});
    await writeFile(path.join(projectRoot, 'public/manifest.webmanifest'), JSON.stringify(manifest));
    await mkdir(path.join(projectRoot, 'public/assets'), {recursive: true});
    await writeFile(path.join(projectRoot, 'public/assets/startup-probe.txt'), 'Verified startup resource');
    const config = layerConfigValidate({...await layerConfigLoad(projectRoot), deployment: {domain: 'localhost'}});
    const releases = /** @type {Map<string, Buffer>[]} */ ([]);
    const source = await readFile('browser-tests/fixtures/updates.layer.js', 'utf8');
    for (const edition of ['one', 'two', 'dark']) {
        if (edition === 'dark') {
            //Building an actual dark manifest instead of mutating verified responses in the browser
            manifest.background_color = '#111827';
            await writeFile(path.join(projectRoot, 'public/manifest.webmanifest'), JSON.stringify(manifest));

        }
        //Generating equal appVersion values but different public component content
        await writeFile(path.join(projectRoot, 'src/pages/index.layer.js'), source.replace('__EDITION__', edition));
        const build = await layerProjectBuild({rootDirectory: projectRoot, config});
        const files = new Map();
        for (const fileName of [...Object.keys(build.integrity), 'icon.svg', 'assets/startup-probe.txt']) {
            //Reading only declared build artifacts and the known generated local icon
            files.set('/' + fileName, await readFile(path.join(projectRoot, 'dist', fileName)));

        }
        releases.push(files);

    }
    const servers = new Set();
    //CallBack THE OBJECT
    return Object.freeze({
        handle: async function(/** @type {import('node:http').IncomingMessage} */ request,
            /** @type {import('node:http').ServerResponse} */ response, /** @type {string} */ requestPath){
            //Exposing a loopback-only test allocator, not a production Layer operation
            if (requestPath !== '/__test/update-fixture' || request.method !== 'POST') {
                return false;

            }
            let edition = 0;
            const startupMode = new URL(request.url ?? '/', 'http://localhost').searchParams.get('startup');
            if (startupMode === 'dark') {
                edition = 2;

            }
            let startupRelease = /** @type {() => void} */ (function(){
                //No pending response exists until the startup gate is created
                return undefined;

            });
            const startupGate = new Promise(function(resolve){
                //Holding a real required cache file independently from the application module
                startupRelease = function(){
                    resolve(undefined);

                };

            });
            const server = createServer(async function(clientRequest, clientResponse){
                //Serving captured release files without resolving arbitrary filesystem paths
                const url = new URL(clientRequest.url ?? '/', 'http://127.0.0.1');
                if (url.pathname === '/__continue' && clientRequest.method === 'POST') {
                    //Completing the actual network download, never synthesizing worker progress
                    startupRelease();
                    clientResponse.end('ok');
                    return;

                }
                if (startupMode === 'registration-error' && url.pathname === '/layer-service-worker.js') {
                    clientResponse.writeHead(503);
                    clientResponse.end();
                    return;

                }
                if (url.pathname === '/__release' && clientRequest.method === 'POST') {
                    edition = 1;
                    clientResponse.end('ok');
                    return;

                }
                if (url.pathname === '/__close' && clientRequest.method === 'POST') {
                    clientResponse.end('ok');
                    startupRelease();
                    server.close();
                    servers.delete(server);
                    return;

                }
                let filePath = url.pathname;
                if (filePath === '/') {
                    filePath = '/index.html';

                }
                let bytes = releases[edition]?.get(filePath);
                if (filePath === '/assets/startup-probe.txt') {
                    if (startupMode === 'hold' || startupMode === 'dark') {
                        await startupGate;

                    } else if (startupMode === 'corrupt') {
                        bytes = Buffer.from('Invalid checksum');

                    }

                }
                if (!bytes) {
                    clientResponse.writeHead(404);
                    clientResponse.end();
                    return;

                }
                if (edition === 1 && filePath.endsWith('.mjs')) {
                    //Making actual resource preparation observable without faking runtime progress
                    await wait(250);

                }
                const mime = /** @type {Record<string, string>} */ ({
                    '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
                    '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'
                });
                clientResponse.writeHead(200, {'content-type': mime[path.extname(filePath)] ?? 'application/octet-stream',
                    'cache-control': 'no-store', 'content-security-policy': layerContentSecurityPolicyCreate(config.security),
                    'x-content-type-options': 'nosniff'});
                if (clientRequest.method === 'HEAD') {
                    clientResponse.end();
                    return;

                }
                clientResponse.end(bytes);

            });
            servers.add(server);
            await new Promise(function(resolve, rejected){
                //Using a private ephemeral port for each independent browser scenario
                server.once('error', rejected);
                server.listen(0, '127.0.0.1', function(){
                    //Completing this fixture's listener setup
                    resolve(undefined);

                });

            });
            const address = /** @type {import('node:net').AddressInfo} */ (server.address());
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({origin: 'http://127.0.0.1:' + address.port}));
            return true;

        }
    });

};
