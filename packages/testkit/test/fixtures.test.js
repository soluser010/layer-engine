import assert from 'node:assert/strict';
import test from 'node:test';
import {layerProtocolValidatorCreate} from '@solcorp/layer-protocol';
import {layerOperationRegistryCreate} from '@solcorp/layer-server';
import {
    layerErrorResponseFixtureCreate,
    layerEventFixtureCreate,
    layerOperationFixtureCreate,
    layerRequestFixtureCreate,
    layerSuccessResponseFixtureCreate
} from '../src/index.js';

test('creates fixtures accepted by their public validators', () => {
    const protocolValidator = layerProtocolValidatorCreate();
    const operationRegistry = layerOperationRegistryCreate();

    assert.equal(protocolValidator.requestValidate(layerRequestFixtureCreate()).valid, true);
    assert.equal(protocolValidator.successResponseValidate(layerSuccessResponseFixtureCreate()).valid, true);
    assert.equal(protocolValidator.errorResponseValidate(layerErrorResponseFixtureCreate()).valid, true);
    assert.equal(protocolValidator.eventValidate(layerEventFixtureCreate()).valid, true);
    assert.doesNotThrow(() => {
        operationRegistry.define(layerOperationFixtureCreate());
    });
});

test('applies nested overrides without shared mutable references', () => {
    const firstRequest = layerRequestFixtureCreate({
        payload: {
            page: 2
        }
    });
    const secondRequest = layerRequestFixtureCreate();
    const firstOperation = layerOperationFixtureCreate({
        inputSchema: {
            properties: {
                page: {
                    type: 'integer'
                }
            }
        }
    });
    const secondOperation = layerOperationFixtureCreate();
    const firstInputSchema = /** @type {{properties: {conversationId: {type: string}}}} */ (firstOperation.inputSchema);
    const secondInputSchema = /** @type {{properties: {conversationId: {type: string}}}} */ (secondOperation.inputSchema);

    firstRequest.payload.conversationId = 'changed';
    firstInputSchema.properties.conversationId.type = 'number';

    assert.deepEqual(firstRequest.payload, {
        conversationId: 'changed',
        page: 2
    });
    assert.equal(secondRequest.payload.conversationId, 'conversation-1');
    assert.equal(secondInputSchema.properties.conversationId.type, 'string');
    assert.notEqual(firstOperation.handler, secondOperation.handler);
});

test('operation fixture preserves an explicitly supplied handler', async () => {
    const handler = async () => ({
        custom: true
    });
    const operationData = layerOperationFixtureCreate({
        handler
    });

    assert.equal(operationData.handler, handler);
    assert.deepEqual(await operationData.handler(), {
        custom: true
    });
});
