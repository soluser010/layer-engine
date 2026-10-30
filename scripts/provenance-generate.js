import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
    readFile,
    readdir,
    writeFile
} from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} filePath
 */
async function fileDigestCreate(filePath) {
    //Hashing the exact release artifact bytes referenced by the statement.
    const fileData = await readFile(filePath);

    return createHash('sha256').update(fileData).digest('hex');

}

function commitIdentifierGet() {
    const environmentIdentifier = process.env.GITVERSE_SHA ?? process.env.GITHUB_SHA;

    if (typeof environmentIdentifier === 'string' && /^[0-9a-f]{40}$/i.test(environmentIdentifier)) {
        return environmentIdentifier.toLowerCase();

    }

    //Falling back to the checked-out Git identity for local candidate generation.
    const gitResult = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: process.cwd(),
        encoding: 'utf8'
    });
    const commitIdentifier = gitResult.stdout.trim();

    if (gitResult.status !== 0 || !/^[0-9a-f]{40}$/i.test(commitIdentifier)) {
        throw new Error('A verified Git commit is required for provenance generation.');

    }

    return commitIdentifier.toLowerCase();

}

async function provenanceGenerate() {
    const artifactDirectory = path.resolve('artifacts');
    const packageDirectory = path.join(artifactDirectory, 'packages');
    const packageFiles = await readdir(packageDirectory, {withFileTypes: true});
    const subjects = [];

    //Recording every generated package archive in lexical order.
    for (const packageFile of packageFiles.sort(function packageFileCompare(firstFile, secondFile) {
        //Keeping statement order stable across runner filesystems.
        return firstFile.name.localeCompare(secondFile.name);

    })) {
        if (!packageFile.isFile() || !packageFile.name.endsWith('.tgz')) {
            continue;

        }

        const packagePath = path.join(packageDirectory, packageFile.name);

        subjects.push({
            name: `packages/${packageFile.name}`,
            digest: {
                sha256: await fileDigestCreate(packagePath)
            }
        });

    }

    if (subjects.length < 1) {
        throw new Error('No package archives are available for provenance.');

    }

    const commitIdentifier = commitIdentifierGet();
    const lockDigest = await fileDigestCreate('package-lock.json');
    const apiDigest = await fileDigestCreate('compatibility/public-api.json');
    const sbomDigest = await fileDigestCreate(path.join(artifactDirectory, 'layer-engine.cdx.json'));
    const provenanceData = {
        _type: 'https://in-toto.io/Statement/v1',
        subject: subjects,
        predicateType: 'https://slsa.dev/provenance/v1',
        predicate: {
            buildDefinition: {
                buildType: 'https://gitverse.ru/solcorp/Layer-Engine/.gitverse/workflows/release-candidate.yml',
                externalParameters: {
                    repository: 'https://gitverse.ru/solcorp/Layer-Engine.git',
                    commit: commitIdentifier,
                    node: process.version,
                    packageManager: 'npm@11.16.0'
                },
                resolvedDependencies: [
                    {uri: 'package-lock.json', digest: {sha256: lockDigest}},
                    {uri: 'compatibility/public-api.json', digest: {sha256: apiDigest}},
                    {uri: 'artifacts/layer-engine.cdx.json', digest: {sha256: sbomDigest}}
                ]
            },
            runDetails: {
                builder: {
                    id: 'https://gitverse.ru/solcorp/Layer-Engine/actions'
                },
                metadata: {
                    invocationId: process.env.GITVERSE_RUN_ID ?? `local-${commitIdentifier}`
                }
            }
        }
    };
    const provenancePath = path.join(artifactDirectory, 'layer-engine.intoto.jsonl');

    //Writing one JSONL statement suitable for signing at the stable release gate.
    await writeFile(provenancePath, `${JSON.stringify(provenanceData)}\n`, 'utf8');
    process.stdout.write(`Wrote ${provenancePath} for ${subjects.length} package archives.\n`);

}

await provenanceGenerate();
