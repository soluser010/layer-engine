import {expect, test} from '@playwright/test';

async function applicationReady(page) {
    await page.goto('http://127.0.0.1:5330/');
    await page.waitForFunction(() => window.layer?.currentGet()?.route && !document.querySelector('[data-layer-root]').hasAttribute('data-layer-ssr'));
}

test('only visible ordinary links warm inert elements; lists and scrolling ancestors wait for navigation', async ({page}) => {
    await applicationReady(page);
    await page.evaluate(() => {
        document.getElementById('startup-link').remove();
        window.warmSections = new WeakSet();
        const create = document.createElement.bind(document);
        document.createElement = function(tag, options) {
            //Remember inert elements so the click can prove that the actual DOM node was reused.
            const element = create(tag, options);
            if (tag === 'section') {
                window.warmSections.add(element);
            }
            return element;
        };
        window.endCapture = function(){
            //Restore the native creator before the real navigation binds its DOM.
            document.createElement = create;

        };
        const root = document.querySelector('[data-layer-root]');
        function link(parent, chat, target) {
            const anchor = document.createElement('a');
            anchor.href = '/chats/' + chat;
            anchor.textContent = chat;
            if (target) {
                anchor.target = target;
            }
            parent.append(anchor);
        }
        function group(tag, parent, role) {
            const node = document.createElement(tag);
            if (role) {
                node.setAttribute('role', role);
            }
            parent.append(node);
            return node;
        }
        const short = group('div', root);
        short.style.overflowY = 'auto';
        short.style.height = '35px';
        link(short, 'short');
        const long = group('div', root);
        long.style.overflowY = 'scroll';
        long.style.height = '30px';
        const nested = group('div', long);
        nested.style.height = '120px';
        link(nested, 'long');
        link(group('li', group('ul', root)), 'list');
        link(group('div', root, 'listbox'), 'aria');
        link(root, 'self', '_self');
        link(root, 'ordinary');
        link(root, 'ordinary');
    });
    await expect.poll(() => page.evaluate(() => window.layer.navigationDiagnostics().unopened)).toBe(2);
    expect(await page.evaluate(() => window.chatMounts ?? 0)).toBe(0);
    await page.evaluate(() => window.endCapture());
    await page.getByText('short', {exact: true}).click();
    await expect(page.getByRole('heading')).toHaveText('Chat short');
    expect(await page.evaluate(() => window.layer.navigationDiagnostics().backgroundHits)).toBe(1);
    expect(await page.evaluate(() => window.warmSections.has(document.querySelector('[data-layer-root] > section')))).toBe(true);
});

test('keep the previous page during readiness, reject stale hooks and restore the same DOM with fresh preload', async ({page}) => {
    await applicationReady(page);
    await page.evaluate(() => window.layer.navigate('/chats/one'));
    await page.getByRole('textbox').fill('draft');
    await page.evaluate(() => {
        window.originalDraft = document.querySelector('textarea');
        window.screenBeforeOpen = ({params, signal}) => {
            if (params.chat === 'slow') {
                window.slowSignal = signal;
                return new Promise(() => {});
            }
            if (params.chat === 'error') {
                throw new Error('fixture-open-error');
            }
        };
        window.slow = window.layer.navigate('/chats/slow');
    });
    await page.waitForFunction(() => window.slowSignal);
    await expect(page).toHaveURL(/chats\/one$/u);
    await expect(page.getByRole('textbox')).toHaveValue('draft');
    await page.evaluate(() => window.layer.navigate('/chats/two'));
    expect(await page.evaluate(async () => [(await window.slow).status, window.slowSignal.aborted])).toEqual(['superseded', true]);
    expect(await page.evaluate(() => window.layer.navigate('/chats/error').catch(error => error.message))).toBe('fixture-open-error');
    await expect(page.getByRole('heading')).toHaveText('Chat two');
    await page.evaluate(() => {
        window.screenPreload = () => 'fresh';
    });
    await page.goBack();
    await expect(page.getByRole('textbox')).toHaveValue('draft');
    await expect(page.locator('output')).toHaveText('fresh');
    expect(await page.evaluate(() => window.originalDraft === document.querySelector('textarea'))).toBe(true);
    await page.getByRole('button', {name: 'Read'}).click();
    expect(await page.evaluate(() => [window.chatMounts, window.chatValue])).toEqual([2, 'fresh']);
    await page.evaluate(async () => {
        window.screenIdentity = {authenticated: true, userId: 'another', permissions: []};
        await window.layer.navigate('/chats/one');
    });
    await expect(page.getByRole('textbox')).toHaveValue('');
    expect(await page.evaluate(() => window.layer.navigationDiagnostics().saved)).toBe(0);
    await page.evaluate(() => window.layer.dispose());
    expect(await page.evaluate(() => window.layer.navigationDiagnostics().active)).toBe(0);
});

test('select navigation respects demand-only and disabled policies, restores nested scroll, and bounds a stuck hook', async ({page}) => {
    await applicationReady(page);
    await page.evaluate(() => {
        document.getElementById('startup-link').remove();
        const parent = document.querySelector('[data-layer-root]');
        const select = document.createElement('select');
        for (const path of ['/', '/on-demand', '/off']) {
            const option = document.createElement('option');
            option.value = option.textContent = path;
            select.append(option);
            const link = document.createElement('a');
            link.href = link.textContent = path;
            parent.append(link);
        }
        select.onchange = () => window.layer.navigate(select.value);
        parent.append(select);
    });
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => window.layer.navigationDiagnostics().unopened)).toBe(0);
    await page.locator('select').selectOption('/on-demand');
    await page.getByRole('textbox').fill('kept');
    await page.evaluate(() => {
        window.originalHeader = document.getElementById('shared-header');
        const region = document.createElement('div');
        region.id = 'saved-scroll-test';
        region.style.cssText = 'height:30px;overflow:auto';
        const list = document.createElement('div');
        list.style.height = '300px';
        region.append(list);
        document.querySelector('section').append(region);
        region.scrollTop = 90;
    });
    await page.evaluate(() => window.layer.navigate('/off'));
    await page.getByRole('textbox').fill('discard');
    expect(await page.evaluate(() => document.getElementById('shared-header') === window.originalHeader)).toBe(true);
    await page.evaluate(() => window.layer.navigate('/on-demand'));
    await expect(page.getByRole('textbox')).toHaveValue('kept');
    expect(await page.locator('#saved-scroll-test').evaluate(node => node.scrollTop)).toBe(90);
    await page.evaluate(() => window.layer.navigate('/off'));
    await expect(page.getByRole('textbox')).toHaveValue('');
    await page.clock.install();
    await page.evaluate(() => {
        window.screenBeforeOpen = ({signal}) => {
            window.deadlineSignal = signal;
            return new Promise(() => {});
        };
        window.deadlineResult = window.layer.navigate('/second/').catch(error => error.message);
    });
    await page.waitForFunction(() => window.deadlineSignal);
    await page.clock.fastForward(15010);
    expect(await page.evaluate(() => window.deadlineResult)).toBe('SCREEN_OPEN_TIMEOUT');
    await expect(page).toHaveURL(/off$/u);
});

test('measure screen retention after 10, 50 and 100 chat URLs', async ({page, browserName}, testInfo) => {
    test.skip(browserName !== 'chromium' || testInfo.project.name !== 'chrome');
    test.setTimeout(90000);
    const requests = [];
    page.on('request', request => requests.push(request.resourceType()));
    const session = await page.context().newCDPSession(page);
    await applicationReady(page);
    async function navigate(path) {
        return page.evaluate(async url => {
            const started = performance.now();
            await window.layer.navigate(url);
            return performance.now() - started;
        }, path);
    }
    const freshPage = await page.context().browser().newPage();
    await applicationReady(freshPage);
    const cold = await freshPage.evaluate(async () => {
        const started = performance.now();
        await window.layer.navigate('/chats/warm');
        return performance.now() - started;
    });
    await freshPage.close();
    await page.evaluate(() => {
        const link = document.createElement('a');
        link.href = '/chats/warm';
        link.textContent = 'Warm';
        document.querySelector('[data-layer-root]').append(link);
    });
    const enabled = await page.evaluate(() => window.layer.navigationDiagnostics().enabled);
    if (enabled) {
        await page.waitForFunction(() => window.layer.navigationDiagnostics().unopened > 0);
        await page.waitForTimeout(350);
    }
    const warmed = await navigate('/chats/warm');
    await navigate('/second/');
    const restored = await navigate('/chats/warm');
    const samples = [];
    const durations = [];
    async function sample(chats) {
        await session.send('HeapProfiler.collectGarbage');
        const heap = await session.send('Runtime.getHeapUsage');
        const dom = await session.send('Memory.getDOMCounters');
        const values = [...durations].sort((a, b) => a - b);
        samples.push({chats, heapBytes: heap.usedSize, ...dom, requests: requests.length,
            medianMs: values[Math.floor(values.length / 2)], p95Ms: values[Math.floor(values.length * 0.95)],
            screens: await page.evaluate(() => window.layer.navigationDiagnostics())});
    }
    for (let index = 1; index <= 100; index++) {
        durations.push(await navigate('/chats/' + index));
        if ([10, 50, 100].includes(index)) {
            await sample(index);
        }
    }
    await page.evaluate(() => window.layer.storagePurge());
    await sample('logout');
    await page.evaluate(() => window.layer.dispose());
    await sample('dispose');
    const result = {enabled, browser: page.context().browser().version(), cold, warmed, restored, samples};
    await testInfo.attach('screen-measurements', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
    console.log('SCREEN_MEASUREMENTS ' + JSON.stringify(result));
});
