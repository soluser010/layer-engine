import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {layerLinksCreate} from '../src/links.js';

//Function for creating an isolated DOM and observable browser navigation primitives
const linksFixtureCreate = function(){
    //Keeping external pages inert while exercising real DOM identity and focus
    const dom = new JSDOM('<div data-layer-root><button id="focus">Focus</button></div>', {url: 'https://app.example.com/'});
    const browserDocument = dom.window.document;
    dom.window.HTMLDialogElement.prototype.showModal = function(){
        //Modeling the browser top layer for unit tests; the browser gate uses native dialogs
        this.setAttribute('open', '');

    };
    dom.window.HTMLDialogElement.prototype.close = function(){
        //Modeling a native close event with deterministic cleanup
        this.removeAttribute('open');
        this.dispatchEvent(new dom.window.Event('close'));

    };
    const external = /** @type {string[]} */ ([]);
    const navigations = /** @type {string[]} */ ([]);
    const location = {href: 'https://app.example.com/', origin: 'https://app.example.com', pathname: '/', search: '', hash: '',
        assign: function(/** @type {string} */ urlData){
            //Recording a related-origin browser navigation without requesting a network resource
            external.push(urlData);

        }};
    const windowData = /** @type {Window} */ (/** @type {unknown} */ ({
        location,
        launchQueue: {setConsumer: function(){
            //Advertising only the native primitive in this DOM fixture
            return undefined;

        }},
        open: function(/** @type {string} */ urlData){
            //Recording explicit user-initiated external opening without treating null as failure
            external.push(urlData);
            return null;

        }
    }));
    const controller = layerLinksCreate({
        root: /** @type {HTMLElement} */ (browserDocument.querySelector('[data-layer-root]')),
        window: windowData,
        scope: '/',
        configuration: {external: {mode: 'viewer', allowedOrigins: ['https://view.example.com', 'https://app.example.com']}, scopeExtensions: ['https://related.example.com']},
        resolve: function(pathData){
            //Providing a bounded route resolver with one explicit missing page
            if (pathData === '/missing') {
                return null;

            }
            return {};

        },
        navigate: async function(urlData){
            //Returning the same success and protected-route boundaries as the generated host
            navigations.push(urlData);
            if (urlData.startsWith('/private')) {
                return {status: 'auth-required'};

            }
            const target = new URL(urlData, location.href);
            Object.assign(location, {href: target.href, pathname: target.pathname, search: target.search, hash: target.hash});
            return {status: 'ready'};

        }
    });

    //CallBack THE OBJECT
    return {dom, document: browserDocument, controller, navigations, external, location};

};

test('links preserve query/hash, readiness, deduplication, guards and related-origin boundaries', async function(){
    //Capturing only the latest incoming URL before router readiness
    const fixture = linksFixtureCreate();
    try {
        assert.equal((await fixture.controller.launch('/old')).reason, 'router-not-ready');
        await fixture.controller.launch('/chat?room=42#message');
        await fixture.controller.ready();
        assert.deepEqual(fixture.navigations, ['/chat?room=42#message']);
        assert.equal((await fixture.controller.launch('/chat?room=42#message')).reason, 'already-current');
        assert.equal((await fixture.controller.open('/private')).reason, 'auth-required');
        assert.equal((await fixture.controller.open('/missing', {mode: 'app'})).reason, 'app-scope-denied');
        assert.equal((await fixture.controller.open('https://related.example.com/chat')).reason, 'related-origin-navigation');
        assert.equal((await fixture.controller.open('https://other.example.com', {mode: 'app'})).status, 'blocked');
        assert.equal((await fixture.controller.open('https://other.example.com')).status, 'external-requested');
        assert.equal((await fixture.controller.open('/missing')).status, 'external-requested');
        assert.equal(fixture.external.length, 3);
        assert.equal(fixture.controller.getCapability().launchQueue, true);
        await fixture.controller.launch('/skipped');
        await fixture.controller.ready(true);
        for (const urlData of ['javascript:alert(1)', 'data:text/html,x', 'https://user:secret@example.com', 'https://example.com/\\path', '\nhttps://example.com']) {
            //Checking executable, credential-bearing and parser-normalized input before any side effect
            assert.equal((await fixture.controller.open(urlData)).reason, 'url-denied');

        }
        for (const options of [null, [], {unknown: true}, {mode: 'bad'}]) {
            //Rejecting malformed public options rather than silently changing navigation intent
            await assert.rejects(function(){
                //Calling the public boundary with intentionally invalid options
                return fixture.controller.open('/', /** @type {any} */ (options));

            }, TypeError);

        }
        fixture.controller.dispose();
        await assert.rejects(fixture.controller.launch('/late'), /disposed/u);
        await assert.rejects(fixture.controller.ready(), /disposed/u);
        await assert.rejects(fixture.controller.open('/late'), /disposed/u);
        assert.equal(fixture.controller.dispose(), false);

    } finally {
        //Closing only this test's browser realm
        fixture.dom.window.close();

    }

});

test('viewer uses restricted DOM, restores focus and isolates component ownership', async function(){
    //Opening an allowlisted site while retaining the existing app nodes
    const fixture = linksFixtureCreate();
    try {
        const focusNode = /** @type {HTMLElement} */ (fixture.document.querySelector('#focus'));
        focusNode.focus();
        const owner = fixture.controller.createOwner();
        const otherOwner = fixture.controller.createOwner();
        assert.equal((await owner.open('https://view.example.com/photo?item=1')).status, 'viewer-opened');
        const viewer = /** @type {HTMLDialogElement} */ (fixture.document.querySelector('dialog'));
        const frame = /** @type {HTMLIFrameElement} */ (viewer.querySelector('iframe'));
        assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-forms allow-same-origin');
        assert.match(frame.getAttribute('allow') ?? '', /camera 'none'/u);
        assert.equal(frame.referrerPolicy, 'no-referrer');
        assert.equal(fixture.document.querySelector('#focus'), focusNode);
        assert.equal(otherOwner.closeViewer(), false);
        const buttons = viewer.querySelectorAll('button');
        buttons[0]?.click();
        assert.equal(fixture.external.length, 1);
        assert.equal(owner.closeViewer(), true);
        assert.equal(fixture.document.activeElement, focusNode);
        await owner.open('https://view.example.com/second');
        assert.equal(owner.dispose(), true);
        assert.equal(owner.dispose(), false);
        assert.throws(function(){
            //Rejecting actions after component teardown
            owner.open('/late');

        }, /disposed/u);
        await fixture.controller.open('https://view.example.com');
        const secondViewer = /** @type {HTMLDialogElement} */ (fixture.document.querySelector('dialog'));
        secondViewer.dispatchEvent(new fixture.dom.window.Event('cancel', {cancelable: true}));
        assert.equal(fixture.document.querySelector('dialog'), null);
        await fixture.controller.open('https://view.example.com');
        /** @type {HTMLDialogElement} */ (fixture.document.querySelector('dialog')).close();
        assert.equal(fixture.controller.closeViewer(), false);
        assert.equal((await fixture.controller.open('https://other.example.com', {mode: 'viewer'})).reason, 'viewer-origin-denied');
        assert.equal((await fixture.controller.open('/', {mode: 'viewer'})).reason, 'viewer-origin-denied');
        const anchorNode = fixture.document.createElement('a');
        anchorNode.href = 'https://view.example.com';
        fixture.document.querySelector('[data-layer-root]')?.append(anchorNode);
        await fixture.controller.openAnchor(anchorNode);
        fixture.controller.closeViewer();
        assert.equal(fixture.document.activeElement, anchorNode);
        const detachedAnchor = fixture.document.createElement('a');
        assert.throws(function(){
            //Rejecting detached triggers before touching dialog focus
            fixture.controller.openAnchor(detachedAnchor);

        });
        fixture.dom.window.HTMLDialogElement.prototype.showModal = undefinedMethod;
        assert.equal((await fixture.controller.open('https://view.example.com')).status, 'external-requested');
        assert.equal((await fixture.controller.open('https://view.example.com', {mode: 'viewer'})).reason, 'viewer-unavailable');
        fixture.dom.window.HTMLDialogElement.prototype.showModal = function(){
            //Simulating a supported primitive that fails its modal transition
            throw new Error('modal unavailable');

        };
        assert.equal((await fixture.controller.open('https://view.example.com', {mode: 'viewer'})).reason, 'viewer-unavailable');

    } finally {
        //Releasing shared and component-owned browser resources
        fixture.controller.dispose();
        fixture.dom.window.close();

    }

});

const undefinedMethod = /** @type {any} */ (undefined);
