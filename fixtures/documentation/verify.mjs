import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {URL} from 'node:url';
import {layerOperationContractsCompile} from '@solcorp/layer-compiler';
import {layerOperationRegistryCreate} from '@solcorp/layer-server';
import {fullOperationDefinitionsCreate} from './full/src/server/operations.js';
import {minimalOperationDefinitionsCreate} from './minimal/src/server/operations.js';

/**
 * Verifies the operation examples used by the public documentation.
 *
 * @returns {Promise<boolean>}
 */
export async function documentationExamplesVerify(){
    //Creating the fixture sources checked by the static operation compiler
    const fixtureFileItemsData = [
        new URL( './minimal/src/operations.js', import.meta.url ),
        new URL( './full/src/operations.js', import.meta.url )
    ];

    //Compiling every shared contract without executing application source code
    for ( const fixtureFileData of fixtureFileItemsData ){
        const fixtureSourceData = await readFile( fixtureFileData, 'utf8' );
        const fixtureContractItemsData = layerOperationContractsCompile( fixtureSourceData, {
            file: fixtureFileData.pathname
        });

        //Checking that the documentation fixture contains one usable operation
        assert.equal( Number( fixtureContractItemsData.length ), Number( 1 ) );

    }

    //Creating the trusted server definitions for both documented complexity levels
    const operationDefinitionItemsData = [
        ...minimalOperationDefinitionsCreate(),
        ...fullOperationDefinitionsCreate({
            messageSend: async function messageSend(){
                //CallBack THE OBJECT
                return {
                    messageId: String( '00000000-0000-4000-8000-000000000001' ),
                    revision: Number( 1 )
                };

            }
        })
    ];
    const operationRegistryData = layerOperationRegistryCreate();

    //Registering every definition through the same registry used by applications
    for ( const operationDefinitionData of operationDefinitionItemsData ){
        operationRegistryData.define( operationDefinitionData );

    }

    //Sealing and inspecting the registry without exposing executable handlers
    operationRegistryData.seal();
    const operationInspectionItemsData = operationRegistryData.list();

    assert.equal( operationRegistryData.isSealed(), true );
    assert.equal( Number( operationInspectionItemsData.length ), Number( 2 ) );
    for ( const operationInspectionData of operationInspectionItemsData ){
        //Checking every public inspection item without relying on array indexes
        assert.equal( Object.hasOwn( operationInspectionData, String( 'handler' ) ), false );

    }

    //CallBack THE BOOLEAN
    return true;

}
