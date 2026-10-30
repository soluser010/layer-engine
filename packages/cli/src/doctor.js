import {access, stat} from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {layerConfigValidate} from './config.js';
import {layerInfrastructureVersionsProbe} from './application-server-runtime.js';
import {layerNodeVersionSupported} from './runtime-version.js';

/**
 * @param {string} versionData
 * @returns {{major: number, minor: number, patch: number}}
 */
function infrastructureVersionParse( versionData ){
    //Reading the numeric prefix without trusting vendor suffixes
    const versionMatchData = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec( versionData );

    if ( versionMatchData === null ){
        return {
            major: Number( -1 ),
            minor: Number( -1 ),
            patch: Number( -1 )
        };

    }

    //CallBack THE OBJECT
    return {
        major: Number( versionMatchData[1] ),
        minor: Number( versionMatchData[2] ?? 0 ),
        patch: Number( versionMatchData[3] ?? 0 )
    };

}

/**
 * @param {'postgresql' | 'redis'} infrastructureNameData
 * @param {string} versionData
 */
function infrastructureVersionCheckCreate( infrastructureNameData, versionData ){
    const parsedVersionData = infrastructureVersionParse( versionData );
    const supportedStatusData = infrastructureNameData === 'postgresql'
        ? Number( parsedVersionData.major ) >= Number( 16 ) && Number( parsedVersionData.major ) <= Number( 18 )
        : (
            Number( parsedVersionData.major ) >= Number( 8 ) ||
            (Number( parsedVersionData.major ) === Number( 7 ) && Number( parsedVersionData.minor ) >= Number( 2 ))
        );
    const compatibleStatusData = infrastructureNameData === 'postgresql'
        ? Number( parsedVersionData.major ) >= Number( 14 )
        : Number( parsedVersionData.major ) >= Number( 5 );

    if ( supportedStatusData === true ){
        return Object.freeze({
            name: `${String( infrastructureNameData )}-version`,
            ok: true,
            code: 'INFRASTRUCTURE_VERSION_SUPPORTED',
            version: versionData,
            message: `${String( infrastructureNameData )} ${String( versionData )} is production-supported.`
        });

    }

    if ( compatibleStatusData === true ){
        return Object.freeze({
            name: `${String( infrastructureNameData )}-version`,
            ok: true,
            code: 'INFRASTRUCTURE_VERSION_LEGACY',
            version: versionData,
            message: `${String( infrastructureNameData )} ${String( versionData )} is compatible for local testing but is not production-certified.`
        });

    }

    //CallBack THE OBJECT
    return Object.freeze({
        name: `${String( infrastructureNameData )}-version`,
        ok: false,
        code: 'INFRASTRUCTURE_VERSION_UNSUPPORTED',
        version: versionData,
        message: `${String( infrastructureNameData )} ${String( versionData )} is unsupported.`
    });

}

/**
 * @param {{
 *     rootDirectory: string,
 *     config: unknown,
 *     nodeVersion?: string,
 *     environment?: Record<string, string | undefined>,
 *     infrastructureProbe?: typeof layerInfrastructureVersionsProbe
 * }} doctorOptions
 */
export async function layerDoctorRun(doctorOptions) {
    const rootDirectory = path.resolve(doctorOptions.rootDirectory);
    const configData = layerConfigValidate(doctorOptions.config);
    const nodeVersion = doctorOptions.nodeVersion ?? process.versions.node;
    const nodeSupported = layerNodeVersionSupported( nodeVersion );
    const doctorChecks = /** @type {Readonly<{name: string, ok: boolean, message: string, code?: string, version?: string}>[]} */ ([]);
    let nodeMessage = `Node.js >=24.22.1 <25 is required; found ${nodeVersion}. Install a patched Node.js 24 LTS release and restart Layer.`;

    if (nodeSupported) {
        //Confirming the required runtime without masking another major version.
        nodeMessage = `Supported Node.js ${nodeVersion} is active.`;

    }

    doctorChecks.push(Object.freeze({
        name: 'node-24',
        ok: nodeSupported,
        message: nodeMessage
    }));

    //Probing configured external infrastructure only after local project checks
    if ( Number( configData.database.postgres.length ) > Number( 0 ) || configData.redis !== null ){
        const infrastructureProbeData = doctorOptions.infrastructureProbe ?? layerInfrastructureVersionsProbe;

        try {
            const infrastructureProbeOptionsData = /** @type {Parameters<typeof layerInfrastructureVersionsProbe>[0]} */ ({
                rootDirectory,
                configuration: configData
            });

            if ( doctorOptions.environment !== undefined ){
                infrastructureProbeOptionsData.environment = doctorOptions.environment;

            }

            const infrastructureVersionsData = await infrastructureProbeData( infrastructureProbeOptionsData );

            if ( infrastructureVersionsData.postgres !== null ){
                doctorChecks.push( infrastructureVersionCheckCreate( 'postgresql', infrastructureVersionsData.postgres ) );

            }

            if ( infrastructureVersionsData.redis !== null ){
                doctorChecks.push( infrastructureVersionCheckCreate( 'redis', infrastructureVersionsData.redis ) );

            }

        } catch {
            doctorChecks.push( Object.freeze({
                name: 'infrastructure-connectivity',
                ok: false,
                code: 'INFRASTRUCTURE_UNAVAILABLE',
                message: 'Configured PostgreSQL or Redis infrastructure is unavailable.'
            }) );

        }

    }

    const directoryChecks = [
        {name: 'source-directory', directory: configData.sourceDirectory, required: true},
        {name: 'pages-directory', directory: `${configData.sourceDirectory}/pages`, required: true},
        {name: 'public-directory', directory: configData.publicDirectory, required: false}
    ];

    for (const directoryCheck of directoryChecks) {
        const directoryPath = path.resolve(rootDirectory, directoryCheck.directory);
        const directoryStatus = await stat(directoryPath).catch(function doctorDirectoryMissing(directoryError) {
            if (/** @type {NodeJS.ErrnoException} */ (directoryError).code === 'ENOENT') {
                return null;

            }

            throw directoryError;

        });
        const checkStatus = directoryStatus?.isDirectory() === true;
        let checkOkStatus = true;
        let checkMessage = `${directoryCheck.directory} is missing (optional).`;

        if (directoryCheck.required) {
            //Requiring source directories while preserving optional public assets.
            checkOkStatus = checkStatus;
            checkMessage = `${directoryCheck.directory} is missing.`;

        }

        if (checkStatus) {
            //Reporting an available directory consistently for both requirement levels.
            checkMessage = `${directoryCheck.directory} is available.`;

        }

        doctorChecks.push(Object.freeze({
            name: directoryCheck.name,
            ok: checkOkStatus,
            message: checkMessage
        }));

    }

    const rootWritableStatus = await access(rootDirectory, constants.W_OK).then(function writableRootConfirm() {
        //Confirming that generated artifacts can be written to the project.
        return true;

    }).catch(function unwritableRootHandle() {
        //Turning a failed access probe into a diagnostic result.
        return false;

    });
    let rootWritableMessage = 'Project directory is not writable.';

    if (rootWritableStatus) {
        //Reporting successful write access separately from the failed state.
        rootWritableMessage = 'Project directory is writable.';

    }

    doctorChecks.push(Object.freeze({
        name: 'project-writable',
        ok: rootWritableStatus,
        message: rootWritableMessage
    }));

    return Object.freeze({
        ok: doctorChecks.every(function doctorCheckStatus(checkData) {
            //Requiring every individual diagnostic before reporting readiness.
            return checkData.ok;

        }),
        checks: Object.freeze(doctorChecks)
    });

}
