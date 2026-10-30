import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import test from 'node:test';
import {
    LayerRuntimeError,
    layerDevtoolsCreate,
    layerDevtoolsPanelCreate
} from '../src/index.js';

test('DevTools snapshots clone, bound, and redact provider data', async () => {
    const devtools = layerDevtoolsCreate({
        enabled: true,
        sensitiveFields: ['personalEmail'],
        maximumDepth: 3,
        maximumEntries: 100,
        maximumStringLength: 40,
        timeCreate: () => '2026-09-18T12:00:00.000Z'
    });
    const disposeProvider = devtools.register('outbox', () => ({
        queued: 2,
        command: {
            commandId: 'command-1',
            csrfToken: 'private-csrf',
            personal_email: 'private@example.com',
            payload: {
                messageBody: 'private body',
                nested: {
                    deeper: {
                        value: true
                    }
                }
            }
        },
        generated: new Date('2026-09-18T10:00:00.000Z'),
        count: 9n,
        handler() {}
    }));
    devtools.register('events', async () => {
        throw new Error('provider unavailable');
    });

    const snapshot = await devtools.snapshot({
        export: true,
        consent: true
    });
    const outboxSection = /** @type {any} */ (snapshot.sections.outbox);
    const eventSection = /** @type {any} */ (snapshot.sections.events);

    assert.equal(snapshot.generatedAt, '2026-09-18T12:00:00.000Z');
    assert.equal(snapshot.export, true);
    assert.equal(outboxSection.command.csrfToken, '[REDACTED]');
    assert.equal(outboxSection.command.personal_email, '[REDACTED]');
    assert.equal(outboxSection.command.payload.messageBody, '[REDACTED]');
    assert.equal(outboxSection.command.payload.nested, '[MAX_DEPTH]');
    assert.equal(outboxSection.generated, '2026-09-18T10:00:00.000Z');
    assert.equal(outboxSection.count, '9');
    assert.equal(outboxSection.handler, '[UNAVAILABLE]');
    assert.equal(eventSection.status, 'failed');
    assert.deepEqual(eventSection.error, {
        name: 'Error',
        message: 'provider unavailable'
    });
    assert.deepEqual(devtools.list(), ['outbox', 'events']);
    assert.equal(disposeProvider(), true);
    assert.deepEqual(devtools.list(), ['events']);
});

test('DevTools fail closed for disabled, duplicate, unknown, and unconsented access', async () => {
    const disabledDevtools = layerDevtoolsCreate();

    assert.throws(() => disabledDevtools.register('events', () => ({})), (errorData) => {
        return errorData instanceof LayerRuntimeError && errorData.code === 'DEVTOOLS_DISABLED';
    });
    await assert.rejects(() => disabledDevtools.snapshot(), (errorData) => {
        return /** @type {any} */ (errorData).code === 'DEVTOOLS_DISABLED';
    });

    const devtools = layerDevtoolsCreate({enabled: true});
    devtools.register('events', () => ({connected: true}));
    assert.throws(() => devtools.register('events', () => ({})), (errorData) => {
        return /** @type {any} */ (errorData).code === 'DEVTOOLS_PROVIDER_DUPLICATE';
    });
    await assert.rejects(() => devtools.snapshot({export: true}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'DEVTOOLS_EXPORT_CONSENT_REQUIRED';
    });
    await assert.rejects(() => devtools.snapshot({include: ['missing']}), (errorData) => {
        return /** @type {any} */ (errorData).code === 'DEVTOOLS_PROVIDER_UNKNOWN';
    });
    assert.throws(() => layerDevtoolsCreate({maximumDepth: 0}), TypeError);
    assert.throws(() => layerDevtoolsCreate({
        enabled: true,
        sensitiveFields: ['invalid field']
    }), TypeError);
});

test('DevTools panel renders redacted text and exports only after consent', async () => {
    const domData = new JSDOM('<!doctype html><body><main id="app"></main></body>');
    const devtools = layerDevtoolsCreate({
        enabled: true,
        timeCreate: () => '2026-09-18T12:00:00.000Z'
    });
    devtools.register('runtime', () => ({
        connected: true,
        password: 'private-password',
        label: '<img src=x onerror=alert(1)>'
    }));
    let consentStatus = false;
    let exportedData = '';
    const panel = layerDevtoolsPanelCreate({
        devtools,
        document: domData.window.document,
        exportConfirm: () => consentStatus,
        exportWrite(exportData) {
            exportedData = exportData;
        }
    });
    const mountTarget = domData.window.document.querySelector('#app');
    assert.ok(mountTarget);
    panel.mount(mountTarget);
    await panel.refresh();

    assert.match(panel.element.shadowRoot?.textContent ?? '', /\[REDACTED\]/);
    assert.doesNotMatch(panel.element.shadowRoot?.textContent ?? '', /private-password/);
    assert.equal(panel.element.shadowRoot?.querySelector('img'), null);
    assert.equal(await panel.export(), null);
    consentStatus = true;
    assert.match(await panel.export() ?? '', /"export": true/);
    assert.match(exportedData, /"runtime"/);
    assert.equal(panel.destroy(), true);
    assert.equal(panel.destroy(), false);
    await assert.rejects(() => panel.refresh(), (errorData) => {
        return /** @type {any} */ (errorData).code === 'DEVTOOLS_PANEL_DESTROYED';
    });
    await assert.rejects(() => panel.export(), (errorData) => {
        return /** @type {any} */ (errorData).code === 'DEVTOOLS_PANEL_DESTROYED';
    });
});

test('DevTools panel rejects foreign mounts and renders bounded failures', async () => {
    const domData = new JSDOM('<!doctype html><body><main id="app"></main></body>');
    const foreignDom = new JSDOM('<!doctype html><body></body>');
    const runtimeFailurePanel = layerDevtoolsPanelCreate({
        document: domData.window.document,
        devtools: {
            list: () => ['runtime'],
            async snapshot() {
                throw new LayerRuntimeError('DEVTOOLS_PROVIDER_FAILED', 'Provider failed safely.');
            }
        }
    });
    const unknownFailurePanel = layerDevtoolsPanelCreate({
        document: domData.window.document,
        devtools: {
            list: () => ['runtime'],
            async snapshot() {
                throw new Error('private provider failure');
            }
        }
    });

    assert.throws(() => layerDevtoolsPanelCreate(/** @type {any} */ ({
        document: {},
        devtools: {}
    })), TypeError);
    assert.throws(() => runtimeFailurePanel.mount(foreignDom.window.document.body), (errorData) => {
        return /** @type {any} */ (errorData).code === 'DEVTOOLS_PANEL_MOUNT_INVALID';
    });
    assert.equal(await runtimeFailurePanel.export(), null);
    await assert.rejects(() => runtimeFailurePanel.refresh(), LayerRuntimeError);
    assert.match(runtimeFailurePanel.element.shadowRoot?.textContent ?? '', /DEVTOOLS_PROVIDER_FAILED/);
    await assert.rejects(() => unknownFailurePanel.refresh(), Error);
    assert.match(unknownFailurePanel.element.shadowRoot?.textContent ?? '', /DEVTOOLS_PANEL_FAILED/);
    assert.doesNotMatch(unknownFailurePanel.element.shadowRoot?.textContent ?? '', /private provider failure/);
});
