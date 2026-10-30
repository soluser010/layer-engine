import {
    expect,
    test
} from '@playwright/test';
import {layerComponentCompile} from '@solcorp/layer-compiler';

const browserComponent = layerComponentCompile(`
<template>
    <section class="browser-card" :data-state="state">
        <h1>{{ title }}</h1>
        <ul>
            <li l-for="item in items" l-key="item.id">{{ item.label }}</li>
        </ul>
    </section>
</template>
<script>
export const route = {};
</script>
<style scoped>
.browser-card { display: block; }
</style>
`, {
    componentId: 'browser/matrix-card'
});
const developmentReloadAssertionTimeout = 15000;

test.beforeEach(async function browserHarnessOpen({page}) {
    //Waiting for native ESM imports before starting each browser contract.
    await page.goto('/browser-tests/harness.html');
    await page.waitForFunction(() => window.layerBrowser !== undefined);

});

test('development host reloads templates and CSS and recovers from a build error', async function developmentReloadCheck({page, request}, testInfo) {
    test.skip(testInfo.project.name !== 'chrome', 'The live reload browser gate runs once in the Chrome project.');
    test.setTimeout(90000);

    //Restoring the canonical development source before opening the controlled application.
    await request.post('/__test/live-reload', {
        data: {
            action: 'reset'
        }
    });
    await page.goto('http://127.0.0.1:5331/?mode=live#current');
    await page.evaluate(async () => navigator.serviceWorker.ready);

    if (await page.evaluate(() => navigator.serviceWorker.controller === null)) {
        await page.reload();

    }

    await expect(page.locator('[data-layer-root] h1')).toHaveText('browser-development', {
        timeout: developmentReloadAssertionTimeout
    });

    //Changing markup and CSS through the real watched source file.
    const updateResponse = await request.post('/__test/live-reload', {
        data: {
            action: 'update'
        }
    });
    expect(updateResponse.status()).toBe(202);
    await expect(page.locator('[data-layer-root] h1')).toHaveText('Live reload updated', {
        timeout: developmentReloadAssertionTimeout
    });
    await expect(page.locator('main')).toHaveCSS('display', 'grid', {
        timeout: developmentReloadAssertionTimeout
    });
    expect(page.url()).toContain('/?mode=live#current');
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    //Keeping the last working document while the next build is invalid.
    await request.post('/__test/live-reload', {
        data: {
            action: 'error'
        }
    });
    await expect(page.locator('#layer-development-error')).toContainText('CLI_', {
        timeout: developmentReloadAssertionTimeout
    });
    await expect(page.locator('[data-layer-root] h1')).toHaveText('Live reload updated', {
        timeout: developmentReloadAssertionTimeout
    });

    //Fixing the source and waiting for the next successful revision reload.
    await request.post('/__test/live-reload', {
        data: {
            action: 'recover'
        }
    });
    await expect(page.locator('[data-layer-root] h1')).toHaveText('Live reload recovered', {
        timeout: developmentReloadAssertionTimeout
    });
    await expect(page.locator('main')).toHaveCSS('display', 'flex', {
        timeout: developmentReloadAssertionTimeout
    });
    await expect(page.locator('#layer-development-error')).toHaveCount(0, {
        timeout: developmentReloadAssertionTimeout
    });
    expect(page.url()).toContain('/?mode=live#current');

});

test('partial DOM bindings preserve nodes in a real browser', async function partialDomCheck({page}) {
    const resultData = await page.evaluate(async (componentData) => {
        const browserApi = /** @type {any} */ (window).layerBrowser;
        const rootNode = document.querySelector('#layer-browser-root');
        const titleSignal = browserApi.signal('Initial');
        const stateSignal = browserApi.signal('ready');
        const itemsSignal = browserApi.signal([
            {id: 'one', label: 'One'},
            {id: 'two', label: 'Two'}
        ]);

        browserApi.layerComponentMount(componentData, rootNode, {
            title: titleSignal,
            state: stateSignal,
            items: itemsSignal
        });

        const cardNode = rootNode.querySelector('.browser-card');
        const firstItemNode = rootNode.querySelector('li');

        titleSignal.set('Updated');
        stateSignal.set('synced');
        itemsSignal.set([
            {id: 'one', label: 'One updated'},
            {id: 'two', label: 'Two'}
        ]);
        await browserApi.layerCommitWait();

        return {
            cardPreserved: rootNode.querySelector('.browser-card') === cardNode,
            firstItemPreserved: rootNode.querySelector('li') === firstItemNode,
            state: cardNode.getAttribute('data-state'),
            text: rootNode.querySelector('h1').textContent,
            firstItemText: rootNode.querySelector('li').textContent
        };
    }, browserComponent);

    expect(resultData).toEqual({
        cardPreserved: true,
        firstItemPreserved: true,
        state: 'synced',
        text: 'Updated',
        firstItemText: 'One updated'
    });
});

test('IndexedDB schema and user purge work in a real browser', async function indexedDbCheck({page}, testInfo) {
    const resultData = await page.evaluate(async ({namespaceData}) => {
        const browserApi = /** @type {any} */ (window).layerBrowser;
        const schemaData = browserApi.layerStorageSchemaDefine({
            name: 'browser-notes',
            version: 1,
            stores: {
                notes: {
                    keyPath: 'id',
                    indexes: {
                        updated_at: {keyPath: 'updatedAt'}
                    }
                }
            },
            migrations: {
                1(migrationData) {
                    migrationData.createStore('notes');
                    migrationData.createIndex('notes', 'updated_at');
                }
            }
        });
        const storageData = await browserApi.layerStorageOpen({
            appId: 'browser-matrix',
            namespace: namespaceData,
            schema: schemaData,
            indexedDb: window.indexedDB,
            storageManager: navigator.storage
        });

        await storageData.put('notes', {
            id: 'note-1',
            text: 'Offline ready',
            updatedAt: 1
        });
        const storedNote = await storageData.get('notes', 'note-1');
        await storageData.purgeUserData();

        return storedNote;
    }, {
        namespaceData: `${testInfo.project.name}-${Date.now()}`
    });

    expect(resultData).toEqual({
        id: 'note-1',
        text: 'Offline ready',
        updatedAt: 1
    });
});

test('Web Share Target POST survives a real browser IndexedDB handoff once', async function shareTargetBrowserCheck({page}, testInfo) {
    const resultData = await page.evaluate(async ({applicationId}) => {
        const browserApi = /** @type {any} */ (window).layerBrowser;
        const shareTarget = {
            action: '/receive?source=os',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
                title: 'title',
                text: 'text',
                files: [{
                    name: 'files',
                    accept: [
                        'text/plain',
                        '.txt'
                    ]
                }]
            }
        };
        const shareCapture = browserApi.layerWorkerShareTargetCaptureCreate({
            appId: applicationId,
            applicationOrigin: location.origin,
            shareTarget,
            shareIdCreate() {
                //Using the browser cryptographic UUID source for the redirect identity.
                return crypto.randomUUID();

            },
            indexedDb: window.indexedDB
        });
        const sharedForm = new FormData();

        sharedForm.set('title', 'Browser share');
        sharedForm.set('text', 'Persisted through IndexedDB');
        sharedForm.append('files', new File(['browser-file'], 'note.txt', {
            type: 'text/plain'
        }));

        //Capturing the operating-system POST before the application consumes it.
        let shareIdentifier;

        try {
            shareIdentifier = await shareCapture(new Request(
                location.origin + '/receive?source=os',
                {
                    method: 'POST',
                    body: sharedForm
                }
            ));

        } catch (captureError) {
            const internalCause = /** @type {any} */ (captureError).cause;

            //Exposing only native error class/message inside the isolated browser test diagnostic.
            throw new Error(
                'Share capture failed: ' + String(internalCause?.name) + ': ' + String(internalCause?.message),
                {cause: captureError}
            );

        }
        const shareInbox = browserApi.layerShareTargetInboxCreate({
            appId: applicationId,
            indexedDb: window.indexedDB
        });
        const sharedRecord = await shareInbox.consume(shareIdentifier);
        const resultRecord = {
            identifierValid: /^[0-9a-f-]{36}$/.test(shareIdentifier),
            title: sharedRecord?.title,
            text: sharedRecord?.text,
            fileName: sharedRecord?.files[0]?.name,
            fileType: sharedRecord?.files[0]?.type,
            fileText: await sharedRecord?.files[0]?.blob.text(),
            frozen: Object.isFrozen(sharedRecord),
            secondConsume: await shareInbox.consume(shareIdentifier)
        };

        //Removing the isolated temporary inbox after the one-time delivery check.
        await shareInbox.purge();

        return resultRecord;
    }, {
        applicationId: `browsershare-${testInfo.project.name.replaceAll('_', '-')}-${Date.now()}`
    });

    expect(resultData).toEqual({
        identifierValid: true,
        title: 'Browser share',
        text: 'Persisted through IndexedDB',
        fileName: 'note.txt',
        fileType: 'text/plain',
        fileText: 'browser-file',
        frozen: true,
        secondConsume: null
    });
});

test('worker outbox drains durable intent through real browser IndexedDB', async function workerOutboxBrowserCheck({page}, testInfo) {
    const resultData = await page.evaluate(async ({applicationId, namespaceData}) => {
        const browserApi = /** @type {any} */ (window).layerBrowser;
        const schemaData = browserApi.layerStorageSchemaDefine({
            name: 'worker-browser',
            version: 1,
            stores: {},
            migrations: {
                1() {
                    //Reserving version one for engine-owned stores.
                }
            }
        });
        const storageData = await browserApi.layerStorageOpen({
            appId: applicationId,
            namespace: namespaceData,
            schema: schemaData,
            indexedDb: window.indexedDB
        });
        const outboxData = browserApi.layerOfflineOutboxCreate({
            storage: storageData,
            ownerId: 'browser-page-owner',
            commandIdCreate() {
                //Returning a stable identity for the worker observation.
                return 'browser-worker-command';

            },
            async commandSend() {
                //Failing if the browser test accidentally uses page delivery.
                throw new Error('The page transport must not run.');

            }
        });

        //Persisting intent and the app-scoped worker pointer.
        await outboxData.queue({
            operation: 'browser.message.send',
            payload: {
                text: 'Background browser delivery'
            },
            baseRevision: 0,
            conflictDomain: 'browser:worker'
        });
        await browserApi.layerWorkerOutboxConfigure({
            appId: applicationId,
            storageName: storageData.name,
            apiUrl: '/api',
            csrfToken: null,
            applicationOrigin: location.origin,
            indexedDb: window.indexedDB
        });
        const workerDrain = browserApi.layerWorkerOutboxDrainCreate({
            appId: applicationId,
            applicationOrigin: location.origin,
            indexedDb: window.indexedDB,
            requestIdCreate() {
                //Using the browser cryptographic UUID source required by the protocol.
                return crypto.randomUUID();

            },
            ownerIdCreate() {
                //Creating one worker lease identity for this browser run.
                return crypto.randomUUID();

            }
        });
        const drainResult = await workerDrain();
        const commandRecord = await outboxData.get('browser-worker-command');

        //Cleaning both worker configuration and isolated user storage.
        await browserApi.layerWorkerOutboxConfigurationClear({
            appId: applicationId,
            indexedDb: window.indexedDB
        });
        await storageData.purgeUserData();

        return {
            drainResult,
            commandStatus: commandRecord?.status,
            responseSource: commandRecord?.result?.data?.source
        };
    }, {
        applicationId: `browserworker-${testInfo.project.name.replaceAll('_', '-')}`,
        namespaceData: `browser-worker-${testInfo.project.name}-${Date.now()}`
    });

    expect(resultData).toEqual({
        drainResult: {
            configured: true,
            claimed: 1,
            confirmed: 1,
            retryable: 0,
            conflicted: 0,
            failed: 0
        },
        commandStatus: 'confirmed',
        responseSource: 'browser-api'
    });
});

test('generated Layer application mounts and installs its verified Service Worker', async function applicationBootCheck({page}) {
    const workerSecurityFailures = /** @type {string[]} */ ([]);

    page.on('console', function browserConsoleInspect(messageData) {
        const messageLocation = messageData.location();
        const messageSearchData = `${messageLocation.url} ${messageData.text()}`.toLowerCase();

        //Collecting only worker-owned CSP failures while allowing the document policy to reject foreign requests.
        if (messageData.type() === 'error' && messageSearchData.includes('service-worker') &&
            messageSearchData.includes('content security policy')) {
            workerSecurityFailures.push(messageSearchData);

        }

    });
    await page.goto('/');

    await expect(page.locator('[data-layer-root] h1')).toHaveText('browser-application');
    await expect(page).toHaveTitle('Layer application');

    const apiSurface = await page.evaluate(() => ({
        command: typeof /** @type {any} */ (window).layer.command,
        eventsSubscribe: typeof /** @type {any} */ (window).layer.events.subscribe,
        pwaFiles: typeof /** @type {any} */ (window).layer.pwa?.files?.setConsumer,
        pwaInstall: typeof /** @type {any} */ (window).layer.pwa?.install?.prompt,
        pwaLaunch: typeof /** @type {any} */ (window).layer.pwa?.launch?.setConsumer,
        pwaNotifications: typeof /** @type {any} */ (window).layer.pwa?.notifications?.show,
        pwaProtocols: typeof /** @type {any} */ (window).layer.pwa?.protocols?.register,
        pwaPush: typeof /** @type {any} */ (window).layer.pwa?.push?.getSubscription,
        pwaShare: typeof /** @type {any} */ (window).layer.pwa?.share?.canSend,
        pwaStorage: typeof /** @type {any} */ (window).layer.pwa?.storage?.estimate,
        pwaUpdateActivate: typeof /** @type {any} */ (window).layer.pwa?.update?.activate,
        pwaUpdateCheck: typeof /** @type {any} */ (window).layer.pwa?.update?.check,
        pwaUpdateState: typeof /** @type {any} */ (window).layer.pwa?.update?.getState,
        query: typeof /** @type {any} */ (window).layer.query,
        storageReady: typeof /** @type {any} */ (window).layer.storageReady,
        storagePurge: typeof /** @type {any} */ (window).layer.storagePurge,
        sync: typeof /** @type {any} */ (window).layer.sync
    }));
    const installPromptResult = await page.evaluate(async () => {
        let promptCallCount = 0;
        const installEvent = new Event('beforeinstallprompt', {
            cancelable: true
        });

        Object.defineProperties(installEvent, {
            prompt: {
                value: async function installPromptShow() {
                    //Recording the browser prompt invocation from the explicit Layer API.
                    promptCallCount += 1;

                }
            },
            userChoice: {
                value: Promise.resolve({
                    outcome: 'accepted',
                    platform: 'browser-test'
                })
            }
        });
        window.dispatchEvent(installEvent);
        const promptResult = await /** @type {any} */ (window).layer.pwa.install.prompt();

        return {
            defaultPrevented: installEvent.defaultPrevented,
            promptCallCount,
            promptResult
        };
    });
    const queryResult = await page.evaluate(async () => {
        //Calling the generated global facade through the real browser fetch stack.
        return /** @type {any} */ (window).layer.query('browser.status.read', {});

    });
    const commandResult = await page.evaluate(async () => {
        const commandHandle = await /** @type {any} */ (window).layer.command('browser.message.send', {
            text: 'Durable browser command'
        }, {
            offline: 'queue',
            baseRevision: 0,
            conflictDomain: 'browser:message'
        });
        const confirmedResult = await commandHandle.result;

        return {
            commandId: commandHandle.commandId,
            state: commandHandle.state,
            result: confirmedResult
        };
    });

    const workerData = await page.evaluate(async () => {
        const registrationData = await navigator.serviceWorker.ready;

        return {
            active: registrationData.active !== null,
            script: registrationData.active?.scriptURL ?? ''
        };
    });
    const foreignRequestBlockedStatus = await page.evaluate(async () => {
        try {
            //Simulating a foreign request that the controlled document security policy must own.
            await fetch('https://security.example.net/injected.js');

            return false;

        } catch {
            //Reporting the expected document-level CSP rejection to the browser test.
            return true;

        }

    });
    expect(foreignRequestBlockedStatus).toBe(true);
    await page.reload();
    await expect(page.locator('[data-layer-root] h1')).toHaveText('browser-application');
    const purgeData = await page.evaluate(async () => {
        const applicationApi = /** @type {any} */ (window).layer;
        const storageData = await applicationApi.storageReady();

        //Purging the active user namespace and worker registry pointer.
        await applicationApi.storagePurge();
        let closedStatus = false;

        try {
            await storageData.exportUserData();

        } catch (storageError) {
            closedStatus = /** @type {any} */ (storageError).code === 'STORAGE_CLOSED';

        }

        const registryConfigured = await new Promise(function workerRegistryRead(resolve, reject) {
            const openRequest = indexedDB.open('layer-worker:browser-application', 1);
            openRequest.addEventListener('success', function workerRegistryOpen() {
                const registryDatabase = openRequest.result;
                const registryTransaction = registryDatabase.transaction(['configuration'], 'readonly');
                const configurationRequest = registryTransaction.objectStore('configuration').get('current');
                configurationRequest.addEventListener('success', function workerConfigurationRead() {
                    //Reporting whether logout left a worker pointer behind.
                    resolve(configurationRequest.result !== undefined);
                    registryDatabase.close();

                }, {once: true});
                configurationRequest.addEventListener('error', function workerConfigurationFailure() {
                    //Passing an unexpected registry read failure to Playwright.
                    reject(configurationRequest.error);
                    registryDatabase.close();

                }, {once: true});

            }, {once: true});
            openRequest.addEventListener('error', function workerRegistryOpenFailure() {
                //Passing an unexpected registry open failure to Playwright.
                reject(openRequest.error);

            }, {once: true});

        });

        return {
            closedStatus,
            registryConfigured
        };
    });

    expect(workerData.active).toBe(true);
    expect(workerData.script).toContain('/layer-service-worker.js');
    expect(apiSurface).toEqual({
        command: 'function',
        eventsSubscribe: 'function',
        pwaFiles: 'function',
        pwaInstall: 'function',
        pwaLaunch: 'function',
        pwaNotifications: 'function',
        pwaProtocols: 'function',
        pwaPush: 'function',
        pwaShare: 'function',
        pwaStorage: 'function',
        pwaUpdateActivate: 'function',
        pwaUpdateCheck: 'function',
        pwaUpdateState: 'function',
        query: 'function',
        storageReady: 'function',
        storagePurge: 'function',
        sync: 'function'
    });
    expect(installPromptResult).toEqual({
        defaultPrevented: false,
        promptCallCount: 1,
        promptResult: {
            outcome: 'accepted',
            platform: 'browser-test'
        }
    });
    expect(queryResult.data).toEqual({source: 'browser-api'});
    expect(queryResult.status).toBe('network');
    expect(commandResult.commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(commandResult.state).toBe('confirmed');
    expect(commandResult.result.data).toEqual({source: 'browser-api'});
    expect(purgeData).toEqual({
        closedStatus: true,
        registryConfigured: false
    });
    expect(workerSecurityFailures).toEqual([]);
});

test('generated navigation resets the viewport after the next screen renders', async function navigationScrollResetCheck({page}) {
    //Opening the generated application and waiting for its initial route.
    await page.goto('/');
    await expect(page.locator('[data-layer-root] h1')).toHaveText('browser-application');
    await page.waitForFunction(function initialRouteRenderComplete(){
        const rootNode = document.querySelector('[data-layer-root]');

        //CallBack THE BOOLEAN
        return rootNode !== null && !rootNode.hasAttribute('data-layer-ssr');

    });

    const scrolledPositionData = await page.evaluate(function viewportScrollPrepare(){
        //Creating persistent page height so the next render cannot clamp an obsolete position accidentally.
        const scrollFixtureData = document.createElement('div');
        scrollFixtureData.setAttribute('data-scroll-fixture', String());
        scrollFixtureData.style.setProperty('height', String( '3000px' ) );
        const rootNode = document.querySelector('[data-layer-root]');
        rootNode.append( scrollFixtureData );
        rootNode.scrollTop = Number( 900 );

        //CallBack THE NUMBER
        return Number( rootNode.scrollTop );

    });

    expect(scrolledPositionData).toBeGreaterThan(Number( 0 ));

    //Navigating through the public Layer facade and waiting for the replacement screen.
    const navigationResultData = await page.evaluate(async function secondScreenOpen(){
        const applicationData = /** @type {any} */ (window).layer;
        const navigationDataResult = await applicationData.navigate('/second/');

        return {
            status: navigationDataResult.status,
            scrollY: Number( document.querySelector('[data-layer-root]').scrollTop ),
            scrollRestoration: String( history.scrollRestoration )
        };

    });

    await expect(page.locator('[data-layer-root] h1')).toHaveText('second-browser-page');
    expect(navigationResultData).toEqual({
        status: 'ready',
        scrollY: 0,
        scrollRestoration: 'manual'
    });

});
