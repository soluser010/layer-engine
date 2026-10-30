import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    deploymentArchiveEntryAllowed,
    deploymentCaddyAssetGet,
    deploymentCaddyArchiveVerify,
    deploymentDownloadCreate,
    deploymentDomainGet,
    deploymentIntegrityCheck,
    deploymentPortGet,
    deploymentWorkerMetricContractGet,
    deploymentWorkerEndpointsCreate,
    deploymentWorkerMaximumResolve,
    deploymentWorkerReplacementEndpointGet
} from '../src/deployment-runner.js';

const deploymentFixtureCreate = function(){
    //CallBack THE OBJECT
    return {
        appName: 'deployment-fixture',
        appVersion: '0.1.0',
        domain: null,
        originPort: 8787,
        serverEntry: false,
        caddy: {
            version: '2.11.4',
            assets: {
                'linux-x64': {archive: 'tar.gz', url: 'linux-amd64', sha512: 'linux-amd64-sha'},
                'linux-arm64': {archive: 'tar.gz', url: 'linux-arm64', sha512: 'linux-arm64-sha'},
                'win32-x64': {archive: 'zip', url: 'windows-amd64', sha512: 'windows-amd64-sha'},
                'win32-arm64': {archive: 'zip', url: 'windows-arm64', sha512: 'windows-arm64-sha'}
            }
        }
    };

};

test('deployment selects only supported pinned platform assets', () => {
    const deploymentData = deploymentFixtureCreate();

    assert.equal(deploymentCaddyAssetGet(deploymentData, 'linux', 'x64').url, 'linux-amd64');
    assert.equal(deploymentCaddyAssetGet(deploymentData, 'linux', 'arm64').url, 'linux-arm64');
    assert.equal(deploymentCaddyAssetGet(deploymentData, 'win32', 'x64').url, 'windows-amd64');
    assert.equal(deploymentCaddyAssetGet(deploymentData, 'win32', 'arm64').url, 'windows-arm64');
    assert.throws(
        () => deploymentCaddyAssetGet(deploymentData, 'darwin', 'arm64'),
        (errorData) => /** @type {any} */ (errorData).code === 'DEPLOY_PLATFORM_UNSUPPORTED'
    );
});

test('deployment validates runtime domain and listener ports', () => {
    const deploymentData = deploymentFixtureCreate();

    assert.equal(deploymentDomainGet(deploymentData, {LAYER_DOMAIN: 'app.example.com'}), 'app.example.com');
    assert.equal(deploymentDomainGet({...deploymentData, domain: 'localhost'}, {}), 'localhost');
    assert.equal(deploymentPortGet({}, 'LAYER_HTTP_PORT', 80), 80);
    assert.equal(deploymentPortGet({LAYER_HTTPS_PORT: '8443'}, 'LAYER_HTTPS_PORT', 443), 8443);
    assert.throws(
        () => deploymentDomainGet(deploymentData, {LAYER_DOMAIN: 'https://example.com'}),
        (errorData) => /** @type {any} */ (errorData).code === 'DEPLOY_DOMAIN_REQUIRED'
    );
    assert.throws(
        () => deploymentPortGet({LAYER_HTTP_PORT: '0'}, 'LAYER_HTTP_PORT', 80),
        (errorData) => /** @type {any} */ (errorData).code === 'DEPLOY_PORT_INVALID'
    );
    assert.throws(
        () => deploymentPortGet({LAYER_HTTP_PORT: '080'}, 'LAYER_HTTP_PORT', 80),
        (errorData) => /** @type {any} */ (errorData).code === 'DEPLOY_PORT_INVALID'
    );
});

test('deployment allocates bounded loopback worker endpoints', function(){
    const workerEndpointsData = deploymentWorkerEndpointsCreate( 8787, 4 );

    assert.deepEqual( workerEndpointsData, [
        {id: 'worker-1', host: '127.0.0.1', port: 8787},
        {id: 'worker-2', host: '127.0.0.1', port: 8788},
        {id: 'worker-3', host: '127.0.0.1', port: 8789},
        {id: 'worker-4', host: '127.0.0.1', port: 8790}
    ] );
    assert.throws(
        function workerPortOverflow(){
            deploymentWorkerEndpointsCreate( 65535, 2 );

        },
        function workerPortFailureCheck( errorData ){
            return /** @type {any} */ (errorData).code === 'DEPLOY_WORKER_PORT_INVALID';

        }
    );

});

test('deployment resolves fixed and resource-aware worker ceilings', function(){
    assert.equal( deploymentWorkerMaximumResolve({
        minimum: 2,
        maximum: 4
    }), 4 );
    assert.equal( deploymentWorkerMaximumResolve({
        minimum: 2,
        maximum: 'auto',
        maximumConnectionsPerWorker: 5,
        connectionBudget: 40
    }, {
        availableParallelism: 32,
        totalMemory: Number( 64 * 1024 * 1024 * 1024 )
    }), 8 );
    assert.equal( deploymentWorkerMaximumResolve({
        minimum: 2,
        maximum: 'auto',
        maximumConnectionsPerWorker: 5,
        connectionBudget: 100
    }, {
        availableParallelism: 4,
        totalMemory: Number( 64 * 1024 * 1024 * 1024 )
    }), 3 );
    assert.throws(
        function automaticBudgetMissing(){
            deploymentWorkerMaximumResolve({
                minimum: 1,
                maximum: 'auto'
            });

        },
        function automaticBudgetFailureCheck( errorData ){
            return /** @type {any} */ (errorData).code === 'DEPLOY_WORKER_BUDGET_INVALID';

        }
    );

});

test('deployment selects the first missing endpoint for worker recovery', function(){
    const requiredEndpointsData = deploymentWorkerEndpointsCreate( 8787, 4 );

    assert.equal(
        deploymentWorkerReplacementEndpointGet(
            requiredEndpointsData,
            requiredEndpointsData.filter(function activeEndpointSelect( endpointData ){
                return endpointData.id === 'worker-1' || endpointData.id === 'worker-3';

            })
        )?.id,
        'worker-2'
    );
    assert.equal(
        deploymentWorkerReplacementEndpointGet( requiredEndpointsData, requiredEndpointsData ),
        null
    );

});

test('deployment worker metrics can observe the quiet autoscale threshold', function(){
    //Getting the exact contract used by both worker metrics and the supervisor
    const workerMetricContractData = deploymentWorkerMetricContractGet();

    //Checking that an idle sample can remain below the quiet delay threshold
    assert.equal(
        workerMetricContractData.resolutionMs < workerMetricContractData.quietDelayMs,
        true
    );
    assert.equal( workerMetricContractData.intervalMs * workerMetricContractData.scaleDownIntervals, 120000 );
    assert.equal( workerMetricContractData.scaleDownCooldownMs, 120000 );

});

test('deployment rejects unsafe archive paths and checksum mismatch', () => {
    const archiveBuffer = Buffer.from('verified-caddy-archive');
    const archiveDigest = createHash('sha512').update(archiveBuffer).digest('hex');

    assert.equal(deploymentArchiveEntryAllowed('caddy', 'caddy'), true);
    assert.equal(deploymentArchiveEntryAllowed('caddy.exe', 'caddy.exe'), true);
    assert.equal(deploymentArchiveEntryAllowed('../caddy', 'caddy'), false);
    assert.equal(deploymentArchiveEntryAllowed('/caddy', 'caddy'), false);
    deploymentCaddyArchiveVerify(archiveBuffer, archiveDigest);
    assert.throws(
        () => deploymentCaddyArchiveVerify(archiveBuffer, '0'.repeat(128)),
        (errorData) => /** @type {any} */ (errorData).code === 'DEPLOY_CADDY_INTEGRITY_FAILED'
    );
});

test('deployment download rejects forbidden redirects, oversized bodies, and interrupted streams', async (testContext) => {
    const downloadRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-deployment-download-'));
    const downloadFile = path.join(downloadRoot, 'caddy.archive');

    testContext.after(async () => rm(downloadRoot, {recursive: true, force: true}));
    await assert.rejects(
        () => deploymentDownloadCreate('https://github.com/release', downloadFile, {
            fetchImplementation: async () => new Response(null, {
                status: 302,
                headers: {location: 'https://attacker.example/caddy'}
            })
        }),
        (errorData) => /** @type {any} */ (errorData).code === 'DEPLOY_CADDY_DOWNLOAD_DENIED'
    );
    await assert.rejects(
        () => deploymentDownloadCreate('https://github.com/release', downloadFile, {
            maximumBytes: 4,
            fetchImplementation: async () => new Response(new Uint8Array([1, 2, 3, 4, 5]))
        }),
        (errorData) => /** @type {any} */ (errorData).code === 'DEPLOY_CADDY_DOWNLOAD_OVERSIZED'
    );
    await assert.rejects(
        () => deploymentDownloadCreate('https://github.com/release', downloadFile, {
            fetchImplementation: async () => new Response(new ReadableStream({
                start(streamController) {
                    //Failing after headers to simulate an interrupted release download
                    streamController.error(new Error('interrupted'));
                }
            }))
        }),
        (errorData) => /** @type {any} */ (errorData).code === 'DEPLOY_CADDY_DOWNLOAD_FAILED'
    );
});

test('deployment integrity accepts exact files and rejects tampering or traversal', async (testContext) => {
    const bundleRoot = await mkdtemp(path.join(os.tmpdir(), 'layer-deployment-integrity-'));
    const layerDirectory = path.join(bundleRoot, '_layer');
    const artifactPath = path.join(bundleRoot, 'package.json');
    const artifactSource = '{"private":true}\n';

    testContext.after(async () => rm(bundleRoot, {recursive: true, force: true}));
    await mkdir(layerDirectory, {recursive: true});
    await writeFile(artifactPath, artifactSource, 'utf8');
    await writeFile(path.join(layerDirectory, 'build.json'), JSON.stringify({
        integrity: {
            'package.json': 'sha256-' + createHash('sha256').update(artifactSource).digest('hex')
        }
    }), 'utf8');

    await deploymentIntegrityCheck(bundleRoot);
    await writeFile(artifactPath, await readFile(artifactPath, 'utf8') + 'changed', 'utf8');
    await assert.rejects(
        () => deploymentIntegrityCheck(bundleRoot),
        (errorData) => /** @type {any} */ (errorData).code === 'DEPLOY_INTEGRITY_FAILED'
    );
    await writeFile(path.join(layerDirectory, 'build.json'), JSON.stringify({
        integrity: {
            '../outside': 'sha256-invalid'
        }
    }), 'utf8');
    await assert.rejects(
        () => deploymentIntegrityCheck(bundleRoot),
        (errorData) => /** @type {any} */ (errorData).code === 'DEPLOY_INTEGRITY_INVALID'
    );
});
