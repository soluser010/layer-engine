import {
    layerCacheInvalidationRepositoryCreate,
    layerCommandResultRepositoryCreate,
    layerDatabaseFacadeCreate,
    layerDatabaseSchemaDefine
} from '@solcorp/layer-database';
import {
    LAYER_ERROR_CODES,
    LayerError
} from '@solcorp/layer-protocol';
import {commandReplayIdentityCreate} from './command-identity.js';

/**
 * @typedef {object} LayerExecutorTransactionClient
 * @property {(queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>} query
 * @typedef {object} LayerExecutorDatabase
 * @property {'embedded' | 'postgres'} [kind]
 * @property {string} [systemSchema]
 * @property {(queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>} [query]
 * @property {<ResultData>(handler: (transactionClient: LayerExecutorTransactionClient) => Promise<ResultData>) => Promise<ResultData>} transaction
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {number} status
 * @param {Record<string, unknown> | null} [details]
 * @param {boolean} [retryable]
 */
function operationErrorCreate(code, message, status, details = null, retryable = false) {
    //Creating a stable public operation error without leaking runtime internals.
    return new LayerError(code, message, {
        details,
        retryable,
        status
    });

}

/**
 * @param {unknown} payloadData
 * @returns {string | null}
 */
function commandIdentifierGet(payloadData) {
    //Checking the command payload before reading its idempotency key.
    if (typeof payloadData !== 'object' || payloadData === null || Array.isArray(payloadData)) {
        return null;

    }

    const commandIdentifier = /** @type {Record<string, unknown>} */ (payloadData).commandId;

    //Checking the bounded command identifier used by the unique database key.
    if (typeof commandIdentifier !== 'string' || commandIdentifier.length < 1 || commandIdentifier.length > 160) {
        return null;

    }

    return commandIdentifier;

}

/**
 * @param {object} executorOptions
 * @param {ReturnType<typeof import('../operation-registry.js').layerOperationRegistryCreate>} executorOptions.operationRegistry
 * @param {{contextResolve: Function}} executorOptions.security
 * @param {{consume: Function}} executorOptions.rateLimiter
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} executorOptions.diagnostics
 * @param {LayerExecutorDatabase | null} [executorOptions.database]
 * @param {unknown} [executorOptions.databaseSchema]
 * @param {{bind: (transactionData: LayerExecutorTransactionClient | null, identityData: any) => unknown, afterCommit: () => Promise<void>} | null} [executorOptions.notifications]
 * @param {{execute: (cacheRequestData: Record<string, unknown>, loadData: () => Promise<unknown>) => Promise<unknown>, invalidate?: (invalidationData: Record<string, unknown>) => Promise<unknown>} | null} [executorOptions.queryCache]
 * @param {{append: (transactionClientData: LayerExecutorTransactionClient, eventData: Record<string, unknown>) => Promise<unknown>} | null} [executorOptions.eventRepository]
 * @param {{record: (auditData: Record<string, unknown>) => Promise<unknown> | unknown} | null} [executorOptions.auditTrail]
 * @param {boolean} [executorOptions.auditRequired]
 * @param {(requestContextData: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>} [executorOptions.contextExtend]
 * @param {() => number} [executorOptions.clock]
 */
export function layerOperationExecutorCreate(executorOptions) {
    const clock = executorOptions.clock ?? Date.now;
    const operationConcurrencyMap = new Map();
    const databaseSchemaData = executorOptions.databaseSchema ?? layerDatabaseSchemaDefine( [] );

    //Failing startup when production policy requires a missing durable audit sink.
    if (executorOptions.auditRequired === true && typeof executorOptions.auditTrail?.record !== 'function') {
        throw new TypeError('A durable audit trail is required.');

    }

    if (executorOptions.auditTrail !== undefined && executorOptions.auditTrail !== null && typeof executorOptions.auditTrail.record !== 'function') {
        throw new TypeError('auditTrail must expose a record function.');

    }

    if ( executorOptions.contextExtend !== undefined && typeof executorOptions.contextExtend !== String( 'function' ) ){
        throw new TypeError( 'contextExtend must be a function.' );

    }

    /**
     * @param {import('../operation-registry.js').LayerRegisteredOperation} operationData
     * @param {{request: {requestId: string}, remoteAddress: string}} executionData
     * @param {Record<string, unknown>} securityContext
     * @param {'success' | 'denied' | 'failed'} outcomeData
     * @param {string | null} errorCode
     */
    async function operationAuditRecord(operationData, executionData, securityContext, outcomeData, errorCode) {
        //Skipping only operations that explicitly disable audit or runtimes without a configured sink.
        if (operationData.audit.enabled !== true || executorOptions.auditTrail === undefined || executorOptions.auditTrail === null) {
            return;

        }

        await executorOptions.auditTrail.record({
            requestId: executionData.request.requestId,
            operation: operationData.name,
            category: operationData.audit.category,
            authenticationType: securityContext.authenticationType,
            credentialId: securityContext.credentialId,
            userId: securityContext.userId,
            tenantId: securityContext.tenantId,
            remoteAddress: executionData.remoteAddress,
            outcome: outcomeData,
            errorCode
        });

    }

    /**
     * @param {import('../operation-registry.js').LayerRegisteredOperation} operationData
     * @param {unknown} payloadData
     * @param {Readonly<Record<string, unknown>>} authorizationContext
     */
    async function operationAuthorizationAssert(operationData, payloadData, authorizationContext) {
        //Allowing operations without an object policy to continue after permission checks.
        if (operationData.authorize === null) {
            return;

        }

        let accessAllowed;

        try {
            //Delegating object ownership and writable-field rules to the domain operation.
            accessAllowed = await operationData.authorize(payloadData, authorizationContext);

        } catch {
            //Collapsing policy failures into the same denial to avoid resource disclosure.
            accessAllowed = false;

        }

        if (accessAllowed !== true) {
            throw operationErrorCreate(
                LAYER_ERROR_CODES.OBJECT_ACCESS_DENIED,
                'Access to the requested object is denied.',
                403
            );

        }

    }

    /**
     * @param {import('../operation-registry.js').LayerRegisteredOperation} operationData
     * @param {unknown} payloadData
     * @param {Readonly<Record<string, unknown>>} requestContext
     * @param {AbortSignal} operationSignal
     * @param {unknown} responseEffectsData
     */
    async function operationHandlerExecute(operationData, payloadData, requestContext, operationSignal, responseEffectsData) {
        //Checking whether this operation requires a database transaction.
        if (operationData.transaction !== true) {
            const handlerContextData = /** @type {Record<string, unknown>} */ ({
                ...requestContext,
                signal: operationSignal
            });

            //Exposing response effects only to process-marked system operations
            if ( operationData.system === true && responseEffectsData !== null && responseEffectsData !== undefined ){
                handlerContextData.response = responseEffectsData;

            }

            //Creating a safe non-transactional database facade when storage is configured
            if (
                executorOptions.database !== null &&
                executorOptions.database !== undefined &&
                typeof executorOptions.database.query === 'function'
            ){
                handlerContextData.database = layerDatabaseFacadeCreate({
                    database: /** @type {any} */ (executorOptions.database),
                    schema: databaseSchemaData,
                    security: /** @type {{tenantId?: string | null, userId?: string | null}} */ (requestContext.security)
                });

            }

            //Binding standalone sends to the authenticated tenant; no raw adapter is exposed
            if ( executorOptions.notifications ){
                handlerContextData.notifications = executorOptions.notifications.bind( null, requestContext.security );

            }

            const handlerContext = Object.freeze( handlerContextData );

            await operationAuthorizationAssert(operationData, payloadData, handlerContext);

            //Running queries without cache when no Redis accelerator or cache policy is configured.
            if ( operationData.cache === null || executorOptions.queryCache === null || executorOptions.queryCache === undefined ){
                return operationData.handler(payloadData, handlerContext);

            }

            let handlerPromiseData = /** @type {Promise<unknown> | null} */ (null);
            let handlerErrorData = /** @type {unknown} */ (undefined);
            const handlerLoadData = function(){
                //Memoizing the handler so a cache failure can never execute application code twice.
                if ( handlerPromiseData === null ){
                    handlerPromiseData = Promise.resolve()
                        .then(function operationHandlerLoad(){
                            return operationData.handler(payloadData, handlerContext);

                        })
                        .catch(function operationHandlerFailure( operationErrorData ){
                            handlerErrorData = operationErrorData;

                            throw operationErrorData;

                        });

                }

                return handlerPromiseData;

            };

            try {
                return await executorOptions.queryCache.execute({
                    operation: operationData.name,
                    payload: payloadData,
                    security: requestContext.security,
                    metadata: operationData.cache
                }, handlerLoadData);

            } catch {
                //Preserving an application failure without misclassifying it as a Redis failure.
                if ( handlerErrorData !== undefined ){
                    throw handlerErrorData;

                }

                executorOptions.diagnostics.record({
                    level: 'warn',
                    event: 'operation.cache-bypassed',
                    operation: operationData.name,
                    code: 'CACHE_UNAVAILABLE'
                });

                return handlerLoadData();

            }

        }

        //Failing closed when a transactional command has no PostgreSQL dependency.
        if (executorOptions.database === null || executorOptions.database === undefined) {
            throw operationErrorCreate(
                LAYER_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
                'The database dependency is unavailable.',
                503
            );

        }

        const commandIdentifier = commandIdentifierGet(payloadData);

        //Requiring idempotency for every transactional command.
        if (commandIdentifier === null) {
            throw operationErrorCreate(
                LAYER_ERROR_CODES.INVALID_PAYLOAD,
                'A valid commandId is required for transactional commands.',
                400
            );

        }

        const securityContext = /** @type {import('@solcorp/layer-security').LayerSecurityContext} */ (requestContext.security);
        const tenantKey = securityContext.tenantId ?? securityContext.userId ?? 'public';
        const replayIdentityData = commandReplayIdentityCreate( securityContext, operationData.name, payloadData );

        return executorOptions.database.transaction(async function transactionalOperationExecute(transactionClient) {
            //Binding command replay and handler work to one database transaction.
            const commandRepository = layerCommandResultRepositoryCreate(transactionClient);
            const cacheInvalidationRepositoryData = layerCacheInvalidationRepositoryCreate({
                database: transactionClient
            });
            const handlerContextData = /** @type {Record<string, unknown>} */ ({
                ...requestContext,
                signal: operationSignal,
                database: layerDatabaseFacadeCreate({
                    database: transactionClient,
                    schema: databaseSchemaData,
                    security: /** @type {{tenantId?: string | null, userId?: string | null}} */ (requestContext.security),
                    transaction: true
                })
            });

            //Exposing response effects only to process-marked system operations
            if ( operationData.system === true && responseEffectsData !== null && responseEffectsData !== undefined ){
                handlerContextData.response = responseEffectsData;

            }

            //Exposing durable event append without revealing the raw transaction client
            if ( executorOptions.eventRepository !== null && executorOptions.eventRepository !== undefined ){
                handlerContextData.events = Object.freeze({
                    async append( /** @type {Record<string, unknown>} */ eventData ){
                        //Appending the journal and outbox records in this command transaction
                        return executorOptions.eventRepository?.append( transactionClient, eventData );

                    }
                });

            }

            //Binding push enqueue to the command transaction, including rollback and replay
            if ( executorOptions.notifications ){
                handlerContextData.notifications = executorOptions.notifications.bind( transactionClient, requestContext.security );

            }

            const handlerContext = Object.freeze( handlerContextData );

            await operationAuthorizationAssert(operationData, payloadData, handlerContext);

            const priorCommandResult = await commandRepository.find({
                tenantKey,
                commandId: commandIdentifier
            });

            //Avoiding delayed handler side effects when a duplicate waited beyond its deadline
            if ( operationSignal.aborted ){
                throw operationErrorCreate( LAYER_ERROR_CODES.OPERATION_TIMEOUT, 'The operation timed out.', 504 );

            }

            //Returning the saved result without executing the command twice.
            if (priorCommandResult !== null) {
                //Rejecting legacy, anonymous, cross-actor and changed-payload replay without exposing the saved result
                if (priorCommandResult.operation !== operationData.name ||
                    replayIdentityData.actorKey === null ||
                    priorCommandResult.actor_key !== replayIdentityData.actorKey ||
                    priorCommandResult.request_digest !== replayIdentityData.requestDigest) {
                    throw operationErrorCreate(
                        LAYER_ERROR_CODES.REVISION_CONFLICT,
                        'The commandId cannot be replayed for this identity or payload.',
                        409
                    );

                }

                return priorCommandResult.result;

            }

            const operationResult = await operationData.handler(payloadData, handlerContext);

            //Preventing a timed-out command from committing after the response deadline.
            if (operationSignal.aborted) {
                throw operationErrorCreate(
                    LAYER_ERROR_CODES.OPERATION_TIMEOUT,
                    'The operation timed out.',
                    504
                );

            }

            //Checking the result before persisting its idempotent replay value.
            if (!operationData.outputValidate(operationResult)) {
                throw operationErrorCreate(
                    LAYER_ERROR_CODES.INTERNAL_ERROR,
                    'The operation returned an invalid result.',
                    500
                );

            }

            //Recording invalidation in the command transaction before Redis receives it.
            if ( operationData.cacheInvalidation !== null ){
                await cacheInvalidationRepositoryData.record({
                    eventId: commandIdentifier,
                    scope: operationData.cacheInvalidation.scope,
                    tenantId: securityContext.tenantId,
                    userId: securityContext.userId,
                    tags: operationData.cacheInvalidation.tags
                });

            }

            await commandRepository.save({
                tenantKey,
                commandId: commandIdentifier,
                operation: operationData.name,
                actorKey: replayIdentityData.actorKey,
                requestDigest: replayIdentityData.requestDigest,
                result: operationResult
            });

            return operationResult;

        });

    }

    return Object.freeze({
        /**
         * @param {object} executionData
         * @param {{protocol?: number, requestId: string, type: string, operation: string, payload: unknown, cursor?: string | null}} executionData.request
         * @param {Record<string, string | string[] | undefined>} executionData.headers
         * @param {string} executionData.remoteAddress
         * @param {unknown} [executionData.responseEffects]
         */
        async execute(executionData) {
            const operationData = executorOptions.operationRegistry.get(executionData.request.operation);

            //Checking the registered operation before any application execution.
            if (operationData === undefined) {
                throw operationErrorCreate(
                    LAYER_ERROR_CODES.OPERATION_NOT_FOUND,
                    'The requested operation was not found.',
                    404
                );

            }

            //Checking that the envelope type matches immutable registry metadata.
            if (operationData.type !== executionData.request.type) {
                throw operationErrorCreate(
                    LAYER_ERROR_CODES.INVALID_ENVELOPE,
                    'The request type does not match the operation.',
                    400
                );

            }

            //Validating application payload before auth and handler access.
            if (!operationData.inputValidate(executionData.request.payload)) {
                const validationIssues = [];

                //Reducing validator details to stable non-sensitive fields.
                for (const validationError of operationData.inputValidate.errors ?? []) {
                    validationIssues.push({
                        path: validationError.instancePath,
                        keyword: validationError.keyword
                    });

                }

                throw operationErrorCreate(
                    LAYER_ERROR_CODES.INVALID_PAYLOAD,
                    'The operation payload is invalid.',
                    400,
                    {
                        issues: validationIssues
                    }
                );

            }

            const securityContext = await executorOptions.security.contextResolve({
                auth: operationData.auth,
                permissions: operationData.permissions,
                headers: executionData.headers,
                remoteAddress: executionData.remoteAddress
            });
            const rateLimitResult = await executorOptions.rateLimiter.consume({
                profile: securityContext.authenticationType,
                remoteAddress: executionData.remoteAddress,
                credentialId: securityContext.credentialId,
                sessionId: securityContext.sessionId,
                userId: securityContext.userId,
                tenantId: securityContext.tenantId,
                operation: operationData.rateLimitBucket,
                cost: operationData.cost
            });

            //Stopping the operation when any in-process security bucket is exhausted.
            if (!rateLimitResult.allowed) {
                throw operationErrorCreate(
                    LAYER_ERROR_CODES.RATE_LIMITED,
                    'The request rate limit was exceeded.',
                    429,
                    {
                        retryAfterMs: rateLimitResult.retryAfterMs
                    },
                    true
                );

            }

            const activeOperationCount = operationConcurrencyMap.get(operationData.name) ?? 0;

            //Checking expensive-operation concurrency before allocating its timeout.
            if (activeOperationCount >= operationData.concurrency) {
                throw operationErrorCreate(
                    LAYER_ERROR_CODES.RATE_LIMITED,
                    'The operation concurrency limit was exceeded.',
                    429,
                    null,
                    true
                );

            }

            const operationName = operationData.name;
            const operationStartedAt = clock();
            const operationAbortController = new AbortController();
            const requestContextBaseData = Object.freeze({
                requestId: executionData.request.requestId,
                operation: operationData.name,
                security: securityContext
            });
            let requestContextExtensionData = /** @type {Readonly<Record<string, unknown>>} */ (Object.freeze({}));

            //Creating trusted server context additions without allowing core-field replacement
            if ( executorOptions.contextExtend !== undefined ){
                const extensionResultData = executorOptions.contextExtend( requestContextBaseData );

                if (
                    extensionResultData === null ||
                    typeof extensionResultData !== String( 'object' ) ||
                    Array.isArray( extensionResultData ) === true
                ){
                    throw operationErrorCreate(
                        LAYER_ERROR_CODES.INTERNAL_ERROR,
                        'The operation context could not be created.',
                        500
                    );

                }

                const reservedContextFieldsData = [
                    'database',
                    'events',
                    'notifications',
                    'operation',
                    'requestId',
                    'response',
                    'security',
                    'signal'
                ];

                for ( const fieldNameData of Object.keys( extensionResultData ) ){
                    if ( reservedContextFieldsData.includes( fieldNameData ) === true ){
                        throw operationErrorCreate(
                            LAYER_ERROR_CODES.INTERNAL_ERROR,
                            'The operation context could not be created.',
                            500
                        );

                    }

                }

                requestContextExtensionData = extensionResultData;

            }

            const requestContext = Object.freeze({
                ...requestContextBaseData,
                ...requestContextExtensionData
            });

            //Owning a concurrency slot only after synchronous context creation has succeeded
            operationConcurrencyMap.set(operationData.name, activeOperationCount + 1);
            const operationPromise = operationHandlerExecute(
                operationData,
                executionData.request.payload,
                requestContext,
                operationAbortController.signal,
                executionData.responseEffects ?? null
            );

            function operationConcurrencyRelease() {
                //Releasing the operation slot only after underlying work settles.
                operationConcurrencyMap.set(
                    operationName,
                    Math.max(0, (operationConcurrencyMap.get(operationName) ?? 1) - 1)
                );

            }

            //Keeping the concurrency slot until the underlying work actually settles.
            operationPromise.then(
                operationConcurrencyRelease,
                operationConcurrencyRelease
            );

            let timeoutIdentifier;
            const timeoutPromise = new Promise(function operationTimeoutWait(resolve, reject) {
                //Scheduling one bounded deadline for the public operation response.
                timeoutIdentifier = setTimeout(function operationTimeoutHandle() {
                    //Signaling cancellation before returning a safe timeout response.
                    operationAbortController.abort();
                    reject(operationErrorCreate(
                        LAYER_ERROR_CODES.OPERATION_TIMEOUT,
                        'The operation timed out.',
                        504
                    ));

                }, operationData.timeoutMs);

            });

            try {
                const operationResult = await Promise.race([
                    operationPromise,
                    timeoutPromise
                ]);

                //Checking every non-transactional and replayed result before serialization.
                if (!operationData.outputValidate(operationResult)) {
                    throw operationErrorCreate(
                        LAYER_ERROR_CODES.INTERNAL_ERROR,
                        'The operation returned an invalid result.',
                        500
                    );

                }

                //Applying the committed invalidation immediately while durable replay remains authoritative.
                if (
                    operationData.cacheInvalidation !== null &&
                    typeof executorOptions.queryCache?.invalidate === 'function'
                ){
                    try {
                        await executorOptions.queryCache.invalidate({
                            security: securityContext,
                            metadata: operationData.cacheInvalidation,
                            tags: operationData.cacheInvalidation.tags
                        });

                    } catch {
                        executorOptions.diagnostics.record({
                            level: 'warn',
                            event: 'operation.cache-invalidation-deferred',
                            operation: operationData.name,
                            code: 'CACHE_UNAVAILABLE'
                        });

                    }

                }

                //Sending best-effort wakeup hints only after successful command commit
                if ( operationData.transaction && executorOptions.notifications ){
                    await executorOptions.notifications.afterCommit();

                }

                await operationAuditRecord(
                    operationData,
                    executionData,
                    securityContext,
                    'success',
                    null
                );

                executorOptions.diagnostics.record({
                    level: 'info',
                    event: 'operation.complete',
                    requestId: executionData.request.requestId,
                    operation: operationData.name,
                    durationMs: clock() - operationStartedAt,
                    status: 200
                });

                return operationResult;

            } catch (operationError) {
                let publicError;

                //Converting unexpected failures into one safe internal error.
                if (operationError instanceof LayerError) {
                    publicError = operationError;

                } else {
                    publicError = operationErrorCreate(
                        LAYER_ERROR_CODES.INTERNAL_ERROR,
                        'An internal error occurred.',
                        500
                    );

                }

                executorOptions.diagnostics.record({
                    level: 'error',
                    event: 'operation.failed',
                    requestId: executionData.request.requestId,
                    operation: operationData.name,
                    durationMs: clock() - operationStartedAt,
                    status: publicError.status,
                    code: publicError.code
                });

                let auditOutcome = /** @type {'denied' | 'failed'} */ ('failed');

                //Classifying rejected identity, policy, and capacity requests as denials.
                if (publicError.status === 401 || publicError.status === 403 || publicError.status === 429) {
                    auditOutcome = 'denied';

                }

                try {
                    //Preserving the primary public failure if the failure-audit sink is unavailable.
                    await operationAuditRecord(
                        operationData,
                        executionData,
                        securityContext,
                        auditOutcome,
                        publicError.code
                    );

                } catch {
                    executorOptions.diagnostics.record({
                        level: 'error',
                        event: 'operation.audit-failed',
                        requestId: executionData.request.requestId,
                        operation: operationData.name,
                        durationMs: clock() - operationStartedAt,
                        status: 500,
                        code: LAYER_ERROR_CODES.DEPENDENCY_UNAVAILABLE
                    });

                }

                throw publicError;

            } finally {
                //Removing the response timer while preserving the work cancellation signal.
                clearTimeout(timeoutIdentifier);

            }

        }
    });

}
