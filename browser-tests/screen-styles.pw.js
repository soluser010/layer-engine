import {expect, test} from '@playwright/test';

//Observe the actual stylesheet request even when the fixture supports offline installation.
test.use({serviceWorkers: 'block'});

async function screenStylesFixture(page, respond){
    const routes = await (await page.request.get('/_layer/routes.json')).json();
    const assetPath = '/' + routes.find(route => route.path === '/css/').style;
    const selector = 'link[href$="' + assetPath + '"]';
    let requests = 0;
    await page.route('**' + assetPath, async function(route){
        //Expose activation directly through a computed property on the current document.
        requests++;
        await respond(route, requests);

    });
    await page.goto('/');
    await page.waitForFunction(() => window.layer?.navigationDiagnostics().active === 1);
    await page.evaluate(() => {
        const anchor = document.createElement('a');
        anchor.href = '/css/';
        anchor.textContent = 'Warm CSS';
        document.querySelector('[data-layer-root]').prepend(anchor);

    });
    return {selector, requests: () => requests};

}

const response = {contentType: 'text/css', body: ':root { --screen-style-probe: ready; }'};

for (const timing of ['ready', 'loading', 'superseded']){
    test('reuse one inactive stylesheet when navigation starts ' + timing, async function({page}){
        const gate = Promise.withResolvers();
        const fixture = await screenStylesFixture(page, async function(route){
            //Hold the first response so the test controls the navigation/load race.
            await gate.promise;
            await route.fulfill(response);

        });
        const stylesheet = page.locator(fixture.selector);
        await expect.poll(fixture.requests).toBe(1);
        await expect(stylesheet).toHaveCount(1);
        await expect(stylesheet).toHaveAttribute('rel', 'stylesheet');
        await expect(stylesheet).toHaveAttribute('media', 'not all');
        await stylesheet.evaluate(link => {
            window.firstWarmedSheet = link;

        });
        if (timing === 'ready'){
            gate.resolve();
            await expect.poll(() => stylesheet.evaluate(link => Boolean(link.sheet?.cssRules.length))).toBe(true);

        }
        const applied = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--screen-style-probe').trim());
        expect(await applied()).toBe('');
        await page.getByRole('link', {name: 'Warm CSS'}).click();
        if (timing === 'superseded'){
            await page.evaluate(() => window.layer.navigate('/second/'));
            gate.resolve();
            await expect.poll(() => stylesheet.evaluate(link => Boolean(link.sheet?.cssRules.length))).toBe(true);
            expect(await applied()).toBe('');
            await expect(page).toHaveURL(/\/second\/$/);
            await page.evaluate(() => window.layer.navigate('/css/'));

        } else {
            if (timing === 'loading'){
                await expect(page).toHaveURL(/:\d+\/$/);
            }
            gate.resolve();

        }
        await expect(page).toHaveURL(/\/css\/$/);
        await expect.poll(applied).toBe('ready');
        expect(await stylesheet.evaluate(link => link === window.firstWarmedSheet)).toBe(true);
        expect(fixture.requests()).toBe(1);
        await page.evaluate(() => window.layer.navigate('/second/'));
        expect(await applied()).toBe('');
        await page.evaluate(() => window.layer.navigate('/css/'));
        expect(await applied()).toBe('ready');
        expect(await stylesheet.evaluate(link => link === window.firstWarmedSheet)).toBe(true);
        expect(fixture.requests()).toBe(1);
        await page.evaluate(() => window.layer.dispose());
        await expect(stylesheet).toHaveCount(0);

    });
}

test('retry a failed background stylesheet when its route opens', async function({page}){
    const fixture = await screenStylesFixture(page, async function(route, requestNumber){
        //A refused speculative response must leave the visible route usable.
        if (requestNumber === 1){
            await route.fulfill({status: 503, body: ''});
            return;

        }
        await route.fulfill(response);

    });
    await expect.poll(fixture.requests).toBe(1);
    await expect(page.locator(fixture.selector)).toHaveCount(0);
    await page.getByRole('link', {name: 'Warm CSS'}).click();
    await expect(page).toHaveURL(/\/css\/$/);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--screen-style-probe').trim())).toBe('ready');
    expect(fixture.requests()).toBe(2);

});

test.describe('production offline cache', function(){
    test.use({serviceWorkers: 'allow'});

    test('warm and open a styled screen for the first time offline', async function({page, request}){
        //Use an independent origin and a real generated production Service Worker.
        const {origin} = await (await request.post('/__test/update-fixture')).json();
        let serverClosed = false;
        try {
            await page.goto(origin);
            await page.waitForFunction(() => navigator.serviceWorker.controller && window.layer?.navigationDiagnostics().active === 1);
            await expect(page.locator('[data-layer-startup-screen]')).toBeHidden();
            const routes = await (await request.get(origin + '/_layer/routes.json')).json();
            const target = routes.find(route => route.path === '/offline-styles/');
            const stylesheet = page.locator('link[href$="/' + target.style + '"]');
            await expect(stylesheet).toHaveCount(0);
            //Remove the real origin after installation, leaving native Service Worker fetch dispatch available.
            const shutdown = await request.post(origin + '/__close');
            expect(shutdown.ok()).toBe(true);
            serverClosed = true;
            await page.evaluate(() => {
                const link = document.createElement('a');
                link.href = '/offline-styles/';
                link.textContent = 'Open offline';
                document.querySelector('[data-layer-root]').prepend(link);

            });
            await expect.poll(() => page.evaluate(() => window.layer.navigationDiagnostics().unopened)).toBe(1);
            const layoutStylesheet = page.locator('link[data-layer-layout-style]');
            await expect(layoutStylesheet).toHaveCount(1);
            await layoutStylesheet.evaluate(link => {
                window.firstWarmedLayout = link;

            });
            await stylesheet.evaluate(link => {
                window.firstWarmedSheet = link;

            });
            await page.getByRole('link', {name: 'Open offline'}).click();
            await expect(page).toHaveURL(origin + '/offline-styles/');
            await expect(page.getByRole('heading', {name: 'Offline styles'})).toHaveCSS('padding-left', '37px');
            await expect(page.getByText('Offline layout', {exact: true})).toHaveCSS('padding-right', '23px');
            expect(await layoutStylesheet.evaluate(link => link === window.firstWarmedLayout)).toBe(true);
            expect(await stylesheet.evaluate(link => link === window.firstWarmedSheet)).toBe(true);

        } finally {
            if (!serverClosed){
                await request.post(origin + '/__close');

            }

        }

    });

});
