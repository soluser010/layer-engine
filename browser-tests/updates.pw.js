import {test, expect} from '@playwright/test';

test('production update card prepares resources, defers, warns about other windows and applies one new build', async function({page, context, request}, testInfo){
    //Allocating a real isolated origin so browser registrations never collide across projects
    test.setTimeout(90000);
    const fixture = await (await request.post('/__test/update-fixture')).json();
    const origin = fixture.origin;
    try {
        await page.goto(origin + '/?room=42#draft');
        await expect(page.locator('h1')).toHaveText('Update edition one');
        await page.evaluate(async function(){
            //Waiting for first install completion without showing an update prompt
            await navigator.serviceWorker.ready;

        });
        await expect.poll(function(){
            //Waiting for the initial worker to claim this real document
            return page.evaluate(function(){
                //Observing the native controller, not a synthetic ready flag
                return navigator.serviceWorker.controller !== null;

            });

        }).toBe(true);
        const card = page.locator('[data-layer-update-card]');
        await expect(card).toBeHidden();
        await page.getByLabel('Draft').fill('Сохранить ввод');
        await page.getByLabel('Draft').focus();
        await request.post(origin + '/__release');
        await page.evaluate(async function(){
            //Requesting discovery through the exact public API, not a test-only worker shortcut
            await window.layer.pwa.update.check();

        });
        await expect(card).toBeVisible();
        await expect(page.getByLabel('Draft')).toHaveValue('Сохранить ввод');
        await expect(page.getByLabel('Draft')).toBeFocused();
        await expect(card.getByRole('button', {name: 'Обновить', exact: true})).toBeVisible({timeout: 20000});
        await expect(card.locator('[data-layer-update-icon]')).toHaveCSS('width', '76px');
        await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(card.getByRole('button', {name: 'Обновить', exact: true})).toHaveCSS('border-bottom-left-radius', '16px');
        await page.screenshot({path: 'artifacts/update-card-' + testInfo.project.name + '.png'});
        await card.getByRole('button', {name: 'Обновить', exact: true}).hover();
        const hoveredColor = await card.getByRole('button', {name: 'Обновить', exact: true}).evaluate(function(button){
            //Reading the actual rendered color rather than assuming color-mix serialization syntax
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const drawing = canvas.getContext('2d');
            drawing.fillStyle = getComputedStyle(button).backgroundColor;
            drawing.fillRect(0, 0, 1, 1);
            return [...drawing.getImageData(0, 0, 1, 1).data].slice(0, 3);

        });
        expect(hoveredColor).toEqual([34, 80, 175]);
        await page.setViewportSize({width: 360, height: 740});
        await expect(card).toHaveCSS('width', '328px');
        await page.screenshot({path: 'artifacts/update-card-mobile-' + testInfo.project.name + '.png'});
        await page.setViewportSize({width: 1280, height: 720});
        await card.getByRole('button', {name: 'Позже'}).click();
        await expect(card).toBeHidden();
        await page.evaluate(async function(){
            //A manual recheck in the same document must not erase the user's dismissal
            await window.layer.pwa.update.check();

        });
        await expect(card).toBeHidden();
        await page.reload();
        await expect(page.locator('h1')).toHaveText('Update edition one');
        await expect(card.getByRole('button', {name: 'Обновить', exact: true})).toBeVisible({timeout: 20000});
        const other = await context.newPage();
        await other.goto(origin + '/?other=1#keep');
        await expect(other.locator('h1')).toHaveText('Update edition one');
        await other.evaluate(function(){
            //Simulating an application that refuses to lose its unsaved state
            window.updateSaveAllowed = false;

        });
        await card.getByRole('button', {name: 'Обновить', exact: true}).click();
        await expect(card.getByRole('button', {name: 'Всё равно обновить'})).toBeVisible({timeout: 20000});
        await expect(page.locator('h1')).toHaveText('Update edition one');
        await card.getByRole('button', {name: 'Всё равно обновить'}).click();
        try {
            //Checking the committed document rather than accepting a controller change alone
            await expect(page.locator('h1')).toHaveText('Update edition two', {timeout: 12000});

        } catch (updateFailure) {
            //Capturing only disposable fixture metadata when a release switch regresses
            console.log('Update fixture diagnostic', await page.evaluate(async function(){
                //Reading public cache markers and runtime identity without user data
                const cacheData = [];
                for (const cacheName of await caches.keys()) {
                    const cache = await caches.open(cacheName);
                    const entries = [];
                    for (const cacheRequest of await cache.keys()) {
                        if (cacheRequest.url.endsWith('.mjs')) {
                            const content = await (await cache.match(cacheRequest)).text();
                            entries.push({url: new URL(cacheRequest.url).pathname, one: content.includes('Update edition one'),
                                two: content.includes('Update edition two')});

                        }

                    }
                    cacheData.push({cacheName, entries});

                }
                return {url: location.href, state: window.layer.pwa.update.getState(), cacheData};

            }));
            throw updateFailure;

        }
        await expect(other.locator('h1')).toHaveText('Update edition two', {timeout: 20000});
        await expect(page).toHaveURL(origin + '/?room=42#draft');
        await expect(other).toHaveURL(origin + '/?other=1#keep');
        await expect(card).toBeHidden();
        await other.close();

    } finally {
        //Closing only the fixture-owned listener; no workstation service is stopped
        await request.post(origin + '/__close');

    }

});
