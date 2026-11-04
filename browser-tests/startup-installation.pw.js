import {test, expect} from '@playwright/test';


test( 'first install covers a slow runtime, shows verified progress and releases without reload', async function( {page, request}, info ){
    //Holding one cache resource at the server and the large module in the browser independently
    const fixture = await (await request.post('/__test/update-fixture?startup=hold')).json();
    let moduleRelease;
    const moduleGate = new Promise(function( resolve ){
        //Keeping the large runtime unavailable while the early external bootstrap can paint
        moduleRelease = resolve;

    });
    const navigations = [];
    page.on('request', function( requestData ){
        //Detecting an unwanted extra document load during activation
        if ( requestData.isNavigationRequest() && requestData.frame() === page.mainFrame() ){
            navigations.push( requestData.url() );

        }

    });
    await page.route('**/_layer/application.mjs', async function( route ){
        //Delaying only the browser runtime download
        await moduleGate;
        await route.continue();

    });
    try {
        await page.setViewportSize({width: 360, height: 740});
        await page.goto(fixture.origin + '/?room=42#draft', {waitUntil: 'commit'});
        const cover = page.locator('[data-layer-startup-screen]');
        await expect(cover).toBeVisible();
        await expect(cover.locator('output')).toHaveText('0%');
        await expect(cover).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(cover.locator('img')).toHaveCSS('width', '156px');
        await expect(page.locator('[data-layer-root]')).toHaveAttribute('inert', '');
        await expect(page.locator('h1')).toBeHidden();
        expect(await page.evaluate(function(){
            //The cover must not wait for evaluation of the deferred module
            return typeof window.layer;

        })).toBe('undefined');
        moduleRelease();
        await expect(page.locator('h1')).toHaveText('Update edition one');
        await expect.poll(async function(){
            //Reading real verified-file progress while one required file remains pending
            return Number.parseInt(await cover.locator('output').textContent(), 10);

        }).toBeGreaterThan(0);
        await expect(page.locator('h1')).toBeHidden();
        await expect(page.locator('[data-layer-update-card]')).toBeHidden();
        //Capturing after module release so Firefox/WebKit font readiness cannot wait on our own network gate
        await page.screenshot({path: 'artifacts/initial-install-' + info.project.name + '.png'});
        await page.evaluate(function(){
            //Programmatic focus must not enter the app while its initial install is incomplete
            document.querySelector('input').focus();

        });
        await expect(page.getByLabel('Draft')).not.toBeFocused();
        await request.post(fixture.origin + '/__continue');
        await expect(cover).toHaveCount(0, {timeout: 20000});
        await expect(page.locator('h1')).toBeVisible();
        await expect(page).toHaveURL(fixture.origin + '/?room=42#draft');
        expect(navigations).toHaveLength(1);
        await page.getByLabel('Draft').fill('Ready');
        await page.reload();
        await expect(page.locator('h1')).toBeVisible();
        await expect(cover).toHaveCount(0);
        await page.setViewportSize({width: 740, height: 360});
        await expect(page.locator('h1')).toBeVisible();

    } finally {
        //Releasing only resources owned by this isolated browser fixture
        moduleRelease();
        await request.post(fixture.origin + '/__close');

    }

});

for ( const failure of ['registration-error', 'corrupt'] ){
    test( 'initial ' + failure + ' releases the ready online app without declaring offline readiness', async function( {page, request} ){
        //Using genuine browser registration and resource verification failures
        const fixture = await (await request.post('/__test/update-fixture?startup=' + failure)).json();
        try {
            await page.goto(fixture.origin + '/');
            await expect(page.locator('h1')).toBeVisible({timeout: 15000});
            await expect(page.locator('[data-layer-startup-screen]')).toHaveCount(0);
            await page.getByLabel('Draft').fill('Still usable');
            await expect(page.locator('[data-layer-update-card]')).toBeHidden();

        } finally {
            await request.post(fixture.origin + '/__close');

        }

    });

}

test( 'startup hook failure offers a safe retry with the complete URL', async function( {page, request} ){
    //Preventing leaked diagnostic text and endless loading after application failure
    const fixture = await (await request.post('/__test/update-fixture')).json();
    try {
        const url = fixture.origin + '/?startup-error=1#draft';
        await page.goto(url);
        const cover = page.locator('[data-layer-startup-screen]');
        await expect(cover.getByRole('button', {name: 'Повторить'})).toBeVisible();
        await expect(cover).not.toContainText('Private fixture');
        await expect(page.locator('h1')).toBeHidden();
        await Promise.all([page.waitForRequest(function( requestData ){
            //Retry uses a native document reload without discarding query or hash
            return requestData.isNavigationRequest();

        }), cover.getByRole('button', {name: 'Повторить'}).click()]);
        await expect(page).toHaveURL(url);

    } finally {
        await request.post(fixture.origin + '/__close');

    }

});

test( 'dark first-install branding fits mobile rotation and provides an icon fallback', async function( {page, request}, info ){
    //Using a real manifest and verified build for the dark-color visual gate
    const fixture = await (await request.post('/__test/update-fixture?startup=dark')).json();
    try {
        await page.route('**/icon.svg', function( route ){
            //Failing only the image request so the local initials tile remains available
            return route.abort();

        });
        await page.setViewportSize({width: 360, height: 740});
        await page.goto(fixture.origin + '/');
        const cover = page.locator('[data-layer-startup-screen]');
        await expect(cover).toHaveCSS('background-color', 'rgb(17, 24, 39)');
        await expect(cover).toHaveCSS('color', 'rgb(255, 255, 255)');
        await expect(cover.locator('[data-layer-startup-icon] span')).toBeVisible();
        await expect(cover.locator('img')).toHaveCount(0);
        await page.setViewportSize({width: 740, height: 360});
        const bounds = await cover.boundingBox();
        expect(bounds).toMatchObject({x: 0, y: 0, width: 740, height: 360});
        await page.screenshot({path: 'artifacts/initial-install-dark-' + info.project.name + '.png'});
        await request.post(fixture.origin + '/__continue');
        await expect(cover).toHaveCount(0, {timeout: 20000});

    } finally {
        await request.post(fixture.origin + '/__close');

    }

});

test( 'disabled Service Worker releases the cover after app readiness without registering', async function( {page, request} ){
    //The startup setting must not implicitly re-enable a worker disabled by the app
    const fixture = await (await request.post('/__test/update-fixture')).json();
    try {
        await page.goto(fixture.origin + '/?no-sw=1');
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('[data-layer-startup-screen]')).toHaveCount(0);
        expect(await page.evaluate(async function(){
            //Inspecting the browser-owned registration after the first route is ready
            return (await navigator.serviceWorker.getRegistrations()).length;

        })).toBe(0);

    } finally {
        await request.post(fixture.origin + '/__close');

    }

});
