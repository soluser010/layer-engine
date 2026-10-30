import {readFileSync} from 'node:fs';
import {LayerCliError} from './cli-error.js';

/** @param {string} packageNameData */
export function packageVersionRead( packageNameData ){
    //Resolving installed package metadata without depending on monorepository folder names
    const entryUrlData = import.meta.resolve( packageNameData );
    const packageUrlData = new URL( '../package.json', entryUrlData );
    const packageData = JSON.parse( readFileSync( packageUrlData, 'utf8' ) );

    if ( packageData.name !== packageNameData || typeof packageData.version !== 'string' ||
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test( packageData.version ) === false ){
        throw new LayerCliError( 'CLI_PACKAGE_VERSION_INVALID', 'Installed Layer package metadata is invalid. Reinstall matching Layer packages.' );

    }

    //CallBack THE STRING
    return packageData.version;

}

export function frameworkVersionsRead(){
    //Keeping compiler-generated bindings on the same coordinated release as their authoring API
    const packageNamesData = ['@solcorp/layer-cli', '@solcorp/layer', '@solcorp/layer-compiler', '@solcorp/layer-render', '@solcorp/layer-runtime'];
    const versionsData = packageNamesData.map(function( packageNameData ){
        //Reading the exact dependencies selected by this installed CLI
        return packageVersionRead( packageNameData );

    });

    if ( new Set( versionsData ).size !== 1 ){
        throw new LayerCliError( 'CLI_FRAMEWORK_VERSION_MISMATCH', 'Layer CLI, compiler, authoring API, renderer and runtime must use the same version. Reinstall one matching release.' );

    }

    //CallBack THE OBJECT
    return Object.freeze({runtimeVersion: String( versionsData[4] ), compilerVersion: String( versionsData[2] )});

}
