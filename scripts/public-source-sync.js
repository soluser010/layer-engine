import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

const executeData = promisify( execFile );
const sourceDirectoryData = await realpath( path.resolve( import.meta.dirname, '..' ) );
const targetArgumentData = process.argv[2];
if ( !targetArgumentData ){
    throw new Error( 'Usage: node scripts/public-source-sync.js <existing-public-checkout>' );

}
const targetDirectoryData = await realpath( path.resolve( targetArgumentData ) );
if ( targetDirectoryData === sourceDirectoryData || targetDirectoryData.startsWith( sourceDirectoryData + path.sep ) ){
    throw new Error( 'The public checkout must be separate from the source checkout.' );

}

/** @param {string} directoryData @param {string[]} argumentsData */
const gitRead = async function( directoryData, argumentsData ){
    //Reading repository state without fetching or transferring private Git objects
    const resultData = await executeData( 'git', argumentsData, {cwd: directoryData, windowsHide: true, maxBuffer: 16 * 1024 * 1024} );
    return resultData.stdout.trim();

};

//Requiring reviewed commits in both checkouts before exporting ordinary files
for ( const directoryData of [sourceDirectoryData, targetDirectoryData] ){
    if ( await gitRead( directoryData, ['status', '--porcelain'] ) !== '' ){
        throw new Error( 'Commit or preserve pending changes before public synchronization: ' + directoryData );

    }

}
const remoteData = await gitRead( targetDirectoryData, ['remote', 'get-url', 'public'] );
if ( !['git@github.com:soluser010/layer-engine.git', 'https://github.com/soluser010/layer-engine.git'].includes( remoteData ) ){
    throw new Error( 'Target public remote is not the approved GitHub repository.' );

}
if ( await gitRead( targetDirectoryData, ['branch', '--show-current'] ) !== 'main' ){
    throw new Error( 'Select main in the public checkout before synchronization.' );

}

const rootFilesData = new Set([
    '.editorconfig', '.gitattributes', '.gitignore', '.npmrc', '.nvmrc',
    'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'README.md', 'README.ru.md', 'SECURITY.md',
    'eslint.config.js', 'package.json', 'package-lock.json', 'playwright.config.js', 'tsconfig.base.json', 'tsconfig.json'
]);
const directoriesData = new Set(['.github', 'browser-tests', 'compatibility', 'docs', 'extensions', 'fixtures', 'infra', 'packages', 'scripts', 'skills', 'test']);
/** @param {string} nameData */
const publicFileAllowed = function( nameData ){
    //Selecting framework source explicitly and excluding credentials and generated local state
    const segmentsData = nameData.split( '/' );
    if ( segmentsData.some( function( segmentData ){
        //Rejecting unexpected path forms even when Git reports them as tracked files
        return ['..', '.', '.git', 'node_modules', 'artifacts', '.layer', '.aws', '.codex'].includes( segmentData ) ||
            segmentData.startsWith( '.env' ) || segmentData.includes( '\\' ) || segmentData.includes( ':' );

    }) ){
        return false;

    }
    return rootFilesData.has( nameData ) || directoriesData.has( segmentsData[0] ?? '' );

};

/** @param {string} nameData */
const targetPathResolve = async function( nameData ){
    //Checking every existing parent to prevent writing through a symlink or junction
    const destinationData = path.resolve( targetDirectoryData, nameData );
    if ( !destinationData.startsWith( targetDirectoryData + path.sep ) ){
        throw new Error( 'Public file escapes the target checkout.' );

    }
    let parentData = destinationData;
    while ( parentData !== targetDirectoryData ){
        const entryData = await lstat( parentData ).catch( function( errorData ){
            //Accepting absent files while preserving unexpected filesystem errors
            if ( errorData.code === 'ENOENT' ){
                return null;

            }
            throw errorData;

        });
        if ( entryData?.isSymbolicLink() ){
            throw new Error( 'Public synchronization refuses symbolic links: ' + nameData );

        }
        parentData = path.dirname( parentData );

    }
    return destinationData;

};

const filesData = (await gitRead( sourceDirectoryData, ['ls-files', '-z'] )).split( '\0' ).filter( publicFileAllowed ).sort();
const previousFilesData = (await gitRead( targetDirectoryData, ['ls-files', '-z'] )).split( '\0' ).filter( Boolean );
const inventoryData = [];

//Preparing the complete validated copy before modifying the public working tree
for ( const nameData of filesData ){
    const sourcePathData = path.join( sourceDirectoryData, nameData );
    if ( !(await lstat( sourcePathData )).isFile() ){
        throw new Error( 'Only regular framework source files can be exported: ' + nameData );

    }
    const targetPathData = await targetPathResolve( nameData );
    const contentData = await readFile( sourcePathData );
    inventoryData.push({name: nameData, target: targetPathData, content: contentData, sha256: createHash( 'sha256' ).update( contentData ).digest( 'hex' )});

}
for ( const nameData of previousFilesData ){
    if ( !publicFileAllowed( nameData ) && nameData !== 'public-source.json' ){
        throw new Error( 'Unmanaged tracked file in public checkout: ' + nameData );

    }
    await targetPathResolve( nameData );

}
for ( const nameData of previousFilesData ){
    if ( !filesData.includes( nameData ) && nameData !== 'public-source.json' ){
        //Removing only obsolete tracked files; unrelated untracked files are left untouched
        await rm( await targetPathResolve( nameData ) );

    }

}
for ( const fileData of inventoryData ){
    await mkdir( path.dirname( fileData.target ), {recursive: true} );
    await writeFile( fileData.target, fileData.content );

}
const sourceRevisionData = await gitRead( sourceDirectoryData, ['rev-parse', 'HEAD'] );
await writeFile( await targetPathResolve( 'public-source.json' ), JSON.stringify({
    sourceRevision: sourceRevisionData,
    files: inventoryData.map( function( fileData ){
        //Recording public file hashes without local paths or private history
        return {path: fileData.name, sha256: fileData.sha256};

    })
}, null, 4) + '\n', 'utf8' );
process.stdout.write( `Prepared ${filesData.length} public files from ${sourceRevisionData}. Review, verify and commit in the public checkout before git push public main.\n` );
