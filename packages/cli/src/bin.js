#!/usr/bin/env node

import {
    layerCliErrorDiagnosticCreate,
    layerCliErrorDiagnosticFormat
} from './cli-error.js';
import {layerCliRun} from './cli.js';

const processArgumentsData = process.argv.slice( 2 );
const jsonDiagnosticArgumentData = String( '--diagnostics=json' );
const jsonDiagnosticStatusData =
    processArgumentsData.includes( jsonDiagnosticArgumentData ) === true ||
    process.env.LAYER_CLI_DIAGNOSTICS === String( 'json' );
const commandArgumentsData = processArgumentsData.filter(function diagnosticArgumentFilter( argumentData ){
    //Removing the process-owned output option before command validation
    return argumentData !== jsonDiagnosticArgumentData;

});

try {
    //Running the CLI with arguments after the Node executable and script path.
    const cliResult = await layerCliRun({
        argv: commandArgumentsData
    });
    process.exitCode = cliResult.code;

    if ((cliResult.command === 'dev' || cliResult.command === 'guide') && typeof /** @type {any} */ (cliResult.result).close === 'function') {
        const developmentResult = /** @type {{close: () => unknown}} */ (cliResult.result);

        //Closing development watchers during an explicit process shutdown.
        for (const signalName of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
            process.once(signalName, function developmentSignalHandle() {
                //Closing owned watchers and returning a successful shutdown status.
                developmentResult.close();
                process.exitCode = 0;

            });

        }

    }

} catch (cliError) {
    //Creating one safe diagnostic without exposing stack, cause, or arbitrary details
    const diagnosticData = layerCliErrorDiagnosticCreate( cliError );
    let diagnosticOutputData = layerCliErrorDiagnosticFormat( diagnosticData );

    //Selecting the bounded machine-readable contract for IDE and CI integrations
    if ( jsonDiagnosticStatusData === true ){
        diagnosticOutputData = JSON.stringify( diagnosticData );

    }

    process.stderr.write( `${String( diagnosticOutputData )}\n` );
    process.exitCode = 1;

}
