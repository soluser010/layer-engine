import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LAYER_ERROR_CODES,
    LAYER_PROTOCOL_VERSION,
    LAYER_REQUEST_TYPES,
    LayerError,
    layerErrorResponseDataCreate,
    layerProtocolDataValidatorCreate,
    layerProtocolValidatorCreate,
    layerSuccessResponseDataCreate
} from '../src/index.js';

const requestIdentifier = '7ec2df78-6db4-4b35-8eb0-b2476bb10001';

/**
 * @param {string} type
 * @param {Record<string, unknown>} [overrideData]
 */
function requestDataCreate(type, overrideData = {}) {
    return {
        protocol: LAYER_PROTOCOL_VERSION,
        requestId: requestIdentifier,
        type,
        operation: 'chat.message.list',
        payload: {},
        ...overrideData
    };
}

test('exports stable protocol constants', () => {
    assert.equal(LAYER_PROTOCOL_VERSION, 1);
    assert.deepEqual(LAYER_REQUEST_TYPES, [
        'query',
        'command',
        'sync',
        'events.open'
    ]);
    assert.equal(LAYER_ERROR_CODES.INVALID_REQUEST, 'INVALID_REQUEST');
    assert.ok(Object.isFrozen(LAYER_REQUEST_TYPES));
    assert.ok(Object.isFrozen(LAYER_ERROR_CODES));
});

test('accepts valid query, command, sync, and events.open envelopes', () => {
    const protocolValidator = layerProtocolValidatorCreate();
    const protocolDataValidator = layerProtocolDataValidatorCreate();

    assert.equal(protocolValidator.requestValidate(requestDataCreate('query')).valid, true);
    assert.equal(protocolDataValidator.requestValidate(requestDataCreate('query')).valid, true);
    assert.equal(protocolValidator.requestValidate(requestDataCreate('command')).valid, true);
    assert.equal(protocolValidator.requestValidate(requestDataCreate('sync', {
        cursor: null
    })).valid, true);
    assert.equal(protocolValidator.requestValidate(requestDataCreate('events.open', {
        cursor: 'cursor-12'
    })).valid, true);
    assert.equal(protocolValidator.requestValidate(requestDataCreate('events.open', {
        cursor: {
            'conversation:1': 12,
            'notifications:user-1': 4
        }
    })).valid, true);
});

test('rejects extra fields, wrong versions, UUIDs, names, and cursor placement', () => {
    const protocolValidator = layerProtocolValidatorCreate();
    const invalidRequests = [
        requestDataCreate('query', {
            extra: true
        }),
        requestDataCreate('query', {
            protocol: 2
        }),
        requestDataCreate('query', {
            requestId: 'not-a-uuid'
        }),
        requestDataCreate('query', {
            operation: 'Invalid Operation'
        }),
        requestDataCreate('query', {
            cursor: null
        }),
        requestDataCreate('command', {
            cursor: 'cursor-1'
        }),
        requestDataCreate('unsupported'),
        requestDataCreate('query', {
            payload: []
        }),
        requestDataCreate('events.open', {
            cursor: {
                'invalid channel': -1
            }
        })
    ];

    for (const requestData of invalidRequests) {
        const validationResult = protocolValidator.requestValidate(requestData);

        assert.equal(validationResult.valid, false);
        assert.ok(validationResult.errors.length > 0);
        assert.equal(typeof validationResult.errors[0]?.keyword, 'string');
    }
});

test('validation does not coerce, default, remove, or mutate input', () => {
    const protocolValidator = layerProtocolValidatorCreate();
    const requestData = requestDataCreate('query', {
        protocol: '1',
        extra: true
    });
    const inputSnapshot = structuredClone(requestData);

    assert.equal(protocolValidator.requestValidate(requestData).valid, false);
    assert.deepEqual(requestData, inputSnapshot);
    assert.equal(requestData.protocol, '1');
    assert.equal(/** @type {Record<string, unknown>} */ (requestData).extra, true);
});

test('validates success, error, and domain event contracts', () => {
    const protocolValidator = layerProtocolValidatorCreate();
    const successData = layerSuccessResponseDataCreate({
        requestId: requestIdentifier,
        data: {
            accepted: true
        },
        meta: {
            durationMs: 4
        }
    });
    const errorData = layerErrorResponseDataCreate({
        requestId: requestIdentifier,
        error: new LayerError(
            LAYER_ERROR_CODES.RATE_LIMITED,
            'Try again later.',
            {
                details: {
                    retryAfterMs: 1000
                },
                retryable: true,
                status: 429
            }
        )
    });
    const eventData = {
        eventId: 'event-1',
        channel: 'conversation:1',
        sequence: 1,
        entityRevision: 2,
        type: 'chat.message.created',
        payload: {
            messageId: 'message-1'
        },
        occurredAt: '2026-09-18T09:00:00.000Z'
    };

    assert.equal(protocolValidator.successResponseValidate(successData).valid, true);
    assert.equal(protocolValidator.errorResponseValidate(errorData).valid, true);
    assert.equal(protocolValidator.eventValidate(eventData).valid, true);

    assert.equal(protocolValidator.successResponseValidate({
        ...successData,
        unexpected: true
    }).valid, false);
    assert.equal(protocolValidator.errorResponseValidate({
        ...errorData,
        error: {
            ...errorData.error,
            stack: 'secret stack'
        }
    }).valid, false);
    assert.equal(protocolValidator.eventValidate({
        ...eventData,
        sequence: 0
    }).valid, false);
});

test('creates a success response without optional metadata', () => {
    const responseData = layerSuccessResponseDataCreate({
        requestId: requestIdentifier,
        data: null
    });

    assert.deepEqual(responseData, {
        protocol: 1,
        requestId: requestIdentifier,
        ok: true,
        data: null
    });
});

test('LayerError keeps cause private and serializes only safe fields', () => {
    const internalCause = new Error('database password leaked here');
    const layerError = new LayerError(
        LAYER_ERROR_CODES.CONFLICT,
        'The entity changed.',
        {
            cause: internalCause,
            details: {
                currentRevision: 4
            },
            retryable: false,
            status: 409
        }
    );
    const serializedError = JSON.parse(JSON.stringify(layerError));

    assert.equal(layerError.internalCauseGet(), internalCause);
    assert.equal(layerError.status, 409);
    assert.deepEqual(serializedError, {
        code: LAYER_ERROR_CODES.CONFLICT,
        message: 'The entity changed.',
        retryable: false,
        details: {
            currentRevision: 4
        }
    });
    assert.equal('stack' in serializedError, false);
    assert.equal('cause' in serializedError, false);
});

test('unknown errors become a generic internal response', () => {
    const responseData = layerErrorResponseDataCreate({
        requestId: requestIdentifier,
        error: new Error('sensitive implementation detail')
    });

    assert.deepEqual(responseData.error, {
        code: LAYER_ERROR_CODES.INTERNAL_ERROR,
        message: 'An internal error occurred.',
        retryable: false,
        details: null
    });
    assert.equal(JSON.stringify(responseData).includes('sensitive'), false);
});

test('compiles application schemas in strict Draft 2020-12 mode', () => {
    const protocolValidator = layerProtocolValidatorCreate();
    const validate = protocolValidator.schemaCompile({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        unevaluatedProperties: false,
        properties: {
            value: {
                type: 'string'
            }
        }
    });

    assert.equal(validate({
        value: 'accepted'
    }), true);
    assert.equal(validate({
        value: 'accepted',
        extra: true
    }), false);
    assert.throws(() => {
        protocolValidator.schemaCompile({
            type: 'object',
            unknownKeyword: true
        });
    });
});
