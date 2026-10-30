import {test, expect} from '@playwright/test';

test('generated link routing preserves query/hash and native anchor targets', async function({page}){
    //Opening a direct route with URL state before runtime initialization
    await page.goto('/links/?first=1#draft');
    await expect(page.locator('h1')).toHaveText('Links fixture');
    expect(new URL(page.url()).search).toBe('?first=1');
    expect(new URL(page.url()).hash).toBe('#draft');
    await page.evaluate(function(){
        //Retaining an epoch that a document replacement would remove
        window.linksDocumentEpoch = 42;

    });
    await page.locator('#internal-link').click();
    await expect(page.locator('h1')).toHaveText('second-browser-page');
    expect(new URL(page.url()).search).toBe('?room=42');
    expect(new URL(page.url()).hash).toBe('#message');
    expect(await page.evaluate(function(){
        //Checking that only the route renderer changed
        return window.linksDocumentEpoch;

    })).toBe(42);
    await page.goBack();
    await expect(page.locator('h1')).toHaveText('Links fixture');
    expect(new URL(page.url()).search).toBe('?first=1');
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#target-link').click();
    const popup = await popupPromise;
    await popup.close();
    await expect(page.locator('[data-layer-link-viewer]')).toHaveCount(0);

    const deniedClicks = await page.evaluate(function(){
        //Checking cancellation without executing a malicious URL or leaving the test document
        return ['javascript:alert(1)', 'data:text/html,bad', 'file:///private', 'https://user:secret@example.com/'].map(function(urlData){
            //Delivering a real bubbling click to the generated document policy
            const anchorNode = document.createElement('a');
            anchorNode.href = urlData;
            document.body.append(anchorNode);
            const clickEvent = new MouseEvent('click', {bubbles: true, cancelable: true, button: 0});
            const permittedStatus = anchorNode.dispatchEvent(clickEvent);
            anchorNode.remove();
            return permittedStatus;

        });

    });
    expect(deniedClicks).toEqual([false, false, false, false]);

});

test('native viewer retains the app, restores focus and never bypasses denied embedding', async function({page}){
    //Waiting for the generated component owner before invoking document policy
    await page.goto('/links/');
    await expect(page.locator('h1')).toHaveText('Links fixture');
    await page.getByLabel('Draft').fill('Retained draft');
    await page.locator('#viewer-link').focus();
    await page.locator('#viewer-link').click();
    const viewer = page.locator('[data-layer-link-viewer]');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-layer-link-origin]')).toHaveText('http://localhost:5330');
    await expect(viewer.frameLocator('iframe').locator('h1')).toHaveText('External test content');
    await expect(viewer.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
    await expect(page.getByLabel('Draft')).toHaveValue('Retained draft');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(page.locator('#viewer-link')).toBeFocused();
    await page.locator('#denied-link').click();
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole('button', {name: 'Open separately'})).toBeVisible();
    await viewer.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(viewer).toHaveCount(0);
    const result = await page.evaluate(async function(){
        //Checking owner exposure through a real compiled component
        return window.layerLinksFixture.owner.open('https://not-allowed.example', {mode: 'viewer'});

    });
    expect(result.reason).toBe('viewer-origin-denied');
    await page.context().setOffline(true);
    await page.locator('#viewer-link').click();
    await expect(viewer).toBeVisible();
    await viewer.getByRole('button', {name: 'Close', exact: true}).click();
    await page.context().setOffline(false);

});

test('cold and warm Launch Queue URLs reach the existing router without duplicate remount', async function({page}){
    //Providing platform envelopes without claiming a real installed OS association
    await page.addInitScript(function(){
        //Modeling the native queue before the host acquires its one consumer
        Object.defineProperty(window, 'launchQueue', {configurable: true, value: {
            setConsumer: function(consumer){
                //Delivering a cold target before route readiness
                window.layerNativeLaunchConsumer = consumer;
                consumer({targetURL: location.origin + '/second/?cold=1#first', files: []});

            }
        }});

    });
    await page.goto('/links/');
    await expect(page.locator('h1')).toHaveText('second-browser-page');
    await expect(page).toHaveURL(/second\/\?cold=1#first/u);
    await page.evaluate(function(){
        //Delivering a later URL without replacing the running document
        window.layerNativeLaunchConsumer({targetURL: location.origin + '/links/?warm=1#second', files: []});

    });
    await expect(page.locator('h1')).toHaveText('Links fixture');
    await expect(page).toHaveURL(/links\/\?warm=1#second/u);
    const inputNode = page.getByLabel('Draft');
    await inputNode.fill('Do not remount');
    await page.evaluate(function(){
        //Repeating the exact target must preserve the current component's input
        window.layerNativeLaunchConsumer({targetURL: location.href, files: []});

    });
    await expect(inputNode).toHaveValue('Do not remount');

});
