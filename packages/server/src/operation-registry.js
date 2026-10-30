import {
    LAYER_ERROR_CODES,
    LAYER_REQUEST_TYPES,
    LayerError,
    layerProtocolValidatorCreate
} from '@solcorp/layer-protocol';
import {layerSystemOperationCheck} from './system-operation.js';

const operationDefinitionFields = Object.freeze([
    'audit',
    'auth',
    'authorize',
    'cache',
    'cacheInvalidation',
    'concurrency',
    'cost',
    'handler',
    'inputSchema',
    'name',
    'offlineReplay',
    'outputSchema',
    'permissions',
    'rateLimitBucket',
    'timeoutMs',
    'transaction',
    'type'
]);

const operationAuthTypes = Object.freeze([
    'session',
    'authenticated',
    'bearer',
    'api-key',
    'none'
]);

/**
 * @typedef {'query' | 'command' | 'sync' | 'events.open'} LayerOperationType
 * @typedef {'session' | 'authenticated' | 'bearer' | 'api-key' | 'none'} LayerOperationAuth
 * @typedef {object} LayerOperationDefinition
 * @property {string} name
 * @property {LayerOperationType} type
 * @property {object | boolean} inputSchema
 * @property {object | boolean} outputSchema
 * @property {(inputData: unknown, contextData: unknown) => unknown | Promise<unknown>} handler
 * @property {((inputData: unknown, contextData: unknown) => boolean | Promise<boolean>) | null} [authorize]
 * @property {LayerOperationAuth} [auth]
 * @property {readonly string[]} [permissions]
 * @property {string} [rateLimitBucket]
 * @property {number} [cost]
 * @property {number} [timeoutMs]
 * @property {number} [concurrency]
 * @property {boolean} [transaction]
 * @property {boolean} [offlineReplay]
 * @property {{enabled?: boolean, category?: string}} [audit]
 * @property {{ttlMs: number, scope: 'global' | 'tenant' | 'user', tags?: readonly string[]} | null} [cache]
 * @property {{scope: 'global' | 'tenant' | 'user', tags: readonly string[]} | null} [cacheInvalidation]
 * @typedef {LayerOperationDefinition & {system: boolean, auth: LayerOperationAuth, authorize: ((inputData: unknown, contextData: unknown) => boolean | Promise<boolean>) | null, permissions: readonly string[], rateLimitBucket: string, cost: number, timeoutMs: number, concurrency: number, transaction: boolean, offlineReplay: boolean, audit: {enabled: boolean, category: string}, cache: {ttlMs: number, scope: 'global' | 'tenant' | 'user', tags: readonly string[]} | null, cacheInvalidation: {scope: 'global' | 'tenant' | 'user', tags: readonly string[]} | null}} LayerNormalizedOperation
 * @typedef {((inputData: unknown) => boolean) & {errors?: readonly {instancePath: string, keyword: string}[] | null}} LayerCompiledValidator
 * @typedef {LayerNormalizedOperation & {inputValidate: LayerCompiledValidator, outputValidate: LayerCompiledValidator}} LayerRegisteredOperation
 */

/**
 * @param {unknown} inputData
 * @returns {inputData is Record<string, unknown>}
 */
function plainObjectCheck(inputData) {
    if (typeof inputData !== 'object' || inputData === null) {
        return false;
    }

    return !Array.isArray(inputData);
}

/**
 * @param {unknown} valueData
 * @returns {asserts valueData is Record<string, unknown>}
 */
function operationDefinitionObjectAssert(valueData) {
    if (!plainObjectCheck(valueData)) {
        throw operationDefinitionErrorCreate('Operation definition must be an object.');
    }
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {LayerError}
 */
function operationDefinitionErrorCreate(message, details = {}) {
    return new LayerError(
        LAYER_ERROR_CODES.INVALID_OPERATION_DEFINITION,
        message,
        {
            details,
            status: 500
        }
    );
}

/**
 * @param {Record<string, unknown>} definitionData
 */
function unknownDefinitionFieldsAssert(definitionData) {
    const unknownFields = Object.keys(definitionData).filter((fieldName) => {
        return !operationDefinitionFields.includes(fieldName);
    });

    if (unknownFields.length > 0) {
        throw operationDefinitionErrorCreate(
            'Operation definition contains unknown fields.',
            {
                fields: unknownFields
            }
        );
    }
}

/**
 * @param {string} fieldName
 * @param {unknown} fieldValue
 * @param {number} minimumValue
 * @param {number} maximumValue
 */
function boundedIntegerAssert(fieldName, fieldValue, minimumValue, maximumValue) {
    if (!Number.isInteger(fieldValue)) {
        throw operationDefinitionErrorCreate(`${fieldName} must be an integer.`);
    }

    if (/** @type {number} */ (fieldValue) < minimumValue || /** @type {number} */ (fieldValue) > maximumValue) {
        throw operationDefinitionErrorCreate(
            `${fieldName} must be between ${minimumValue} and ${maximumValue}.`
        );
    }
}

/**
 * @param {unknown} auditData
 * @returns {{enabled: boolean, category: string}}
 */
function operationAuditNormalize(auditData) {
    if (auditData === undefined) {
        return {
            enabled: true,
            category: 'metadata'
        };
    }

    operationDefinitionObjectAssert(auditData);

    const unknownFields = Object.keys(auditData).filter((fieldName) => {
        return fieldName !== 'enabled' && fieldName !== 'category';
    });

    if (unknownFields.length > 0) {
        throw operationDefinitionErrorCreate(
            'Audit metadata contains unknown fields.',
            {
                fields: unknownFields
            }
        );
    }

    const enabled = auditData.enabled ?? true;
    const category = auditData.category ?? 'metadata';

    if (typeof enabled !== 'boolean') {
        throw operationDefinitionErrorCreate('audit.enabled must be a boolean.');
    }

    if (typeof category !== 'string' || category.length === 0 || category.length > 80) {
        throw operationDefinitionErrorCreate('audit.category must be a non-empty string up to 80 characters.');
    }

    return {
        enabled,
        category
    };
}

/**
 * @param {unknown} cacheData
 * @param {LayerOperationType} operationTypeData
 * @param {LayerOperationAuth} authenticationTypeData
 */
function operationCacheNormalize( cacheData, operationTypeData, authenticationTypeData ){
    if ( cacheData === undefined || cacheData === null ){
        return null;

    }

    operationDefinitionObjectAssert( cacheData );

    const unknownFieldsData = Object.keys( cacheData ).filter(function cacheFieldUnknown( fieldNameData ){
        return ['scope', 'tags', 'ttlMs'].includes( fieldNameData ) === false;

    });

    if ( Number( unknownFieldsData.length ) > Number( 0 ) ){
        throw operationDefinitionErrorCreate( 'Cache metadata contains unknown fields.', {
            fields: unknownFieldsData
        });

    }

    if ( operationTypeData !== 'query' ){
        throw operationDefinitionErrorCreate( 'Only query operations may enable result cache.' );

    }

    const timeToLiveData = cacheData.ttlMs;
    const cacheScopeData = cacheData.scope;
    const cacheTagsInputData = cacheData.tags ?? [];

    boundedIntegerAssert( 'cache.ttlMs', timeToLiveData, 100, 3600000 );

    if ( ['global', 'tenant', 'user'].includes( String( cacheScopeData ) ) === false ){
        throw operationDefinitionErrorCreate( 'cache.scope must be global, tenant, or user.' );

    }

    if ( authenticationTypeData === 'none' && cacheScopeData !== 'global' ){
        throw operationDefinitionErrorCreate( 'Public query cache must use global scope.' );

    }

    if (
        Array.isArray( cacheTagsInputData ) === false ||
        Number( cacheTagsInputData.length ) > Number( 16 )
    ){
        throw operationDefinitionErrorCreate( 'cache.tags must contain at most 16 tags.' );

    }

    const cacheTagsData = cacheTagsInputData.map(function cacheTagNormalize( tagData ){
        if (
            typeof tagData !== 'string' ||
            /^[a-z][a-z0-9:_-]{0,79}$/.test( tagData ) === false
        ){
            throw operationDefinitionErrorCreate( 'Each cache tag must use a stable lowercase identifier.' );

        }

        return tagData;

    });

    if ( Number( new Set( cacheTagsData ).size ) !== Number( cacheTagsData.length ) ){
        throw operationDefinitionErrorCreate( 'cache.tags must not contain duplicates.' );

    }

    return Object.freeze({
        ttlMs: Number( timeToLiveData ),
        scope: /** @type {'global' | 'tenant' | 'user'} */ (cacheScopeData),
        tags: Object.freeze( cacheTagsData )
    });

}

/**
 * @param {unknown} invalidationData
 * @param {LayerOperationType} operationTypeData
 * @param {LayerOperationAuth} authenticationTypeData
 * @param {boolean} transactionStatusData
 */
function operationCacheInvalidationNormalize(
    invalidationData,
    operationTypeData,
    authenticationTypeData,
    transactionStatusData
){
    if ( invalidationData === undefined || invalidationData === null ){
        return null;

    }

    operationDefinitionObjectAssert( invalidationData );

    const unknownFieldsData = Object.keys( invalidationData ).filter(function invalidationFieldUnknown( fieldNameData ){
        return ['scope', 'tags'].includes( fieldNameData ) === false;

    });

    if ( Number( unknownFieldsData.length ) > Number( 0 ) ){
        throw operationDefinitionErrorCreate( 'Cache invalidation metadata contains unknown fields.', {
            fields: unknownFieldsData
        });

    }

    if ( operationTypeData !== 'command' || transactionStatusData !== true ){
        throw operationDefinitionErrorCreate( 'Cache invalidation requires a transactional command.' );

    }

    const cacheScopeData = invalidationData.scope;
    const cacheTagsInputData = invalidationData.tags;

    if ( ['global', 'tenant', 'user'].includes( String( cacheScopeData ) ) === false ){
        throw operationDefinitionErrorCreate( 'cacheInvalidation.scope must be global, tenant, or user.' );

    }

    if ( authenticationTypeData === 'none' && cacheScopeData !== 'global' ){
        throw operationDefinitionErrorCreate( 'Public cache invalidation must use global scope.' );

    }

    if (
        Array.isArray( cacheTagsInputData ) === false ||
        Number( cacheTagsInputData.length ) < Number( 1 ) ||
        Number( cacheTagsInputData.length ) > Number( 16 )
    ){
        throw operationDefinitionErrorCreate( 'cacheInvalidation.tags must contain between 1 and 16 tags.' );

    }

    const cacheTagsData = cacheTagsInputData.map(function cacheInvalidationTagNormalize( tagData ){
        if ( typeof tagData !== 'string' || /^[a-z][a-z0-9:_-]{0,79}$/.test( tagData ) === false ){
            throw operationDefinitionErrorCreate( 'Each cache invalidation tag must use a stable lowercase identifier.' );

        }

        return tagData;

    });

    if ( Number( new Set( cacheTagsData ).size ) !== Number( cacheTagsData.length ) ){
        throw operationDefinitionErrorCreate( 'cacheInvalidation.tags must not contain duplicates.' );

    }

    return Object.freeze({
        scope: /** @type {'global' | 'tenant' | 'user'} */ (cacheScopeData),
        tags: Object.freeze( cacheTagsData )
    });

}

/**
 * @param {unknown} permissionsData
 * @returns {readonly string[]}
 */
function operationPermissionsNormalize(permissionsData) {
    if (permissionsData === undefined) {
        return Object.freeze([]);
    }

    if (!Array.isArray(permissionsData)) {
        throw operationDefinitionErrorCreate('permissions must be an array.');
    }

    const permissions = permissionsData.map((permissionData) => {
        if (typeof permissionData !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(permissionData)) {
            throw operationDefinitionErrorCreate('Each permission must use a dotted lowercase name.');
        }

        return permissionData;
    });

    if (new Set(permissions).size !== permissions.length) {
        throw operationDefinitionErrorCreate('permissions must not contain duplicates.');
    }

    return Object.freeze(permissions);
}

/**
 * @param {Record<string, unknown>} definitionData
 */
function operationDefinitionRequiredFieldsAssert(definitionData) {
    if (typeof definitionData.name !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(definitionData.name)) {
        throw operationDefinitionErrorCreate('name must use a dotted lowercase operation name.');
    }

    if (definitionData.name.length > 160) {
        throw operationDefinitionErrorCreate('name must not exceed 160 characters.');
    }

    if (typeof definitionData.type !== 'string' || !LAYER_REQUEST_TYPES.includes(definitionData.type)) {
        throw operationDefinitionErrorCreate('type must be a supported protocol request type.');
    }

    if (typeof definitionData.handler !== 'function') {
        throw operationDefinitionErrorCreate('handler must be a function.');
    }

    if ((!plainObjectCheck(definitionData.inputSchema) && typeof definitionData.inputSchema !== 'boolean') ||
        (!plainObjectCheck(definitionData.outputSchema) && typeof definitionData.outputSchema !== 'boolean')) {
        throw operationDefinitionErrorCreate('inputSchema and outputSchema must be JSON Schema objects or booleans.');
    }
}

/**
 * @param {LayerOperationType} operationType
 * @returns {number}
 */
function operationTimeoutDefaultGet(operationType) {
    if (operationType === 'command') {
        return 15000;
    }

    return 10000;
}

/**
 * @param {Record<string, unknown>} definitionData
 */
function operationCombinationAssert(definitionData) {
    if (definitionData.transaction === true && definitionData.type !== 'command') {
        throw operationDefinitionErrorCreate('Only command operations may start a transaction.');
    }

    if (definitionData.offlineReplay === true && definitionData.type !== 'command') {
        throw operationDefinitionErrorCreate('Only command operations may allow offline replay.');
    }

    if (definitionData.offlineReplay === true && definitionData.transaction !== true) {
        throw operationDefinitionErrorCreate('offlineReplay requires transaction to be enabled.');
    }

    if (definitionData.auth === 'none' && /** @type {readonly string[]} */ (definitionData.permissions).length > 0) {
        throw operationDefinitionErrorCreate('Public operations cannot require authenticated permissions.');
    }
}

/**
 * @param {LayerOperationDefinition} definitionData
 * @returns {LayerNormalizedOperation}
 */
function operationDefinitionNormalize(definitionData) {
    operationDefinitionObjectAssert(definitionData);
    const definitionRecord = /** @type {Record<string, unknown>} */ (definitionData);

    unknownDefinitionFieldsAssert(definitionRecord);
    operationDefinitionRequiredFieldsAssert(definitionRecord);

    const auth = definitionData.auth ?? 'session';
    const authorize = definitionData.authorize ?? null;
    const permissions = operationPermissionsNormalize(definitionData.permissions);
    const rateLimitBucket = definitionData.rateLimitBucket ?? 'operation.default';
    const cost = definitionData.cost ?? 1;
    const timeoutMs = definitionData.timeoutMs ?? operationTimeoutDefaultGet(definitionData.type);
    const concurrency = definitionData.concurrency ?? 32;
    const transaction = definitionData.transaction ?? false;
    const offlineReplay = definitionData.offlineReplay ?? false;
    const audit = operationAuditNormalize(definitionData.audit);
    const cache = operationCacheNormalize( definitionData.cache, definitionData.type, auth );
    const cacheInvalidation = operationCacheInvalidationNormalize(
        definitionData.cacheInvalidation,
        definitionData.type,
        auth,
        transaction
    );
    const system = layerSystemOperationCheck( definitionData );

    if (!operationAuthTypes.includes(auth)) {
        throw operationDefinitionErrorCreate('auth must use a supported authentication mode.');
    }

    if (authorize !== null && typeof authorize !== 'function') {
        throw operationDefinitionErrorCreate('authorize must be a function or null.');
    }

    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(rateLimitBucket)) {
        throw operationDefinitionErrorCreate('rateLimitBucket must use a stable lowercase identifier.');
    }

    boundedIntegerAssert('cost', cost, 1, 1000);
    boundedIntegerAssert('timeoutMs', timeoutMs, 100, 120000);
    boundedIntegerAssert('concurrency', concurrency, 1, 10000);

    if (typeof transaction !== 'boolean' || typeof offlineReplay !== 'boolean') {
        throw operationDefinitionErrorCreate('transaction and offlineReplay must be booleans.');
    }

    const normalizedDefinition = {
        ...definitionData,
        system,
        auth,
        authorize,
        permissions,
        rateLimitBucket,
        cost,
        timeoutMs,
        concurrency,
        transaction,
        offlineReplay,
        audit: Object.freeze(audit),
        cache,
        cacheInvalidation
    };

    operationCombinationAssert(normalizedDefinition);

    return Object.freeze(normalizedDefinition);
}

/**
 * @param {ReturnType<typeof operationDefinitionNormalize>} operationData
 */
function operationInspectionDataCreate(operationData) {
    return Object.freeze({
        name: operationData.name,
        type: operationData.type,
        auth: operationData.auth,
        permissions: operationData.permissions,
        rateLimitBucket: operationData.rateLimitBucket,
        cost: operationData.cost,
        timeoutMs: operationData.timeoutMs,
        concurrency: operationData.concurrency,
        transaction: operationData.transaction,
        offlineReplay: operationData.offlineReplay,
        audit: operationData.audit,
        cache: operationData.cache,
        cacheInvalidation: operationData.cacheInvalidation
    });
}

export function layerOperationRegistryCreate() {
    const protocolValidator = layerProtocolValidatorCreate();
    const operationMap = /** @type {Map<string, LayerRegisteredOperation>} */ (new Map());
    let sealed = false;

    return Object.freeze({
        /**
         * @param {LayerOperationDefinition} definitionData
         */
        define(definitionData) {
            if (sealed) {
                throw new LayerError(
                    LAYER_ERROR_CODES.OPERATION_REGISTRY_SEALED,
                    'The operation registry is sealed.',
                    {
                        status: 500
                    }
                );
            }

            const operationData = operationDefinitionNormalize(definitionData);

            if (operationMap.has(operationData.name)) {
                throw new LayerError(
                    LAYER_ERROR_CODES.OPERATION_DUPLICATE,
                    `Operation ${operationData.name} is already registered.`,
                    {
                        details: {
                            operation: operationData.name
                        },
                        status: 500
                    }
                );
            }

            try {
                const inputValidate = protocolValidator.schemaCompile(operationData.inputSchema);
                const outputValidate = protocolValidator.schemaCompile(operationData.outputSchema);

                operationMap.set(operationData.name, Object.freeze(/** @type {LayerRegisteredOperation} */ ({
                    ...operationData,
                    inputValidate,
                    outputValidate
                })));
            } catch (errorData) {
                throw new LayerError(
                    LAYER_ERROR_CODES.INVALID_OPERATION_SCHEMA,
                    `Operation ${operationData.name} contains an invalid JSON Schema.`,
                    {
                        cause: errorData,
                        details: {
                            operation: operationData.name
                        },
                        status: 500
                    }
                );
            }

            return operationInspectionDataCreate(operationData);
        },

        /**
         * Internal runtime lookup. This includes the handler and compiled validators.
         *
         * @param {string} operationName
         */
        get(operationName) {
            return operationMap.get(operationName);
        },

        /**
         * @param {string} operationName
         */
        has(operationName) {
            return operationMap.has(operationName);
        },

        list() {
            return Object.freeze(
                Array.from(operationMap.values(), (operationData) => {
                    return operationInspectionDataCreate(operationData);
                })
            );
        },

        seal() {
            sealed = true;
        },

        isSealed() {
            return sealed;
        }
    });
}
