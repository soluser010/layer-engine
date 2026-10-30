import {LayerRuntimeError} from './runtime-error.js';

const terminalFailureStatuses = new Set([
    'cancelled',
    'conflict',
    'failed',
    'resolved'
]);

/**
 * @typedef {Readonly<{
 *     commandId: string,
 *     state: string,
 *     result: Promise<unknown>,
 *     conflict: Readonly<Record<string, unknown>> | null,
 *     snapshot: () => Readonly<Record<string, unknown>>,
 *     retry: () => Promise<void>,
 *     cancel: () => Promise<void>,
 *     resolveConflict: (resolutionData: Record<string, unknown>) => Promise<LayerCommandHandle>,
 *     dispose: () => boolean
 * }>} LayerCommandHandle
 */

/**
 * @param {Readonly<Record<string, unknown>>} commandRecord
 */
function commandRecordClone(commandRecord) {
    //Publishing immutable snapshots instead of live IndexedDB values.
    return Object.freeze(structuredClone(commandRecord));

}

/**
 * @param {Readonly<Record<string, unknown>>} commandRecord
 */
function commandFailureCreate(commandRecord) {
    let failureData = /** @type {Record<string, unknown>} */ ({});

    if (typeof commandRecord.failure === 'object' && commandRecord.failure !== null) {
        failureData = /** @type {Record<string, unknown>} */ (commandRecord.failure);

    }

    let errorCode = 'COMMAND_FAILED';
    let errorMessage = 'The offline command failed.';

    if (typeof failureData.code === 'string') {
        errorCode = failureData.code;

    }

    if (commandRecord.status === 'cancelled') {
        errorCode = 'COMMAND_CANCELLED';
        errorMessage = 'The offline command was cancelled.';

    } else if (commandRecord.status === 'resolved') {
        errorCode = 'COMMAND_SUPERSEDED';
        errorMessage = 'The conflicted command was superseded.';

    } else if (commandRecord.status === 'conflict') {
        errorMessage = 'The offline command requires conflict resolution.';

    }

    let errorDetails = /** @type {Readonly<Record<string, unknown>> | null} */ (null);
    let requestIdentifier = /** @type {string | null} */ (null);

    if (typeof failureData.details === 'object' && failureData.details !== null) {
        errorDetails = Object.freeze(structuredClone(
            /** @type {Record<string, unknown>} */ (failureData.details)
        ));

    }

    if (typeof failureData.requestId === 'string') {
        requestIdentifier = failureData.requestId;

    }

    return new LayerRuntimeError(errorCode, errorMessage, {
        requestId: requestIdentifier,
        retryAfterMs: Number(failureData.retryAfterMs) || 0,
        retryable: failureData.retryable === true,
        details: errorDetails
    });

}

/**
 * @param {object} runtimeOptions
 * @param {{
 *     queue: (queueData: Record<string, unknown>) => Promise<Readonly<Record<string, unknown>>>,
 *     get: (commandId: string) => Promise<Readonly<Record<string, unknown>> | null>,
 *     watch: (commandId: string, listener: (record: Readonly<Record<string, unknown>> | null) => void, options?: {immediate?: boolean}) => () => void,
 *     drain: () => Promise<Readonly<{claimed: number, confirmed: number, retryable: number, conflicted: number, failed: number}>>,
 *     retry: (commandId: string) => Promise<void>,
 *     cancel: (commandId: string) => Promise<void>,
 *     resolveConflict: (commandId: string, resolutionData: Record<string, unknown>) => Promise<string>
 * }} runtimeOptions.outbox
 * @param {() => boolean} [runtimeOptions.onlineGet]
 * @param {(commandRecord: Readonly<Record<string, unknown>>) => void | Promise<void>} [runtimeOptions.optimisticApply]
 * @param {() => void | Promise<void>} [runtimeOptions.backgroundSyncRegister]
 * @param {(failureData: Readonly<{stage: string, error: unknown}>) => void} [runtimeOptions.failureHandle]
 */
export function layerCommandRuntimeCreate(runtimeOptions) {
    if (runtimeOptions === null || typeof runtimeOptions !== 'object' ||
        typeof runtimeOptions.outbox !== 'object' || runtimeOptions.outbox === null) {
        throw new TypeError('Layer command runtime options are invalid.');

    }

    const outboxData = runtimeOptions.outbox;
    const requiredMethods = [
        'queue',
        'get',
        'watch',
        'drain',
        'retry',
        'cancel',
        'resolveConflict'
    ];

    if (requiredMethods.some(function requiredOutboxMethodCheck(methodName) {
        //Rejecting partial adapters before the first command can be persisted.
        return typeof /** @type {Record<string, unknown>} */ (outboxData)[methodName] !== 'function';

    }) ||
        (runtimeOptions.onlineGet !== undefined && typeof runtimeOptions.onlineGet !== 'function') ||
        (runtimeOptions.optimisticApply !== undefined && typeof runtimeOptions.optimisticApply !== 'function') ||
        (runtimeOptions.backgroundSyncRegister !== undefined &&
            typeof runtimeOptions.backgroundSyncRegister !== 'function') ||
        (runtimeOptions.failureHandle !== undefined && typeof runtimeOptions.failureHandle !== 'function')) {
        throw new TypeError('Layer command runtime integrations are invalid.');

    }

    const onlineGet = runtimeOptions.onlineGet ?? function commandOnlineRead() {
        //Treating an absent browser signal as online while transport errors remain retryable.
        return true;

    };
    let activeDrain = /** @type {Promise<Readonly<Record<string, number>>> | null} */ (null);
    let drainRequestedStatus = false;

    function failureReport(/** @type {string} */ stageData, /** @type {unknown} */ errorData) {
        //Reporting background work without converting a durable command into a hidden success.
        runtimeOptions.failureHandle?.(Object.freeze({
            stage: stageData,
            error: errorData
        }));

    }

    async function commandDrain() {
        //Sharing one drain promise so page lifecycle triggers cannot send concurrently.
        if (activeDrain !== null) {
            return activeDrain;

        }

        activeDrain = (async function commandDrainRun() {
            //Draining confirmed domains until no immediately safe command remains.
            let aggregateResult = {
                claimed: 0,
                confirmed: 0,
                retryable: 0,
                conflicted: 0,
                failed: 0
            };
            let continueStatus = true;

            while (continueStatus && onlineGet()) {
                drainRequestedStatus = false;
                const drainResult = await outboxData.drain();

                aggregateResult = {
                    claimed: aggregateResult.claimed + drainResult.claimed,
                    confirmed: aggregateResult.confirmed + drainResult.confirmed,
                    retryable: aggregateResult.retryable + drainResult.retryable,
                    conflicted: aggregateResult.conflicted + drainResult.conflicted,
                    failed: aggregateResult.failed + drainResult.failed
                };
                continueStatus = drainRequestedStatus ||
                    (drainResult.claimed > 0 && drainResult.retryable === 0 &&
                        drainResult.conflicted === 0 && drainResult.failed === 0);

            }

            return Object.freeze(aggregateResult);

        })();

        try {
            return await activeDrain;

        } finally {
            activeDrain = null;

        }

    }

    function commandDrainSchedule() {
        //Starting transport work after the caller receives the durable handle.
        queueMicrotask(function queuedCommandDrainStart() {
            if (activeDrain !== null) {
                drainRequestedStatus = true;

                return;

            }

            void commandDrain().catch(function backgroundCommandDrainFailure(drainError) {
                //Keeping the command queued while exposing infrastructure failure to diagnostics.
                failureReport('drain', drainError);

            });

        });

    }

    /**
     * @param {Readonly<Record<string, unknown>>} initialRecord
     * @returns {LayerCommandHandle}
     */
    function commandHandleCreate(initialRecord) {
        let currentRecord = commandRecordClone(initialRecord);
        let settledStatus = false;
        let resultResolve = /** @type {(resultData: unknown) => void} */ (function unresolvedResultAccept(_resultData) {
            //Holding a typed placeholder until the first completion promise is created.
            return undefined;

        });
        let resultReject = /** @type {(errorData: unknown) => void} */ (function unresolvedResultReject(_errorData) {
            //Holding a typed placeholder until the first completion promise is created.
            return undefined;

        });
        let resultPromise = /** @type {Promise<unknown>} */ (Promise.resolve());

        function resultPromiseReset() {
            //Creating one observable completion cycle for the current delivery attempt.
            settledStatus = false;
            resultPromise = new Promise(function commandResultWait(resolve, reject) {
                //Capturing this attempt's settlement functions for outbox watch updates.
                resultResolve = resolve;
                resultReject = reject;

            });
            void resultPromise.catch(function commandResultObservedInternally() {
                //Preventing an unhandled rejection while preserving rejection for consumers.
                return undefined;

            });

        }

        /**
         * @param {Readonly<Record<string, unknown>> | null} nextRecord
         */
        function commandRecordApply(nextRecord) {
            //Advancing the handle only from a committed durable snapshot.
            if (nextRecord === null) {
                return;

            }

            currentRecord = commandRecordClone(nextRecord);

            if (settledStatus) {
                return;

            }

            if (currentRecord.status === 'confirmed') {
                settledStatus = true;
                resultResolve(structuredClone(currentRecord.result));

            } else if (terminalFailureStatuses.has(String(currentRecord.status))) {
                settledStatus = true;
                resultReject(commandFailureCreate(currentRecord));

            }

        }

        resultPromiseReset();
        commandRecordApply(currentRecord);
        const watchDispose = outboxData.watch(
            String(currentRecord.commandId),
            commandRecordApply,
            {immediate: false}
        );
        let disposedStatus = false;
        const handleData = {
            get commandId() {
                //Returning the durable id of the current command intent.
                return String(currentRecord.commandId);

            },
            get state() {
                //Returning the latest committed lifecycle status.
                return String(currentRecord.status);

            },
            get result() {
                //Returning the completion promise for the current delivery attempt.
                return resultPromise;

            },
            get conflict() {
                if (currentRecord.status !== 'conflict' ||
                    typeof currentRecord.failure !== 'object' || currentRecord.failure === null) {
                    return null;

                }

                const failureData = /** @type {Record<string, unknown>} */ (currentRecord.failure);

                if (typeof failureData.details !== 'object' || failureData.details === null) {
                    return null;

                }

                return Object.freeze(structuredClone(
                    /** @type {Record<string, unknown>} */ (failureData.details)
                ));

            },
            snapshot() {
                //Returning the latest committed command state for UI rendering.
                return commandRecordClone(currentRecord);

            },
            async retry() {
                //Starting a new result cycle only after durable retry authorization.
                await outboxData.retry(String(currentRecord.commandId));
                resultPromiseReset();
                commandRecordApply(await outboxData.get(String(currentRecord.commandId)));
                commandDrainSchedule();

            },
            async cancel() {
                //Cancelling only while no active transport lease owns the command.
                await outboxData.cancel(String(currentRecord.commandId));
                commandRecordApply(await outboxData.get(String(currentRecord.commandId)));

            },
            async resolveConflict(/** @type {Record<string, unknown>} */ resolutionData) {
                //Creating a new immutable intent instead of rewriting the conflicted command.
                const replacementIdentifier = await outboxData.resolveConflict(
                    String(currentRecord.commandId),
                    resolutionData
                );
                commandRecordApply(await outboxData.get(String(currentRecord.commandId)));
                const replacementRecord = await outboxData.get(replacementIdentifier);

                if (replacementRecord === null) {
                    throw new LayerRuntimeError(
                        'COMMAND_REPLACEMENT_MISSING',
                        'The replacement command could not be loaded.'
                    );

                }

                const replacementHandle = commandHandleCreate(replacementRecord);
                commandDrainSchedule();

                return replacementHandle;

            },
            dispose() {
                //Stopping local observation without deleting durable command history.
                if (disposedStatus) {
                    return false;

                }

                disposedStatus = true;
                watchDispose();

                return true;

            }
        };
        const commandHandle = Object.freeze(handleData);

        return commandHandle;

    }

    return Object.freeze({
        /**
         * @param {string} operationName
         * @param {Record<string, unknown>} payloadData
         * @param {{offline?: 'queue' | 'reject', baseRevision: number, conflictDomain?: string, optimisticPatch?: Record<string, unknown> | null}} commandOptions
         */
        async command(operationName, payloadData, commandOptions) {
            //Persisting intent before optimistic UI or transport work can begin.
            if (typeof commandOptions !== 'object' || commandOptions === null ||
                !['queue', 'reject'].includes(commandOptions.offline ?? 'queue')) {
                throw new TypeError('Layer command options are invalid.');

            }

            const onlineStatus = onlineGet();

            if (!onlineStatus && commandOptions.offline === 'reject') {
                throw new LayerRuntimeError('COMMAND_OFFLINE', 'The command requires an active network connection.', {
                    retryable: true
                });

            }

            const commandRecord = await outboxData.queue({
                operation: operationName,
                payload: payloadData,
                baseRevision: commandOptions.baseRevision,
                //Deriving a valid operation-local domain when the application omits one.
                conflictDomain: commandOptions.conflictDomain ?? operationName.replaceAll('.', ':'),
                optimisticPatch: commandOptions.optimisticPatch ?? null
            });
            const commandHandle = commandHandleCreate(commandRecord);

            if (runtimeOptions.optimisticApply !== undefined) {
                try {
                    await runtimeOptions.optimisticApply(commandRecord);

                } catch (optimisticError) {
                    failureReport('optimistic-apply', optimisticError);

                }

            }

            if (runtimeOptions.backgroundSyncRegister !== undefined) {
                try {
                    //Registering a worker fallback even when the page can send immediately.
                    await runtimeOptions.backgroundSyncRegister();

                } catch (registrationError) {
                    failureReport('background-sync', registrationError);

                }

            }

            if (onlineStatus) {
                commandDrainSchedule();

            }

            return commandHandle;

        },
        drain: commandDrain
    });

}
