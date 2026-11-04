import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {layerStartupBootstrapCreate} from '../src/startup-bootstrap.js';
import {layerUpdateCardCreate} from '../../pwa/src/update-card.js';


/** @param {import('node:test').TestContext} context @param {any} [options] */
const fixtureCreate = function( context, options = {} ){
    //Providing browser lifetimes with a controllable foreground clock and native-handle identities
    const dom = new JSDOM('<html lang="en"><body><main data-layer-root><input></main><aside inert aria-hidden="false"></aside></body></html>', {
        url: 'https://app.example.test/?room=1#draft', pretendToBeVisual: true
    });
    const window = /** @type {any} */ (dom.window);
    const intervals = new Map();
    const frames = new Map();
    let sequence = 0;
    let now = 0;
    window.performance.now = function(){
        //Reading deterministic active time without slowing the test for a minute
        return now;

    };
    window.setInterval = function( /** @type {any} */ callback ){
        //Tracking only bootstrap intervals for disposal verification
        intervals.set( ++sequence, callback );
        return sequence;

    };
    window.clearInterval = function( /** @type {any} */ identifier ){
        //Removing the owner's timer
        intervals.delete( identifier );

    };
    window.requestAnimationFrame = function( /** @type {any} */ callback ){
        //Keeping 100 percent observable until the next presentation frame
        frames.set( ++sequence, callback );
        return sequence;

    };
    window.cancelAnimationFrame = function( /** @type {any} */ identifier ){
        //Cancelling a pending completion frame
        frames.delete( identifier );

    };
    window.HTMLCanvasElement.prototype.getContext = function(){
        //Supplying computed opaque pixels without a platform-dependent native canvas dependency
        return {fillRect: function(){
            //Drawing is represented by the chosen fixture pixels
            return undefined;

        }, getImageData: function(){
            //Testing both foreground contrast branches
            return {data: options.pixels ?? [255, 255, 255, 255]};

        }};

    };
    const container = new window.EventTarget();
    container.getRegistration = async function(){
        //Returning a registration without assigning a controller to this window
        if ( options.lookupError ){
            throw new Error( 'Inspection denied' );

        }
        return options.existing;

    };
    if ( !options.unsupported ){
        Object.defineProperty( window.navigator, 'serviceWorker', {value: container} );

    }
    const worker = new window.EventTarget();
    worker.scriptURL = 'https://app.example.test/layer-service-worker.js';
    worker.state = 'installing';
    worker.postMessage = function(){
        //Default snapshots time out; explicit tests supply a transferred reply
        return undefined;

    };
    const registration = new window.EventTarget();
    Object.assign( registration, {scope: 'https://app.example.test/', installing: worker, active: null, waiting: null} );
    const configuration = {enabled: true, scope: '/', appKey: 'app', buildId: 'build',
        manifest: {name: 'Test application', ...options.manifest}};
    if ( options.noBody ){
        //Simulating the parser-blocking head script before the body exists
        window.document.body.remove();

    }
    const api = layerStartupBootstrapCreate( window, configuration );
    context.after(function(){
        //Releasing only this fixture's resources
        api.dispose();
        window.close();

    });
    return {window, api, configuration, registration, worker, intervals, frames,
        output: function(){
            //Reading rendered progress rather than private state
            return window.document.querySelector('output')?.textContent;

        }, advance: function( /** @type {number} */ milliseconds ){
            //Delivering the next timer tick at the requested foreground clock time
            now += milliseconds;
            for ( const callback of intervals.values() ){
                callback();

            }

        }, send: function( /** @type {any} */ fields, source = worker ){
            //Delivering realistic worker messages with independent source identity
            container.dispatchEvent( new window.MessageEvent( 'message', {source, data: {
                type: 'layer-update-status', appKey: 'app', buildId: 'build',
                phase: 'downloading', completedFiles: 0, totalFiles: 100, ...fields
            }} ) );

        }};

};


test( 'initial installation blocks the renderer until verified cache, native activation and app readiness', async function( context ){
    //Separating the three readiness gates and preserving existing accessibility state
    const fixture = fixtureCreate( context );
    await fixture.api.inspection;
    const {window, api, registration, worker} = fixture;
    assert.equal( layerStartupBootstrapCreate( window, fixture.configuration ), api );
    assert.equal( fixture.output(), '0%' );
    assert.equal( window.document.querySelector('main').hasAttribute('inert'), true );
    api.connect( registration );
    fixture.send({completedFiles: 18, totalFiles: 24});
    assert.equal( fixture.output(), '75%' );
    fixture.send({phase: 'verifying', completedFiles: 24, totalFiles: 24});
    assert.equal( fixture.output(), '99%' );
    fixture.send({phase: 'ready', completedFiles: 24, totalFiles: 24});
    api.ready();
    assert.equal( fixture.output(), '99%' );
    registration.active = worker;
    registration.installing = null;
    worker.state = 'activated';
    worker.dispatchEvent( new window.Event('statechange') );
    assert.equal( fixture.output(), '100%' );
    for ( const callback of fixture.frames.values() ){
        callback();

    }
    assert.equal( window.document.querySelector('[data-layer-startup-screen]'), null );
    assert.equal( window.document.querySelector('main').hasAttribute('inert'), false );
    assert.equal( window.document.querySelector('main').hasAttribute('aria-hidden'), false );
    assert.equal( window.document.querySelector('aside').hasAttribute('inert'), true );
    assert.equal( window.document.querySelector('aside').getAttribute('aria-hidden'), 'false' );
    assert.equal( fixture.intervals.size, 0 );
    api.ready();
    api.fail();
    api.connect( registration );

});

test( 'progress rejects foreign handles, scopes, apps, builds and impossible counters', async function( context ){
    //Preventing a forged ready message from opening the application
    const fixture = fixtureCreate( context );
    await fixture.api.inspection;
    fixture.api.connect( fixture.registration );
    fixture.send({completedFiles: 10});
    for ( const fields of [{appKey: 'other'}, {buildId: 'old'}, {phase: 'unknown'}, {totalFiles: 10001},
        {totalFiles: 0}, {completedFiles: -1}, {completedFiles: 101}, {completedFiles: 12.5},
        {phase: 'ready', completedFiles: 12}, {completedFiles: 9}, {type: 'unrelated'}] ){
        fixture.send( fields );
        assert.equal( fixture.output(), '10%' );

    }
    fixture.send({completedFiles: 100, phase: 'ready'}, {scriptURL: fixture.worker.scriptURL});
    assert.equal( fixture.output(), '10%' );
    fixture.worker.scriptURL += '?foreign';
    fixture.send({completedFiles: 100, phase: 'ready'});
    assert.equal( fixture.output(), '10%' );
    fixture.api.connect({scope: 'https://app.example.test/other/'});
    fixture.api.ready();
    assert.equal( fixture.output(), undefined );

});

test( 'uncontrolled documents with an active exact registration never flash initial-install content', async function( context ){
    //Controller absence must not classify an ordinary waiting update as the first installation
    const fixture = fixtureCreate( context, {existing: {scope: 'https://app.example.test/',
        active: {scriptURL: 'https://app.example.test/layer-service-worker.js'}, waiting: {}}} );
    assert.equal( fixture.window.document.querySelector('[data-layer-startup-screen] > div').hidden, true );
    await fixture.api.inspection;
    assert.equal( fixture.output(), undefined );
    assert.equal( fixture.intervals.size, 0 );

});

test( 'a registration of another scope does not suppress the app installation', async function( context ){
    //Treating a parent or sibling registration separately from this application
    const fixture = fixtureCreate( context, {existing: {scope: 'https://app.example.test/other/', active: {}}} );
    await fixture.api.inspection;
    assert.equal( fixture.output(), '0%' );
    assert.equal( fixture.window.document.querySelector('[data-layer-startup-screen] > div').hidden, false );

});

test( 'installation errors and redundant workers release an already ready application without 100 percent', async function( context ){
    //Covering registration rejection, disabled workers and failed preparation independently
    for ( const failure of ['registration', 'cache', 'redundant', 'lookup', 'unsupported'] ){
        const fixture = fixtureCreate( context, {lookupError: failure === 'lookup', unsupported: failure === 'unsupported'} );
        await fixture.api.inspection;
        if ( failure === 'registration' ){
            fixture.api.connect( null );

        } else if ( failure === 'cache' || failure === 'redundant' ){
            fixture.api.connect( fixture.registration );
            if ( failure === 'cache' ){
                fixture.send({phase: 'error'});

            } else {
                fixture.worker.state = 'redundant';
                fixture.worker.dispatchEvent( new fixture.window.Event('statechange') );

            }

        }
        fixture.api.ready();
        assert.equal( fixture.output(), undefined, failure );
        assert.equal( fixture.frames.size, 0 );

    }

});

test( 'foreground stall resets on progress and excludes hidden time', async function( context ){
    //A backgrounded phone must not time out a healthy download
    const fixture = fixtureCreate( context );
    await fixture.api.inspection;
    fixture.api.connect( fixture.registration );
    fixture.api.ready();
    fixture.advance( 59000 );
    fixture.send({completedFiles: 10});
    fixture.advance( 59000 );
    assert.equal( fixture.output(), '10%' );
    Object.defineProperty( fixture.window.document, 'visibilityState', {value: 'hidden', configurable: true} );
    fixture.window.document.dispatchEvent( new fixture.window.Event('visibilitychange') );
    fixture.advance( 600000 );
    Object.defineProperty( fixture.window.document, 'visibilityState', {value: 'visible', configurable: true} );
    fixture.window.document.dispatchEvent( new fixture.window.Event('visibilitychange') );
    assert.equal( fixture.output(), '10%' );
    fixture.advance( 1000 );
    assert.equal( fixture.output(), undefined );

});

test( 'startup failure and startup timeout show safe localized retry instead of endless percent', async function( context ){
    //Never rendering application error payloads or granting access to an unusable app
    for ( const lang of ['en', 'ru'] ){
        const fixture = fixtureCreate( context, {manifest: {lang}} );
        await fixture.api.inspection;
        if ( lang === 'en' ){
            fixture.api.fail();

        } else {
            fixture.advance( 60000 );

        }
        assert.doesNotMatch( fixture.output(), /%/u );
        assert.equal( fixture.window.document.querySelectorAll('button').length, 1 );
        fixture.api.fail();
        fixture.api.ready();
        assert.equal( fixture.window.document.querySelectorAll('button').length, 1 );
        assert.equal( fixture.window.document.querySelector('main').hasAttribute('inert'), true );

    }

});

test( 'snapshot recovers missed ready messages and disposal closes pending channels', async function( context ){
    //Using the existing reply-port contract rather than synthesizing progress from a timer
    const fixture = fixtureCreate( context );
    await fixture.api.inspection;
    let closed = 0;
    fixture.window.MessageChannel = class {
        port1 = {onmessage: /** @type {any} */ (null), close: function(){
            //Recording response-port cleanup
            closed++;

        }};
        port2 = {owner: this.port1, close: function(){
            //Recording transferred-port cleanup
            closed++;

        }};
    };
    fixture.worker.postMessage = function( /** @type {any} */ request, /** @type {any} */ ports ){
        //Returning a real snapshot shape after the first broadcast was missed
        assert.equal( request.type, 'layer-update-snapshot' );
        ports[0].owner.onmessage({data: {ok: true, appKey: 'app', buildId: 'build',
            phase: 'ready', completedFiles: 12, totalFiles: 12}});

    };
    fixture.registration.active = fixture.worker;
    fixture.registration.installing = null;
    fixture.worker.state = 'activated';
    fixture.api.connect( fixture.registration );
    fixture.api.ready();
    assert.equal( fixture.output(), '100%' );
    assert.equal( closed, 2 );
    fixture.worker.postMessage = function(){
        //Simulating a disappearing worker without exposing the exception
        throw new Error('Worker disconnected');

    };
    fixture.worker.dispatchEvent( new fixture.window.Event('statechange') );
    assert.equal( closed, 4 );
    fixture.worker.postMessage = function(){
        //Leaving a response pending for the disposal path
        return undefined;

    };
    fixture.worker.dispatchEvent( new fixture.window.Event('statechange') );
    fixture.api.dispose();
    assert.equal( closed, 6 );

});

test( 'branding stays local and uses initials when the selected icon fails', async function( context ){
    //Rejecting URL injection and retaining an opaque, contrasting surface
    const fixture = fixtureCreate( context, {pixels: [0, 0, 0, 255], manifest: {
        name: '<script>', background_color: 'url(https://evil.test/)', icons: [
            {src: 'https://evil.test/a.svg', sizes: 'any'}, {src: 'https://user:pass@app.example.test/a.svg'},
            {src: 'http://[bad'}, {src: '/small.png', sizes: '32x32'}, {src: '/large.png', sizes: '512x512'},
            {src: '/icon.svg', type: 'image/svg+xml', sizes: 'any'}
        ]
    }} );
    await fixture.api.inspection;
    const document = fixture.window.document;
    const image = document.querySelector('[data-layer-startup-icon] img');
    assert.equal( image.src, 'https://app.example.test/icon.svg' );
    assert.equal( document.querySelector('[data-layer-startup-screen]').style.color, 'white' );
    image.dispatchEvent( new fixture.window.Event('load') );
    image.dispatchEvent( new fixture.window.Event('error') );
    assert.equal( document.querySelector('[data-layer-startup-icon] img'), null );
    assert.equal( document.querySelector('script'), null );
    const extra = document.createElement('section');
    document.body.append( extra );
    await Promise.resolve();
    assert.equal( extra.hasAttribute('inert'), true );
    fixture.window.dispatchEvent( new fixture.window.Event('pagehide') );
    assert.equal( extra.hasAttribute('inert'), false );
    assert.equal( layerStartupBootstrapCreate(fixture.window, {enabled: false}), fixture.api );
    assert.equal( layerStartupBootstrapCreate({}, {enabled: false}), null );

});

test( 'update descriptions truncate at 47 code points without modifying the original manifest', function( context ){
    //Exercising exact boundaries, surrogate pairs, Cyrillic and trailing whitespace through the real card
    const fixture = fixtureCreate( context );
    fixture.api.dispose();
    const root = fixture.window.document.querySelector('main');
    for ( const description of [undefined, '', 'a'.repeat(46), 'я'.repeat(47), 'я'.repeat(48),
        '😀'.repeat(48), 'a'.repeat(46) + '\ntext'] ){
        const manifest = {name: 'Test', description};
        const card = layerUpdateCardCreate({root, manifest, controller: /** @type {any} */ ({subscribe: function( /** @type {any} */ listener ){
            //Showing a ready card without connecting a network controller
            listener({visible: true, phase: 'ready', progress: null});
            return function(){
                //No background subscription exists in this presentation fixture
                return undefined;

            };

        }})});
        const characters = Array.from( description ?? '' );
        let expected = description ?? '';
        if ( characters.length > 47 ){
            expected = characters.slice(0, 47).join('').trimEnd() + '...';

        }
        assert.equal( fixture.window.document.querySelector('[data-layer-update-card] p').textContent, expected );
        assert.equal( manifest.description, description );
        card.dispose();

    }

});


test( 'the early bootstrap paints during body parsing and retains a failure raised before body exists', async function( context ){
    //DOMContentLoaded can wait for a large module; creating the cover must not wait for that event
    for ( const failEarly of [false, true] ){
        const options = {noBody: true, existing: /** @type {any} */ (null)};
        const fixture = fixtureCreate( context, options );
        options.existing = fixture.registration;
        await fixture.api.inspection;
        if ( failEarly ){
            fixture.api.fail();

        }
        const body = fixture.window.document.createElement('body');
        fixture.window.document.documentElement.append( body );
        await Promise.resolve();
        assert.ok( body.querySelector('[data-layer-startup-screen]') );
        if ( failEarly ){
            assert.equal( body.querySelectorAll('button').length, 1 );

        } else {
            assert.equal( fixture.output(), '0%' );
            const module = fixture.window.document.createElement('script');
            module.src = '/_layer/application.mjs';
            body.append(module);
            module.dispatchEvent( new fixture.window.Event('error') );
            assert.equal( body.querySelectorAll('button').length, 1 );

        }

    }

});
