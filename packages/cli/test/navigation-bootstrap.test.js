import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import {JSDOM} from 'jsdom';
import {layerNavigationBootstrapCreate} from '../src/navigation-bootstrap.js';

const appKey = 'a'.repeat(64);

/** @param {any} context @param {number} [timeoutMs] */
const fixtureCreate = function( context, timeoutMs = 1000 ){
    //Keeping browser listeners, deadlines and native fallback inside a disposable document
    const dom = new JSDOM('<main><a href="/app/one/?q=1#draft">First</a></main>', {url: 'https://example.com/app/'});
    const window = /** @type {any} */ (dom.window);
    const container = new window.EventTarget();
    container.controller = {};
    Object.defineProperty(window.navigator, 'serviceWorker', {value: container});
    const fallbacks = /** @type {string[]} */ ([]);
    const options = {appKey, scope: '/app/', matchers: ['^/app/(?:[^/]+/?)?$'], timeoutMs,
        fallback: function(/** @type {string} */ url){
            //Recording native recovery without navigating JSDOM
            fallbacks.push(url);

        }};
    const controller = layerNavigationBootstrapCreate(window, options);
    context.after(function(){
        //Closing only this fixture's browser ownership
        controller.dispose();
        window.close();

    });
    return {window, container, options, controller, fallbacks};

};

test('early bootstrap retains the latest app click and releases it through guarded routing', async function(context){
    //Delivering real bubbling events before any application module exists
    const {window, controller, options, fallbacks} = fixtureCreate(context);
    assert.equal(layerNavigationBootstrapCreate(window, options), controller);
    const anchor = window.document.querySelector('a');
    const click = new window.MouseEvent('click', {bubbles: true, cancelable: true, button: 0});
    assert.equal(anchor.dispatchEvent(click), false);
    anchor.href = '/app/two/?next=2#keep';
    assert.equal(anchor.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true})), false);
    const routes = /** @type {string[]} */ ([]);
    await controller.ready(async function(/** @type {string} */ url){
        //Checking that the complete last URL, not stale history, reaches the existing router
        routes.push(url);

    });
    assert.deepEqual(routes, ['https://example.com/app/two/?next=2#keep']);
    assert.deepEqual(fallbacks, []);
    assert.equal(anchor.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true})), true);
    assert.equal(controller.dispose(), true);
    assert.equal(controller.dispose(), false);

});

test('early bootstrap preserves explicit targets and every non-app navigation boundary', function(context){
    //Keeping _self and other existing platform semantics unchanged
    const {window} = fixtureCreate(context);
    const anchor = window.document.querySelector('a');
    for (const target of ['_self', '_blank', '_top', 'named-window']) {
        anchor.target = target;
        assert.equal(anchor.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true})), true);

    }
    anchor.removeAttribute('target');
    for (const href of ['/other/', 'https://foreign.example/app/one/', '/app/one/%FF', 'https://user:secret@example.com/app/one/']) {
        anchor.href = href;
        assert.equal(anchor.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true})), true);

    }
    anchor.href = '/app/one/';
    for (const attribute of ['download', 'data-layer-link']) {
        anchor.setAttribute(attribute, 'external');
        assert.equal(anchor.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true})), true);
        anchor.removeAttribute(attribute);

    }
    assert.equal(anchor.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true, ctrlKey: true})), true);

});

test('startup failure and timeout recover once, while disposal cancels native recovery', async function(context){
    //Checking bounded recovery independently from the browser network
    for (const mode of ['fail', 'timeout', 'dispose']) {
        const {window, controller, fallbacks} = fixtureCreate(context, 10);
        window.document.querySelector('a').dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
        if (mode === 'fail') {
            controller.fail();
            controller.fail();

        } else if (mode === 'dispose') {
            controller.dispose();

        }
        await pause(30);
        let expected = 1;
        if (mode === 'dispose') {
            expected = 0;

        }
        assert.equal(fallbacks.length, expected);
        await controller.ready(async function(){
            //No released controller may replay its old intention
            assert.fail('Released startup was revived.');

        });

    }

});

test('worker handoff requires the actual controller, app identity and a valid scoped route', async function(context){
    //Receiving a native-shaped event on a dedicated acknowledgement channel
    const {window, container, controller} = fixtureCreate(context);
    const routes = /** @type {string[]} */ ([]);
    await controller.ready(async function(/** @type {string} */ url){
        //Observing normal guarded router delivery rather than browser navigation
        routes.push(url);

    });
    const channel = new MessageChannel();
    context.after(function(){
        //Closing both native test ports even when an assertion fails
        channel.port1.close();
        channel.port2.close();

    });
    const message = {type: 'layer-navigation-open', protocol: 1, appKey, url: 'https://example.com/app/one/?q=2#keep'};
    for (const data of [{...message, appKey: 'foreign'}, {...message, protocol: 2}, {...message, extra: true}]) {
        const event = new window.Event('message');
        Object.assign(event, {source: container.controller, data, ports: [channel.port2]});
        container.dispatchEvent(event);

    }
    const foreign = new window.Event('message');
    Object.assign(foreign, {source: {}, data: message, ports: [channel.port2]});
    container.dispatchEvent(foreign);
    assert.equal(routes.length, 0);
    const response = new Promise(function(resolve){
        //Listening before delivery so an immediate acknowledgement cannot be missed
        channel.port1.onmessage = function(event){
            //Returning only the acknowledgement associated with this port
            resolve(event.data);

        };

    });
    const event = new window.Event('message');
    Object.assign(event, {source: container.controller, data: message, ports: [channel.port2]});
    container.dispatchEvent(event);
    assert.equal(/** @type {any} */ (await response).accepted, true);
    assert.deepEqual(routes, [message.url]);

});

test('a pending worker handoff is acknowledged before readiness without bypassing a denied guard', async function(context){
    //Separating successful message ownership from application authorization
    const {window, container, controller, fallbacks} = fixtureCreate(context);
    const channel = new MessageChannel();
    context.after(function(){
        //Closing test ports independently from the controller lifetime
        channel.port1.close();
        channel.port2.close();

    });
    const reply = new Promise(function(resolve){
        //Waiting for acknowledgement without needing application modules
        channel.port1.onmessage = function(event){
            //Reading this handoff's protocol reply
            resolve(event.data);

        };

    });
    const event = new window.Event('message');
    Object.assign(event, {source: container.controller, ports: [channel.port2], data: {
        type: 'layer-navigation-open', protocol: 1, appKey, url: 'https://example.com/app/private/?q=1#keep'
    }});
    container.dispatchEvent(event);
    assert.equal(/** @type {any} */ (await reply).accepted, true);
    const routes = /** @type {string[]} */ ([]);
    await controller.ready(async function(/** @type {string} */ url){
        //The existing router owns denial; native fallback must not bypass it
        routes.push(url);
        return {status: 'auth-required'};

    });
    assert.deepEqual(routes, ['https://example.com/app/private/?q=1#keep']);
    assert.deepEqual(fallbacks, []);

});

test('early navigation survives BFCache and releases listeners on actual document disposal', function(context){
    //Checking lifecycle ownership without pretending that a hidden page was terminated
    const {window, controller} = fixtureCreate(context);
    window.dispatchEvent(new window.PageTransitionEvent('pagehide', {persisted: true}));
    const anchor = window.document.querySelector('a');
    assert.equal(anchor.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true})), false);
    window.dispatchEvent(new window.PageTransitionEvent('pagehide', {persisted: false}));
    assert.equal(anchor.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true})), true);
    assert.equal(controller.dispose(), false);

});
