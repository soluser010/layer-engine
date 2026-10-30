import {createServer as httpServerCreate} from 'node:http';
import {
    connect as tcpConnect,
    createServer as tcpServerCreate
} from 'node:net';

const controlHost = '127.0.0.1';
const controlPort = Number(process.env.LAYER_STABLE_PROXY_CONTROL_PORT ?? 16400);
const controlToken = process.env.LAYER_STABLE_PROXY_CONTROL_TOKEN;

if (typeof controlToken !== 'string' || controlToken.length < 32) {
    throw new Error('LAYER_STABLE_PROXY_CONTROL_TOKEN is required.');

}

/**
 * @param {object} proxyOptions
 * @param {string} proxyOptions.name
 * @param {number} proxyOptions.listenPort
 * @param {number} proxyOptions.targetPort
 */
function faultProxyCreate(proxyOptions) {
    let availableStatus = true;
    const socketItems = new Set();
    const serverData = tcpServerCreate(function proxyConnectionHandle(clientSocketData) {
        if (!availableStatus) {
            clientSocketData.destroy();

            return;

        }

        const targetSocketData = tcpConnect({
            host: '127.0.0.1',
            port: proxyOptions.targetPort
        });
        const socketPairData = Object.freeze({
            client: clientSocketData,
            target: targetSocketData
        });

        socketItems.add(socketPairData);
        clientSocketData.pipe(targetSocketData);
        targetSocketData.pipe(clientSocketData);

        const socketPairRelease = function socketPairReleaseHandle() {
            socketItems.delete(socketPairData);

        };

        clientSocketData.once('close', socketPairRelease);
        targetSocketData.once('close', socketPairRelease);
        clientSocketData.once('error', function clientSocketErrorHandle() {
            targetSocketData.destroy();

        });
        targetSocketData.once('error', function targetSocketErrorHandle() {
            clientSocketData.destroy();

        });
    });

    return Object.freeze({
        name: proxyOptions.name,
        port: proxyOptions.listenPort,
        async start() {
            await new Promise(function proxyListenWait(resolve, reject) {
                serverData.once('error', reject);
                serverData.listen(proxyOptions.listenPort, controlHost, function proxyListenComplete() {
                    serverData.off('error', reject);
                    resolve(undefined);

                });
            });

        },
        setAvailable(/** @type {boolean} */ nextAvailableStatus) {
            availableStatus = nextAvailableStatus === true;

            if (!availableStatus) {
                //Closing only test-proxy sockets while preserving shared OpenServer services.
                for (const socketPairData of socketItems) {
                    socketPairData.client.destroy();
                    socketPairData.target.destroy();

                }

                socketItems.clear();

            }

        },
        statusGet() {
            return Object.freeze({
                available: availableStatus,
                connections: socketItems.size,
                port: proxyOptions.listenPort,
                targetPort: proxyOptions.targetPort
            });
        },
        async close() {
            for (const socketPairData of socketItems) {
                socketPairData.client.destroy();
                socketPairData.target.destroy();

            }

            socketItems.clear();

            await new Promise(function proxyCloseWait(resolve) {
                serverData.close(function proxyCloseComplete() {
                    resolve(undefined);

                });
            });

        }
    });

}

const proxyItems = Object.freeze({
    postgres: faultProxyCreate({
        name: 'postgres',
        listenPort: 15432,
        targetPort: 5432
    }),
    redis: faultProxyCreate({
        name: 'redis',
        listenPort: 16379,
        targetPort: 6379
    })
});

await Promise.all(Object.values(proxyItems).map(function proxyStart(proxyData) {
    return proxyData.start();

}));

const controlServerData = httpServerCreate(async function controlRequestHandle(requestData, responseData) {
    const authorizationData = requestData.headers.authorization;

    if (authorizationData !== 'Bearer ' + String(controlToken)) {
        responseData.writeHead(401, {
            'content-type': 'application/json; charset=utf-8'
        });
        responseData.end('{"status":"unauthorized"}');

        return;

    }

    const requestUrlData = new URL(requestData.url ?? '/', 'http://layer.local');

    if (requestData.method === 'GET' && requestUrlData.pathname === '/status') {
        responseData.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8'
        });
        responseData.end(JSON.stringify({
            processId: process.pid,
            postgres: proxyItems.postgres.statusGet(),
            redis: proxyItems.redis.statusGet()
        }));

        return;

    }

    const routeMatchData = /^\/(postgres|redis)\/(up|down)$/.exec(requestUrlData.pathname);

    if (requestData.method === 'POST' && routeMatchData !== null) {
        const proxyNameData = /** @type {'postgres' | 'redis'} */ (routeMatchData[1]);
        const availableStatusData = routeMatchData[2] === 'up';

        proxyItems[proxyNameData].setAvailable(availableStatusData);
        responseData.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8'
        });
        responseData.end(JSON.stringify(proxyItems[proxyNameData].statusGet()));

        return;

    }

    if (requestData.method === 'POST' && requestUrlData.pathname === '/shutdown') {
        responseData.writeHead(202, {
            'content-type': 'application/json; charset=utf-8'
        });
        responseData.end('{"status":"stopping"}');

        setImmediate(function proxyShutdownSchedule() {
            void shutdownExecute();

        });

        return;

    }

    responseData.writeHead(404, {
        'content-type': 'application/json; charset=utf-8'
    });
    responseData.end('{"status":"not-found"}');
});
let shutdownRunningStatus = false;

async function shutdownExecute() {
    if (shutdownRunningStatus) {
        return;

    }

    shutdownRunningStatus = true;
    await Promise.all(Object.values(proxyItems).map(function proxyClose(proxyData) {
        return proxyData.close();

    }));
    await new Promise(function controlCloseWait(resolve) {
        controlServerData.close(function controlCloseComplete() {
            resolve(undefined);

        });
    });
}

await new Promise(function controlListenWait(resolve, reject) {
    controlServerData.once('error', reject);
    controlServerData.listen(controlPort, controlHost, function controlListenComplete() {
        controlServerData.off('error', reject);
        resolve(undefined);

    });
});

for (const signalNameData of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.once(signalNameData, function proxySignalHandle() {
        void shutdownExecute();

    });
}
