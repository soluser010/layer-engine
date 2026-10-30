import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const workspaceDirectory = path.resolve(process.argv[2] ?? '');
const componentFile = path.resolve(process.argv[3] ?? '');
const previewStatus = process.argv.includes('--preview');
const relativeFile = path.relative(workspaceDirectory, componentFile).replaceAll('\\', '/');

/**
 * @param {unknown} outputData
 */
function resultWrite(outputData) {
    //Writing exactly one bounded JSON record for the extension host.
    process.stdout.write(`${JSON.stringify(outputData)}\n`);

}

try {
    let packageSearchDirectory = workspaceDirectory;
    let compilerPackageDirectory = null;
    let compilerPackageSource = null;

    //Following Node's ancestor lookup without executing package code.
    while (compilerPackageDirectory === null) {
        const candidateDirectory = path.join(
            packageSearchDirectory,
            'node_modules',
            '@solcorp',
            'layer-compiler'
        );

        try {
            compilerPackageSource = await readFile(path.join(candidateDirectory, 'package.json'), 'utf8');
            compilerPackageDirectory = candidateDirectory;

        } catch (packageError) {
            if (/** @type {NodeJS.ErrnoException} */ (packageError).code !== 'ENOENT') {
                throw packageError;

            }

            const parentDirectory = path.dirname(packageSearchDirectory);

            if (parentDirectory === packageSearchDirectory) {
                throw new Error('Install @solcorp/layer-compiler in the Layer application workspace.', {
                    cause: packageError
                });

            }

            packageSearchDirectory = parentDirectory;

        }

    }

    const compilerPackageData = JSON.parse(String(compilerPackageSource));
    const compilerEntryRelative = compilerPackageData.exports?.['.']?.import;

    if (typeof compilerEntryRelative !== 'string') {
        throw new Error('The local @solcorp/layer-compiler ESM export is unavailable.');

    }

    const compilerEntry = path.resolve(compilerPackageDirectory, compilerEntryRelative);
    const compilerEntryBoundary = path.relative(compilerPackageDirectory, compilerEntry);

    if (compilerEntryBoundary.startsWith('..') || path.isAbsolute(compilerEntryBoundary)) {
        throw new Error('The local compiler export leaves its package directory.');

    }

    const compilerModule = await import(pathToFileURL(compilerEntry).href);
    const sourceData = await readFile(componentFile, 'utf8');
    let compiledData;

    //Selecting the static operation contract or component compiler by conventional file.
    if (relativeFile === 'src/operations.js') {
        compiledData = compilerModule.layerOperationContractsCompile(sourceData, {
            file: relativeFile
        });

    } else {
        compiledData = compilerModule.layerJavascriptComponentCompile(sourceData, {
            componentId: relativeFile.replace(/[^A-Za-z0-9._/-]/g, '-'),
            file: relativeFile
        });

    }

    let previewData = null;

    //Returning the compiled plan only for the explicit preview command.
    if (previewStatus) {
        previewData = compiledData;

    }

    resultWrite({
        ok: true,
        preview: previewData
    });

} catch (errorData) {
    let errorRecord = /** @type {Record<string, unknown>} */ ({});

    //Reading compiler diagnostics only from object-shaped failures.
    if (typeof errorData === 'object' && errorData !== null) {
        errorRecord = /** @type {Record<string, unknown>} */ (errorData);

    }

    resultWrite({
        ok: false,
        code: String(errorRecord.code ?? 'LAYER_IDE_DIAGNOSTIC_FAILED'),
        message: String(errorRecord.message ?? 'Layer compiler diagnostics are unavailable.'),
        file: errorRecord.file ?? relativeFile,
        line: Number(errorRecord.line ?? 1),
        column: Number(errorRecord.column ?? 1)
    });

}
/* global process */
