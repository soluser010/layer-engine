'use strict';

const embeddedDocumentByteLimit = 1024 * 1024;

//Function for checking one JavaScript identifier character
const identifierCharacterCheck = function(characterData = String()){
    //CallBack THE BOOLEAN
    return /[A-Za-z0-9_$]/.test(characterData);

};

//Function for checking one JavaScript identifier start character
const identifierStartCheck = function(characterData = String()){
    //CallBack THE BOOLEAN
    return /[A-Za-z_$]/.test(characterData);

};

//Function for skipping one quoted JavaScript string
const quotedStringEndFind = function(sourceData = String(), startOffset = Number(), quoteData = String()){
    let sourceOffset = Number( startOffset ) + Number( 1 );

    //Searching the matching quote while respecting escapes
    while ( Number( sourceOffset ) < Number( sourceData.length ) ){
        if ( String( sourceData[sourceOffset] ) === String( '\\' ) ){
            sourceOffset += 2;
            continue;

        }

        if ( String( sourceData[sourceOffset] ) === String( quoteData ) ){
            //CallBack THE NUMBER
            return Number( sourceOffset ) + Number( 1 );

        }

        sourceOffset += 1;

    }

    //CallBack THE NUMBER
    return Number( sourceData.length );

};

//Function for skipping one JavaScript line comment
const lineCommentEndFind = function(sourceData = String(), startOffset = Number()){
    const lineEndOffset = sourceData.indexOf( '\n', Number( startOffset ) + Number( 2 ) );

    if ( lineEndOffset < 0 ){
        //CallBack THE NUMBER
        return Number( sourceData.length );

    }

    //CallBack THE NUMBER
    return Number( lineEndOffset ) + Number( 1 );

};

//Function for skipping one JavaScript block comment
const blockCommentEndFind = function(sourceData = String(), startOffset = Number()){
    const commentEndOffset = sourceData.indexOf( '*/', Number( startOffset ) + Number( 2 ) );

    if ( commentEndOffset < 0 ){
        //CallBack THE NUMBER
        return Number( sourceData.length );

    }

    //CallBack THE NUMBER
    return Number( commentEndOffset ) + Number( 2 );

};

//Function for deciding whether a slash can start a JavaScript regular expression
const regularExpressionStartCheck = function(previousTokenData = String()){
    //Checking tokens that cannot finish a JavaScript value
    if (
        Number( previousTokenData.length ) === Number( 0 ) ||
        /^[([{,:;=!?&|+\-*%^~<>]$/.test(previousTokenData) === true ||
        /^(?:return|throw|case|delete|void|typeof|yield|await|in|of)$/.test(previousTokenData) === true
    ){
        //CallBack THE BOOLEAN
        return true;

    }

    //CallBack THE BOOLEAN
    return false;

};

//Function for skipping one JavaScript regular expression literal
const regularExpressionEndFind = function(sourceData = String(), startOffset = Number()){
    let sourceOffset = Number( startOffset ) + Number( 1 );
    let characterClassStatus = false;

    //Searching the closing slash while respecting escapes and character classes
    while ( Number( sourceOffset ) < Number( sourceData.length ) ){
        const characterData = String( sourceData[sourceOffset] );

        if ( String( characterData ) === String( '\\' ) ){
            sourceOffset += 2;
            continue;

        }

        if ( String( characterData ) === String( '[' ) ){
            characterClassStatus = true;
            sourceOffset += 1;
            continue;

        }

        if ( String( characterData ) === String( ']' ) ){
            characterClassStatus = false;
            sourceOffset += 1;
            continue;

        }

        if ( String( characterData ) === String( '/' ) && characterClassStatus === false ){
            sourceOffset += 1;

            while ( /[A-Za-z]/.test(String( sourceData[sourceOffset] )) === true ){
                sourceOffset += 1;

            }

            //CallBack THE NUMBER
            return Number( sourceOffset );

        }

        if ( String( characterData ) === String( '\n' ) || String( characterData ) === String( '\r' ) ){
            //CallBack THE NUMBER
            return Number( sourceOffset );

        }

        sourceOffset += 1;

    }

    //CallBack THE NUMBER
    return Number( sourceData.length );

};

/**
 * @typedef {{
 *     languageId: 'html' | 'css',
 *     templateStart: number,
 *     contentStart: number,
 *     contentEnd: number,
 *     templateEnd: number,
 *     closed: boolean,
 *     interpolations: ReadonlyArray<Readonly<{start: number, end: number}>>
 * }} EmbeddedRegionData
 */

/**
 * @param {string} sourceData
 * @param {number} startOffset
 * @param {EmbeddedRegionData[]} regionsData
 * @param {boolean} closingBraceStatus
 * @returns {number}
 */
function javascriptEndFind(sourceData, startOffset, regionsData, closingBraceStatus) {
    let sourceOffset = Number(startOffset);
    let braceDepth = 0;
    let previousTokenData = String();

    if (closingBraceStatus) {
        //Starting inside one interpolation brace owned by the caller.
        braceDepth = 1;

    }

    //Scanning executable JavaScript without evaluating it.
    while (Number(sourceOffset) < Number(sourceData.length)) {
        const characterData = String(sourceData[sourceOffset]);
        const nextCharacterData = String(sourceData[sourceOffset + 1] ?? '');

        if (/\s/.test(characterData)) {
            sourceOffset += 1;
            continue;

        }

        if (characterData === '/' && nextCharacterData === '/') {
            sourceOffset = lineCommentEndFind(sourceData, sourceOffset);
            continue;

        }

        if (characterData === '/' && nextCharacterData === '*') {
            sourceOffset = blockCommentEndFind(sourceData, sourceOffset);
            continue;

        }

        if (characterData === "'" || characterData === '"') {
            sourceOffset = quotedStringEndFind(sourceData, sourceOffset, characterData);
            previousTokenData = 'value';
            continue;

        }

        if (characterData === '`') {
            sourceOffset = templateEndFind(sourceData, sourceOffset, null, regionsData);
            previousTokenData = 'value';
            continue;

        }

        if (characterData === '/' && regularExpressionStartCheck(previousTokenData)) {
            sourceOffset = regularExpressionEndFind(sourceData, sourceOffset);
            previousTokenData = 'value';
            continue;

        }

        if (identifierStartCheck(characterData)) {
            const identifierStartOffset = Number(sourceOffset);

            while (identifierCharacterCheck(String(sourceData[sourceOffset] ?? ''))) {
                sourceOffset += 1;

            }

            const identifierData = sourceData.slice(identifierStartOffset, sourceOffset);
            let templateStartOffset = Number(sourceOffset);

            while (/\s/.test(String(sourceData[templateStartOffset] ?? ''))) {
                templateStartOffset += 1;

            }

            const previousCharacterData = String(sourceData[identifierStartOffset - 1] ?? '');
            const canonicalTagStatus = (identifierData === 'html' || identifierData === 'css') &&
                identifierCharacterCheck(previousCharacterData) === false &&
                previousCharacterData !== '.' &&
                previousCharacterData !== '?' &&
                sourceData[templateStartOffset] === '`';

            if (canonicalTagStatus) {
                sourceOffset = templateEndFind(
                    sourceData,
                    templateStartOffset,
                    /** @type {'html' | 'css'} */ (identifierData),
                    regionsData
                );
                previousTokenData = 'value';
                continue;

            }

            previousTokenData = identifierData;
            continue;

        }

        if (closingBraceStatus && characterData === '{') {
            braceDepth += 1;
            previousTokenData = characterData;
            sourceOffset += 1;
            continue;

        }

        if (closingBraceStatus && characterData === '}') {
            braceDepth -= 1;
            sourceOffset += 1;

            if (braceDepth === 0) {
                //CallBack THE NUMBER
                return Number(sourceOffset);

            }

            previousTokenData = characterData;
            continue;

        }

        previousTokenData = characterData;
        sourceOffset += 1;

    }

    //CallBack THE NUMBER
    return Number(sourceData.length);

};

/**
 * @param {string} sourceData
 * @param {number} templateStartOffset
 * @param {'html' | 'css' | null} languageId
 * @param {EmbeddedRegionData[]} regionsData
 */
function templateEndFind(sourceData, templateStartOffset, languageId, regionsData) {
    const contentStartOffset = Number(templateStartOffset) + Number(1);
    const interpolationRanges = /** @type {{start: number, end: number}[]} */ ([]);
    let sourceOffset = Number(contentStartOffset);
    let closedStatus = false;

    //Scanning template content and recursively scanning JavaScript interpolations.
    while (Number(sourceOffset) < Number(sourceData.length)) {
        const characterData = String(sourceData[sourceOffset]);
        const nextCharacterData = String(sourceData[sourceOffset + 1] ?? '');

        if (characterData === '\\') {
            sourceOffset += 2;
            continue;

        }

        if (characterData === '`') {
            closedStatus = true;
            break;

        }

        if (characterData === '$' && nextCharacterData === '{') {
            const interpolationStartOffset = Number(sourceOffset);
            const interpolationEndOffset = javascriptEndFind(
                sourceData,
                Number(sourceOffset) + Number(2),
                regionsData,
                true
            );
            interpolationRanges.push({
                start: interpolationStartOffset,
                end: interpolationEndOffset
            });
            sourceOffset = interpolationEndOffset;
            continue;

        }

        sourceOffset += 1;

    }

    const contentEndOffset = Number(sourceOffset);
    let templateEndOffset = Number(sourceData.length);

    if (closedStatus) {
        //Including the closing backtick in the complete template range.
        templateEndOffset = Number(sourceOffset) + Number(1);

    }

    if (languageId !== null) {
        //Recording the embedded language region after all nested regions are known.
        regionsData.push({
            languageId,
            templateStart: Number(templateStartOffset),
            contentStart: contentStartOffset,
            contentEnd: contentEndOffset,
            templateEnd: templateEndOffset,
            closed: closedStatus,
            interpolations: Object.freeze(interpolationRanges.map(function interpolationFreeze(rangeData) {
                //Freezing every interpolation range exposed by the scanner.
                return Object.freeze(rangeData);

            }))
        });

    }

    //CallBack THE NUMBER
    return Number(templateEndOffset);

};

//Function for locating every canonical embedded language region
const embeddedRegionsFind = function(sourceData = String()){
    if (Buffer.byteLength(sourceData, 'utf8') > embeddedDocumentByteLimit) {
        return Object.freeze([]);

    }

    const regionsData = /** @type {EmbeddedRegionData[]} */ ([]);
    javascriptEndFind(sourceData, 0, regionsData, false);
    regionsData.sort(function embeddedRegionOrder(firstRegionData, secondRegionData) {
        //Ordering regions by source position for deterministic diagnostics.
        return Number(firstRegionData.contentStart) - Number(secondRegionData.contentStart);

    });

    //CallBack THE OBJECT
    return Object.freeze(regionsData.map(function embeddedRegionFreeze(regionData) {
        //Freezing every region exposed by the scanner.
        return Object.freeze(regionData);

    }));

};

/**
 * @param {EmbeddedRegionData} regionData
 * @param {number} sourceOffset
 */
const embeddedInterpolationCheck = function(regionData, sourceOffset){
    //Checking whether JavaScript owns this position inside the template.
    return regionData.interpolations.some(function interpolationOffsetFind(interpolationData) {
        //Comparing the source offset with this exact interpolation range.
        return Number(sourceOffset) >= Number(interpolationData.start) &&
            Number(sourceOffset) < Number(interpolationData.end);

    });

};

/**
 * @param {string} sourceData
 * @param {EmbeddedRegionData} regionData
 */
const embeddedVirtualSourceCreate = function(sourceData, regionData){
    const sourceCharacters = /** @type {string[]} */ (Array.from(sourceData, function sourceCharacterMask(characterData) {
        //Preserving line breaks so every LSP position maps to the host document.
        if (characterData === '\n' || characterData === '\r') {
            return characterData;

        }

        return ' ';

    }));

    //Copying only the selected embedded template content.
    for (let sourceOffset = regionData.contentStart; sourceOffset < regionData.contentEnd; sourceOffset += 1) {
        sourceCharacters[sourceOffset] = sourceData[sourceOffset];

    }

    for (const interpolationData of regionData.interpolations) {
        let neutralValueStatus = false;

        //Masking executable JavaScript while retaining its exact source span.
        for (let sourceOffset = interpolationData.start; sourceOffset < interpolationData.end; sourceOffset += 1) {
            const characterData = String(sourceData[sourceOffset]);

            if (characterData === '\n' || characterData === '\r') {
                sourceCharacters[sourceOffset] = characterData;
                continue;

            }

            if (neutralValueStatus === false) {
                if (regionData.languageId === 'html') {
                    //Using a neutral HTML token without changing the source width.
                    sourceCharacters[sourceOffset] = 'x';

                } else {
                    //Using a neutral CSS token without changing the source width.
                    sourceCharacters[sourceOffset] = '0';

                }

                neutralValueStatus = true;

            } else {
                sourceCharacters[sourceOffset] = ' ';

            }

        }

    }

    //CallBack THE STRING
    return sourceCharacters.join('');

};

/**
 * @param {string} sourceData
 * @param {number} sourceOffset
 */
const embeddedDocumentAtOffsetCreate = function(sourceData, sourceOffset){
    const regionsData = embeddedRegionsFind(sourceData);
    const matchingRegions = regionsData.filter(function embeddedRegionAtOffsetFind(regionData) {
        //Treating the cursor immediately before the closing backtick as template content.
        return Number(sourceOffset) >= Number(regionData.contentStart) &&
            Number(sourceOffset) <= Number(regionData.contentEnd);

    }).sort(function embeddedRegionSmallestOrder(firstRegionData, secondRegionData) {
        //Selecting a nested canonical template before its containing interpolation.
        return (Number(firstRegionData.contentEnd) - Number(firstRegionData.contentStart)) -
            (Number(secondRegionData.contentEnd) - Number(secondRegionData.contentStart));

    });

    for (const regionData of matchingRegions) {
        if (embeddedInterpolationCheck(regionData, sourceOffset) === false) {
            //CallBack THE OBJECT
            return Object.freeze({
                languageId: regionData.languageId,
                region: regionData,
                text: embeddedVirtualSourceCreate(sourceData, regionData)
            });

        }

    }

    //CallBack THE BOOLEAN
    return null;

};

//Function for creating one virtual document for every embedded template
const embeddedDocumentsCreate = function(sourceData = String()){
    //CallBack THE OBJECT
    return Object.freeze(embeddedRegionsFind(sourceData).map(function embeddedDocumentCreate(regionData) {
        //Creating one immutable virtual document with source-compatible coordinates.
        return Object.freeze({
            languageId: regionData.languageId,
            region: regionData,
            text: embeddedVirtualSourceCreate(sourceData, regionData)
        });

    }));

};

module.exports = {
    embeddedDocumentAtOffsetCreate,
    embeddedDocumentByteLimit,
    embeddedDocumentsCreate,
    embeddedInterpolationCheck,
    embeddedRegionsFind
};
