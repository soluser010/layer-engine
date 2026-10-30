import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {Linter} from 'eslint';
import {documentationExamplesVerify} from '../fixtures/documentation/verify.mjs';
import {documentationContractsVerify} from '../fixtures/documentation/contracts.mjs';
import {applicationExamplesVerify} from '../fixtures/documentation/application/verify.mjs';

const workspaceDirectory = path.resolve(import.meta.dirname, '..');
const documentationDirectory = path.join(workspaceDirectory, 'docs');
const localeItemsData = ['ru', 'en'];
const javascriptLinterData = new Linter({configType: 'flat'});
const requiredFrontmatterFieldsData = Object.freeze([
    'audience',
    'description',
    'order',
    'status',
    'title',
    'updated'
]);
const futureResourceItemsData = Object.freeze([
    'https://layer.solcorp.ru'
]);
const futureStatusExpressionData = /future|planned|not published|not available|будущ|планир|не опубликован|недоступен/iu;

/**
 * @param {string} directoryData
 * @param {string} [prefixData]
 * @returns {Promise<string[]>}
 */
async function markdownFilesRead(directoryData, prefixData = '') {
    //Reading only the direct entries before traversing nested documentation folders
    const entryItemsData = await readdir(directoryData, {
        withFileTypes: true
    });
    const fileItemsData = [];

    //Collecting normalized Markdown paths for deterministic locale comparison
    for (const entryData of entryItemsData) {
        const relativePathData = path.join(prefixData, entryData.name);

        if (entryData.isDirectory()) {
            fileItemsData.push(...await markdownFilesRead(
                path.join(directoryData, entryData.name),
                relativePathData
            ));

        } else if (entryData.isFile() && entryData.name.endsWith('.md')) {
            fileItemsData.push(relativePathData.replaceAll('\\', '/'));

        }

    }

    return fileItemsData.sort();

}

/**
 * @param {string} sourceData
 * @param {string} fileData
 */
function frontmatterValidate( sourceData, fileData ){
    //Getting the bounded YAML header used by the documentation site in the future
    const frontmatterMatchData = sourceData.match( /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u );

    //Checking that every localized article can be indexed without parsing its body
    if ( frontmatterMatchData === null ){
        throw new Error( fileData + ' does not contain YAML frontmatter.' );

    }

    const frontmatterSourceData = String( frontmatterMatchData[1] );

    //Checking the required future-site metadata one field at a time
    for ( const fieldNameData of requiredFrontmatterFieldsData ){
        const fieldExpressionData = new RegExp( '^' + fieldNameData + ':\\s*.+$', 'mu' );

        if ( fieldExpressionData.test( frontmatterSourceData ) === false ){
            throw new Error( fileData + ' is missing frontmatter field ' + fieldNameData + '.' );

        }

    }

}

/**
 * @param {string} headingData
 * @returns {string}
 */
function markdownAnchorCreate( headingData ){
    //Creating the GitHub-compatible anchor used by ordinary Markdown viewers
    return String( headingData )
        .trim()
        .toLowerCase()
        .replace( /[`*_~]/gu, '' )
        .replace( /[^\p{Letter}\p{Number}\s-]/gu, '' )
        .replace( /\s+/gu, '-' );

}

/**
 * @param {string} sourceData
 * @returns {Set<string>}
 */
function markdownAnchorsRead( sourceData ){
    const anchorItemsData = new Set();

    //Collecting every explicit heading outside the YAML header
    for ( const headingMatchData of sourceData.matchAll( /^#{1,6}\s+(.+)$/gmu ) ){
        anchorItemsData.add( markdownAnchorCreate( String( headingMatchData[1] ?? '' ) ) );

    }

    return anchorItemsData;

}

/**
 * @param {string} sourceData
 * @param {string} fileData
 */
function codeBlocksValidate(sourceData, fileData) {
    //Collecting balanced fenced blocks before validating executable examples
    const fenceExpressionData = /^```([^\r\n]*)\r?\n([\s\S]*?)^```\s*$/gm;
    const openingFenceCountData = (sourceData.match(/^```/gm) ?? []).length;
    const blockItemsData = [...sourceData.matchAll(fenceExpressionData)];

    if (openingFenceCountData !== blockItemsData.length * 2) {
        throw new Error(fileData + ' contains an unbalanced fenced code block.');

    }

    for (const blockData of blockItemsData) {
        //Selecting only JavaScript blocks owned by the syntax validation gate
        const languageData = String(blockData[1]).trim();

        if (languageData !== 'js' && languageData !== 'javascript') {
            continue;

        }

        const exampleSourceData = String(blockData[2]).trim();
        let parsedSourceData = exampleSourceData;

        //Wrapping configuration object examples as expressions for the JavaScript parser
        if ( exampleSourceData.startsWith( '{' ) && exampleSourceData.endsWith( '}' ) ){
            parsedSourceData = '(' + exampleSourceData + ')';

        }

        const diagnosticItemsData = javascriptLinterData.verify(parsedSourceData, [{
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                parserOptions: {
                    allowReturnOutsideFunction: true
                }
            }
        }]);

        const fatalDiagnosticData = diagnosticItemsData.find(function fatalDiagnosticFind( diagnosticData ){
            //CallBack THE BOOLEAN
            return diagnosticData.fatal === true;

        });

        if (fatalDiagnosticData !== undefined) {
            throw new Error(
                fileData + ' contains a JavaScript example with invalid syntax at line ' +
                String(fatalDiagnosticData.line ?? 0) + ': ' + fatalDiagnosticData.message
            );

        }

    }

}

/**
 * @param {string} sourceData
 * @param {string} absoluteFileData
 */
async function localLinksValidate(sourceData, absoluteFileData) {
    const linkExpressionData = /\[[^\]]*\]\(([^)]+)\)/g;

    for (const matchData of sourceData.matchAll(linkExpressionData)) {
        const targetSourceData = String(matchData[1]).trim().replace(/^<|>$/g, '');

        if (
            targetSourceData.length === 0 ||
            targetSourceData.startsWith('#') ||
            /^[a-z]+:/i.test(targetSourceData)
        ) {
            continue;

        }

        const targetPartsData = targetSourceData.split('#');
        const targetPathData = decodeURIComponent(targetPartsData.at(0) ?? '');
        const targetAnchorData = decodeURIComponent(targetPartsData.at(1) ?? '');

        if (targetPathData.length === 0 && targetAnchorData.length === 0) {
            continue;

        }

        let targetAbsoluteData = absoluteFileData;

        //Resolving an explicit linked file relative to the current documentation article
        if ( targetPathData.length > 0 ){
            targetAbsoluteData = path.resolve( path.dirname( absoluteFileData ), targetPathData );

        }

        const targetSourceDataValue = await readFile(targetAbsoluteData, 'utf8').catch(function documentationLinkMissing() {
            //Converting a filesystem miss into a documentation-specific diagnostic
            throw new Error(
                path.relative(workspaceDirectory, absoluteFileData) +
                ' references missing file ' + targetSourceData + '.'
            );

        });

        //Checking explicit heading links so the future site cannot publish dead navigation
        if (
            targetAnchorData.length > 0 &&
            markdownAnchorsRead( targetSourceDataValue ).has( targetAnchorData ) === false
        ){
            throw new Error(
                path.relative( workspaceDirectory, absoluteFileData ) +
                ' references missing anchor #' + targetAnchorData + ' in ' + targetSourceData + '.'
            );

        }

    }

}

/**
 * @param {string} sourceData
 * @param {string} fileData
 */
function futureResourcesValidate( sourceData, fileData ){
    //Checking that planned public destinations are never presented as currently available
    for ( const resourceUrlData of futureResourceItemsData ){
        if (
            sourceData.includes( resourceUrlData ) === true &&
            futureStatusExpressionData.test( sourceData ) === false
        ){
            throw new Error( fileData + ' presents a future resource without a status warning: ' + resourceUrlData );

        }

    }

}

/**
 * @param {string} sourceData
 * @param {string} fileData
 */
function cliCommandsValidate( sourceData, fileData ){
    const commandExpressionData = /^\s*layer\s+([^\r\n]+)$/gmu;
    const commandPatternItemsData = [
        /^(?:--help|-h|--version|-v)$/u,
        /^build(?:\s+--(?:dry-run|diagnostics=json))*$/u,
        /^create\s+(?:<name>|[A-Za-z][A-Za-z0-9 -]*)(?:\s+--dry-run)?$/u,
        /^database\s+schema\s+apply\s+(?:<checksum>|[a-f0-9]+)\s+--confirm-data-loss$/u,
        /^database\s+schema\s+plan$/u,
        /^notifications\s+vapid\s+generate$/u,
        /^(?:dev|doctor|docs|inspect)(?:\s+--diagnostics=json)?$/u
    ];

    //Checking every documented Layer command against the current public CLI vocabulary
    for ( const commandMatchData of sourceData.matchAll( commandExpressionData ) ){
        const commandSourceData = String( commandMatchData[1] ).trim();
        const commandStatusData = commandPatternItemsData.some(function commandPatternCheck( commandPatternData ){
            //CallBack THE BOOLEAN
            return commandPatternData.test( commandSourceData );

        });

        if ( commandStatusData === false ){
            throw new Error( fileData + ' contains an unknown Layer CLI command: layer ' + commandSourceData );

        }

    }

}

/**
 * @param {string} sourceData
 * @param {string} fileData
 */
async function publicImportsValidate( sourceData, fileData ){
    const importExpressionData = /import\s*\{([^}]*)\}\s*from\s*['"](@solcorp\/layer(?:-[a-z-]+)?)['"]/gu;

    //Checking public named imports against the currently executable package export map
    for ( const importMatchData of sourceData.matchAll( importExpressionData ) ){
        const packageNameData = String( importMatchData[2] );
        const packageModuleData = await import( packageNameData );
        const importNameItemsData = String( importMatchData[1] ).split( ',' ).map(function importNameNormalize( importNameData ){
            //Getting the exported name before an optional local alias
            return String( String( importNameData ).trim().split( /\s+as\s+/u )[0] ?? '' );

        }).filter( Boolean );

        for ( const importNameData of importNameItemsData ){
            if ( Object.hasOwn( packageModuleData, importNameData ) === false ){
                throw new Error(
                    fileData + ' imports missing public export ' + importNameData + ' from ' + packageNameData + '.'
                );

            }

        }

    }

}

/**
 * @param {string} localeData
 * @param {readonly string[]} fileItemsData
 */
async function localeTableOfContentsValidate( localeData, fileItemsData ){
    const indexFileData = path.join( documentationDirectory, localeData, 'README.md' );
    const indexSourceData = await readFile( indexFileData, 'utf8' );

    //Checking that the localized table of contents reaches every public article
    for ( const relativeFileData of fileItemsData ){
        if ( relativeFileData === 'README.md' ){
            continue;

        }

        if ( indexSourceData.includes( '(' + relativeFileData + ')' ) === false ){
            throw new Error( localeData + '/README.md does not link to ' + relativeFileData + '.' );

        }

    }

}

const localeFileMapData = new Map();

for (const localeData of localeItemsData) {
    localeFileMapData.set(
        localeData,
        await markdownFilesRead(path.join(documentationDirectory, localeData))
    );

}

const russianFileItemsData = localeFileMapData.get('ru') ?? [];
const englishFileItemsData = localeFileMapData.get('en') ?? [];

if (JSON.stringify(russianFileItemsData) !== JSON.stringify(englishFileItemsData)) {
    throw new Error('Russian and English documentation structures are not equivalent.');

}

await localeTableOfContentsValidate( 'ru', russianFileItemsData );
await localeTableOfContentsValidate( 'en', englishFileItemsData );

for (const localeData of localeItemsData) {
    for (const relativeFileData of localeFileMapData.get(localeData) ?? []) {
        const absoluteFileData = path.join(documentationDirectory, localeData, relativeFileData);
        const sourceData = await readFile(absoluteFileData, 'utf8');

        frontmatterValidate( sourceData, relativeFileData );
        codeBlocksValidate(sourceData, relativeFileData);
        cliCommandsValidate( sourceData, relativeFileData );
        futureResourcesValidate( sourceData, relativeFileData );
        await localLinksValidate(sourceData, absoluteFileData);
        await publicImportsValidate( sourceData, relativeFileData );

    }

}

await documentationExamplesVerify();
const documentedContractsData = await documentationContractsVerify();
await applicationExamplesVerify();

process.stdout.write(
    'Documentation check passed for ' + String(russianFileItemsData.length) + ' mirrored articles, ' +
    String(documentedContractsData.exports) + ' classified exports and ' +
    String(documentedContractsData.topics) + ' required API topics; selected application examples executed.\n'
);
