import {spawnSync} from 'node:child_process';
import {
    readFile,
    readdir
} from 'node:fs/promises';
import path from 'node:path';

const versionArgument = process.argv.find(function versionArgumentFind(argumentData) {
    //Selecting the single explicit stable version passed by release automation.
    return argumentData.startsWith('--version=');

});
const releaseVersion = versionArgument?.slice('--version='.length) ?? '';
const allowUntaggedStatus = process.argv.includes('--allow-untagged');

if (!/^[1-9]\d*\.\d+\.\d+$/.test(releaseVersion)) {
    throw new Error('Stable release verification requires --version=major.minor.patch with major >= 1.');

}

const rootPackageData = JSON.parse(await readFile('package.json', 'utf8'));

if (rootPackageData.version !== releaseVersion) {
    throw new Error('The root package version does not match the requested stable release.');

}

const packageEntries = await readdir('packages', {withFileTypes: true});
const publicApiData = JSON.parse(await readFile('compatibility/public-api.json', 'utf8'));

//Requiring one coordinated framework version across all publishable packages.
for (const packageEntry of packageEntries) {
    if (!packageEntry.isDirectory()) {
        continue;

    }

    const packageData = JSON.parse(await readFile(path.join('packages', packageEntry.name, 'package.json'), 'utf8'));

    if (packageData.version !== releaseVersion || publicApiData.packages?.[packageData.name]?.version !== releaseVersion) {
        throw new Error(`${packageData.name} version or API baseline is not synchronized.`);

    }

    for (const [dependencyName, dependencyVersion] of Object.entries(packageData.dependencies ?? {})) {
        if (dependencyName.startsWith('@solcorp/layer-') && dependencyVersion !== releaseVersion) {
            throw new Error(`${packageData.name} does not pin ${dependencyName} to the release version.`);

        }

    }

}

const changelogData = await readFile('CHANGELOG.md', 'utf8');
const escapedVersion = releaseVersion.replaceAll('.', '\\.');

if (!new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelogData)) {
    throw new Error('CHANGELOG.md does not contain the dated stable release entry.');

}

const gitStatus = spawnSync('git', ['status', '--porcelain'], {
    encoding: 'utf8'
});

if (gitStatus.status !== 0 || gitStatus.stdout.trim().length > 0) {
    throw new Error('Stable release verification requires a clean Git worktree.');

}

if (!allowUntaggedStatus) {
    const gitTag = spawnSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], {
        encoding: 'utf8'
    });

    if (gitTag.status !== 0 || gitTag.stdout.trim() !== `v${releaseVersion}`) {
        throw new Error(`Stable release verification requires exact tag v${releaseVersion}.`);

    }

}

process.stdout.write(`Stable release ${releaseVersion} metadata and Git identity are verified.\n`);
