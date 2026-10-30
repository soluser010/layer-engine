import assert from 'node:assert/strict';
import test from 'node:test';
import {
    html,
    repeat,
    when
} from '../src/index.js';
import {
    layerRepeatValueResolve,
    layerWhenValueResolve
} from '@solcorp/layer-render';

test('creates lazy owned when descriptors', function() {
    //Creating the descriptor without executing its lazy branch.
    let renderCount = 0;
    const descriptorData = when(true, function truthyRender() {
        //Recording the exact moment the selected template is requested.
        renderCount += 1;

        return html`<p>Visible</p>`;

    });
    const descriptorState = layerWhenValueResolve(descriptorData);

    if ( descriptorState === null ){
        //Failing before the nullable resolver result reaches the template assertion
        throw new Error( 'The when descriptor could not be resolved.' );

    }

    assert.equal(renderCount, 0);
    assert.equal(descriptorState.condition, true);
    const truthyTemplate = descriptorState.render(true);

    if ( truthyTemplate === null ){
        //Failing when the selected truthy branch unexpectedly has no template
        throw new Error( 'The truthy when template is unavailable.' );

    }

    assert.deepEqual(truthyTemplate.strings, ['<p>Visible</p>']);
    assert.equal(descriptorState.render(false), null);
    assert.equal(renderCount, 1);

});

test('creates keyed repeat descriptors and validates lazy templates', function() {
    //Creating one valid descriptor before exercising its failure boundaries.
    const descriptorData = repeat(
        [{id: 'message-1', title: 'Hello'}],
        function messageKeyGet(messageData) {
            //Returning the stable domain identity unchanged.
            return messageData.id;

        },
        function messageRender(messageData) {
            //Returning one compiler-compatible item template.
            return html`<li>${messageData.title}</li>`;

        }
    );
    const descriptorState = layerRepeatValueResolve(descriptorData);

    assert.equal(descriptorState.key({id: 'message-2'}, 0), 'message-2');
    assert.deepEqual(descriptorState.render({title: 'Layer'}, 0).values, ['Layer']);
    assert.throws(function invalidWhenCreate() {
        //Passing an invalid renderer to the public helper boundary.
        when(true, /** @type {any} */ (null));

    }, TypeError);
    assert.throws(function invalidRepeatCreate() {
        repeat([], /** @type {any} */ (null), function itemRender() {
            //Returning a valid template so only the key selector fails.
            return html`<li>Invalid</li>`;

        });

    }, TypeError);
    assert.throws(function invalidItemRender() {
        const invalidDescriptor = repeat([], function itemKeyGet() {
            //Returning one stable key before testing the template boundary.
            return 'key';

        }, function itemRender() {
            //Returning a foreign value that cannot own compiled HTML.
            return /** @type {any} */ ('unsafe');

        });

        layerRepeatValueResolve(invalidDescriptor).render({}, 0);

    }, TypeError);

});
