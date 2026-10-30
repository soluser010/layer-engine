import assert from 'node:assert/strict';
import test from 'node:test';
import {layerLinksConfigurationCreate, layerLinkAssociationDocumentsCreate, layerWebAppManifestValidate} from '../src/index.js';
import {layerLaunchBrokerCreate} from '../src/launch-broker.js';

//Function for preparing independent public platform identities for each fixture
const associationFixtureCreate = function(){
    //Using synthetic public metadata without a private signing key
    return {
        android: [{packageName: 'ru.example.app', sha256CertFingerprints: ['ab:'.repeat(31) + 'ab']}],
        apple: [{appId: 'ABCDE12345.ru.example.app'}],
        windows: [{packageFamilyName: 'Example.App_abcdefghijklm'}],
        web: [{appId: 'https://app.example.com/installed-app'}]
    };

};

test('links defaults are immutable and generate no fictitious association documents', function(){
    //Checking the safe configuration for a plain PWA
    const config = layerLinksConfigurationCreate(undefined);
    assert.equal(config.external.mode, 'viewer');
    assert.deepEqual(config.external.allowedOrigins, []);
    assert.deepEqual(layerLinkAssociationDocumentsCreate(config), {});
    assert.ok(Object.isFrozen(config.associations.android));

});

test('association documents preserve real identities and canonicalize deterministic output', function(){
    //Checking platform defaults and deduplicated origins without altering caller input
    const associations = associationFixtureCreate();
    const input = {associations, external: {allowedOrigins: ['https://VIEW.example.com', 'https://view.example.com/']}, scopeExtensions: ['https://related.example.com']};
    const config = layerLinksConfigurationCreate(input);
    const documents = layerLinkAssociationDocumentsCreate(config);
    assert.equal(Object.keys(documents).length, 4);
    assert.equal(JSON.parse(documents['.well-known/assetlinks.json'] ?? '')[0].target.namespace, 'android_app');
    assert.equal(config.associations.android[0]?.sha256CertFingerprints[0], 'AB:'.repeat(31) + 'AB');
    assert.equal(config.associations.web[0]?.appId, 'https://app.example.com/installed-app');
    assert.deepEqual(JSON.parse(documents['.well-known/web-app-origin-association'] ?? ''), {'https://app.example.com/installed-app': {scope: '/'}});
    assert.deepEqual(JSON.parse(documents['.well-known/apple-app-site-association'] ?? '').applinks.details[0].components, [{'/': '/*'}]);
    assert.deepEqual(config.external.allowedOrigins, ['https://view.example.com']);
    assert.equal(associations.android[0]?.sha256CertFingerprints[0], 'ab:'.repeat(31) + 'ab');
    const second = layerLinksConfigurationCreate({...input, associations: {
        ...associations,
        android: [...associations.android, {packageName: 'ru.another.app', sha256CertFingerprints: ['CD:'.repeat(31) + 'CD']}].reverse()
    }});
    assert.equal(second.associations.android[0]?.packageName, 'ru.another.app');
    assert.deepEqual(layerLinksConfigurationCreate({external: {allowedOrigins: ['http://127.0.0.1:8080']}}, {development: true}).external.allowedOrigins, ['http://127.0.0.1:8080']);

});

test('link configuration rejects malformed, excessive and ambiguous grants with field paths', function(){
    //Exercising every strict envelope and platform-specific validation boundary
    const invalidInputs = [
        [], new Date(), {unknown: true}, {external: []}, {external: {unknown: true}}, {external: {mode: 'all'}},
        {external: {allowedOrigins: 'all'}}, {scopeExtensions: Array(33).fill('https://example.com')},
        {scopeExtensions: ['https://*.example.com']}, {scopeExtensions: ['https://example.com/path']},
        {scopeExtensions: ['https://user:password@example.com']}, {scopeExtensions: ['not-a-url']},
        {scopeExtensions: ['http://example.com']}, {scopeExtensions: ['http://localhost']},
        {scopeExtensions: [123]}, {associations: {unknown: []}},
        {associations: {android: [{}]}}, {associations: {android: [{packageName: 'ru.example.app', sha256CertFingerprints: []}]}},
        {associations: {android: [{packageName: 'ru.example.app', sha256CertFingerprints: ['bad']}]}},
        {associations: {apple: [{appId: 'bad'}]}}, {associations: {apple: [{appId: 'ABCDE12345.ru.example.app', paths: ['../secret']}]}},
        {associations: {apple: [{appId: 'ABCDE12345.ru.example.app', paths: ['/../secret']}]}},
        {associations: {windows: [{packageFamilyName: 'bad'}]}},
        {associations: {web: [{appId: 123}]}}, {associations: {web: [{appId: 'bad'}]}},
        {associations: {web: [{appId: 'https://user:secret@example.com/app'}]}},
        {associations: {web: [{appId: 'https://example.com/app#unstable'}]}},
        {associations: {web: [{appId: 'https://example.com/app', scope: '/*'}]}}
    ];
    for (const inputData of invalidInputs) {
        //Requiring a stable error category and a source-addressable configuration path
        assert.throws(function(){
            //Launching only the pure validation boundary
            layerLinksConfigurationCreate(inputData);

        }, function(errorData){
            //Checking error metadata without reflecting the submitted input
            const error = /** @type {any} */ (errorData);
            return error.code === 'PWA_LINKS_CONFIG_INVALID' && error.details.path.startsWith('links');

        });

    }
    for (const [platformName, entries] of Object.entries(associationFixtureCreate())) {
        //Rejecting repeated identities for every association consumer
        assert.throws(function(){
            //Constructing an intentionally duplicated platform grant
            layerLinksConfigurationCreate({associations: {[platformName]: [...entries, ...entries]}});

        }, /Duplicate/u);

    }

});

test('standard manifest accepts bounded origin extensions without losing explicit launch behavior', function(){
    //Extending the existing manifest validator, not bypassing its unknown-field policy
    const manifest = {name: 'Example', short_name: 'Example', start_url: '/', icons: [{src: '/icon.svg', sizes: 'any', type: 'image/svg+xml'}],
        scope_extensions: [{type: 'origin', origin: 'https://related.example.com'}], launch_handler: {client_mode: 'navigate-new'}};
    const result = layerWebAppManifestValidate(manifest);
    assert.equal(/** @type {any} */ (result).scope_extensions[0].origin, 'https://related.example.com');
    assert.equal(/** @type {any} */ (result).launch_handler.client_mode, 'navigate-new');
    for (const extensions of [null, {}, [{type: 'other', origin: 'https://example.com'}], [{type: 'origin', origin: 'https://example.com', unsafe: true}]]) {
        //Rejecting invalid extension roots and unknown nested fields
        assert.throws(function(){
            //Passing each malformed extension through the real manifest validator
            layerWebAppManifestValidate({...manifest, scope_extensions: extensions});

        });

    }

});

test('launch broker preserves independent callbacks, startup replay and manual URL ownership', async function(){
    //Capturing the single native registration for deterministic delivery
    let callback = /** @type {any} */ (null);
    let registrations = 0;
    const failures = /** @type {unknown[]} */ ([]);
    const queue = {setConsumer: function(/** @type {any} */ consumer){
        //Recording the browser-owned slot
        callback = consumer;
        registrations++;

    }};
    const broker = layerLaunchBrokerCreate(queue, function(errorData){
        //Collecting callback errors independently from delivery records
        failures.push(errorData);

    });
    assert.equal(layerLaunchBrokerCreate(queue), broker);
    const auto = /** @type {any[]} */ ([]);
    const manual = /** @type {any[]} */ ([]);
    const files = /** @type {any[]} */ ([]);
    broker.setDefaultConsumer(function(data){
        //Recording router-directed startup data
        auto.push(data);

    });
    callback({targetURL: 'https://example.com/chat?room=1#message', files: [{name: 'one.txt'}]});
    broker.setConsumer(function(data){
        //Taking URL ownership with a cold-start replay
        manual.push(data);

    });
    broker.setFileConsumer(function(handles){
        //Receiving file handles retained before component readiness
        files.push(handles);

    });
    assert.equal(manual.length, 1);
    assert.equal(files.length, 1);
    assert.equal(registrations, 1);
    assert.equal(broker.hasConsumer(), true);
    broker.startupComplete();
    callback({targetURL: '/second', files: []});
    assert.equal(auto.length, 1);
    assert.equal(manual.length, 2);
    assert.equal(files.length, 2);
    broker.setConsumer(function(){
        //Simulating a rejected asynchronous application hook
        return Promise.reject(new Error('trusted callback failure'));

    });
    broker.setFileConsumer(function(){
        //Simulating an independent synchronous callback failure
        throw new Error('file callback failure');

    });
    callback({});
    await new Promise(function(resolve){
        //Waiting for Promise rejection observation without blocking the event loop
        setImmediate(resolve);

    });
    assert.equal(failures.length, 2);
    assert.equal(broker.dispose(), true);
    assert.equal(broker.dispose(), false);
    callback({targetURL: '/late'});
    assert.throws(function(){
        //Rejecting registrations after global disposal
        broker.setConsumer(function(){
            //Providing a valid callback while deliberately exercising disposed registration
            return undefined;

        });

    });
    for (const method of ['setConsumer', 'setFileConsumer', 'setDefaultConsumer']) {
        //Rejecting callback misuse before native ownership changes
        assert.throws(function(){
            //Passing invalid caller data through each callback slot
            /** @type {any} */ (broker)[method](null);

        }, TypeError);

    }

});
