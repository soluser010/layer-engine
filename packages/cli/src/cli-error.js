export class LayerCliError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {Readonly<Record<string, unknown>> | null} [details]
     */
    constructor(code, message, details = null) {
        super(message);

        //Publishing stable command diagnostics without filesystem internals.
        this.name = 'LayerCliError';
        this.code = code;
        this.details = details;

    }

}

/**
 * Creates the bounded machine-readable diagnostic exposed by the CLI boundary.
 * Unknown errors deliberately keep only the generic internal error code.
 *
 * @param {unknown} errorData
 * @returns {Readonly<{
 *     code: string,
 *     message: string,
 *     file: string | null,
 *     path: string | null,
 *     line: number | null,
 *     column: number | null,
 *     suggestions: readonly string[],
 *     documentation: string | null
 * }>}
 */
export function layerCliErrorDiagnosticCreate( errorData ){
    //Creating the fail-closed diagnostic used for unexpected implementation failures
    let errorCodeData = String( 'CLI_INTERNAL_ERROR' );
    let errorMessageData = String( 'Layer CLI encountered an unexpected internal error.' );
    let errorDetailsData = /** @type {Readonly<Record<string, unknown>> | null} */ (null);

    //Reading only the stable public fields from an expected Layer CLI error
    if ( errorData instanceof LayerCliError ){
        errorCodeData = String( errorData.code ).slice( 0, 160 );
        errorMessageData = String( errorData.message ).slice( 0, 1000 );
        errorDetailsData = errorData.details;

    }

    let errorFileData = null;
    let errorPathData = null;
    let errorLineData = null;
    let errorColumnData = null;
    let errorDocumentationData = null;
    let errorSuggestionsData = /** @type {string[]} */ ([]);

    //Copying only explicitly supported diagnostic metadata without exposing arbitrary details
    if ( errorDetailsData !== null ){
        if ( typeof errorDetailsData.file === String( 'string' ) ){
            errorFileData = String( errorDetailsData.file ).slice( 0, 500 );

        }

        if ( typeof errorDetailsData.path === String( 'string' ) ){
            errorPathData = String( errorDetailsData.path ).slice( 0, 500 );

        }

        if ( Number.isSafeInteger( errorDetailsData.line ) && Number( errorDetailsData.line ) > Number( 0 ) ){
            errorLineData = Number( errorDetailsData.line );

        }

        if ( Number.isSafeInteger( errorDetailsData.column ) && Number( errorDetailsData.column ) > Number( 0 ) ){
            errorColumnData = Number( errorDetailsData.column );

        }

        if (
            typeof errorDetailsData.documentation === String( 'string' ) &&
            /^(?:https:\/\/|docs\/)[^\s]{1,480}$/u.test( String( errorDetailsData.documentation ) )
        ){
            errorDocumentationData = String( errorDetailsData.documentation );

        }

        if ( Array.isArray( errorDetailsData.suggestions ) ){
            errorSuggestionsData = errorDetailsData.suggestions
                .filter(function errorSuggestionFilter( suggestionData ){
                    //Keeping only bounded textual instructions prepared by the trusted validator
                    return typeof suggestionData === String( 'string' ) && Number( suggestionData.length ) > Number( 0 );

                })
                .slice( 0, 5 )
                .map(function errorSuggestionNormalize( suggestionData ){
                    //Bounding one instruction before writing it to a terminal or JSON consumer
                    return String( suggestionData ).slice( 0, 500 );

                });

        }

    }

    //CallBack THE OBJECT
    return Object.freeze({
        code: errorCodeData,
        message: errorMessageData,
        file: errorFileData,
        path: errorPathData,
        line: errorLineData,
        column: errorColumnData,
        suggestions: Object.freeze( errorSuggestionsData ),
        documentation: errorDocumentationData
    });

}

/**
 * Formats one safe diagnostic for a developer terminal.
 *
 * @param {ReturnType<typeof layerCliErrorDiagnosticCreate>} diagnosticData
 * @returns {string}
 */
export function layerCliErrorDiagnosticFormat( diagnosticData ){
    //Creating the stable headline and problem description
    const outputLinesData = [
        `Layer CLI failed: ${String( diagnosticData.code )}.`,
        `Problem: ${String( diagnosticData.message )}`
    ];

    //Adding the source file and coordinates when the producer identified them safely
    if ( diagnosticData.file !== null ){
        let fileLocationData = String( diagnosticData.file );

        if ( diagnosticData.line !== null ){
            fileLocationData += `:${Number( diagnosticData.line )}`;

            if ( diagnosticData.column !== null ){
                fileLocationData += `:${Number( diagnosticData.column )}`;

            }

        }

        outputLinesData.push( `File: ${String( fileLocationData )}` );

    }

    //Adding the declarative field path independently from its source coordinates
    if ( diagnosticData.path !== null ){
        outputLinesData.push( `Field: ${String( diagnosticData.path )}` );

    }

    //Adding every known repair without including the rejected secret or payload
    for ( const [suggestionIndexData, suggestionData] of diagnosticData.suggestions.entries() ){
        let suggestionLabelData = String( 'Alternative' );

        //Naming the first repair as the preferred safe solution
        if ( suggestionIndexData === Number( 0 ) ){
            suggestionLabelData = String( 'Solution' );

        }

        outputLinesData.push( `${String( suggestionLabelData )}: ${String( suggestionData )}` );

    }

    //Adding the complete reference only when one was declared for this diagnostic
    if ( diagnosticData.documentation !== null ){
        outputLinesData.push( `Documentation: ${String( diagnosticData.documentation )}` );

    }

    //CallBack THE STRING
    return outputLinesData.join( String( '\n' ) );

}
