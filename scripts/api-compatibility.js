import {createHash} from 'node:crypto';
import {
    mkdir,
    readFile,
    readdir,
    writeFile
} from 'node:fs/promises';
import path from 'node:path';

const baselinePath = path.resolve('compatibility/public-api.json');
const updateStatus = process.argv.includes('--update');

/**
 * @param {string} directoryPath
 * @returns {Promise<string[]>}
 */
async function declarationFilesRead(directoryPath) {
    const declarationFiles = [];
    const directoryEntries = await readdir(directoryPath, {withFileTypes: true});

    //Walking generated declarations in stable lexical order.
    for (const directoryEntry of directoryEntries.sort(function directoryEntryCompare(firstEntry, secondEntry) {
        //Keeping snapshot order independent of filesystem enumeration.
        return firstEntry.name.localeCompare(secondEntry.name);

    })) {
        const entryPath = path.join(directoryPath, directoryEntry.name);

        if (directoryEntry.isDirectory()) {
            declarationFiles.push(...await declarationFilesRead(entryPath));

        } else if (directoryEntry.isFile() && directoryEntry.name.endsWith('.d.ts')) {
            declarationFiles.push(entryPath);

        }

    }

    return declarationFiles;

}

async function apiSnapshotCreate() {
    const packageEntries = await readdir(path.resolve('packages'), {withFileTypes: true});
    const packageSnapshots = /** @type {Record<string, {version: string, declarations: Record<string, string>}>} */ ({});

    //Capturing every public package declaration surface after build.
    for (const packageEntry of packageEntries.sort(function packageEntryCompare(firstEntry, secondEntry) {
        //Keeping package order deterministic for reviewable baseline changes.
        return firstEntry.name.localeCompare(secondEntry.name);

    })) {
        if (!packageEntry.isDirectory()) {
            continue;

        }

        const packageDirectory = path.resolve('packages', packageEntry.name);
        const packageData = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
        const declarationDirectory = path.join(packageDirectory, 'dist');
        const declarationFiles = await declarationFilesRead(declarationDirectory);
        const declarationHashes = /** @type {Record<string, string>} */ ({});

        for (const declarationFile of declarationFiles) {
            const declarationData = await readFile(declarationFile);
            const relativePath = path.relative(declarationDirectory, declarationFile).replaceAll('\\', '/');

            declarationHashes[relativePath] = createHash('sha256').update(declarationData).digest('hex');

        }

        packageSnapshots[packageData.name] = {
            version: packageData.version,
            declarations: declarationHashes
        };

    }

    return {
        schemaVersion: 1,
        packages: packageSnapshots
    };

}

async function apiCompatibilityRun() {
    const snapshotData = await apiSnapshotCreate();
    const serializedSnapshot = `${JSON.stringify(snapshotData, null, 4)}\n`;

    if (updateStatus) {
        //Writing a new baseline only during an explicit compatibility review.
        await mkdir(path.dirname(baselinePath), {recursive: true});
        await writeFile(baselinePath, serializedSnapshot, 'utf8');
        process.stdout.write(`Updated ${baselinePath}\n`);

        return;

    }

    const baselineData = await readFile(baselinePath, 'utf8');

    if (baselineData !== serializedSnapshot) {
        throw new Error('Public API declarations changed. Review SemVer impact and run npm run api:snapshot explicitly.');

    }

    process.stdout.write(`Public API baseline matches ${Object.keys(snapshotData.packages).length} packages.\n`);

}

await apiCompatibilityRun();
