import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {computed, effect, layerBindingObserve, layerCommitWait, layerSchedulerFlush, signal} from '../src/signals.js';

test( 'a failed effect reports commit failure and cannot strand sibling observers', async function(){
    const valueData = signal( 0 );
    const observedData = /** @type {number[]} */ ([]);
    const failureData = new Error( 'Expected effect failure' );
    const firstDisposeData = effect(function(){
        //Failing one observer while keeping its sibling in the same queue snapshot
        if ( valueData.get() === 1 ){
            throw failureData;

        }

    });
    const secondDisposeData = effect(function(){
        //Recording actual runs after the throwing observer
        observedData.push( valueData.get() );

    });

    try {
        layerSchedulerFlush();
        valueData.set( 1 );
        const rejectedCommitData = assert.rejects( layerCommitWait(), failureData );
        assert.throws( layerSchedulerFlush, failureData );
        await rejectedCommitData;
        assert.deepEqual( observedData, [0, 1] );
        valueData.set( 2 );
        await layerCommitWait();
        assert.deepEqual( observedData, [0, 1, 2] );

    } finally {
        firstDisposeData();
        secondDisposeData();

    }

});

test( 'computed and binding failures recover without remounting the document', async function(){
    const documentData = new JSDOM( '<main><span></span><p></p></main>' ).window.document;
    const originalNodeData = documentData.querySelector( 'span' );
    assert.ok( originalNodeData );
    const valueData = signal( 0 );
    let writesData = 0;
    const derivedData = computed(function(){
        //Returning the same value after recovery to verify failed consumers are still notified
        if ( valueData.get() === 1 ){
            throw new Error( 'Expected computed failure' );

        }

        return 0;

    });
    const bindingDisposeData = layerBindingObserve(function(){
        //Updating the existing text node so recovery cannot hide a replacement render
        originalNodeData.textContent = String( derivedData.get() );
        writesData += 1;

    });
    const otherDisposeData = layerBindingObserve(function(){
        //Failing a separate binding while preserving its dependency for recovery
        const currentData = valueData.get();

        if ( currentData === 1 ){
            throw new Error( 'Expected binding failure' );

        }

        documentData.querySelector( 'p' )?.setAttribute( 'data-value', String( currentData ) );

    });

    try {
        valueData.set( 1 );
        assert.throws( layerSchedulerFlush, AggregateError );
        valueData.set( 2 );
        await layerCommitWait();
        assert.equal( writesData, 2 );
        assert.equal( documentData.querySelector( 'span' ), originalNodeData );
        assert.equal( documentData.querySelector( 'p' )?.getAttribute( 'data-value' ), '2' );

    } finally {
        bindingDisposeData();
        otherDisposeData();
        derivedData.dispose();
        documentData.defaultView?.close();

    }

});

test( 'cleanup failure retains retry dependencies and a failed initial binding owns no subscription', async function(){
    const valueData = signal( 0 );
    const observedData = /** @type {number[]} */ ([]);
    let cleanupCallsData = 0;
    const disposeData = effect(function(){
        const currentData = valueData.get();
        observedData.push( currentData );

        return function(){
            //Throwing before the next effect can read any dependency
            cleanupCallsData += 1;

            if ( currentData === 0 ){
                throw new Error( 'Expected cleanup failure' );

            }

        };

    });
    layerSchedulerFlush();
    valueData.set( 1 );
    assert.throws( layerSchedulerFlush, /Expected cleanup failure/ );
    valueData.set( 2 );
    await layerCommitWait();
    assert.deepEqual( observedData, [0, 2] );
    disposeData();
    disposeData();
    assert.equal( cleanupCallsData, 2 );

    let initialCallsData = 0;
    assert.throws(function(){
        layerBindingObserve(function(){
            //Failing before the caller could receive a disposer
            valueData.get();
            initialCallsData += 1;
            throw new Error( 'Expected initial failure' );

        });

    }, /Expected initial failure/ );
    valueData.set( 3 );
    await layerCommitWait();
    assert.equal( initialCallsData, 1 );

});
