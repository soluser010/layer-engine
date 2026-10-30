import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile, rm, symlink} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {layerConfigValidate, layerConfigLoad, layerProjectCreate, layerProjectBuild, layerDevelopmentRequestHandlerCreate} from '../src/index.js';

test('CLI normalizes links, merges only frame permissions and keeps safe diagnostic paths', function(){
    //Checking that an allowed viewer origin grants no additional script or connection permission
    const config = layerConfigValidate({appName: 'links-example', links: {external: {allowedOrigins: ['https://view.example.com']}}});
    assert.deepEqual(config.security.csp.sources['frame-src'], ['https://view.example.com']);
    assert.equal(config.security.csp.sources['script-src'], undefined);
    assert.equal(config.security.csp.sources['connect-src'], undefined);
    assert.throws(function(){
        //Passing an unknown field through the CLI's real diagnostic boundary
        layerConfigValidate({appName: 'links-example', links: {external: {unknown: true}}});

    }, function(errorData){
        //Checking the stable category and source-addressable repair location
        const error = /** @type {any} */ (errorData);
        return error.code === 'CLI_CONFIG_INVALID' && error.details.path === 'links.external.unknown';

    });

});

test('build emits all association formats atomically without precaching or overwriting user files', async function(context){
    //Creating a disposable project through the public generator, outside user apps
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-links-build-'));
    context.after(async function(){
        //Removing only this test's generated project
        await rm(temporaryRoot, {recursive: true, force: true});

    });
    await layerProjectCreate({targetDirectory: temporaryRoot, projectName: 'links-example'});
    const initialConfig = await layerConfigLoad(temporaryRoot);
    const config = {...initialConfig, links: {
        external: {mode: 'viewer', allowedOrigins: ['https://view.example.com']},
        scopeExtensions: ['https://related.example.com'],
        associations: {
            android: [{packageName: 'ru.example.app', sha256CertFingerprints: ['AB:'.repeat(31) + 'AB']}],
            apple: [{appId: 'ABCDE12345.ru.example.app', paths: ['/chat/*']}],
            windows: [{packageFamilyName: 'Example.App_abcdefghijklm'}],
            web: [{appId: 'https://app.example.com/custom-id', scope: '/'}]
        }
    }};
    const build = await layerProjectBuild({rootDirectory: temporaryRoot, config});
    const manifest = JSON.parse(await readFile(path.join(temporaryRoot, 'dist/manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.id, '/');
    assert.equal(manifest.launch_handler.client_mode, 'focus-existing');
    assert.deepEqual(manifest.scope_extensions, [{type: 'origin', origin: 'https://related.example.com'}]);
    const version = JSON.parse(await readFile(path.join(temporaryRoot, 'dist/_layer/version.json'), 'utf8'));
    const names = ['assetlinks.json', 'apple-app-site-association', 'windows-app-web-link', 'web-app-origin-association'];
    for (const nameData of names) {
        //Checking that platform verification documents exist in release integrity but not offline cache
        const artifactName = '.well-known/' + nameData;
        assert.ok(build.integrity[artifactName]);
        assert.ok((await readFile(path.join(temporaryRoot, 'dist', artifactName), 'utf8')).startsWith('[') ||
            (await readFile(path.join(temporaryRoot, 'dist', artifactName), 'utf8')).startsWith('{'));
        assert.equal(version.assets.some(function(/** @type {any} */ assetData){
            //Looking for accidental mandatory precache enrollment
            return assetData.url === '/' + artifactName;

        }), false);

    }
    const previousShell = await readFile(path.join(temporaryRoot, 'dist/index.html'), 'utf8');
    await mkdir(path.join(temporaryRoot, 'public/.well-known'), {recursive: true});
    await writeFile(path.join(temporaryRoot, 'public/.well-known/assetlinks.json'), '[]', 'utf8');
    await assert.rejects(function(){
        //Checking conflict before the live dist can be replaced
        return layerProjectBuild({rootDirectory: temporaryRoot, config});

    }, function(errorData){
        //Recognizing the explicit conflict category
        return /** @type {any} */ (errorData).code === 'CLI_BUILD_ASSOCIATION_CONFLICT';

    });
    assert.equal(await readFile(path.join(temporaryRoot, 'dist/index.html'), 'utf8'), previousShell);

});

test('association generation rejects public junctions and production plaintext origins', async function(context){
    //Keeping the escape target inside an isolated fixture, never in user state
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-links-junction-'));
    context.after(async function(){
        //Removing only the owned fixture and its junction entry
        await rm(temporaryRoot, {recursive: true, force: true});

    });
    const projectRoot = path.join(temporaryRoot, 'project');
    const targetRoot = path.join(temporaryRoot, 'outside-public');
    await layerProjectCreate({targetDirectory: projectRoot, projectName: 'links-example'});
    await mkdir(targetRoot);
    await symlink(targetRoot, path.join(projectRoot, 'public/.well-known'), 'junction');
    const config = await layerConfigLoad(projectRoot);
    await assert.rejects(function(){
        //Rejecting development-only origin grants before production output
        return layerProjectBuild({rootDirectory: projectRoot, config: {...config, links: {
            external: {allowedOrigins: ['http://localhost:8080']}
        }}});

    }, function(errorData){
        //Checking that the PWA validator remains inside the CLI failure contract
        return /** @type {any} */ (errorData).code === 'CLI_CONFIG_INVALID';

    });
    const manifestFile = path.join(projectRoot, 'public/manifest.webmanifest');
    const originalManifest = await readFile(manifestFile, 'utf8');
    await writeFile(manifestFile, JSON.stringify({
        ...JSON.parse(originalManifest),
        scope_extensions: [{type: 'origin', origin: 'http://localhost:8080'}]
    }), 'utf8');
    await assert.rejects(function(){
        //Applying production TLS validation even to manifest-owned related origins
        return layerProjectBuild({rootDirectory: projectRoot, config});

    }, function(errorData){
        //Attaching the diagnostic to the manifest rather than an imaginary config property
        return /** @type {any} */ (errorData).code === 'CLI_BUILD_MANIFEST_INVALID';

    });
    await writeFile(manifestFile, originalManifest, 'utf8');
    await assert.rejects(function(){
        //Rejecting a generated destination whose parent was a public symlink
        return layerProjectBuild({rootDirectory: projectRoot, config: {...config, links: {associations: {
            apple: [{appId: 'ABCDE12345.ru.example.app'}]
        }}}});

    }, function(errorData){
        //Recognizing the explicit ownership conflict rather than a partial write
        return /** @type {any} */ (errorData).code === 'CLI_BUILD_ASSOCIATION_CONFLICT';

    });
    await assert.rejects(readFile(path.join(targetRoot, 'apple-app-site-association')), {code: 'ENOENT'});

});

test('dev serves extensionless association JSON through GET/HEAD and never applies SPA fallback', async function(context){
    //Preparing static documents without opening API, database or application services
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-links-http-'));
    await mkdir(path.join(temporaryRoot, '.well-known'));
    await writeFile(path.join(temporaryRoot, '.well-known/apple-app-site-association'), '{}', 'utf8');
    await writeFile(path.join(temporaryRoot, 'index.html'), '<h1>App</h1>', 'utf8');
    const handler = layerDevelopmentRequestHandlerCreate({outputDirectory: temporaryRoot});
    const server = createServer(function(request, response){
        //Propagating unexpected fixture failures rather than swallowing handler errors
        void handler(request, response).catch(function(errorData){
            //Propagating fixture failures to the HTTP transport
            response.destroy(errorData);

        });

    });
    await new Promise(function(resolve){
        //Reserving a free loopback port only for this fixture
        server.listen(0, '127.0.0.1', function(){
            //Completing listener startup
            resolve(undefined);

        });

    });
    context.after(async function(){
        //Releasing sockets before removing the test's directory
        await new Promise(function(resolve){
            //Waiting for all fixture sockets to close
            server.close(function(){
                //Completing listener shutdown
                resolve(undefined);

            });

        });
        await rm(temporaryRoot, {recursive: true, force: true});

    });
    const address = /** @type {import('node:net').AddressInfo} */ (server.address());
    const url = 'http://127.0.0.1:' + address.port + '/.well-known/apple-app-site-association';
    for (const method of ['GET', 'HEAD']) {
        //Checking real HTTP headers independently from whether a response body is requested
        const response = await fetch(url, {method, headers: {accept: 'text/html'}});
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'application/json');
        assert.equal(response.headers.get('cache-control'), 'no-cache');

    }
    assert.equal((await fetch('http://127.0.0.1:' + address.port + '/.well-known/windows-app-web-link', {headers: {accept: 'text/html'}})).status, 404);

});
