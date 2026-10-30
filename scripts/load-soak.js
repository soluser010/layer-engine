import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';
import {layerEventStreamManagerCreate} from '@solcorp/layer-events';
import {layerSessionSecurityCreate} from '@solcorp/layer-security';
import {
    layerDiagnosticsCreate,
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate,
    layerOperationRegistryCreate
} from '@solcorp/layer-server';

const requestCount = Number.parseInt(process.env.LAYER_LOAD_REQUESTS ?? '400', 10);
const concurrency = Number.parseInt(process.env.LAYER_LOAD_CONCURRENCY ?? '20', 10);
const streamCount = Number.parseInt(process.env.LAYER_SOAK_STREAMS ?? '12', 10);
const maximumP95Ms = Number.parseInt(process.env.LAYER_LOAD_P95_MS ?? '1500', 10);
const maximumHeapGrowthBytes = Number.parseInt(process.env.LAYER_LOAD_HEAP_BYTES ?? String(64 * 1024 * 1024), 10);

/**
 * Minimal writable response used to exercise long-lived stream lifecycle.
 */
class SoakResponse extends EventEmitter {
    constructor() {
        //Initializing only the observable stream state used by the soak run.
        super();
        this.destroyed = false;
        this.frameCount = 0;

    }

    writeHead() {
        //Accepting the stream headers before frame delivery begins.

    }

    flushHeaders() {
        //Matching the native response contract without buffering headers.

    }

    /**
     * @param {string} frameData
     */
    write(frameData) {
        //Counting complete frames while keeping backpressure available.
        if (frameData.length > 0) {
            this.frameCount += 1;

        }

        return true;

    }

    end() {
        if (this.destroyed) {
            return;

        }

        //Closing the held request exactly once for manager cleanup.
        this.destroyed = true;
        this.emit('close');

    }

    destroy() {
        //Using the same close boundary for failed and graceful responses.
        this.end();

    }
}

function configurationAssert() {
    //Checking load bounds before allocating workers or sockets.
    for (const configurationValue of [requestCount, concurrency, streamCount, maximumP95Ms, maximumHeapGrowthBytes]) {
        if (!Number.isSafeInteger(configurationValue) || configurationValue < 1) {
            throw new TypeError('Load-test configuration is invalid.');

        }

    }

}

function runtimeCreate() {
    const operationRegistry = layerOperationRegistryCreate();
    const diagnostics = layerDiagnosticsCreate();

    operationRegistry.define({
        name: 'load.status.read',
        type: 'query',
        auth: 'none',
        audit: {enabled: false},
        inputSchema: {
            type: 'object',
            additionalProperties: false
        },
        outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: {
                status: {const: 'ok'}
            }
        },
        async handler() {
            //Returning the smallest validated response for transport measurement.
            return {status: 'ok'};

        }
    });

    const security = layerSessionSecurityCreate({
        allowedOrigins: ['https://app.example.com'],
        async sessionResolve() {
            //Keeping authenticated state unavailable for this public load operation.
            return null;

        }
    });
    const operationExecutor = layerOperationExecutorCreate({
        operationRegistry,
        security,
        rateLimiter: {
            consume() {
                //Removing limiter noise while retaining the executor boundary.
                return {allowed: true, remaining: 1000000, retryAfterMs: 0};

            }
        },
        diagnostics
    });

    return layerHttpRuntimeCreate({
        operationRegistry,
        operationExecutor,
        diagnostics
    });

}

/**
 * @param {string} runtimeUrl
 */
async function httpLoadRun(runtimeUrl) {
    const durations = /** @type {number[]} */ ([]);
    let nextRequestIndex = 0;
    let failureCount = 0;

    async function loadWorkerRun() {
        //Claiming independent requests until the shared bounded plan is complete.
        while (nextRequestIndex < requestCount) {
            nextRequestIndex += 1;
            const requestStartedAt = performance.now();
            const response = await fetch(`${runtimeUrl}/api`, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({
                    protocol: 1,
                    requestId: randomUUID(),
                    type: 'query',
                    operation: 'load.status.read',
                    payload: {}
                })
            });
            const responseData = await response.json();

            durations.push(performance.now() - requestStartedAt);

            if (response.status !== 200 || responseData.ok !== true) {
                failureCount += 1;

            }

        }

    }

    await Promise.all(Array.from({length: concurrency}, loadWorkerRun));
    durations.sort(function durationCompare(firstDuration, secondDuration) {
        //Ordering samples before selecting the percentile boundary.
        return firstDuration - secondDuration;

    });

    const p95Index = Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1);

    return {
        failureCount,
        p95Ms: durations[p95Index] ?? 0,
        requestCount: durations.length
    };

}

async function eventStreamSoakRun() {
    const manager = layerEventStreamManagerCreate({
        eventRepository: {
            async replay() {
                //Returning an empty durable window for lifecycle and heartbeat soak.
                return {events: [], hasMore: false};

            }
        },
        diagnostics: {
            record() {
                //Discarding per-heartbeat diagnostics during the bounded soak.

            }
        },
        heartbeatMs: 20,
        maxStreamsPerUser: streamCount,
        maxStreamsPerIp: streamCount
    });
    const responses = Array.from({length: streamCount}, function soakResponseCreate() {
        //Creating one isolated response surface per simulated browser stream.
        return new SoakResponse();

    });
    const openTasks = responses.map(function streamOpen(responseData, streamIndex) {
        //Opening independent identities so per-user limits remain meaningful.
        return manager.open({
            response: /** @type {any} */ (responseData),
            authorization: {
                tenantKey: 'load-tenant',
                userId: `load-user-${streamIndex}`,
                channels: [`load:${streamIndex}`]
            },
            cursor: null,
            remoteAddress: `198.18.0.${streamIndex + 1}`,
            requestId: randomUUID()
        });

    });

    //Holding streams across multiple heartbeat intervals before graceful drain.
    await new Promise(function soakIntervalWait(resolve) {
        //Waiting long enough to observe repeated heartbeat scheduling.
        setTimeout(resolve, 120);

    });
    await manager.drain();
    await Promise.all(openTasks);

    return {
        frameCount: responses.reduce(function frameCountAdd(frameTotal, responseData) {
            //Summing emitted heartbeat and drain frames across all streams.
            return frameTotal + responseData.frameCount;

        }, 0),
        streamCount
    };

}

async function loadSoakRun() {
    configurationAssert();

    const heapBefore = process.memoryUsage().heapUsed;
    const runtime = runtimeCreate();

    await runtime.start({host: '127.0.0.1', port: 0});

    try {
        const addressData = runtime.address();

        if (addressData === null || typeof addressData === 'string') {
            throw new Error('The load-test listener address is unavailable.');

        }

        const httpMetrics = await httpLoadRun(`http://127.0.0.1:${addressData.port}`);
        const streamMetrics = await eventStreamSoakRun();
        const heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
        const resultData = {
            http: httpMetrics,
            streams: streamMetrics,
            heapGrowthBytes,
            budgets: {
                maximumP95Ms,
                maximumHeapGrowthBytes
            }
        };

        process.stdout.write(`${JSON.stringify(resultData, null, 4)}\n`);

        if (httpMetrics.failureCount > 0 || httpMetrics.requestCount !== requestCount || httpMetrics.p95Ms > maximumP95Ms ||
            streamMetrics.frameCount < streamCount || heapGrowthBytes > maximumHeapGrowthBytes) {
            throw new Error('Layer-Engine load or soak budget failed.');

        }

    } finally {
        //Stopping the listener even when a performance budget fails.
        await runtime.stop({deadlineMs: 1000});

    }

}

await loadSoakRun();
