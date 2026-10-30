import {
    LAYER_ERROR_CODES,
    LAYER_PROTOCOL_VERSION
} from '@solcorp/layer-protocol';

/**
 * @typedef {object} LayerRequestFixture
 * @property {number} protocol
 * @property {string} requestId
 * @property {string} type
 * @property {string} operation
 * @property {Record<string, unknown>} payload
 * @property {string | null} [cursor]
 */

/**
 * @typedef {object} LayerSuccessResponseFixture
 * @property {number} protocol
 * @property {string} requestId
 * @property {true} ok
 * @property {unknown} data
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {object} LayerErrorResponseFixture
 * @property {number} protocol
 * @property {string} requestId
 * @property {false} ok
 * @property {{code: string, message: string, retryable: boolean, details: Record<string, unknown> | null}} error
 */

/**
 * @typedef {object} LayerEventFixture
 * @property {string} eventId
 * @property {string} channel
 * @property {number} sequence
 * @property {number} entityRevision
 * @property {string} type
 * @property {Record<string, unknown>} payload
 * @property {string} occurredAt
 */

/**
 * @typedef {object} LayerOperationFixture
 * @property {string} name
 * @property {'query' | 'command' | 'sync' | 'events.open'} type
 * @property {Record<string, unknown>} inputSchema
 * @property {Record<string, unknown>} outputSchema
 * @property {(inputData: unknown, contextData: unknown) => unknown | Promise<unknown>} handler
 * @property {'session' | 'bearer' | 'api-key' | 'none'} [auth]
 * @property {readonly string[]} [permissions]
 * @property {string} [rateLimitBucket]
 * @property {number} [cost]
 * @property {number} [timeoutMs]
 * @property {number} [concurrency]
 * @property {boolean} [transaction]
 * @property {boolean} [offlineReplay]
 * @property {{enabled?: boolean, category?: string}} [audit]
 */

/**
 * @param {unknown} inputData
 * @returns {inputData is Record<string, unknown>}
 */
function plainObjectCheck(inputData) {
    return typeof inputData === 'object' && inputData !== null && !Array.isArray(inputData);
}

/**
 * @param {Record<string, unknown>} baseData
 * @param {Record<string, unknown>} overrideData
 * @returns {Record<string, unknown>}
 */
function fixtureDataMerge(baseData, overrideData) {
    const fixtureData = structuredClone(baseData);

    for (const [fieldName, fieldValue] of Object.entries(overrideData)) {
        const currentValue = fixtureData[fieldName];

        if (plainObjectCheck(currentValue) && plainObjectCheck(fieldValue)) {
            fixtureData[fieldName] = fixtureDataMerge(currentValue, fieldValue);
            continue;
        }

        fixtureData[fieldName] = structuredClone(fieldValue);
    }

    return fixtureData;
}

/**
 * @param {Record<string, unknown>} [overrideData]
 * @returns {LayerRequestFixture}
 */
export function layerRequestFixtureCreate(overrideData = {}) {
    return /** @type {LayerRequestFixture} */ (fixtureDataMerge({
        protocol: LAYER_PROTOCOL_VERSION,
        requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10001',
        type: 'query',
        operation: 'chat.message.list',
        payload: {
            conversationId: 'conversation-1'
        }
    }, overrideData));
}

/**
 * @param {Record<string, unknown>} [overrideData]
 * @returns {LayerSuccessResponseFixture}
 */
export function layerSuccessResponseFixtureCreate(overrideData = {}) {
    return /** @type {LayerSuccessResponseFixture} */ (fixtureDataMerge({
        protocol: LAYER_PROTOCOL_VERSION,
        requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10001',
        ok: true,
        data: {
            items: []
        }
    }, overrideData));
}

/**
 * @param {Record<string, unknown>} [overrideData]
 * @returns {LayerErrorResponseFixture}
 */
export function layerErrorResponseFixtureCreate(overrideData = {}) {
    return /** @type {LayerErrorResponseFixture} */ (fixtureDataMerge({
        protocol: LAYER_PROTOCOL_VERSION,
        requestId: '7ec2df78-6db4-4b35-8eb0-b2476bb10001',
        ok: false,
        error: {
            code: LAYER_ERROR_CODES.INVALID_REQUEST,
            message: 'The request is invalid.',
            retryable: false,
            details: null
        }
    }, overrideData));
}

/**
 * @param {Record<string, unknown>} [overrideData]
 * @returns {LayerEventFixture}
 */
export function layerEventFixtureCreate(overrideData = {}) {
    return /** @type {LayerEventFixture} */ (fixtureDataMerge({
        eventId: 'event-1',
        channel: 'conversation:1',
        sequence: 1,
        entityRevision: 1,
        type: 'chat.message.created',
        payload: {
            messageId: 'message-1'
        },
        occurredAt: '2026-09-18T09:00:00.000Z'
    }, overrideData));
}

/**
 * @param {Record<string, unknown> & {handler?: (inputData: unknown, contextData: unknown) => unknown | Promise<unknown>}} [overrideData]
 * @returns {LayerOperationFixture}
 */
export function layerOperationFixtureCreate(overrideData = {}) {
    const defaultHandler = async (/** @type {unknown} */ inputData) => {
        return inputData;
    };

    const handler = overrideData.handler ?? defaultHandler;
    const dataWithoutHandler = {
        ...overrideData
    };

    delete dataWithoutHandler.handler;

    const fixtureData = fixtureDataMerge({
        name: 'chat.message.list',
        type: 'query',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                conversationId: {
                    type: 'string'
                }
            }
        },
        outputSchema: {
            type: 'object',
            required: [
                'items'
            ],
            properties: {
                items: {
                    type: 'array'
                }
            }
        }
    }, dataWithoutHandler);

    return /** @type {LayerOperationFixture} */ ({
        ...fixtureData,
        handler
    });
}
