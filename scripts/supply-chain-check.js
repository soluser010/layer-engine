import {
    readFile,
    readdir
} from 'node:fs/promises';
import path from 'node:path';

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * @param {Record<string, string> | undefined} dependencyData
 * @param {string} packageName
 */
function dependencyVersionsAssert(dependencyData, packageName) {
    if (dependencyData === undefined) {
        return;

    }

    //Rejecting ranges, URLs, branches, aliases, and mutable tags.
    for (const [dependencyName, dependencyVersion] of Object.entries(dependencyData)) {
        if (!exactVersionPattern.test(dependencyVersion)) {
            throw new Error(`${packageName} must pin ${dependencyName} to an exact version.`);

        }

    }

}

async function supplyChainCheckRun() {
    const rootPackageData = JSON.parse(await readFile('package.json', 'utf8'));
    const lockData = JSON.parse(await readFile('package-lock.json', 'utf8'));
    const packageEntries = await readdir('packages', {withFileTypes: true});

    if (lockData.lockfileVersion !== 3 || lockData.name !== rootPackageData.name || lockData.version !== rootPackageData.version) {
        throw new Error('package-lock.json does not match the root package identity or lockfile policy.');

    }

    dependencyVersionsAssert(rootPackageData.dependencies, rootPackageData.name);
    dependencyVersionsAssert(rootPackageData.devDependencies, rootPackageData.name);
    dependencyVersionsAssert(rootPackageData.overrides, rootPackageData.name);

    if (rootPackageData.repository?.url !== 'git+https://github.com/soluser010/layer-engine.git' ||
        rootPackageData.homepage !== 'https://www.npmjs.com/package/@solcorp/layer' ||
        rootPackageData.bugs?.url !== 'https://github.com/soluser010/layer-engine/issues') {
        throw new Error('Root release metadata does not identify the public framework source.');

    }

    //Checking publishable package metadata and lifecycle-script policy.
    for (const packageEntry of packageEntries) {
        if (!packageEntry.isDirectory()) {
            continue;

        }

        const packageData = JSON.parse(await readFile(path.join('packages', packageEntry.name, 'package.json'), 'utf8'));

        if (packageData.license !== 'Apache-2.0' || packageData.type !== 'module' || packageData.publishConfig?.access !== 'public') {
            throw new Error(`${packageData.name} does not satisfy public package metadata policy.`);

        }

        if (packageData.repository?.url !== 'git+https://github.com/soluser010/layer-engine.git' ||
            packageData.repository?.directory !== `packages/${packageEntry.name}` ||
            packageData.homepage !== 'https://www.npmjs.com/package/@solcorp/layer' ||
            packageData.bugs?.url !== 'https://github.com/soluser010/layer-engine/issues') {
            throw new Error(`${packageData.name} does not identify the canonical release source.`);

        }

        for (const lifecycleName of ['preinstall', 'install', 'postinstall', 'prepare']) {
            if (packageData.scripts?.[lifecycleName] !== undefined) {
                throw new Error(`${packageData.name} contains forbidden lifecycle script ${lifecycleName}.`);

            }

        }

        dependencyVersionsAssert(packageData.dependencies, packageData.name);
        dependencyVersionsAssert(packageData.devDependencies, packageData.name);

    }

    //Requiring registry integrity for every external locked package.
    for (const [packagePath, lockedPackageData] of Object.entries(lockData.packages)) {
        if (!packagePath.startsWith('node_modules/') || lockedPackageData.link === true) {
            continue;

        }

        if (typeof lockedPackageData.integrity !== 'string' || !lockedPackageData.integrity.startsWith('sha512-') ||
            typeof lockedPackageData.resolved !== 'string' || !lockedPackageData.resolved.startsWith('https://registry.npmjs.org/')) {
            throw new Error(`Locked dependency ${packagePath} lacks approved registry integrity.`);

        }

    }

    process.stdout.write('Supply-chain policy passed for exact dependencies and lockfile integrity.\n');

}

await supplyChainCheckRun();
