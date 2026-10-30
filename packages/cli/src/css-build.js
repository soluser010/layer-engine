import {readFile, readdir, lstat} from 'node:fs/promises';
import path from 'node:path';
import {transform} from 'lightningcss';
import {LayerCliError} from './cli-error.js';
import {layerEnvironmentRequestPathCheck} from './private-artifacts.js';


const defaultTargetsData = Object.freeze({chrome: '109', edge: '109', firefox: '115', safari: '16.4', ios_saf: '16.4'});
const browserNamesData = new Set(['chrome', 'edge', 'firefox', 'safari', 'ios_saf', 'opera', 'samsung', 'android']);

//Function for validating explicit CSS browser floors without loading ambient configuration
/** @param {unknown} [configurationData] */
export function layerCssConfigurationCreate( configurationData ){
    //Keeping old application configs compatible while rejecting explicit null or unknown fields
    if ( configurationData === undefined ){
        return Object.freeze({targets: defaultTargetsData});

    }
    if ( configurationData === null || typeof configurationData !== 'object' || Array.isArray( configurationData ) ||
        ![Object.prototype, null].includes( Object.getPrototypeOf(configurationData) ) ){
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'css must be an object.', {path: 'css'} );

    }
    const cssData = /** @type {Record<string, unknown>} */ (configurationData);
    if ( Object.keys( cssData ).some(function( fieldData ){
        //Rejecting options outside the single deterministic target contract
        return fieldData !== 'targets';

    }) ){
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'css contains unknown fields.', {path: 'css'} );

    }
    let targetsData = cssData.targets;
    if ( targetsData === undefined ){
        //Supplying defaults only for absence, not an explicit invalid null
        targetsData = defaultTargetsData;

    }
    if ( targetsData === null || typeof targetsData !== 'object' || Array.isArray( targetsData ) ||
        ![Object.prototype, null].includes( Object.getPrototypeOf(targetsData) ) || Object.keys( targetsData ).length === 0 ){
        throw new LayerCliError( 'CLI_CONFIG_INVALID', 'css.targets must contain browser versions.', {path: 'css.targets'} );

    }
    const normalizedData = /** @type {Record<string, string>} */ ({});
    for ( const [browserData, versionData] of Object.entries( targetsData ).sort() ){
        //Accepting stable major.minor.patch numbers that fit the compiler target representation
        if ( !browserNamesData.has( browserData ) || typeof versionData !== 'string' ||
            versionData.trim() !== versionData || !/^[1-9][0-9]{0,2}(?:\.(?:0|[1-9][0-9]{0,2})){0,2}$/.test( versionData ) ||
            versionData.split( '.' ).some(function( partData ){
                //Each version component occupies one byte in Lightning CSS
                return Number( partData ) > 255;

            }) ){
            throw new LayerCliError( 'CLI_CONFIG_INVALID', 'css.targets requires a supported browser and a version such as 16.4.', {
                path: 'css.targets.' + browserData,
                suggestions: ["Use css: {targets: {chrome: '109', firefox: '115', safari: '16.4', ios_saf: '16.4'}}."]
            });

        }
        normalizedData[browserData] = versionData;

    }
    //Returning immutable targets; a supplied map replaces the defaults
    return Object.freeze({targets: Object.freeze( normalizedData )});

}

//Function for prefixing, lowering and minifying one already-scoped stylesheet
/** @param {string} sourceData @param {string} fileData @param {ReturnType<typeof layerCssConfigurationCreate>} configurationData */
export function layerCssBuild( sourceData, fileData, configurationData ){
    //Encoding browser floors once for the native transform without ambient Browserslist or ENV
    const targetsData = /** @type {Record<string, number>} */ ({});
    for ( const [browserData, versionData] of Object.entries( configurationData.targets ) ){
        const versionPartsData = versionData.split( '.' ).map( Number );
        targetsData[browserData] = Number( versionPartsData[0] ) * 65536 + (versionPartsData[1] ?? 0) * 256 + (versionPartsData[2] ?? 0);

    }
    try {
        //Keeping Layer class names, asset URLs and custom properties while optimizing CSS only
        const resultData = transform({filename: fileData, code: Buffer.from( sourceData ), targets: targetsData,
            minify: true, cssModules: false, errorRecovery: false});
        return Buffer.from( resultData.code ).toString( 'utf8' );

    } catch( transformError ){
        //Publishing bounded file coordinates without source excerpts or native stack traces
        const locationData = /** @type {{loc?: {line?: number, column?: number}}} */ (transformError)?.loc;
        throw new LayerCliError( 'CLI_BUILD_CSS_INVALID', 'CSS could not be compiled. Check the stylesheet syntax.', {
            file: fileData, line: locationData?.line, column: locationData?.column,
            suggestions: ['Correct the CSS syntax at this location and rebuild; the previous dist remains available.']
        });

    }

}

//Function for transforming public styles before their integrity and release hashes are recorded
/** @param {string} publicDirectoryData @param {ReturnType<typeof layerCssConfigurationCreate>} configurationData */
export async function layerPublicCssBuild( publicDirectoryData, configurationData ){
    //Walking only the selected public tree with bounded CSS input and no symlink traversal
    const artifactsData = /** @type {Record<string, string>} */ ({});
    const pendingDirectoriesData = [publicDirectoryData];
    let inputBytesData = 0;
    let entryCountData = 0;
    while ( pendingDirectoriesData.length > 0 ){
        const directoryData = /** @type {string} */ (pendingDirectoriesData.pop());
        const entriesData = await readdir( directoryData, {withFileTypes: true} );
        for ( const entryData of entriesData ){
            const fileData = path.join( directoryData, entryData.name );
            const relativeData = path.relative( publicDirectoryData, fileData ).replaceAll( '\\', '/' );
            if ( layerEnvironmentRequestPathCheck( '/' + relativeData ) ){
                //Skipping private environment paths before any read
                continue;

            }
            entryCountData += 1;
            if ( entryData.isSymbolicLink() || entryCountData > 10000 ){
                throw new LayerCliError( 'CLI_BUILD_CSS_INVALID', 'Public CSS discovery exceeds its bounds or contains a symbolic link.' );

            }
            if ( entryData.isDirectory() ){
                pendingDirectoriesData.push( fileData );

            } else if ( entryData.isFile() && /\.css$/i.test( entryData.name ) ){
                //Bounding both individual files and the total retained stylesheet data
                const statusData = await lstat( fileData );
                inputBytesData += statusData.size;
                if ( statusData.size > 2 * 1024 * 1024 || inputBytesData > 16 * 1024 * 1024 ){
                    throw new LayerCliError( 'CLI_BUILD_CSS_INVALID', 'Public CSS exceeds the stylesheet size budget.', {file: 'public/' + relativeData} );

                }
                const sourceData = await readFile( fileData, 'utf8' );
                artifactsData[relativeData] = layerCssBuild( sourceData, 'public/' + relativeData, configurationData );

            }

        }

    }
    //Returning transformed copies without mutating public sources or fetching remote imports
    return artifactsData;

}
