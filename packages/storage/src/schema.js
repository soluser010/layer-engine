const storageNamePattern = /^[a-z][a-z0-9_-]{0,63}$/;

/**
 * @param {unknown} keyPathData
 */
function keyPathValidate(keyPathData) {
    if (typeof keyPathData === 'string') {
        return keyPathData.length > 0 && keyPathData.length <= 160;

    }

    if (!Array.isArray(keyPathData) || keyPathData.length < 1 || keyPathData.length > 16) {
        return false;

    }

    return keyPathData.every(function keyPathPartValidate(keyPathPart) {
        //Restricting compound key parts to bounded property paths.
        return typeof keyPathPart === 'string' && keyPathPart.length > 0 && keyPathPart.length <= 160;

    });

}

/**
 * @param {unknown} schemaData
 */
export function layerStorageSchemaDefine(schemaData) {
    if (typeof schemaData !== 'object' || schemaData === null || Array.isArray(schemaData)) {
        throw new TypeError('The storage schema must be an object.');

    }

    const schemaRecord = /** @type {Record<string, unknown>} */ (schemaData);
    const schemaName = schemaRecord.name;
    const schemaVersion = schemaRecord.version;
    const storeData = schemaRecord.stores;
    const migrationData = schemaRecord.migrations;

    //Checking the stable application database identity and sequential version.
    if (typeof schemaName !== 'string' || !storageNamePattern.test(schemaName) ||
        !Number.isInteger(schemaVersion) || Number(schemaVersion) < 1 || Number(schemaVersion) > 1000 ||
        typeof storeData !== 'object' || storeData === null || Array.isArray(storeData) ||
        typeof migrationData !== 'object' || migrationData === null || Array.isArray(migrationData)) {
        throw new TypeError('The storage schema identity, version, stores, or migrations are invalid.');

    }

    const normalizedStores = /** @type {Record<string, Readonly<Record<string, unknown>>>} */ ({});

    for (const [storeName, storeValue] of Object.entries(storeData)) {
        if (!storageNamePattern.test(storeName) || storeName.startsWith('__layer_') ||
            typeof storeValue !== 'object' || storeValue === null || Array.isArray(storeValue)) {
            throw new TypeError(`Storage store ${storeName} is invalid or reserved.`);

        }

        const storeRecord = /** @type {Record<string, unknown>} */ (storeValue);
        const allowedStoreKeys = new Set([
            'keyPath',
            'autoIncrement',
            'indexes'
        ]);

        if (Object.keys(storeRecord).some(function unknownStoreKeyFind(storeKey) {
            //Rejecting metadata outside the stable store contract.
            return !allowedStoreKeys.has(storeKey);

        }) ||
            !keyPathValidate(storeRecord.keyPath) ||
            (storeRecord.autoIncrement !== undefined && typeof storeRecord.autoIncrement !== 'boolean') ||
            typeof storeRecord.indexes !== 'object' || storeRecord.indexes === null || Array.isArray(storeRecord.indexes)) {
            throw new TypeError(`Storage store ${storeName} definition is invalid.`);

        }

        const normalizedIndexes = /** @type {Record<string, Readonly<Record<string, unknown>>>} */ ({});

        for (const [indexName, indexValue] of Object.entries(storeRecord.indexes)) {
            if (!storageNamePattern.test(indexName) ||
                typeof indexValue !== 'object' || indexValue === null || Array.isArray(indexValue)) {
                throw new TypeError(`Storage index ${storeName}.${indexName} is invalid.`);

            }

            const indexRecord = /** @type {Record<string, unknown>} */ (indexValue);
            const allowedIndexKeys = new Set([
                'keyPath',
                'unique',
                'multiEntry'
            ]);

            if (Object.keys(indexRecord).some(function unknownIndexKeyFind(indexKey) {
                //Rejecting metadata outside the stable index contract.
                return !allowedIndexKeys.has(indexKey);

            }) ||
                !keyPathValidate(indexRecord.keyPath) ||
                (indexRecord.unique !== undefined && typeof indexRecord.unique !== 'boolean') ||
                (indexRecord.multiEntry !== undefined && typeof indexRecord.multiEntry !== 'boolean')) {
                throw new TypeError(`Storage index ${storeName}.${indexName} definition is invalid.`);

            }

            normalizedIndexes[indexName] = Object.freeze({
                keyPath: indexRecord.keyPath,
                unique: indexRecord.unique ?? false,
                multiEntry: indexRecord.multiEntry ?? false
            });

        }

        normalizedStores[storeName] = Object.freeze({
            keyPath: storeRecord.keyPath,
            autoIncrement: storeRecord.autoIncrement ?? false,
            indexes: Object.freeze(normalizedIndexes)
        });

    }

    const normalizedMigrations = /** @type {Record<number, Function>} */ ({});

    //Requiring one explicit migration for every version without gaps.
    for (let migrationVersion = 1; migrationVersion <= Number(schemaVersion); migrationVersion += 1) {
        const migrationHandle = /** @type {Record<string, unknown>} */ (migrationData)[String(migrationVersion)];

        if (typeof migrationHandle !== 'function') {
            throw new TypeError(`Storage migration ${migrationVersion} is missing.`);

        }

        normalizedMigrations[migrationVersion] = migrationHandle;

    }

    if (Object.keys(migrationData).length !== Number(schemaVersion)) {
        throw new TypeError('Storage migrations contain an unknown version.');

    }

    return Object.freeze({
        name: schemaName,
        version: Number(schemaVersion),
        stores: Object.freeze(normalizedStores),
        migrations: Object.freeze(normalizedMigrations)
    });

}
