import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {
    mkdir,
    readFile,
    rm,
    writeFile
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client as PostgreSqlClient} from 'pg';
import {createClient as redisClientCreate} from 'redis';
import autocannon from 'autocannon';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, '..', '..');
const applicationDirectory = path.join(workspaceDirectory, 'apps', 'stable-test-messenger');
const artifactDirectory = path.join(workspaceDirectory, 'artifacts', 'stable-tests');
const proxyStateFile = path.join(artifactDirectory, 'fault-proxy.json');
const developmentLogFile = path.join(artifactDirectory, 'development.log');
const proxyControlOrigin = 'http://127.0.0.1:16400';
const applicationOrigin = 'http://127.0.0.1:5390';
const testDatabaseName = 'layer_stable_messenger';
const testRedisDatabase = 15;

/**
 * @param {number} durationMsData
 */
function delay(durationMsData) {
    return new Promise(function delayWait(resolve) {
        setTimeout(resolve, durationMsData);

    });

}

function systemCpuSnapshotRead() {
    let idleTimeData = 0;
    let totalTimeData = 0;

    for (const cpuData of os.cpus()) {
        idleTimeData += cpuData.times.idle;
        totalTimeData += Object.values(cpuData.times).reduce(
            (sumData, timeData) => sumData + timeData,
            0
        );

    }

    return Object.freeze({
        idle: idleTimeData,
        total: totalTimeData
    });

}

/**
 * @param {string} commandData
 * @param {readonly string[]} argumentItemsData
 * @param {object} [optionsData]
 * @param {string} [optionsData.cwd]
 * @param {Record<string, string | undefined>} [optionsData.environment]
 */
async function commandRun(commandData, argumentItemsData, optionsData = {}) {
    return new Promise(function commandCompleteWait(resolve, reject) {
        const childProcessData = spawn(commandData, argumentItemsData, {
            cwd: optionsData.cwd ?? workspaceDirectory,
            env: {
                ...process.env,
                ...optionsData.environment
            },
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });
        let standardOutputData = '';
        let standardErrorData = '';

        childProcessData.stdout.setEncoding('utf8');
        childProcessData.stderr.setEncoding('utf8');
        childProcessData.stdout.on('data', function commandOutputRead(chunkData) {
            standardOutputData += String(chunkData);

        });
        childProcessData.stderr.on('data', function commandErrorRead(chunkData) {
            standardErrorData += String(chunkData);

        });
        childProcessData.once('error', reject);
        childProcessData.once('exit', function commandExitHandle(exitCodeData) {
            if (exitCodeData !== 0) {
                reject(new Error(
                    commandData + ' failed with code ' + String(exitCodeData) + '.\n' +
                    standardOutputData + standardErrorData
                ));

                return;

            }

            resolve(Object.freeze({
                stdout: standardOutputData,
                stderr: standardErrorData
            }));

        });
    });

}

async function databaseReset() {
    const administrationClientData = new PostgreSqlClient({
        host: '127.0.0.1',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        connectionTimeoutMillis: 5000
    });

    await administrationClientData.connect();

    try {
        //Resetting only the dedicated disposable stable-test database.
        await administrationClientData.query(
            'DROP DATABASE IF EXISTS "' + testDatabaseName + '" WITH (FORCE)'
        );
        await administrationClientData.query(
            'CREATE DATABASE "' + testDatabaseName + '"'
        );

    } finally {
        await administrationClientData.end();

    }

}

async function databaseRemove() {
    const administrationClientData = new PostgreSqlClient({
        host: '127.0.0.1',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        connectionTimeoutMillis: 5000
    });

    await administrationClientData.connect();

    try {
        //Removing only the explicitly named disposable test database.
        await administrationClientData.query(
            'DROP DATABASE IF EXISTS "' + testDatabaseName + '" WITH (FORCE)'
        );

    } finally {
        await administrationClientData.end();

    }

}

async function redisDatabaseFlush() {
    const redisClientData = redisClientCreate({
        RESP: 2,
        socket: {
            host: '127.0.0.1',
            port: 6379,
            connectTimeout: 5000,
            reconnectStrategy: false
        },
        database: testRedisDatabase
    });

    redisClientData.on('error', function redisTestErrorIgnore() {
        //The awaited command below remains the authoritative failure result.

    });
    await redisClientData.connect();

    try {
        //Flushing only the reserved stable-test logical database.
        await redisClientData.flushDb();

    } finally {
        await redisClientData.quit();

    }

}

/**
 * @returns {Promise<{token: string, processId: number}>}
 */
async function proxyStateRead() {
    const sourceData = await readFile(proxyStateFile, 'utf8');
    const stateData = JSON.parse(sourceData);

    if (
        typeof stateData.token !== 'string' ||
        stateData.token.length < 32 ||
        Number.isInteger(stateData.processId) === false
    ) {
        throw new Error('The stable-test proxy state is invalid.');

    }

    return stateData;

}

/**
 * @param {{token: string}} stateData
 * @param {string} routeData
 * @param {'GET' | 'POST'} [methodData]
 */
async function proxyRequest(stateData, routeData, methodData = 'POST') {
    return fetch(proxyControlOrigin + routeData, {
        method: methodData,
        headers: {
            authorization: 'Bearer ' + stateData.token
        },
        signal: AbortSignal.timeout(5000)
    });

}

async function proxyEnsure() {
    const existingStateData = await proxyStateRead().catch(function proxyStateMissing() {
        return null;

    });

    if (existingStateData !== null) {
        const existingResponseData = await proxyRequest(
            existingStateData,
            '/status',
            'GET'
        ).catch(function existingProxyUnavailable() {
            return null;

        });

        if (existingResponseData?.ok === true) {
            await proxyRequest(existingStateData, '/postgres/up');
            await proxyRequest(existingStateData, '/redis/up');

            return existingStateData;

        }

    }

    const tokenData = randomBytes(32).toString('base64url');
    const proxyProcessData = spawn(
        process.execPath,
        [path.join(scriptDirectory, 'fault-proxy.js')],
        {
            cwd: workspaceDirectory,
            detached: true,
            env: {
                ...process.env,
                LAYER_STABLE_PROXY_CONTROL_TOKEN: tokenData
            },
            shell: false,
            stdio: 'ignore',
            windowsHide: true
        }
    );
    const stateData = Object.freeze({
        token: tokenData,
        processId: proxyProcessData.pid
    });

    proxyProcessData.unref();

    for (let attemptIndexData = 0; attemptIndexData < 50; attemptIndexData += 1) {
        const statusResponseData = await proxyRequest(
            stateData,
            '/status',
            'GET'
        ).catch(function proxyStarting() {
            return null;

        });

        if (statusResponseData?.ok === true) {
            await writeFile(proxyStateFile, JSON.stringify(stateData, null, 4) + '\n', 'utf8');

            return stateData;

        }

        await delay(100);

    }

    throw new Error('The stable-test fault proxy did not start.');

}

async function prepareExecute() {
    await mkdir(artifactDirectory, {
        recursive: true
    });
    await databaseReset();
    await redisDatabaseFlush();
    await proxyEnsure();
    const buildResultData = await commandRun(
        process.execPath,
        [path.join(workspaceDirectory, 'packages', 'cli', 'src', 'bin.js'), 'build'],
        {
            cwd: applicationDirectory
        }
    );
    const doctorResultData = await commandRun(
        process.execPath,
        [path.join(workspaceDirectory, 'packages', 'cli', 'src', 'bin.js'), 'doctor'],
        {
            cwd: applicationDirectory
        }
    );

    process.stdout.write(buildResultData.stdout);
    process.stdout.write(doctorResultData.stdout);
    process.stdout.write('Stable test infrastructure is prepared.\n');

}

/**
 * @param {string} operationData
 * @param {'query' | 'command' | 'sync'} typeData
 * @param {Record<string, unknown>} payloadData
 * @param {object} [optionsData]
 * @param {string} [optionsData.bearer]
 */
async function apiRequest(operationData, typeData, payloadData, optionsData = {}) {
    const headersData = /** @type {Record<string, string>} */ ({
        'content-type': 'application/json'
    });

    if (typeof optionsData.bearer === 'string') {
        headersData.authorization = 'Bearer ' + optionsData.bearer;

    }

    const responseData = await fetch(applicationOrigin + '/api', {
        method: 'POST',
        headers: headersData,
        body: JSON.stringify({
            protocol: 1,
            requestId: randomUUID(),
            type: typeData,
            operation: operationData,
            payload: payloadData,
            ...(typeData === 'sync' ? {cursor: null} : {})
        }),
        signal: AbortSignal.timeout(15000)
    });
    const responseBodyData = await responseData.json();

    return Object.freeze({
        status: responseData.status,
        body: responseBodyData
    });

}

/**
 * @param {string} originData
 * @param {string} requestPathData
 * @param {'GET' | 'POST'} methodData
 * @param {Record<string, unknown> | null} bodyData
 * @param {Record<string, string>} [headerData]
 */
async function localHttpsRequest(originData, requestPathData, methodData, bodyData, headerData = {}) {
    const requestBodyData = bodyData === null ? null : JSON.stringify(bodyData);

    return new Promise(function localHttpsCompleteWait(resolve, reject) {
        const requestData = https.request(originData + requestPathData, {
            method: methodData,
            rejectUnauthorized: false,
            headers: requestBodyData === null ? headerData : {
                ...headerData,
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(requestBodyData))
            },
            timeout: 5000
        }, function localHttpsResponseRead(responseData) {
            /** @type {Buffer[]} */
            const chunkItemsData = [];
            let totalSizeData = 0;

            responseData.on('data', function responseChunkRead(chunkData) {
                totalSizeData += chunkData.length;

                if (totalSizeData > 1024 * 1024) {
                    requestData.destroy(new Error('Local HTTPS response exceeded the test limit.'));

                    return;

                }

                chunkItemsData.push(chunkData);

            });
            responseData.once('end', function responseComplete() {
                const responseSourceData = Buffer.concat(chunkItemsData).toString('utf8');

                resolve(Object.freeze({
                    status: Number(responseData.statusCode ?? 0),
                    body: responseSourceData.length === 0 ? null : JSON.parse(responseSourceData)
                }));

            });

        });

        requestData.once('timeout', function requestTimeoutHandle() {
            requestData.destroy(new Error('Local HTTPS request timed out.'));

        });
        requestData.once('error', reject);

        if (requestBodyData !== null) {
            requestData.write(requestBodyData);

        }

        requestData.end();

    });

}

/**
 * @param {number} expectedStatusData
 * @param {number} [timeoutMsData]
 */
async function healthWait(expectedStatusData, timeoutMsData = 15000) {
    const deadlineData = Date.now() + timeoutMsData;
    const observedStatusItemsData = new Set();

    while (Date.now() < deadlineData) {
        const healthResponseData = await fetch(applicationOrigin + '/health/ready', {
            signal: AbortSignal.timeout(2000)
        }).catch(function healthUnavailable() {
            return null;

        });

        observedStatusItemsData.add(healthResponseData?.status ?? 'unavailable');

        if (healthResponseData?.status === expectedStatusData) {
            return;

        }

        await delay(200);

    }

    throw new Error(
        'Health status ' + String(expectedStatusData) +
        ' was not observed; received ' + [...observedStatusItemsData].join(', ') + '.'
    );

}

async function developmentServerStart(loadBypassStatusData = false) {
    const identityOneTokenData = randomBytes(32).toString('base64url');
    const identityTwoTokenData = randomBytes(32).toString('base64url');
    const childProcessData = spawn(
        process.execPath,
        [path.join(workspaceDirectory, 'packages', 'cli', 'src', 'bin.js'), 'dev'],
        {
            cwd: applicationDirectory,
            env: {
                ...process.env,
                LAYER_STABLE_IDENTITY_ONE_TOKEN: identityOneTokenData,
                LAYER_STABLE_IDENTITY_TWO_TOKEN: identityTwoTokenData,
                LAYER_STABLE_LOAD_BYPASS: loadBypassStatusData ? 'true' : 'false'
            },
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        }
    );
    let outputData = '';

    childProcessData.stdout.setEncoding('utf8');
    childProcessData.stderr.setEncoding('utf8');
    childProcessData.stdout.on('data', function developmentOutputRead(chunkData) {
        outputData += String(chunkData);

    });
    childProcessData.stderr.on('data', function developmentErrorRead(chunkData) {
        outputData += String(chunkData);

    });
    childProcessData.once('exit', function developmentExitRecord() {
        void writeFile(developmentLogFile, outputData, 'utf8');

    });
    await healthWait(200, 60000).catch(async function developmentStartupFailure(errorData) {
        childProcessData.kill('SIGTERM');
        await writeFile(developmentLogFile, outputData, 'utf8');
        throw errorData;

    });

    return Object.freeze({
        process: childProcessData,
        identityOneToken: identityOneTokenData,
        identityTwoToken: identityTwoTokenData,
        async close() {
            if (childProcessData.exitCode !== null) {
                return;

            }

            childProcessData.kill('SIGTERM');

            await Promise.race([
                new Promise(function developmentExitWait(resolve) {
                    childProcessData.once('exit', resolve);

                }),
                delay(10000)
            ]);

            if (childProcessData.exitCode === null) {
                childProcessData.kill('SIGKILL');

            }

            await writeFile(developmentLogFile, outputData, 'utf8');

        }
    });

}

/**
 * @param {object} profileData
 * @param {string} profileData.name
 * @param {string} [profileData.family]
 * @param {number} profileData.minimum
 * @param {number | 'auto'} profileData.maximum
 * @param {number} profileData.portOffset
 * @param {boolean} [profileData.loadBypass]
 */
async function deploymentServerStart(profileData) {
    const environmentData = {
        LAYER_STABLE_WORKERS_MINIMUM: String(profileData.minimum),
        LAYER_STABLE_WORKERS_MAXIMUM: String(profileData.maximum)
    };

    const buildExecuteData = function deploymentBuildExecute() {
        return commandRun(
            process.execPath,
            [path.join(workspaceDirectory, 'packages', 'cli', 'src', 'bin.js'), 'build'],
            {
                cwd: applicationDirectory,
                environment: environmentData
            }
        );

    };

    await buildExecuteData().catch(async function deploymentBuildRetry(errorData) {
        //Windows can release the previous atomic dist directory shortly after the launcher exits
        await delay(1000);
        await buildExecuteData().catch(function deploymentBuildRetryFail() {
            throw errorData;

        });

    });

    const distributionDirectoryData = path.join(applicationDirectory, 'dist');
    const identityOneTokenData = randomBytes(32).toString('base64url');
    const identityTwoTokenData = randomBytes(32).toString('base64url');
    const httpsPortData = 15443 + profileData.portOffset;
    let loadBypassEnvironmentData = 'false';

    //Enabling the bypass only for the explicitly marked localhost load profile
    if (profileData.loadBypass === true) {
        loadBypassEnvironmentData = 'true';

    }

    const childProcessData = spawn(
        process.execPath,
        [path.join(distributionDirectoryData, '_layer', 'deployment', 'run.mjs')],
        {
            cwd: distributionDirectoryData,
            env: {
                ...process.env,
                LAYER_DOMAIN: 'localhost',
                LAYER_HTTP_PORT: String(15080 + profileData.portOffset),
                LAYER_HTTPS_PORT: String(httpsPortData),
                LAYER_ORIGIN_PORT: String(15787 + profileData.portOffset * 10),
                LAYER_CADDY_ADMIN_PORT: String(16019 + profileData.portOffset),
                LAYER_STATE_DIRECTORY: path.join(artifactDirectory, 'deployment-state'),
                LAYER_STABLE_IDENTITY_ONE_TOKEN: identityOneTokenData,
                LAYER_STABLE_IDENTITY_TWO_TOKEN: identityTwoTokenData,
                LAYER_STABLE_LOAD_BYPASS: loadBypassEnvironmentData
            },
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        }
    );
    const originData = 'https://localhost:' + String(httpsPortData);
    let outputData = '';

    childProcessData.stdout.setEncoding('utf8');
    childProcessData.stderr.setEncoding('utf8');
    childProcessData.stdout.on('data', function deploymentOutputRead(chunkData) {
        outputData += String(chunkData);

    });
    childProcessData.stderr.on('data', function deploymentErrorRead(chunkData) {
        outputData += String(chunkData);

    });

    const deadlineData = Date.now() + 180000;
    let readyStatusData = false;

    while (Date.now() < deadlineData && childProcessData.exitCode === null) {
        const healthData = await localHttpsRequest(originData, '/health/ready', 'GET', null).catch(
            function deploymentHealthUnavailable() {
                return null;

            }
        );

        if (healthData?.status === 200) {
            readyStatusData = true;
            break;

        }

        await delay(500);

    }

    if (!readyStatusData) {
        childProcessData.kill('SIGTERM');
        await writeFile(
            path.join(artifactDirectory, 'deployment-' + profileData.name + '.log'),
            outputData,
            'utf8'
        );
        throw new Error('Production deployment did not become ready for ' + profileData.name + '.');

    }

    return Object.freeze({
        origin: originData,
        identityOneToken: identityOneTokenData,
        identityTwoToken: identityTwoTokenData,
        async close() {
            if (childProcessData.exitCode === null) {
                childProcessData.kill('SIGTERM');
                await Promise.race([
                    new Promise(function deploymentExitWait(resolve) {
                        childProcessData.once('exit', resolve);

                    }),
                    delay(15000)
                ]);

            }

            if (childProcessData.exitCode === null) {
                childProcessData.kill('SIGKILL');

            }

            await writeFile(
                path.join(artifactDirectory, 'deployment-' + profileData.name + '.log'),
                outputData,
                'utf8'
            );
            await delay(500);

        }
    });

}

/**
 * @param {Readonly<Record<string, any>>} deploymentData
 * @param {string} operationNameData
 * @param {Record<string, unknown>} payloadData
 */
async function deploymentOperationRequest(deploymentData, operationNameData, payloadData) {
    //Sending a trusted local request through Caddy to the managed worker pool
    return localHttpsRequest(
        deploymentData.origin,
        '/api',
        'POST',
        {
            protocol: 1,
            requestId: randomUUID(),
            type: 'query',
            operation: operationNameData,
            payload: payloadData
        },
        {authorization: 'Bearer ' + deploymentData.identityOneToken}
    );

}

/**
 * @param {Readonly<Record<string, any>>} deploymentData
 * @param {'query' | 'command'} requestTypeData
 * @param {string} operationNameData
 * @param {Record<string, unknown>} payloadData
 */
async function deploymentProtocolRequest(
    deploymentData,
    requestTypeData,
    operationNameData,
    payloadData
) {
    //Sending a typed protocol request through the generated HTTPS deployment
    return localHttpsRequest(
        deploymentData.origin,
        '/api',
        'POST',
        {
            protocol: 1,
            requestId: randomUUID(),
            type: requestTypeData,
            operation: operationNameData,
            payload: payloadData
        },
        {authorization: 'Bearer ' + deploymentData.identityOneToken}
    );

}

/**
 * @param {Readonly<Record<string, any>>} deploymentData
 * @param {number} requestCountData
 */
async function deploymentWorkersObserve(deploymentData, requestCountData) {
    //Creating simultaneous requests so the least-connection policy can expose every ready worker
    const responseItemsData = await Promise.all(Array.from(
        {length: requestCountData},
        function workerRequestCreate() {
            //Sending one observation request through the active Caddy topology
            return deploymentOperationRequest(deploymentData, 'test.runtime.worker', {});

        }
    ));
    const workerIdentifierItemsData = new Set();

    //Checking responses before recording the observed worker topology
    for (const responseData of responseItemsData) {
        assert.equal(responseData.status, 200);

        const responseBodyData = /** @type {Record<string, any>} */ (responseData.body);

        workerIdentifierItemsData.add(String(responseBodyData.data.workerId));

    }

    //CallBack THE OBJECT
    return workerIdentifierItemsData;

}

/**
 * @param {Readonly<Record<string, any>>} deploymentData
 */
async function automaticWorkerScaleVerify(deploymentData) {
    const pressureStartedAtData = Date.now();
    const pressureDeadlineData = pressureStartedAtData + Number(40000);
    const pressureWorkerIdentifierItemsData = new Set();
    let pressureRequestCountData = Number(0);
    let pressureRejectedCountData = Number(0);
    let scaleUpObservedAtData = /** @type {number | null} */ (null);

    //Running three bounded clients to keep both initial workers above the autoscale threshold
    await Promise.all(Array.from({length: 3}, async function pressureClientRun() {
        while (Date.now() < pressureDeadlineData) {
            const pressureResponseData = await deploymentOperationRequest(
                deploymentData,
                'test.runtime.pressure',
                {durationMs: 250}
            );

            pressureRequestCountData += Number(1);

            if (pressureResponseData.status === 200) {
                const pressureBodyData = /** @type {Record<string, any>} */ (pressureResponseData.body);

                pressureWorkerIdentifierItemsData.add(String(pressureBodyData.data.workerId));

                //Recording the first response from an automatically added worker
                if (
                    pressureWorkerIdentifierItemsData.size >= Number(3) &&
                    scaleUpObservedAtData === null
                ) {
                    scaleUpObservedAtData = Date.now();

                }

            } else {
                pressureRejectedCountData += Number(1);

            }

        }

    }));

    //Checking that the supervisor added at least one worker under sustained pressure
    assert.equal(
        pressureWorkerIdentifierItemsData.size >= Number(3),
        true,
        'Automatic workers did not scale above the configured minimum.'
    );
    assert.notEqual(scaleUpObservedAtData, null);

    const pressureDurationMsData = Date.now() - pressureStartedAtData;
    const scaleUpDurationMsData = Number(scaleUpObservedAtData) - pressureStartedAtData;
    const scaleDownStartedAtData = Date.now();
    const scaleDownDeadlineData = scaleDownStartedAtData + Number(165000);
    let quietWorkerIdentifierItemsData = new Set();

    //Waiting for the documented 120-second quiet window and supervisor drain
    while (Date.now() < scaleDownDeadlineData) {
        await delay(5000);

        quietWorkerIdentifierItemsData = await deploymentWorkersObserve(deploymentData, 12);

        if (quietWorkerIdentifierItemsData.size === Number(2)) {
            break;

        }

    }

    //Checking that automatic scale-down returned to the configured minimum
    assert.equal(
        quietWorkerIdentifierItemsData.size,
        Number(2),
        'Automatic workers did not return to the configured minimum.'
    );

    //CallBack THE OBJECT
    return Object.freeze({
        scaleUpDurationMs: scaleUpDurationMsData,
        pressureDurationMs: pressureDurationMsData,
        scaleDownDurationMs: Date.now() - scaleDownStartedAtData,
        pressureRequests: pressureRequestCountData,
        pressureRejected: pressureRejectedCountData,
        scaledWorkers: [...pressureWorkerIdentifierItemsData].sort(),
        quietWorkers: [...quietWorkerIdentifierItemsData].sort()
    });

}

/**
 * @param {Readonly<Record<string, any>>} deploymentData
 * @param {object} profileData
 * @param {string} profileData.name
 * @param {'read' | 'command'} profileData.family
 * @param {number} profileData.workerCount
 * @param {number} profileData.connections
 * @param {number} profileData.durationSeconds
 * @param {import('autocannon').Request[]} profileData.requests
 */
async function deploymentLoadProfileRun(deploymentData, profileData) {
    /** @type {Record<string, any>[]} */
    const metricSamplesData = [];
    let metricCollectionRunningStatusData = false;
    /** @type {Promise<void>} */
    let metricCollectionPromiseData = Promise.resolve();
    /** @type {unknown} */
    let metricCollectionFailureData = null;
    let overloadIntervalCountData = Number(0);
    let priorSystemCpuData = systemCpuSnapshotRead();
    /** @type {'cpu' | 'memory' | null} */
    let safetyStopReasonData = null;
    /** @type {import('autocannon').Instance} */
    let autocannonInstanceData;

    //Launching the HTTPS load through the generated production Caddy configuration
    const loadResultPromiseData = new Promise(function deploymentLoadCompleteWait(resolve, reject) {
        autocannonInstanceData = autocannon({
            url: deploymentData.origin,
            connections: profileData.connections,
            duration: profileData.durationSeconds,
            pipelining: 1,
            requests: profileData.requests,
            tlsOptions: {
                rejectUnauthorized: false
            }
        }, function deploymentLoadComplete(loadErrorData, loadResultData) {
            //Passing transport failures to the cluster-load boundary
            if (loadErrorData !== null) {
                reject(loadErrorData);

                return;

            }

            //CallBack THE OBJECT
            resolve(loadResultData);

        });

    });

    //Sampling every ready worker and the shared host while load is active
    const metricCollectionTimerData = setInterval(function deploymentMetricsSchedule() {
        if (metricCollectionRunningStatusData === true) {
            return;

        }

        metricCollectionRunningStatusData = true;

        metricCollectionPromiseData = Promise.all(Array.from(
            {length: profileData.workerCount},
            function deploymentMetricRequestCreate() {
                //Sending one metric request for each expected Caddy upstream
                return deploymentOperationRequest(deploymentData, 'test.runtime.worker', {});

            }
        )).then(function deploymentMetricsRecord(metricResponseItemsData) {
            const currentSystemCpuData = systemCpuSnapshotRead();
            const systemTotalDeltaData = currentSystemCpuData.total - priorSystemCpuData.total;
            const systemIdleDeltaData = currentSystemCpuData.idle - priorSystemCpuData.idle;
            let systemCpuPercentData = Number(0);

            //Calculating host CPU only when the operating system returned an interval
            if (systemTotalDeltaData > Number(0)) {
                systemCpuPercentData =
                    (Number(1) - systemIdleDeltaData / systemTotalDeltaData) * Number(100);

            }

            const systemMemoryPercentData =
                (Number(1) - os.freemem() / os.totalmem()) * Number(100);

            priorSystemCpuData = currentSystemCpuData;

            //Recording bounded process metrics from successful operation responses
            for (const metricResponseData of metricResponseItemsData) {
                if (metricResponseData.status !== Number(200)) {
                    continue;

                }

                const workerMetricData = /** @type {Record<string, any>} */ (
                    metricResponseData.body?.data ?? {}
                );

                metricSamplesData.push({
                    sampledAt: new Date().toISOString(),
                    workerId: String(workerMetricData.workerId),
                    rssBytes: Number(workerMetricData.rssBytes),
                    heapUsedBytes: Number(workerMetricData.heapUsedBytes),
                    eventLoopUtilization: Number(workerMetricData.eventLoopUtilization),
                    systemCpuPercent: systemCpuPercentData,
                    systemMemoryPercent: systemMemoryPercentData
                });

            }

            const overloadedStatusData = (
                systemCpuPercentData > Number(85) ||
                systemMemoryPercentData > Number(75)
            );

            //Counting consecutive unsafe host intervals before stopping the profile
            if (overloadedStatusData === true) {
                overloadIntervalCountData += Number(1);

            } else {
                overloadIntervalCountData = Number(0);

            }

            //Stopping load before the local workstation becomes unresponsive
            if (overloadIntervalCountData >= Number(3) && safetyStopReasonData === null) {
                //Recording the exact exhausted host resource
                if (systemCpuPercentData > Number(85)) {
                    safetyStopReasonData = 'cpu';

                } else {
                    safetyStopReasonData = 'memory';

                }

                autocannonInstanceData.stop();

            }

        }).catch(function deploymentMetricsFailureRecord(metricCollectionErrorData) {
            //Recording the failure so it is propagated after the load process settles
            metricCollectionFailureData = metricCollectionErrorData;

        }).finally(function deploymentMetricsComplete() {
            //Allowing the next scheduled sample or the terminal await to proceed
            metricCollectionRunningStatusData = false;

        });

    }, Number(1000));

    const loadResultData = /** @type {Record<string, any>} */ (
        await loadResultPromiseData
    );

    clearInterval(metricCollectionTimerData);

    //Waiting for the last bounded metric request before the deployment can stop
    await metricCollectionPromiseData;

    //Passing metric transport failures to the cluster-load gate
    if (metricCollectionFailureData !== null) {
        throw metricCollectionFailureData;

    }

    const statusCodeStatisticData = /** @type {Record<string, {count: number}>} */ (
        loadResultData.statusCodeStats ?? {}
    );
    /** @type {Record<string, number>} */
    const statusCodeData = {};

    //Flattening Autocannon statistics into serializable response counters
    for (const [statusCodeNameData, statusStatisticData] of Object.entries(
        statusCodeStatisticData
    )) {
        statusCodeData[statusCodeNameData] = Number(statusStatisticData.count);

    }

    const successfulRequestCountData = Number(statusCodeData['200'] ?? 0);
    const rejectedRequestCountData = Number(statusCodeData['429'] ?? 0);
    const serverErrorCountData = Object.entries(statusCodeData).reduce(
        function deploymentServerErrorCountCreate(totalData, statusEntryData) {
            const statusNumberData = Number(statusEntryData[0]);

            //Adding only unexpected HTTP 5xx responses
            if (statusNumberData >= Number(500) && statusNumberData < Number(600)) {
                return Number(totalData) + Number(statusEntryData[1]);

            }

            //CallBack THE NUMBER
            return Number(totalData);

        },
        Number(0)
    );
    const actualDurationSecondsData = Number(loadResultData.duration);
    let successfulRequestsPerSecondData = Number(0);

    //Calculating successful throughput only for a completed positive duration
    if (actualDurationSecondsData > Number(0)) {
        successfulRequestsPerSecondData =
            successfulRequestCountData / actualDurationSecondsData;

    }

    //Failing the gate on internal server responses instead of hiding them in throughput
    assert.equal(serverErrorCountData, Number(0));

    //CallBack THE OBJECT
    return {
        name: profileData.name,
        family: profileData.family,
        workerCount: profileData.workerCount,
        connections: profileData.connections,
        configuredDurationSeconds: profileData.durationSeconds,
        actualDurationSeconds: actualDurationSecondsData,
        requestsTotal: Number(loadResultData.requests.total),
        requestsPerSecond: Number(loadResultData.requests.average),
        successfulRequests: successfulRequestCountData,
        successfulRequestsPerSecond: successfulRequestsPerSecondData,
        rejectedRequests: rejectedRequestCountData,
        serverErrors: serverErrorCountData,
        latency: {
            p50: Number(loadResultData.latency.p50),
            p95: Number(loadResultData.latency.p97_5),
            p95Method: 'autocannon-p97_5-upper-bound',
            p99: Number(loadResultData.latency.p99)
        },
        errors: Number(loadResultData.errors),
        timeouts: Number(loadResultData.timeouts),
        non2xx: Number(loadResultData.non2xx),
        statusCodes: statusCodeData,
        safetyStopReason: safetyStopReasonData,
        observedWorkers: [...new Set(
            metricSamplesData.map(function metricWorkerIdentifierRead(metricSampleData) {
                //CallBack THE STRING
                return String(metricSampleData.workerId);

            })
        )].sort(),
        maximumSystemCpuPercent: metricSamplesData.reduce(
            function metricSystemCpuMaximumRead(maximumData, metricSampleData) {
                //CallBack THE NUMBER
                return Math.max(Number(maximumData), Number(metricSampleData.systemCpuPercent));

            },
            Number(0)
        ),
        maximumSystemMemoryPercent: metricSamplesData.reduce(
            function metricSystemMemoryMaximumRead(maximumData, metricSampleData) {
                //CallBack THE NUMBER
                return Math.max(Number(maximumData), Number(metricSampleData.systemMemoryPercent));

            },
            Number(0)
        ),
        metricSamples: metricSamplesData
    };

}

/**
 * @param {number} cursorData
 */
async function eventStreamOpen(cursorData) {
    const abortControllerData = new AbortController();
    const responseData = await fetch(applicationOrigin + '/api', {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            protocol: 1,
            requestId: randomUUID(),
            type: 'events.open',
            operation: 'events.open',
            payload: {
                channels: ['chat:general']
            },
            cursor: {
                'chat:general': cursorData
            }
        }),
        signal: abortControllerData.signal
    });

    assert.equal(responseData.status, 200);
    assert.equal(responseData.headers.get('content-type')?.startsWith('text/event-stream'), true);
    assert.ok(responseData.body !== null);

    const readerData = responseData.body.getReader();
    const decoderData = new TextDecoder();
    let bufferedData = '';
    let pendingReadData = readerData.read();

    return Object.freeze({
        async eventRead(timeoutMsData = 10000) {
            const deadlineData = Date.now() + timeoutMsData;

            while (Date.now() < deadlineData) {
                const readResultData = await Promise.race([
                    pendingReadData,
                    delay(Math.min(500, deadlineData - Date.now())).then(function readPending() {
                        return null;

                    })
                ]);

                if (readResultData === null) {
                    continue;

                }

                pendingReadData = readerData.read();

                if (readResultData.done) {
                    throw new Error('The event stream closed before an event arrived.');

                }

                bufferedData += decoderData.decode(readResultData.value, {
                    stream: true
                });
                const frameEndIndexData = bufferedData.indexOf('\n\n');

                if (frameEndIndexData < 0) {
                    continue;

                }

                const frameData = bufferedData.slice(0, frameEndIndexData);
                bufferedData = bufferedData.slice(frameEndIndexData + 2);
                const eventTypeData = /^event: (.+)$/m.exec(frameData)?.[1];
                const payloadSourceData = /^data: (.+)$/m.exec(frameData)?.[1];

                if (eventTypeData === 'layer.event' && payloadSourceData !== undefined) {
                    return JSON.parse(payloadSourceData);

                }

            }

            throw new Error('An event stream frame did not arrive in time.');

        },
        close() {
            void pendingReadData.catch(function pendingReadCancelIgnore() {
                //Reader cancellation below intentionally terminates the speculative next read

            });
            void readerData.cancel().catch(function streamCancelIgnore() {
                //The stream can already be closed by the server during local cleanup.

            });

        }
    });

}

/**
 * @param {Readonly<Record<string, any>>} deploymentData
 * @param {number} cursorData
 */
async function deploymentEventStreamOpen(deploymentData, cursorData) {
    const requestBodyData = JSON.stringify({
        protocol: 1,
        requestId: randomUUID(),
        type: 'events.open',
        operation: 'events.open',
        payload: {
            channels: ['chat:general']
        },
        cursor: {
            'chat:general': cursorData
        }
    });

    //Opening one persistent HTTPS stream through the production Caddy endpoint
    return new Promise(function deploymentEventStreamReadyWait(resolve, reject) {
        let responseReadyStatusData = false;
        /** @type {((streamErrorData: Error) => void) | null} */
        let streamFailureHandleData = null;
        const requestData = https.request(deploymentData.origin + '/api', {
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(requestBodyData))
            },
            timeout: 15000
        }, function deploymentEventStreamResponseRead(responseData) {
            const responseStatusData = Number(responseData.statusCode ?? 0);
            const responseContentTypeData = String(responseData.headers['content-type'] ?? '');

            //Rejecting bounded protocol failures before exposing a stream handle
            if (
                responseStatusData !== Number(200) ||
                responseContentTypeData.startsWith('text/event-stream') === false
            ) {
                responseData.resume();
                reject(new Error(
                    'Production event stream returned HTTP ' +
                    String(responseStatusData) + '.'
                ));

                return;

            }

            /** @type {Record<string, any>[]} */
            const queuedEventItemsData = [];
            /** @type {Array<{resolve: (eventData: Record<string, any>) => void, reject: (streamErrorData: Error) => void, timeout: NodeJS.Timeout}>} */
            const waitingReaderItemsData = [];
            /** @type {number[]} */
            const receivedSequenceItemsData = [];
            let bufferedSourceData = '';
            let closedStatusData = false;
            let terminalErrorData = new Error('The production event stream closed.');

            //Rejecting every pending reader after a transport or lifecycle failure
            streamFailureHandleData = function deploymentEventStreamFailureHandle(
                streamErrorData
            ) {
                //Ignoring repeated terminal notifications after the first failure
                if (closedStatusData === true) {
                    return;

                }

                closedStatusData = true;
                terminalErrorData = streamErrorData;

                for (const waitingReaderData of waitingReaderItemsData.splice(0)) {
                    clearTimeout(waitingReaderData.timeout);
                    waitingReaderData.reject(streamErrorData);

                }

            };

            //Recording one parsed event or satisfying the oldest pending reader
            /**
             * @param {Record<string, any>} eventData
             */
            const streamEventRecord = function deploymentStreamEventRecord(
                eventData
            ) {
                //Recording the sequence before handing the event to a reader
                receivedSequenceItemsData.push(Number(eventData.sequence));

                const waitingReaderData = waitingReaderItemsData.shift();

                if (waitingReaderData !== undefined) {
                    clearTimeout(waitingReaderData.timeout);
                    waitingReaderData.resolve(eventData);

                    return;

                }

                queuedEventItemsData.push(eventData);

            };

            //Parsing every complete SSE frame while preserving incomplete chunks
            const streamFramesProcess = function deploymentStreamFramesProcess() {
                let frameEndIndexData = bufferedSourceData.indexOf('\n\n');

                while (frameEndIndexData >= Number(0)) {
                    const frameSourceData = bufferedSourceData.slice(0, frameEndIndexData);

                    bufferedSourceData = bufferedSourceData.slice(frameEndIndexData + Number(2));

                    const eventTypeData = /^event: (.+)$/m.exec(frameSourceData)?.[1];
                    const payloadSourceData = /^data: (.+)$/m.exec(frameSourceData)?.[1];

                    //Recording only application events and ignoring heartbeat comments
                    if (eventTypeData === 'layer.event' && payloadSourceData !== undefined) {
                        try {
                            const eventData = /** @type {Record<string, any>} */ (
                                JSON.parse(payloadSourceData)
                            );

                            streamEventRecord(eventData);

                        } catch (eventParseErrorData) {
                            let streamErrorData = new Error(
                                'The production event frame is invalid.'
                            );

                            //Preserving the parser Error without exposing frame source data
                            if (eventParseErrorData instanceof Error) {
                                streamErrorData = eventParseErrorData;

                            }

                            streamFailureHandleData?.(streamErrorData);
                            responseData.destroy(streamErrorData);

                            return;

                        }

                    }

                    frameEndIndexData = bufferedSourceData.indexOf('\n\n');

                }

            };

            responseData.setEncoding('utf8');
            responseData.on('data', function deploymentEventStreamChunkRead(chunkData) {
                //Appending the decoded chunk before parsing complete frames
                bufferedSourceData += String(chunkData);
                streamFramesProcess();

            });
            responseData.once('end', function deploymentEventStreamEndHandle() {
                //Propagating an unexpected remote close to pending readers
                streamFailureHandleData?.(
                    new Error('The production event stream ended before explicit close.')
                );

            });
            responseData.once('error', function deploymentEventStreamErrorHandle(
                streamErrorData
            ) {
                //Propagating the transport failure to pending readers
                streamFailureHandleData?.(streamErrorData);

            });

            responseReadyStatusData = true;

            //CallBack THE OBJECT
            resolve(Object.freeze({
                eventRead(timeoutMsData = 20000) {
                    const queuedEventData = queuedEventItemsData.shift();

                    //Returning an event already received before the reader started
                    if (queuedEventData !== undefined) {
                        return Promise.resolve(queuedEventData);

                    }

                    //Passing an already terminal stream state to the caller
                    if (closedStatusData === true) {
                        return Promise.reject(terminalErrorData);

                    }

                    //Waiting for the next application event with a bounded deadline
                    return new Promise(function deploymentEventReadWait(
                        eventResolve,
                        eventReject
                    ) {
                        /** @type {{resolve: (eventData: Record<string, any>) => void, reject: (streamErrorData: Error) => void, timeout: NodeJS.Timeout}} */
                        const waitingReaderData = {
                            resolve: eventResolve,
                            reject: eventReject,
                            timeout: setTimeout(function deploymentEventReadTimeout() {
                                const waitingReaderIndexData = waitingReaderItemsData.indexOf(
                                    waitingReaderData
                                );

                                //Removing only the reader whose own deadline expired
                                if (waitingReaderIndexData >= Number(0)) {
                                    waitingReaderItemsData.splice(waitingReaderIndexData, Number(1));

                                }

                                eventReject(new Error(
                                    'A production event stream frame did not arrive in time.'
                                ));

                            }, timeoutMsData)
                        };

                        waitingReaderItemsData.push(waitingReaderData);

                    });

                },
                eventCountRead() {
                    //CallBack THE NUMBER
                    return Number(receivedSequenceItemsData.length);

                },
                sequenceItemsRead() {
                    //CallBack THE OBJECT
                    return [...receivedSequenceItemsData];

                },
                close() {
                    //Creating one bounded terminal reason for explicit local cleanup
                    const closeErrorData = new Error(
                        'The production event stream was closed by the test runner.'
                    );

                    streamFailureHandleData?.(closeErrorData);
                    responseData.destroy();
                    requestData.destroy();

                }
            }));

        });

        requestData.once('timeout', function deploymentEventStreamTimeoutHandle() {
            //Stopping a stream whose response headers were not received in time
            requestData.destroy(new Error('Production event stream opening timed out.'));

        });
        requestData.once('error', function deploymentEventStreamRequestErrorHandle(
            streamErrorData
        ) {
            //Rejecting setup failures or notifying an already exposed stream handle
            if (responseReadyStatusData === false) {
                reject(streamErrorData);

                return;

            }

            streamFailureHandleData?.(streamErrorData);

        });

        requestData.write(requestBodyData);
        requestData.end();

    });

}

/**
 * @param {Readonly<Record<string, any>>} deploymentData
 * @param {number} streamCountData
 * @param {number} cursorData
 */
async function deploymentEventStreamsOpen(
    deploymentData,
    streamCountData,
    cursorData
) {
    /** @type {Record<string, any>[]} */
    const streamItemsData = [];
    const openingStartedAtData = Date.now();
    const batchSizeData = Number(25);

    //Opening bounded batches to avoid a transient local socket burst
    for (
        let streamOffsetData = Number(0);
        streamOffsetData < streamCountData;
        streamOffsetData += batchSizeData
    ) {
        const currentBatchSizeData = Math.min(
            batchSizeData,
            streamCountData - streamOffsetData
        );
        const batchResultItemsData = await Promise.allSettled(Array.from(
            {length: currentBatchSizeData},
            function deploymentEventStreamCreate() {
                //Opening one stream from the current bounded batch
                return deploymentEventStreamOpen(deploymentData, cursorData);

            }
        ));
        let failedStreamCountData = Number(0);

        //Recording successful handles and counting bounded setup failures
        for (const batchResultData of batchResultItemsData) {
            if (batchResultData.status === 'fulfilled') {
                streamItemsData.push(batchResultData.value);

            } else {
                failedStreamCountData += Number(1);

            }

        }

        //Closing every opened stream before propagating an incomplete profile
        if (failedStreamCountData > Number(0)) {
            for (const streamData of streamItemsData) {
                streamData.close();

            }

            throw new Error(
                'Production SSE profile failed to open ' +
                String(failedStreamCountData) + ' streams.'
            );

        }

    }

    //CallBack THE OBJECT
    return Object.freeze({
        streams: streamItemsData,
        openingDurationMs: Date.now() - openingStartedAtData
    });

}

/**
 * @param {Readonly<Record<string, any>>} deploymentData
 * @param {number} streamCountData
 * @param {number} cursorData
 */
async function deploymentEventStreamProfileRun(
    deploymentData,
    streamCountData,
    cursorData
) {
    const streamOpenResultData = await deploymentEventStreamsOpen(
        deploymentData,
        streamCountData,
        cursorData
    );
    const streamItemsData = streamOpenResultData.streams;

    try {
        //Starting every reader before publishing the shared durable event
        const eventReadPromiseItemsData = streamItemsData.map(
            function deploymentEventReadStart(streamData) {
                //Waiting for the event distributed through the worker pool
                return streamData.eventRead(30000);

            }
        );
        const publishStartedAtData = Date.now();
        const commandResponseData = await deploymentProtocolRequest(
            deploymentData,
            'command',
            'chat.message.send',
            {
                commandId: 'cluster-sse-' + randomUUID(),
                baseRevision: cursorData,
                roomId: 'general',
                text: 'Production SSE profile ' + String(streamCountData)
            }
        );

        assert.equal(commandResponseData.status, Number(200));

        const commandBodyData = /** @type {Record<string, any>} */ (
            commandResponseData.body
        );
        const expectedSequenceData = Number(commandBodyData.data.sequence);
        const expectedEventIdentifierData = String(commandBodyData.data.eventId);
        const eventItemsData = await Promise.all(eventReadPromiseItemsData);
        const deliveryDurationMsData = Date.now() - publishStartedAtData;
        let sequenceGapCountData = Number(0);
        let eventIdentifierMismatchCountData = Number(0);

        //Checking every connection received the exact committed event
        for (const eventData of eventItemsData) {
            if (Number(eventData.sequence) !== expectedSequenceData) {
                sequenceGapCountData += Number(1);

            }

            if (String(eventData.eventId) !== expectedEventIdentifierData) {
                eventIdentifierMismatchCountData += Number(1);

            }

        }

        await delay(250);

        const duplicateEventCountData = streamItemsData.reduce(
            function deploymentDuplicateEventCountCreate(totalData, streamData) {
                const extraEventCountData = Math.max(
                    Number(0),
                    Number(streamData.eventCountRead()) - Number(1)
                );

                //CallBack THE NUMBER
                return Number(totalData) + extraEventCountData;

            },
            Number(0)
        );

        assert.equal(sequenceGapCountData, Number(0));
        assert.equal(eventIdentifierMismatchCountData, Number(0));
        assert.equal(duplicateEventCountData, Number(0));

        //Closing the live population before proving durable cursor replay
        for (const streamData of streamItemsData) {
            streamData.close();

        }

        const replayStartedAtData = Date.now();
        const replayStreamData = await deploymentEventStreamOpen(
            deploymentData,
            cursorData
        );

        try {
            const replayEventData = await replayStreamData.eventRead(15000);

            assert.equal(Number(replayEventData.sequence), expectedSequenceData);
            assert.equal(String(replayEventData.eventId), expectedEventIdentifierData);

        } finally {
            replayStreamData.close();

        }

        //CallBack THE OBJECT
        return {
            name: 'sse-' + String(streamCountData),
            requestedStreams: streamCountData,
            openedStreams: streamItemsData.length,
            openingDurationMs: streamOpenResultData.openingDurationMs,
            deliveryDurationMs: deliveryDurationMsData,
            replayDurationMs: Date.now() - replayStartedAtData,
            sequence: expectedSequenceData,
            sequenceGaps: sequenceGapCountData,
            eventIdentifierMismatches: eventIdentifierMismatchCountData,
            duplicates: duplicateEventCountData
        };

    } finally {
        //Closing remaining streams after success or any assertion failure
        for (const streamData of streamItemsData) {
            streamData.close();

        }

    }

}

async function integrationExecute() {
    const proxyStateData = await proxyStateRead();
    const proxyStatusData = await proxyRequest(proxyStateData, '/status', 'GET');

    if (!proxyStatusData.ok) {
        throw new Error('Run stable:test:prepare before the integration gate.');

    }

    process.stdout.write('Integration stage: server-start.\n');
    const developmentServerData = await developmentServerStart();

    try {
        process.stdout.write('Integration stage: initial-query.\n');
        const initialListData = await apiRequest(
            'chat.messages.list',
            'query',
            {roomId: 'general'}
        );

        assert.equal(initialListData.status, 200);
        assert.equal(initialListData.body.data.items.length, 0);
        assert.equal(initialListData.body.data.revision, 0);

        process.stdout.write('Integration stage: live-stream.\n');
        const liveStreamData = await eventStreamOpen(0);
        const commandIdentifierData = randomUUID();
        const sendPayloadData = {
            commandId: commandIdentifierData,
            baseRevision: 0,
            roomId: 'general',
            text: 'Первое stable-сообщение'
        };
        const sendResultData = await apiRequest('chat.message.send', 'command', sendPayloadData);

        assert.equal(sendResultData.status, 200);
        assert.equal(sendResultData.body.data.revision, 1);

        const liveEventData = await liveStreamData.eventRead();

        assert.equal(liveEventData.sequence, 1);
        assert.equal(liveEventData.type, 'chat.message.created');
        liveStreamData.close();

        process.stdout.write('Integration stage: idempotency.\n');
        const repeatedSendData = await apiRequest('chat.message.send', 'command', sendPayloadData);

        assert.equal(repeatedSendData.status, 200);
        assert.deepEqual(repeatedSendData.body.data, sendResultData.body.data);

        process.stdout.write('Integration stage: revision-conflict.\n');
        const messageIdentifierData = sendResultData.body.data.message.id;
        const editResultData = await apiRequest('chat.message.edit', 'command', {
            commandId: randomUUID(),
            baseRevision: 1,
            messageId: messageIdentifierData,
            text: 'Отредактированное stable-сообщение'
        });

        assert.equal(editResultData.status, 200);
        assert.equal(editResultData.body.data.message.revision, 2);

        const conflictResultData = await apiRequest('chat.message.edit', 'command', {
            commandId: randomUUID(),
            baseRevision: 1,
            messageId: messageIdentifierData,
            text: 'Устаревшая редакция'
        });

        assert.equal(conflictResultData.status, 409);
        assert.equal(conflictResultData.body.error.code, 'REVISION_CONFLICT');

        process.stdout.write('Integration stage: cursor-replay.\n');
        const replayStreamData = await eventStreamOpen(1);
        const replayEventData = await replayStreamData.eventRead();

        assert.equal(replayEventData.sequence, 2);
        assert.equal(replayEventData.type, 'chat.message.updated');
        replayStreamData.close();

        process.stdout.write('Integration stage: tenant-isolation.\n');
        const unauthenticatedIdentityData = await apiRequest(
            'test.identity.records.list',
            'query',
            {}
        );

        assert.equal(unauthenticatedIdentityData.status, 401);

        const identityCreateData = await apiRequest(
            'test.identity.record.create',
            'command',
            {commandId: randomUUID(), value: 'tenant-one-only'},
            {bearer: developmentServerData.identityOneToken}
        );
        const identityOneListData = await apiRequest(
            'test.identity.records.list',
            'query',
            {},
            {bearer: developmentServerData.identityOneToken}
        );
        const identityTwoListData = await apiRequest(
            'test.identity.records.list',
            'query',
            {},
            {bearer: developmentServerData.identityTwoToken}
        );

        assert.equal(identityCreateData.status, 200);
        assert.equal(identityOneListData.body.data.items.length, 1);
        assert.equal(identityOneListData.body.data.items[0].value, 'tenant-one-only');
        assert.equal(identityTwoListData.body.data.items.length, 0);

        process.stdout.write('Integration stage: redis-fallback.\n');
        await proxyRequest(proxyStateData, '/redis/down');

        const fallbackWorkerData = await apiRequest('test.runtime.worker', 'query', {});
        const fallbackListData = await apiRequest(
            'chat.messages.list',
            'query',
            {roomId: 'general'}
        );

        assert.equal(
            fallbackWorkerData.status,
            200,
            'Worker fallback response: ' + JSON.stringify(fallbackWorkerData.body)
        );
        assert.equal(
            fallbackListData.status,
            200,
            'Query fallback response: ' + JSON.stringify(fallbackListData.body)
        );
        assert.equal(fallbackListData.body.data.items.length, 1);

        process.stdout.write('Integration stage: redis-reconnect.\n');
        await proxyRequest(proxyStateData, '/redis/up');

        process.stdout.write('Integration stage: postgres-readiness.\n');
        const postgresDownResponseData = await proxyRequest(proxyStateData, '/postgres/down');
        const postgresDownStateData = await postgresDownResponseData.json();

        process.stdout.write(
            'PostgreSQL fault proxy closed ' +
            String(postgresDownStateData.connections) +
            ' active connection(s).\n'
        );
        await healthWait(503);
        await proxyRequest(proxyStateData, '/postgres/up');
        await healthWait(200, 20000);

        process.stdout.write('Integration stage: sync-snapshot.\n');
        const synchronizedStateData = await apiRequest(
            'chat.state.sync',
            'sync',
            {roomId: 'general'}
        );

        assert.equal(synchronizedStateData.status, 200);
        assert.equal(synchronizedStateData.body.data.messages.length, 1);
        assert.equal(synchronizedStateData.body.data.revision, 2);

        process.stdout.write('Stable integration gate passed.\n');

    } finally {
        await proxyRequest(proxyStateData, '/postgres/up').catch(function postgresRestoreIgnore() {
            //Cleanup reports infrastructure state separately.

        });
        await proxyRequest(proxyStateData, '/redis/up').catch(function redisRestoreIgnore() {
            //Cleanup reports infrastructure state separately.

        });
        await developmentServerData.close();

    }

}

/**
 * @param {'query' | 'command' | 'sync'} typeData
 * @param {string} operationData
 * @param {() => Record<string, unknown>} payloadCreateData
 * @param {string} [bearerData]
 * @returns {import('autocannon').Request}
 */
function loadRequestCreate(typeData, operationData, payloadCreateData, bearerData) {
    const headersData = {
        'content-type': 'application/json',
        ...(bearerData === undefined ? {} : {authorization: 'Bearer ' + bearerData})
    };

    return /** @type {import('autocannon').Request} */ ({
        method: 'POST',
        path: '/api',
        headers: headersData,
        setupRequest(/** @type {Record<string, any>} */ requestData) {
            requestData.body = JSON.stringify({
                protocol: 1,
                requestId: randomUUID(),
                type: typeData,
                operation: operationData,
                payload: payloadCreateData(),
                ...(typeData === 'sync' ? {cursor: null} : {})
            });

            return requestData;
        }
    });

}

/**
 * @param {object} profileData
 * @param {string} profileData.name
 * @param {number} profileData.connections
 * @param {number} profileData.durationSeconds
 * @param {import('autocannon').Request[]} profileData.requests
 */
async function loadProfileRun(profileData) {
    /** @type {Record<string, any>[]} */
    const metricSamplesData = [];
    let workerMetricsRunningStatusData = false;
    /** @type {{time: number, cpuMicros: number} | null} */
    let previousCpuData = null;
    let previousSystemCpuData = systemCpuSnapshotRead();
    let overloadIntervalCountData = 0;
    /** @type {'cpu' | 'memory' | 'error-rate' | 'latency' | null} */
    let safetyStopReasonData = null;
    /** @type {import('autocannon').Instance} */
    let autocannonInstanceData;

    const resultPromiseData = new Promise(function loadResultWait(resolve, reject) {
        autocannonInstanceData = autocannon({
            url: applicationOrigin,
            connections: profileData.connections,
            duration: profileData.durationSeconds,
            pipelining: 1,
            requests: profileData.requests
        }, function loadComplete(errorData, resultData) {
            if (errorData !== null) {
                reject(errorData);

                return;

            }

            resolve(resultData);
        });
    });
    const metricsTimerData = setInterval(function workerMetricsSchedule() {
        if (workerMetricsRunningStatusData) {
            return;

        }

        workerMetricsRunningStatusData = true;
        void apiRequest('test.runtime.worker', 'query', {}).then(function workerMetricsRecord(responseData) {
            if (responseData.status !== 200) {
                return;

            }

            const workerData = responseData.body.data;
            const sampleTimeData = Date.now();
            let cpuPercentData = 0;

            if (previousCpuData !== null) {
                const elapsedMicrosData = (sampleTimeData - previousCpuData.time) * 1000;
                const usedMicrosData =
                    workerData.cpuUserMicros +
                    workerData.cpuSystemMicros -
                    previousCpuData.cpuMicros;

                cpuPercentData = elapsedMicrosData > 0
                    ? usedMicrosData / elapsedMicrosData * 100
                    : 0;

            }

            previousCpuData = {
                time: sampleTimeData,
                cpuMicros: workerData.cpuUserMicros + workerData.cpuSystemMicros
            };

            const systemCpuData = systemCpuSnapshotRead();
            const systemTotalDeltaData = systemCpuData.total - previousSystemCpuData.total;
            const systemIdleDeltaData = systemCpuData.idle - previousSystemCpuData.idle;
            const systemCpuPercentData = systemTotalDeltaData > 0
                ? (1 - systemIdleDeltaData / systemTotalDeltaData) * 100
                : 0;
            const memoryPercentData = (1 - os.freemem() / os.totalmem()) * 100;
            const overloadStatusData = systemCpuPercentData > 85 || memoryPercentData > 75;

            previousSystemCpuData = systemCpuData;

            overloadIntervalCountData = overloadStatusData
                ? overloadIntervalCountData + 1
                : 0;
            metricSamplesData.push({
                ...workerData,
                sampledAt: new Date(sampleTimeData).toISOString(),
                workerCpuPercent: cpuPercentData,
                systemCpuPercent: systemCpuPercentData,
                systemMemoryPercent: memoryPercentData
            });

            if (overloadIntervalCountData >= 3 && safetyStopReasonData === null) {
                safetyStopReasonData = systemCpuPercentData > 85 ? 'cpu' : 'memory';
                autocannonInstanceData.stop();

            }
        }).finally(function workerMetricsComplete() {
            workerMetricsRunningStatusData = false;

        });
    }, 1000);

    const loadResultData = /** @type {any} */ (await resultPromiseData);

    clearInterval(metricsTimerData);

    const profileResultData = /** @type {Record<string, any>} */ ({
        name: profileData.name,
        connections: profileData.connections,
        configuredDurationSeconds: profileData.durationSeconds,
        actualDurationSeconds: loadResultData.duration,
        requestsPerSecond: loadResultData.requests.average,
        requestsTotal: loadResultData.requests.total,
        latency: {
            p50: loadResultData.latency.p50,
            p95: loadResultData.latency.p97_5,
            p95Method: 'autocannon-p97_5-upper-bound',
            p99: loadResultData.latency.p99
        },
        errors: loadResultData.errors,
        timeouts: loadResultData.timeouts,
        non2xx: loadResultData.non2xx,
        statusCodes: loadResultData.statusCodeStats,
        errorRatePercent: loadResultData.requests.total > 0
            ? (
                loadResultData.errors +
                loadResultData.timeouts +
                loadResultData.non2xx
            ) / loadResultData.requests.total * 100
            : 0,
        safetyStopReason: safetyStopReasonData,
        workers: [...new Set(metricSamplesData.map((sampleData) => sampleData.workerId))],
        metricSamples: metricSamplesData
    });
    const unexpectedServerErrorCountData = Object.entries(
        loadResultData.statusCodeStats ?? {}
    ).reduce(function serverErrorCount(sumData, statusEntryData) {
        const statusCodeData = Number(statusEntryData[0]);

        return statusCodeData >= 500 && statusCodeData < 600
            ? sumData + Number(statusEntryData[1])
            : sumData;

    }, 0);

    if (profileResultData.safetyStopReason === null) {
        if (profileResultData.errorRatePercent > 1) {
            profileResultData.safetyStopReason = 'error-rate';

        } else if (profileResultData.latency.p99 > 2500) {
            profileResultData.safetyStopReason = 'latency';

        }

    }

    if (unexpectedServerErrorCountData > 0) {
        throw new Error(
            'Load gate received ' + String(unexpectedServerErrorCountData) +
            ' unexpected 5xx responses for ' + profileData.name + '.'
        );

    }

    return Object.freeze(profileResultData);

}

/**
 * @param {readonly Record<string, unknown>[]} profileResultsData
 * @param {string} reportNameData
 */
async function loadReportWrite(profileResultsData, reportNameData) {
    const reportTimeData = new Date().toISOString();
    const reportBaseNameData = reportNameData + '-' + reportTimeData.replaceAll(':', '-');
    const jsonFileData = path.join(artifactDirectory, reportBaseNameData + '.json');
    const markdownFileData = path.join(artifactDirectory, reportBaseNameData + '.md');
    let markdownHeadingData = '# Layer-Engine stable load report';
    let markdownTableHeaderItemsData = [
        '| Profile | Connections | Requests/s | p50 | p95 | p99 | Errors | Timeouts |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
    ];
    let markdownRowsData = profileResultsData.map(function profileRowCreate(profileData) {
        const latencyData = /** @type {Record<string, unknown>} */ (profileData.latency ?? {});

        return '| ' + profileData.name + ' | ' +
            profileData.connections + ' | ' +
            String(profileData.requestsPerSecond ?? '—') + ' | ' +
            String(latencyData.p50 ?? '—') + ' | ' +
            String(latencyData.p95 ?? '—') + ' | ' +
            String(latencyData.p99 ?? profileData.deliveryLatencyMs ?? '—') + ' | ' +
            String(profileData.errors ?? '—') + ' | ' +
            String(profileData.timeouts ?? '—') + ' |';

    });

    //Creating a topology-specific table instead of presenting workers as HTTP load profiles
    if (reportNameData === 'workers') {
        markdownHeadingData = '# Layer-Engine stable worker report';
        markdownTableHeaderItemsData = [
            '| Profile | Configuration | Initial workers | Peak workers | Settled workers | Scale-up | Pressure duration | Scale-down | Pressure requests | Rejected |',
            '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |'
        ];
        markdownRowsData = profileResultsData.map(function workerProfileRowCreate(profileData) {
            const autoscaleData = /** @type {Record<string, any> | null} */ (
                profileData.autoscale ?? null
            );
            const initialWorkerItemsData = /** @type {readonly string[]} */ (
                profileData.observedWorkers ?? []
            );
            const peakWorkerItemsData = /** @type {readonly string[]} */ (
                autoscaleData?.scaledWorkers ?? initialWorkerItemsData
            );
            const settledWorkerItemsData = /** @type {readonly string[]} */ (
                autoscaleData?.quietWorkers ?? initialWorkerItemsData
            );
            let scaleUpDurationData = '—';
            let pressureDurationData = '—';
            let scaleDownDurationData = '—';

            //Formatting timing values only for the automatic worker profile
            if (autoscaleData !== null) {
                scaleUpDurationData =
                    (Number(autoscaleData.scaleUpDurationMs) / 1000).toFixed(2) + ' s';
                pressureDurationData =
                    (Number(autoscaleData.pressureDurationMs) / 1000).toFixed(2) + ' s';
                scaleDownDurationData =
                    (Number(autoscaleData.scaleDownDurationMs) / 1000).toFixed(2) + ' s';

            }

            return '| ' + profileData.name + ' | ' +
                String(profileData.configuredMinimum) + '/' +
                String(profileData.configuredMaximum) + ' | ' +
                initialWorkerItemsData.join(', ') + ' | ' +
                peakWorkerItemsData.join(', ') + ' | ' +
                settledWorkerItemsData.join(', ') + ' | ' +
                scaleUpDurationData + ' | ' +
                pressureDurationData + ' | ' +
                scaleDownDurationData + ' | ' +
                String(autoscaleData?.pressureRequests ?? '—') + ' | ' +
                String(autoscaleData?.pressureRejected ?? '—') + ' |';

        });

    }

    //Creating the production Caddy throughput comparison table
    if (reportNameData === 'cluster-load') {
        markdownHeadingData = '# Layer-Engine production Caddy cluster load report';
        markdownTableHeaderItemsData = [
            '| Profile | Workers | Connections | Successful req/s | Scale vs 1 | Efficiency | p50 | p95 | p99 | 429 | 5xx | Max CPU | Observed workers |',
            '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
        ];
        markdownRowsData = profileResultsData.map(function clusterProfileRowCreate(profileData) {
            const latencyData = /** @type {Record<string, unknown>} */ (
                profileData.latency ?? {}
            );
            const statusCodeData = /** @type {Record<string, number>} */ (
                profileData.statusCodes ?? {}
            );
            const observedWorkerItemsData = /** @type {readonly string[]} */ (
                profileData.observedWorkers ?? []
            );

            //CallBack THE STRING
            return '| ' + String(profileData.name) + ' | ' +
                String(profileData.workerCount) + ' | ' +
                String(profileData.connections) + ' | ' +
                Number(profileData.successfulRequestsPerSecond).toFixed(2) + ' | ' +
                Number(profileData.scaleFactor).toFixed(2) + 'x | ' +
                Number(profileData.scalingEfficiencyPercent).toFixed(1) + '% | ' +
                String(latencyData.p50 ?? '—') + ' | ' +
                String(latencyData.p95 ?? '—') + ' | ' +
                String(latencyData.p99 ?? '—') + ' | ' +
                String(statusCodeData['429'] ?? 0) + ' | ' +
                String(profileData.serverErrors ?? 0) + ' | ' +
                Number(profileData.maximumSystemCpuPercent).toFixed(1) + '% | ' +
                observedWorkerItemsData.join(', ') + ' |';

        });

    }

    //Creating a production POST SSE capacity and recovery table
    if (reportNameData === 'cluster-sse') {
        markdownHeadingData = '# Layer-Engine production Caddy SSE report';
        markdownTableHeaderItemsData = [
            '| Profile | Opened / requested | Open time | Delivery | Replay | Sequence | Gaps | Duplicates | Event mismatches |',
            '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
        ];
        markdownRowsData = profileResultsData.map(function clusterSseProfileRowCreate(
            profileData
        ) {
            //CallBack THE STRING
            return '| ' + String(profileData.name) + ' | ' +
                String(profileData.openedStreams) + ' / ' +
                String(profileData.requestedStreams) + ' | ' +
                String(profileData.openingDurationMs) + ' ms | ' +
                String(profileData.deliveryDurationMs) + ' ms | ' +
                String(profileData.replayDurationMs) + ' ms | ' +
                String(profileData.sequence) + ' | ' +
                String(profileData.sequenceGaps) + ' | ' +
                String(profileData.duplicates) + ' | ' +
                String(profileData.eventIdentifierMismatches) + ' |';

        });

    }

    const markdownData = [
        markdownHeadingData,
        '',
        '- Created: `' + reportTimeData + '`',
        '- Host CPUs: `' + String(os.availableParallelism()) + '`',
        '- Total memory: `' + String(os.totalmem()) + '` bytes',
        '',
        ...markdownTableHeaderItemsData,
        ...markdownRowsData,
        ''
    ].join('\n');

    await mkdir(artifactDirectory, {
        recursive: true
    });
    await writeFile(jsonFileData, JSON.stringify({
        createdAt: reportTimeData,
        availableParallelism: os.availableParallelism(),
        totalMemoryBytes: os.totalmem(),
        profiles: profileResultsData
    }, null, 4) + '\n', 'utf8');
    await writeFile(markdownFileData, markdownData, 'utf8');

    return Object.freeze({
        jsonFile: jsonFileData,
        markdownFile: markdownFileData
    });

}

/**
 * @param {number} connectionCountData
 */
async function eventStreamLoadRun(connectionCountData) {
    const messageStateData = await apiRequest('chat.messages.list', 'query', {
        roomId: 'general'
    });
    const currentRevisionData = Number(messageStateData.body.data.revision);
    const streamResultItemsData = await Promise.allSettled(Array.from(
        {length: connectionCountData},
        function streamCreate() {
            return eventStreamOpen(currentRevisionData);

        }
    ));
    const streamItemsData = streamResultItemsData
        .filter((streamResultData) => streamResultData.status === 'fulfilled')
        .map((streamResultData) => streamResultData.value);
    const connectionErrorCountData = connectionCountData - streamItemsData.length;
    const startedAtData = performance.now();

    if (streamItemsData.length === 0) {
        return Object.freeze({
            name: 'sse-' + String(connectionCountData),
            connections: 0,
            attemptedConnections: connectionCountData,
            connectionErrors: connectionErrorCountData,
            safetyStopReason: 'connection-error'
        });

    }

    try {
        const commandResponseData = await apiRequest('chat.message.send', 'command', {
            commandId: 'load-event-' + randomUUID(),
            baseRevision: currentRevisionData,
            roomId: 'general',
            text: 'Stable SSE load event'
        });

        assert.equal(commandResponseData.status, 200);

        const eventItemsData = await Promise.all(streamItemsData.map(function eventWait(streamData) {
            return streamData.eventRead(15000);

        }));
        const eventIdentifierItemsData = eventItemsData.map((eventData) => String(eventData.eventId));
        const expectedEventIdentifierData = String(commandResponseData.body.data.eventId);
        const expectedSequenceData = Number(commandResponseData.body.data.sequence);

        assert.equal(eventIdentifierItemsData.every(
            (eventIdentifierData) => eventIdentifierData === expectedEventIdentifierData
        ), true);
        assert.equal(eventItemsData.every(
            (eventData) => Number(eventData.sequence) === expectedSequenceData
        ), true);

        return Object.freeze({
            name: 'sse-' + String(connectionCountData),
            connections: streamItemsData.length,
            attemptedConnections: connectionCountData,
            connectionErrors: connectionErrorCountData,
            connectionErrorRatePercent: connectionErrorCountData / connectionCountData * 100,
            safetyStopReason: connectionErrorCountData / connectionCountData > 0.01
                ? 'connection-error'
                : null,
            deliveryLatencyMs: performance.now() - startedAtData,
            eventId: expectedEventIdentifierData,
            sequence: expectedSequenceData,
            deliveries: eventItemsData.length,
            duplicates: 0,
            cursorGaps: 0
        });

    } finally {
        for (const streamData of streamItemsData) {
            streamData.close();

        }

    }

}

/**
 * @param {boolean} soakStatusData
 */
async function loadExecute(soakStatusData) {
    const proxyStateData = await proxyStateRead();
    const proxyStatusData = await proxyRequest(proxyStateData, '/status', 'GET');

    if (!proxyStatusData.ok) {
        throw new Error('Run stable:test:prepare before the load gate.');

    }

    const quickProfileStatusData =
        process.argv.includes('--quick') ||
        process.env.LAYER_STABLE_LOAD_PROFILE === 'quick';
    const sseOnlyStatusData = process.argv.includes('--sse-only');
    const httpOnlyStatusData = process.argv.includes('--http-only');
    const developmentServerData = await developmentServerStart(true);
    const profileResultsData = [];
    const queryRequestData = loadRequestCreate('query', 'chat.messages.list', function queryPayloadCreate() {
        return {roomId: 'general'};

    });
    const commandRequestData = loadRequestCreate(
        'command',
        'test.identity.record.create',
        function commandPayloadCreate() {
            return {
                commandId: 'load-' + randomUUID(),
                value: 'Load record ' + randomUUID()
            };

        },
        developmentServerData.identityOneToken
    );
    const syncRequestData = loadRequestCreate('sync', 'chat.state.sync', function syncPayloadCreate() {
        return {roomId: 'general'};

    });

    try {
        const profileDefinitionsData = sseOnlyStatusData
            ? []
            : soakStatusData
                ? [{
                    name: 'soak',
                    family: 'soak',
                    connections: quickProfileStatusData ? 10 : 25,
                    durationSeconds: quickProfileStatusData ? 5 : 1800,
                    requests: [
                        ...Array(7).fill(queryRequestData),
                        ...Array(2).fill(commandRequestData),
                        syncRequestData
                    ]
                }]
                : quickProfileStatusData
                    ? [
                        {
                            name: 'smoke',
                            family: 'smoke',
                            connections: 5,
                            durationSeconds: 3,
                            requests: [queryRequestData]
                        },
                        {
                            name: 'mixed',
                            family: 'mixed',
                            connections: 5,
                            durationSeconds: 3,
                            requests: [
                                ...Array(7).fill(queryRequestData),
                                ...Array(2).fill(commandRequestData),
                                syncRequestData
                            ]
                        }
                    ]
                    : [
                        {
                            name: 'smoke',
                            family: 'smoke',
                            connections: 20,
                            durationSeconds: 60,
                            requests: [queryRequestData]
                        },
                        ...[25, 50, 100, 200].map((connectionCountData) => ({
                            name: 'reads-' + String(connectionCountData),
                            family: 'reads',
                            connections: connectionCountData,
                            durationSeconds: 60,
                            requests: [queryRequestData]
                        })),
                        ...[10, 25, 50, 100].map((connectionCountData) => ({
                            name: 'commands-' + String(connectionCountData),
                            family: 'commands',
                            connections: connectionCountData,
                            durationSeconds: 60,
                            requests: [commandRequestData]
                        })),
                        {
                            name: 'mixed',
                            family: 'mixed',
                            connections: 100,
                            durationSeconds: 60,
                            requests: [
                                ...Array(7).fill(queryRequestData),
                                ...Array(2).fill(commandRequestData),
                                syncRequestData
                            ]
                        }
                    ];

        const saturatedFamilyItemsData = new Set();

        for (const profileData of profileDefinitionsData) {
            if (saturatedFamilyItemsData.has(profileData.family)) {
                continue;

            }

            process.stdout.write('Load profile: ' + profileData.name + '.\n');
            const profileResultData = await loadProfileRun(profileData);

            profileResultsData.push(profileResultData);

            if (profileResultData.safetyStopReason !== null) {
                saturatedFamilyItemsData.add(profileData.family);
                process.stdout.write(
                    'Load family ' + profileData.family + ' reached ' +
                    profileResultData.safetyStopReason + ' saturation.\n'
                );

            }

        }

        if (!soakStatusData && !httpOnlyStatusData) {
            const sseConnectionItemsData = quickProfileStatusData ? [5] : [50, 200, 500];

            for (const connectionCountData of sseConnectionItemsData) {
                process.stdout.write('SSE profile: ' + String(connectionCountData) + '.\n');
                profileResultsData.push(await eventStreamLoadRun(connectionCountData));

            }

        }

        const reportData = await loadReportWrite(
            profileResultsData,
            soakStatusData ? 'soak' : 'load'
        );

        process.stdout.write(
            'Stable ' + (soakStatusData ? 'soak' : 'load') + ' gate passed.\n' +
            'JSON: ' + reportData.jsonFile + '\n' +
            'Markdown: ' + reportData.markdownFile + '\n'
        );

    } finally {
        await developmentServerData.close();

    }

}

async function multiWorkerExecute() {
    const proxyStateData = await proxyStateRead();
    const proxyStatusData = await proxyRequest(proxyStateData, '/status', 'GET');

    if (!proxyStatusData.ok) {
        throw new Error('Run stable:test:prepare before the worker gate.');

    }

    const completeProfileItemsData = [
        {name: 'fixed-1', minimum: 1, maximum: 1, portOffset: 1},
        {name: 'fixed-2', minimum: 2, maximum: 2, portOffset: 2},
        {name: 'fixed-4', minimum: 4, maximum: 4, portOffset: 3},
        {
            name: 'automatic-2',
            minimum: 2,
            maximum: /** @type {'auto'} */ ('auto'),
            portOffset: 4,
            loadBypass: true
        }
    ];
    let profileItemsData = completeProfileItemsData;

    //Selecting only the expensive automatic profile during focused regression retries
    if (process.argv.includes('--auto-only')) {
        profileItemsData = completeProfileItemsData.filter(function automaticProfileSelect(profileData) {
            //CallBack THE BOOLEAN
            return profileData.maximum === 'auto';

        });

    }
    const resultItemsData = [];

    for (const profileData of profileItemsData) {
        process.stdout.write('Worker profile: ' + profileData.name + '.\n');

        const deploymentData = await deploymentServerStart(profileData);
        /** @type {Set<string>} */
        let workerIdentifierItemsData;

        try {
            workerIdentifierItemsData = await deploymentWorkersObserve(
                deploymentData,
                Math.max(4, profileData.minimum * 4)
            );

            assert.equal(workerIdentifierItemsData.size, profileData.minimum);
            const profileResultData = /** @type {Record<string, unknown>} */ ({
                name: profileData.name,
                configuredMinimum: profileData.minimum,
                configuredMaximum: profileData.maximum,
                observedWorkers: [...workerIdentifierItemsData]
            });

            //Proving both scale directions only for the resource-aware automatic profile
            if (profileData.maximum === 'auto') {
                profileResultData.autoscale = await automaticWorkerScaleVerify(deploymentData);

            }

            resultItemsData.push(profileResultData);

        } finally {
            await deploymentData.close();

        }

    }

    const reportData = await loadReportWrite(resultItemsData, 'workers');

    process.stdout.write(
        'Stable multi-worker gate passed.\n' +
        'JSON: ' + reportData.jsonFile + '\n' +
        'Markdown: ' + reportData.markdownFile + '\n'
    );

}

async function clusterLoadExecute() {
    const proxyStateData = await proxyStateRead();
    const proxyStatusData = await proxyRequest(proxyStateData, '/status', 'GET');

    //Checking the isolated PostgreSQL and Redis fault proxy before starting deployments
    if (!proxyStatusData.ok) {
        throw new Error('Run stable:test:prepare before the cluster-load gate.');

    }

    const quickProfileStatusData =
        process.argv.includes('--quick') ||
        process.env.LAYER_STABLE_LOAD_PROFILE === 'quick';
    let profileDurationSecondsData = Number(20);

    //Using the short profile only for focused runner verification
    if (quickProfileStatusData === true) {
        profileDurationSecondsData = Number(3);

    }
    const workerCountItemsData = [1, 2, 4];
    /** @type {Record<string, any>[]} */
    const profileResultItemsData = [];

    //Running identical per-worker concurrency through fixed production topologies
    for (const workerCountData of workerCountItemsData) {
        const deploymentProfileData = {
            name: 'cluster-fixed-' + String(workerCountData),
            minimum: workerCountData,
            maximum: workerCountData,
            portOffset: Number(10) + workerCountData,
            loadBypass: true
        };
        const deploymentData = await deploymentServerStart(deploymentProfileData);

        try {
            const readRequestData = loadRequestCreate(
                'query',
                'chat.messages.list',
                function clusterReadPayloadCreate() {
                    //CallBack THE OBJECT
                    return {roomId: 'general'};

                }
            );
            const commandRequestData = loadRequestCreate(
                'command',
                'test.identity.record.create',
                function clusterCommandPayloadCreate() {
                    //CallBack THE OBJECT
                    return {
                        commandId: 'cluster-load-' + randomUUID(),
                        value: 'Cluster load record ' + randomUUID()
                    };

                },
                deploymentData.identityOneToken
            );
            const loadProfileItemsData = [
                {
                    name: 'read-' + String(workerCountData),
                    family: /** @type {const} */ ('read'),
                    workerCount: workerCountData,
                    connections: Number(16) * workerCountData,
                    durationSeconds: profileDurationSecondsData,
                    requests: [readRequestData]
                },
                {
                    name: 'command-' + String(workerCountData),
                    family: /** @type {const} */ ('command'),
                    workerCount: workerCountData,
                    connections: Number(4) * workerCountData,
                    durationSeconds: profileDurationSecondsData,
                    requests: [commandRequestData]
                }
            ];

            //Measuring cached reads and transactional commands on the same worker topology
            for (const loadProfileData of loadProfileItemsData) {
                process.stdout.write('Cluster load profile: ' + loadProfileData.name + '.\n');

                const loadProfileResultData = await deploymentLoadProfileRun(
                    deploymentData,
                    loadProfileData
                );

                profileResultItemsData.push(loadProfileResultData);

                //Stopping larger profiles after the local safety threshold is reached
                if (loadProfileResultData.safetyStopReason !== null) {
                    break;

                }

            }

        } finally {
            await deploymentData.close();

        }

        const unsafeProfileData = profileResultItemsData.find(
            function unsafeProfileFind(profileResultData) {
                //CallBack THE BOOLEAN
                return profileResultData.safetyStopReason !== null;

            }
        );

        //Stopping topology escalation after a recorded safety boundary
        if (unsafeProfileData !== undefined) {
            break;

        }

    }

    //Calculating scaling factors independently for reads and commands
    for (const familyNameData of ['read', 'command']) {
        const familyProfileItemsData = profileResultItemsData.filter(
            function familyProfileSelect(profileResultData) {
                //CallBack THE BOOLEAN
                return profileResultData.family === familyNameData;

            }
        );
        const baselineProfileData = familyProfileItemsData.find(
            function baselineProfileFind(profileResultData) {
                //CallBack THE BOOLEAN
                return Number(profileResultData.workerCount) === Number(1);

            }
        );

        if (baselineProfileData === undefined) {
            continue;

        }

        //Recording relative capacity and per-worker scaling efficiency
        for (const familyProfileData of familyProfileItemsData) {
            const scaleFactorData =
                Number(familyProfileData.successfulRequestsPerSecond) /
                Number(baselineProfileData.successfulRequestsPerSecond);

            familyProfileData.scaleFactor = scaleFactorData;
            familyProfileData.scalingEfficiencyPercent =
                scaleFactorData / Number(familyProfileData.workerCount) * Number(100);

        }

    }

    const reportData = await loadReportWrite(profileResultItemsData, 'cluster-load');

    process.stdout.write(
        'Stable production Caddy cluster-load gate passed.\n' +
        'JSON: ' + reportData.jsonFile + '\n' +
        'Markdown: ' + reportData.markdownFile + '\n'
    );

}

async function clusterSseExecute() {
    const proxyStateData = await proxyStateRead();
    const proxyStatusData = await proxyRequest(proxyStateData, '/status', 'GET');

    //Checking the isolated infrastructure before opening persistent connections
    if (!proxyStatusData.ok) {
        throw new Error('Run stable:test:prepare before the cluster-sse gate.');

    }

    const quickProfileStatusData = process.argv.includes('--quick');
    let streamCountItemsData = [50, 200, 500];

    //Using a single small population only for focused transport verification
    if (quickProfileStatusData === true) {
        streamCountItemsData = [20];

    }

    const deploymentData = await deploymentServerStart({
        name: 'cluster-sse-fixed-4',
        minimum: 4,
        maximum: 4,
        portOffset: 16,
        loadBypass: true
    });
    /** @type {Record<string, any>[]} */
    const profileResultItemsData = [];

    try {
        const initialMessagesResponseData = await deploymentProtocolRequest(
            deploymentData,
            'query',
            'chat.messages.list',
            {roomId: 'general'}
        );

        assert.equal(initialMessagesResponseData.status, Number(200));

        const initialMessagesBodyData = /** @type {Record<string, any>} */ (
            initialMessagesResponseData.body
        );
        let currentCursorData = Number(initialMessagesBodyData.data.revision);

        //Growing the persistent stream population on one fixed production topology
        for (const streamCountData of streamCountItemsData) {
            process.stdout.write(
                'Cluster SSE profile: ' + String(streamCountData) + ' streams.\n'
            );

            const profileResultData = await deploymentEventStreamProfileRun(
                deploymentData,
                streamCountData,
                currentCursorData
            );

            profileResultItemsData.push(profileResultData);
            currentCursorData = Number(profileResultData.sequence);

        }

    } finally {
        await deploymentData.close();

    }

    const reportData = await loadReportWrite(profileResultItemsData, 'cluster-sse');

    process.stdout.write(
        'Stable production Caddy SSE gate passed.\n' +
        'JSON: ' + reportData.jsonFile + '\n' +
        'Markdown: ' + reportData.markdownFile + '\n'
    );

}

async function cleanupExecute() {
    const stateData = await proxyStateRead().catch(function proxyStateMissing() {
        return null;

    });

    if (stateData !== null) {
        await proxyRequest(stateData, '/shutdown').catch(function proxyAlreadyStopped() {
            //A stale local state file is safe to remove below.

        });
        await delay(300);

    }

    await rm(proxyStateFile, {
        force: true
    });
    await redisDatabaseFlush();
    await databaseRemove();
    process.stdout.write('Stable test resources were removed.\n');

}

async function main() {
    const actionNameData = process.argv[2];

    if (actionNameData === 'prepare') {
        await prepareExecute();

    } else if (actionNameData === 'integration') {
        await integrationExecute();

    } else if (actionNameData === 'cleanup') {
        await cleanupExecute();

    } else if (actionNameData === 'load') {
        await loadExecute(false);

    } else if (actionNameData === 'soak') {
        await loadExecute(true);

    } else if (actionNameData === 'workers') {
        await multiWorkerExecute();

    } else if (actionNameData === 'cluster-load') {
        await clusterLoadExecute();

    } else if (actionNameData === 'cluster-sse') {
        await clusterSseExecute();

    } else {
        throw new Error(
            'Expected prepare, integration, load, soak, workers, cluster-load, cluster-sse, or cleanup.'
        );

    }
}

await main().catch(function stableTestFailureHandle(errorData) {
    const errorMessageData = errorData instanceof Error
        ? errorData.name + ': ' + errorData.message
        : 'Unknown stable-test failure.';

    process.stderr.write('Stable test failed: ' + errorMessageData + '\n');
    process.exitCode = 1;
});
