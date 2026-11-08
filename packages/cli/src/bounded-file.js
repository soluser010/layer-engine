import {constants} from 'node:fs';
import {lstat, open, realpath} from 'node:fs/promises';
import path from 'node:path';

/**
 * Reads a regular file beneath an owned root. Missing files, links, changed
 * identities and oversized inputs all return null before their bytes are used.
 * @param {string} rootDirectory
 * @param {string} filePath
 * @param {number} [maximumBytes]
 */
export async function boundedFileRead( rootDirectory, filePath, maximumBytes = Infinity ){
    //Anchor relative traversal checks at the configured root, including on other Windows drives.
    const relativeFile = path.relative( rootDirectory, filePath );
    if ( !relativeFile || relativeFile === '..' || relativeFile.startsWith( '..' + path.sep ) || path.isAbsolute( relativeFile ) ){
        return null;

    }

    try {
        const expectedFile = path.join( await realpath( rootDirectory ), relativeFile );
        if ( await realpath( filePath ) !== expectedFile ){
            return null;

        }

        const expected = await lstat( expectedFile, {bigint: true} );
        if ( !expected.isFile() || expected.size > maximumBytes ){
            return null;

        }

        const file = await open( expectedFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0) );
        try {
            //Recheck the opened object across concurrent renames and read through the same handle.
            const actual = await file.stat({bigint: true});
            if ( !actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino ||
                actual.size !== expected.size || await realpath( filePath ) !== expectedFile ){
                return null;

            }

            if ( maximumBytes === Infinity ){
                return await file.readFile();

            }

            const content = Buffer.alloc( Number( actual.size ) + 1 );
            let length = 0;
            while ( length < content.length ){
                const result = await file.read( content, length, content.length - length, length );
                if ( result.bytesRead === 0 ){
                    break;

                }

                length += result.bytesRead;

            }

            if ( length !== Number( actual.size ) ){
                return null;

            }

            return content.subarray( 0, length );

        } finally {
            await file.close();

        }

    } catch ( fileError ){
        if ( ['ENOENT', 'ENOTDIR', 'ELOOP'].includes( /** @type {NodeJS.ErrnoException} */ (fileError).code ?? '' ) ){
            return null;

        }

        throw fileError;

    }

}
