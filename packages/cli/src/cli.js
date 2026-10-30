import {readFileSync} from 'node:fs';
import path from 'node:path';
import {LayerCliError} from './cli-error.js';
import {layerProjectCreate, layerProjectNameNormalize} from './project-create.js';
import {layerNodeVersionSupported} from './runtime-version.js';

const cliPackageData = /** @type {{version: string}} */ (JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
));
const layerCliVersion = String(cliPackageData.version);
const layerCliHelpData = [
    'Layer CLI ' + layerCliVersion,
    'Usage: layer <command> [options]',
    '',
    'Commands:',
    '  create <name>                     Create ./apps/<normalized-name>',
    '  dev                               Build, watch, and serve locally',
    '  build                             Create the production bundle',
    '  database schema plan              Plan application schema changes',
    '  notifications vapid generate      Generate server VAPID secrets explicitly',
    '  database schema apply <checksum> --confirm-data-loss',
    '                                    Apply one approved destructive plan',
    '  doctor                            Check project requirements',
    '  inspect                           Inspect the generated build plan',
    '  docs                              Generate project API documentation',
    '  guide [--lang ru|en] [--open]      Read the offline framework handbook',
    '  help                              Show this command reference',
    '  version                           Show the installed CLI version',
    '',
    'Options:',
    '  -h, --help                        Show help',
    '  -v, --version                     Show version',
    '  --dry-run                         Plan create/build without writing output',
    '  --diagnostics=json                Emit safe machine-readable errors'
].join('\n');

/**
 * @param {{argv: readonly string[], cwd?: string, write?: (outputData: string) => void}} cliOptions
 * @returns {Promise<Readonly<{code: number, command: string, result: unknown}>>}
 */
export async function layerCliRun(cliOptions) {
    //Rejecting an unpatched runtime before executing project commands or loading its configuration
    if ( layerNodeVersionSupported( process.versions.node ) === false ){
        //Providing a safe actionable error instead of running a project on a vulnerable runtime
        throw new LayerCliError( 'CLI_NODE_UNSUPPORTED', `Node.js >=24.22.1 <25 is required; found ${process.versions.node}.`, {
            suggestions: ['Install Node.js 24.22.1 or a newer stable 24.x release, then restart the terminal and Layer processes.']
        });

    }

    //Resolving command ownership and output without reading secrets.
    const rootDirectory = path.resolve(cliOptions.cwd ?? process.cwd());
    const writeOutput = cliOptions.write ?? function cliOutputWrite(outputData) {
        //Writing one complete command record to standard output.
        process.stdout.write(`${outputData}\n`);

    };
    const commandName = cliOptions.argv[0] ?? 'help';
    const commandArguments = cliOptions.argv.slice(1);
    const dryRunStatus = commandArguments.includes('--dry-run');

    if (commandName === 'help' || commandName === '--help' || commandName === '-h') {
        //Showing help before loading a project configuration.
        writeOutput(layerCliHelpData);

        return Object.freeze({code: 0, command: 'help', result: layerCliHelpData});

    }

    if (commandName === 'version' || commandName === '--version' || commandName === '-v') {
        //Showing the installed CLI version without requiring a Layer project.
        writeOutput(layerCliVersion);

        return Object.freeze({code: 0, command: 'version', result: layerCliVersion});

    }

    if ( commandName === 'guide' ){
        //Validating guide options without requiring an application configuration
        let languageData = /** @type {'ru' | 'en'} */ ('en');
        let openStatusData = false;
        for ( let indexData = 0; indexData < commandArguments.length; indexData += 1 ){
            const argumentData = commandArguments[indexData];
            if ( argumentData === '--lang' && ['ru', 'en'].includes( commandArguments[indexData + 1] ?? '' ) ){
                languageData = /** @type {'ru' | 'en'} */ (commandArguments[indexData + 1]);
                indexData += 1;

            } else if ( argumentData === '--open' ){
                openStatusData = true;

            } else {
                throw new LayerCliError( 'CLI_ARGUMENT_UNKNOWN', 'guide accepts --lang ru|en and --open.' );

            }

        }
        const {layerGuideServe} = await import( '@solcorp/layer-docs' );
        const guideData = await layerGuideServe({lang: languageData});
        writeOutput( guideData.url );
        if ( openStatusData ){
            //Opening only the known local URL without shell interpolation
            const {execFile} = await import( 'node:child_process' );
            let executableData = 'xdg-open';
            let argumentsData = [guideData.url];
            if ( process.platform === 'win32' ){
                executableData = 'rundll32.exe';
                argumentsData = ['url.dll,FileProtocolHandler', guideData.url];

            } else if ( process.platform === 'darwin' ){
                executableData = 'open';

            }
            execFile( executableData, argumentsData, {windowsHide: true}, function( errorData ){
                //Keeping the usable local address when a desktop opener is unavailable
                if ( errorData ){
                    writeOutput( 'Open the printed guide URL manually.' );

                }

            });

        }
        return Object.freeze({code: 0, command: 'guide', result: guideData});

    }

    if (commandName === 'create') {
        const unsupportedOption = commandArguments.find(function createOptionFind(argumentData) {
            //Finding any create option outside the single supported dry-run flag.
            return argumentData.startsWith('-') && argumentData !== '--dry-run';

        });

        if (unsupportedOption !== undefined) {
            throw new LayerCliError('CLI_ARGUMENT_UNKNOWN', 'create accepts only an application name and --dry-run.', {
                option: unsupportedOption
            });

        }

        const applicationNameArguments = commandArguments.filter(function createNameArgumentFilter(argumentData) {
            //Keeping quoted or separate name words while removing the supported execution flag.
            return argumentData !== '--dry-run';

        });

        if (applicationNameArguments.length === 0) {
            throw new LayerCliError('CLI_ARGUMENT_REQUIRED', 'create requires an application name.');

        }

        //Normalizing one quoted name or several shell words into the canonical application identity.
        const applicationNameSource = applicationNameArguments.join(' ');
        const projectName = layerProjectNameNormalize(applicationNameSource);
        const applicationsDirectory = path.join(rootDirectory, 'apps');
        const targetDirectory = path.join(applicationsDirectory, projectName);
        const createResult = await layerProjectCreate({
            targetDirectory,
            projectName,
            dryRun: dryRunStatus
        });
        writeOutput(JSON.stringify(createResult, null, 4));

        return Object.freeze({code: 0, command: commandName, result: createResult});

    }

    //Generating keys only on an explicit command; no configuration or running app is required
    if ( commandName === 'notifications' ){
        if ( commandArguments.length !== 2 || commandArguments[0] !== 'vapid' || commandArguments[1] !== 'generate' ){
            throw new LayerCliError( 'CLI_ARGUMENT_REQUIRED', 'notifications requires vapid generate.' );

        }

        const {layerNotificationsVapidGenerate} = await import( '@solcorp/layer-notifications' );
        const vapidResultData = layerNotificationsVapidGenerate();
        writeOutput( JSON.stringify( vapidResultData, null, 4 ) );

        return Object.freeze({code: 0, command: 'notifications vapid generate', result: vapidResultData});

    }

    //Loading server and build dependencies only for commands that require them
    const {layerConfigLoad, layerConfigPublicCreate} = await import( './config.js' );
    const {layerProjectBuild} = await import( './project-build.js' );
    const {layerDevelopmentHostCreate} = await import( './development-host.js' );
    const {layerDatabaseSchemaWorkflowRun} = await import( './database-workflow.js' );
    const {layerDoctorRun} = await import( './doctor.js' );
    const configData = await layerConfigLoad(rootDirectory);

    if ( commandName === 'database' ){
        const databaseSectionData = commandArguments[0];
        const databaseActionData = commandArguments[1];

        if ( databaseSectionData !== 'schema' || (databaseActionData !== 'plan' && databaseActionData !== 'apply') ){
            throw new LayerCliError(
                'CLI_ARGUMENT_REQUIRED',
                'database requires schema plan or schema apply <checksum> --confirm-data-loss.'
            );

        }

        if ( databaseActionData === 'plan' ){
            if ( Number( commandArguments.length ) !== Number( 2 ) ){
                throw new LayerCliError( 'CLI_ARGUMENT_UNKNOWN', 'database schema plan accepts no additional arguments.' );

            }

            const schemaPlanData = await layerDatabaseSchemaWorkflowRun({
                rootDirectory,
                config: configData,
                action: 'plan'
            });
            writeOutput( JSON.stringify( schemaPlanData, null, 4 ) );

            return Object.freeze({code: 0, command: 'database schema plan', result: schemaPlanData});

        }

        const checksumData = commandArguments[2];
        const confirmationStatusData = commandArguments.includes( '--confirm-data-loss' );

        if (
            typeof checksumData !== 'string' ||
            /^[0-9a-f]{64}$/.test( checksumData ) === false ||
            confirmationStatusData === false ||
            Number( commandArguments.length ) !== Number( 4 )
        ){
            throw new LayerCliError(
                'CLI_ARGUMENT_REQUIRED',
                'database schema apply requires a checksum and --confirm-data-loss.'
            );

        }

        const schemaApplyData = await layerDatabaseSchemaWorkflowRun({
            rootDirectory,
            config: configData,
            action: 'apply',
            checksum: checksumData,
            confirmDataLoss: true
        });
        writeOutput( JSON.stringify( schemaApplyData, null, 4 ) );

        return Object.freeze({code: 0, command: 'database schema apply', result: schemaApplyData});

    }

    if (commandName === 'build') {
        const buildResult = await layerProjectBuild({
            rootDirectory,
            config: configData,
            mode: 'production',
            dryRun: dryRunStatus
        });
        writeOutput(JSON.stringify({
            routes: buildResult.routes.length,
            artifacts: buildResult.artifacts.length,
            outputDirectory: buildResult.outputDirectory,
            dryRun: buildResult.dryRun
        }, null, 4));

        return Object.freeze({code: 0, command: commandName, result: buildResult});

    }

    if (commandName === 'doctor') {
        const doctorResult = await layerDoctorRun({
            rootDirectory,
            config: configData
        });
        writeOutput(JSON.stringify(doctorResult, null, 4));

        let commandCode = 1;

        if (doctorResult.ok) {
            commandCode = 0;

        }

        return Object.freeze({code: commandCode, command: commandName, result: doctorResult});

    }

    if (commandName === 'inspect' || commandName === 'docs') {
        const inspectionResult = await layerProjectBuild({
            rootDirectory,
            config: configData,
            mode: 'inspect',
            dryRun: true
        });
        const publicInspectionResult = Object.freeze({
            ...inspectionResult,
            config: layerConfigPublicCreate( inspectionResult.config )
        });
        let outputData;

        if (commandName === 'docs') {
            outputData = publicInspectionResult.documentation;

        } else {
            outputData = JSON.stringify({
                config: publicInspectionResult.config,
                routes: publicInspectionResult.routes,
                integrity: publicInspectionResult.integrity
            }, null, 4);

        }

        writeOutput(outputData);

        return Object.freeze({code: 0, command: commandName, result: publicInspectionResult});

    }

    if (commandName === 'dev') {
        const developmentResult = await layerDevelopmentHostCreate({
            rootDirectory,
            config: configData,
            onBuild(buildResult) {
                //Reporting only bounded build counts and no source content.
                writeOutput(`Layer build ready: ${buildResult.routes.length} route(s).`);

            },
            onError(buildError) {
                let errorCode = 'CLI_DEV_BUILD_FAILED';

                if (buildError instanceof LayerCliError) {
                    errorCode = buildError.code;

                }

                //Reporting a stable code without stack or filesystem cause.
                writeOutput(`Layer build failed: ${errorCode}.`);

            }
        });
        writeOutput(`Layer development host is active at ${developmentResult.origin}.`);

        return Object.freeze({code: 0, command: commandName, result: developmentResult});

    }

    throw new LayerCliError('CLI_COMMAND_UNKNOWN', 'Unknown Layer CLI command.', {
        command: commandName
    });

}
