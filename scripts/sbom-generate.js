import {spawnSync} from 'node:child_process';
import {
    mkdir,
    writeFile
} from 'node:fs/promises';
import path from 'node:path';

const writeStatus = process.argv.includes('--write');
const npmCliPath = process.env.npm_execpath;

function sbomGenerate() {
    if (typeof npmCliPath !== 'string' || npmCliPath.length < 1) {
        throw new Error('SBOM generation must run through the pinned npm package script.');

    }

    //Asking the pinned npm CLI to describe the installed production graph.
    const sbomResult = spawnSync(
        process.execPath,
        [npmCliPath, 'sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024
        }
    );

    if (sbomResult.status !== 0) {
        const failureDetail = sbomResult.error?.message ?? sbomResult.stderr?.trim() ?? sbomResult.stdout?.trim() ?? 'unknown failure';

        throw new Error(`npm sbom failed: ${failureDetail}`);

    }

    const sbomData = JSON.parse(sbomResult.stdout);

    if (sbomData.bomFormat !== 'CycloneDX' || !Array.isArray(sbomData.components) || sbomData.components.length < 1) {
        throw new Error('Generated SBOM does not satisfy the CycloneDX contract.');

    }

    return {
        data: sbomData,
        serialized: `${JSON.stringify(sbomData, null, 4)}\n`
    };

}

async function sbomRun() {
    const sbomResult = sbomGenerate();

    if (writeStatus) {
        const artifactDirectory = path.resolve('artifacts');
        const artifactPath = path.join(artifactDirectory, 'layer-engine.cdx.json');

        //Persisting the verified document only for CI or release artifacts.
        await mkdir(artifactDirectory, {recursive: true});
        await writeFile(artifactPath, sbomResult.serialized, 'utf8');
        process.stdout.write(`Wrote ${artifactPath}\n`);

    } else {
        process.stdout.write(`CycloneDX SBOM contains ${sbomResult.data.components.length} components.\n`);

    }

}

await sbomRun();
