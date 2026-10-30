import {
    LAYER_ERROR_CODES,
    LAYER_PROTOCOL_VERSION,
    LAYER_REQUEST_TYPES
} from './constants.js';

const requestIdentifierSchema = Object.freeze({
    type: 'string',
    format: 'uuid'
});

export const layerRequestEnvelopeSchema = Object.freeze({
    $id: 'https://layer.engine/schemas/protocol/request-envelope.json',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [
        'protocol',
        'requestId',
        'type',
        'operation',
        'payload'
    ],
    properties: {
        protocol: {
            const: LAYER_PROTOCOL_VERSION
        },
        requestId: requestIdentifierSchema,
        type: {
            enum: LAYER_REQUEST_TYPES
        },
        operation: {
            type: 'string',
            minLength: 3,
            maxLength: 160,
            pattern: '^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*)+$'
        },
        payload: {
            type: 'object'
        },
        cursor: {
            anyOf: [
                {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2048
                },
                {
                    type: 'object',
                    propertyNames: {
                        pattern: '^[a-zA-Z0-9:_-]+$'
                    },
                    additionalProperties: {
                        type: 'integer',
                        minimum: 0
                    },
                    maxProperties: 50
                },
                {
                    type: 'null'
                }
            ]
        }
    },
    dependentSchemas: {
        cursor: {
            properties: {
                type: {
                    enum: [
                        'sync',
                        'events.open'
                    ]
                }
            }
        }
    }
});

export const layerSuccessResponseSchema = Object.freeze({
    $id: 'https://layer.engine/schemas/protocol/success-response.json',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [
        'protocol',
        'requestId',
        'ok',
        'data'
    ],
    properties: {
        protocol: {
            const: LAYER_PROTOCOL_VERSION
        },
        requestId: requestIdentifierSchema,
        ok: {
            const: true
        },
        data: {},
        meta: {
            type: 'object'
        }
    }
});

export const layerErrorResponseSchema = Object.freeze({
    $id: 'https://layer.engine/schemas/protocol/error-response.json',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [
        'protocol',
        'requestId',
        'ok',
        'error'
    ],
    properties: {
        protocol: {
            const: LAYER_PROTOCOL_VERSION
        },
        requestId: requestIdentifierSchema,
        ok: {
            const: false
        },
        error: {
            type: 'object',
            additionalProperties: false,
            required: [
                'code',
                'message',
                'retryable',
                'details'
            ],
            properties: {
                code: {
                    enum: Object.values(LAYER_ERROR_CODES)
                },
                message: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 500
                },
                retryable: {
                    type: 'boolean'
                },
                details: {
                    anyOf: [
                        {
                            type: 'object'
                        },
                        {
                            type: 'null'
                        }
                    ]
                }
            }
        }
    }
});

export const layerDomainEventSchema = Object.freeze({
    $id: 'https://layer.engine/schemas/protocol/domain-event.json',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [
        'eventId',
        'channel',
        'sequence',
        'entityRevision',
        'type',
        'payload',
        'occurredAt'
    ],
    properties: {
        eventId: {
            type: 'string',
            minLength: 1,
            maxLength: 160
        },
        channel: {
            type: 'string',
            minLength: 1,
            maxLength: 160,
            pattern: '^[a-zA-Z0-9:_-]+$'
        },
        sequence: {
            type: 'integer',
            minimum: 1
        },
        entityRevision: {
            type: 'integer',
            minimum: 0
        },
        type: {
            type: 'string',
            minLength: 3,
            maxLength: 160,
            pattern: '^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*)+$'
        },
        payload: {
            type: 'object'
        },
        occurredAt: {
            type: 'string',
            format: 'date-time'
        }
    }
});
