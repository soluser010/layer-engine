import {test, expect} from '@playwright/test';

test('an early SSR click waits for runtime and preserves the document and complete URL', async function({page}){
    //Delaying only the large application module, not the small parser-blocking bootstrap
    let release;
    const gate = new Promise(function(resolve){
        //Holding one intercepted module request until after the first user click
        release = resolve;

    });
    let released = false;
    const documents = [];
    page.on('request', function(request){
        //Counting actual document requests rather than mistaking DOM replacement for reload
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            documents.push(request.url());

        }

    });
    await page.route('**/_layer/application.mjs', async function(route){
        //Keeping the prerender interactive while the main runtime is unavailable
        if (!released) {
            await gate;

        }
        await route.continue();

    });
    try {
        await page.goto('/', {waitUntil: 'commit'});
        await expect(page.locator('#startup-link')).toBeVisible();
        expect(await page.evaluate(function(){
            //Observing the previously unprotected startup gap
            window.startupEpoch = 'same-document';
            return typeof window.layer;

        })).toBe('undefined');
        await page.locator('#startup-link').click({noWaitAfter: true});
        expect(documents).toHaveLength(1);
        await expect(page).toHaveURL('http://127.0.0.1:5330/');
        released = true;
        release();
        await expect(page.locator('h1')).toHaveText('second-browser-page');
        await expect(page).toHaveURL('http://127.0.0.1:5330/second/?cold=1#draft');
        expect(await page.evaluate(function(){
            //The queued click must reach the existing router without a new document
            return window.startupEpoch;

        })).toBe('same-document');
        expect(documents).toHaveLength(1);

    } finally {
        //Releasing intercepted requests even when the regression assertion fails
        released = true;
        release();

    }

});

test('explicit _self links keep their native document-navigation semantics', async function({page}){
    //Protecting the owner's explicit decision not to change _self behavior
    await page.goto('/');
    await page.waitForFunction(function(){
        //Waiting for the normal router before checking unchanged explicit-target behavior
        return window.layer?.currentGet() !== null && window.layer?.currentGet() !== undefined;

    });
    await page.evaluate(function(){
        //Setting a document-local epoch that native navigation must discard
        window.selfEpoch = 'old-document';
        document.querySelector('#startup-link').target = '_self';

    });
    const navigation = page.waitForRequest(function(request){
        //Observing the browser's main-document request rather than a component fetch
        return request.isNavigationRequest() && new URL(request.url()).pathname === '/second/';

    });
    await Promise.all([navigation, page.locator('#startup-link').click()]);
    await expect(page.locator('h1')).toHaveText('second-browser-page');
    expect(await page.evaluate(function(){
        //Confirming that _self did not start using the SPA router
        return window.selfEpoch;

    })).toBeUndefined();

});

test('a real controlling worker hands URLs to the running router without reload', async function({page, context, request}, info){
    //Playwright exposes ServiceWorker.evaluate only through Chromium-based projects
    test.skip(!['chrome', 'edge'].includes(info.project.name), 'Native worker evaluation requires Chromium.');
    await page.goto('/?push=1#same');
    await page.evaluate(async function(){
        //Waiting for actual installation before addressing a native worker
        await navigator.serviceWorker.ready;

    });
    await page.waitForFunction(function(){
        //Requiring both native control and initial route readiness
        return navigator.serviceWorker.controller !== null && window.layer?.currentGet() !== null;

    });
    const bootstrap = await (await request.get('/_layer/navigation.js')).text();
    const appKey = /"appKey":"([a-f0-9]{64})"/u.exec(bootstrap)[1];
    await page.evaluate(function(){
        //Retaining a live draft to detect even a same-URL remount
        window.pushEpoch = 'same-document';
        const input = document.createElement('input');
        input.id = 'push-draft';
        input.value = 'Unsaved draft';
        document.querySelector('[data-layer-root] main').append(input);

    });
    const worker = context.serviceWorkers()[0];
    const deliver = async function(targetUrl){
        //Using a real worker-to-window message and a transferred reply port, not a forged source
        return worker.evaluate(async function({appKey, targetUrl}){
            //Selecting a native controlled client from this isolated browser context
            const client = (await self.clients.matchAll({type: 'window'}))[0];
            const channel = new MessageChannel();
            return new Promise(function(resolve, reject){
                //Bounding delivery so a missing receiver is a visible test failure
                const timer = setTimeout(function(){
                    //Closing the channel when a regression prevents acknowledgement
                    channel.port1.close();
                    reject(new Error('The navigation acknowledgement timed out.'));

                }, 3000);
                channel.port1.onmessage = function(event){
                    //Returning only this dedicated handoff's native reply
                    clearTimeout(timer);
                    channel.port1.close();
                    resolve(event.data);

                };
                client.postMessage({type: 'layer-navigation-open', protocol: 1, appKey, url: targetUrl}, [channel.port2]);

            });

        }, {appKey, targetUrl});

    };
    expect((await deliver(page.url())).accepted).toBe(true);
    await expect(page.locator('#push-draft')).toHaveValue('Unsaved draft');
    expect((await deliver('http://127.0.0.1:5330/second/?push=2#keep')).accepted).toBe(true);
    await expect(page.locator('h1')).toHaveText('second-browser-page');
    await expect(page).toHaveURL('http://127.0.0.1:5330/second/?push=2#keep');
    expect(await page.evaluate(function(){
        //Checking that the worker handoff retained the running document
        return window.pushEpoch;

    })).toBe('same-document');

});
