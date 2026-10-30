const tableDefinitionSet = new WeakSet();
const schemaDefinitionSet = new WeakSet();
const tableNamePattern = /^[a-z][a-z0-9_]{0,62}$/;
const columnNamePattern = /^[a-z][A-Za-z0-9]{0,62}$/;
const columnTypes = Object.freeze([
    'boolean',
    'integer',
    'json',
    'number',
    'string',
    'timestamp',
    'uuid'
]);
const tableScopes = Object.freeze([
    'global',
    'tenant',
    'user'
]);

/**
 * @param {unknown} valueData
 * @returns {valueData is Record<string, unknown>}
 */
function plainObjectCheck( valueData ){
    //Checking declarative records without accepting arrays or null
    return typeof valueData === 'object' && valueData !== null && Array.isArray( valueData ) === false;

}

/**
 * @param {Record<string, unknown>} objectData
 * @param {readonly string[]} supportedFieldsData
 * @param {string} subjectData
 */
function unknownFieldsAssert( objectData, supportedFieldsData, subjectData ){
    //Checking every declarative field before it becomes SQL metadata
    for ( const fieldNameData of Object.keys( objectData ) ){
        if ( supportedFieldsData.includes( fieldNameData ) === false ){
            //Passing the misspelled schema field to the server boundary
            throw new TypeError( `${String( subjectData )} contains an unknown field.` );

        }

    }

}

/**
 * @param {string} columnNameData
 * @returns {string}
 */
function databaseColumnNameCreate( columnNameData ){
    //Converting a public camelCase field into one stable PostgreSQL identifier
    const databaseColumnNameData = String( columnNameData ).replace(/[A-Z]/g, function uppercaseColumnConvert( characterData ){
        //Converting the current uppercase boundary into snake_case
        return `_${String( characterData ).toLowerCase()}`;

    });

    //CallBack THE STRING
    return databaseColumnNameData;

}

/**
 * @param {string} columnTypeData
 * @param {unknown} defaultValueData
 * @param {boolean} nullableStatusData
 * @param {string} columnNameData
 * @returns {unknown}
 */
function columnDefaultNormalize( columnTypeData, defaultValueData, nullableStatusData, columnNameData ){
    //Allowing a null default only for an explicitly nullable column
    if ( defaultValueData === null ){
        if ( nullableStatusData === false ){
            throw new TypeError( `Column ${String( columnNameData )} cannot use a null default.` );

        }

        //CallBack THE OBJECT
        return null;

    }

    if ( columnTypeData === 'string' ){
        if ( typeof defaultValueData !== 'string' || Number( defaultValueData.length ) > Number( 10000 ) ){
            throw new TypeError( `Column ${String( columnNameData )} has an invalid default.` );

        }

        //CallBack THE STRING
        return defaultValueData;

    }

    if ( columnTypeData === 'uuid' ){
        if (
            typeof defaultValueData !== 'string' ||
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test( defaultValueData ) === false
        ){
            throw new TypeError( `Column ${String( columnNameData )} has an invalid default.` );

        }

        //CallBack THE STRING
        return String( defaultValueData ).toLowerCase();

    }

    if ( columnTypeData === 'integer' ){
        if ( Number.isSafeInteger( defaultValueData ) === false ){
            throw new TypeError( `Column ${String( columnNameData )} has an invalid default.` );

        }

        //CallBack THE NUMBER
        return Number( defaultValueData );

    }

    if ( columnTypeData === 'number' ){
        if ( typeof defaultValueData !== 'number' || Number.isFinite( defaultValueData ) === false ){
            throw new TypeError( `Column ${String( columnNameData )} has an invalid default.` );

        }

        //CallBack THE NUMBER
        return Number( defaultValueData );

    }

    if ( columnTypeData === 'boolean' ){
        if ( typeof defaultValueData !== 'boolean' ){
            throw new TypeError( `Column ${String( columnNameData )} has an invalid default.` );

        }

        //CallBack THE BOOLEAN
        return defaultValueData;

    }

    if ( columnTypeData === 'timestamp' ){
        const timestampData = new Date( /** @type {string | number | Date} */ (defaultValueData) );

        if ( Number.isFinite( timestampData.getTime() ) === false ){
            throw new TypeError( `Column ${String( columnNameData )} has an invalid default.` );

        }

        //CallBack THE STRING
        return timestampData.toISOString();

    }

    if ( columnTypeData === 'json' ){
        let serializedJsonData;

        try {
            serializedJsonData = JSON.stringify( defaultValueData );

        } catch {
            throw new TypeError( `Column ${String( columnNameData )} has an invalid default.` );

        }

        if ( serializedJsonData === undefined || Number( serializedJsonData.length ) > Number( 10000 ) ){
            throw new TypeError( `Column ${String( columnNameData )} has an invalid default.` );

        }

        //CallBack THE OBJECT
        return JSON.parse( serializedJsonData );

    }

    throw new TypeError( `Column ${String( columnNameData )} has an invalid default.` );

}

/**
 * @param {unknown} columnInputData
 * @param {string} columnNameData
 */
function columnDefinitionCreate( columnInputData, columnNameData ){
    //Checking the public field name before deriving a PostgreSQL identifier
    if ( columnNamePattern.test( columnNameData ) === false || columnNameData.startsWith( 'sys' ) === true ){
        //Passing the unsafe or engine-reserved field to the schema boundary
        throw new TypeError( `Column ${String( columnNameData )} has an invalid name.` );

    }

    //Checking the column record before reading its type and constraints
    if ( plainObjectCheck( columnInputData ) === false ){
        //Passing the invalid column declaration to the schema boundary
        throw new TypeError( `Column ${String( columnNameData )} must be an object.` );

    }

    unknownFieldsAssert(
        columnInputData,
        ['default', 'generated', 'nullable', 'type'],
        `Column ${String( columnNameData )}`
    );

    const columnTypeData = columnInputData.type;
    const nullableStatusData = columnInputData.nullable ?? false;
    const generatedData = columnInputData.generated ?? null;
    const defaultPresentStatusData = Object.prototype.hasOwnProperty.call( columnInputData, 'default' );

    //Checking supported data types and explicit nullability
    if (
        typeof columnTypeData !== 'string' ||
        columnTypes.includes( columnTypeData ) === false ||
        typeof nullableStatusData !== 'boolean'
    ){
        //Passing the unsupported column contract to the schema boundary
        throw new TypeError( `Column ${String( columnNameData )} has an invalid type or nullable value.` );

    }

    //Checking generated values stay within the two engine-owned strategies
    if (
        generatedData !== null &&
        generatedData !== 'uuid' &&
        generatedData !== 'identity'
    ){
        //Passing the unsupported generation strategy to the schema boundary
        throw new TypeError( `Column ${String( columnNameData )} has an invalid generated value.` );

    }

    //Checking generated strategies match their database data type
    if (
        (generatedData === 'uuid' && columnTypeData !== 'uuid') ||
        (generatedData === 'identity' && columnTypeData !== 'integer')
    ){
        //Passing the incompatible generation strategy to the schema boundary
        throw new TypeError( `Column ${String( columnNameData )} generation does not match its type.` );

    }

    //Preventing ambiguous generated columns with developer defaults
    if ( generatedData !== null && defaultPresentStatusData === true ){
        //Passing the ambiguous column contract to the schema boundary
        throw new TypeError( `Column ${String( columnNameData )} cannot combine generated and default.` );

    }

    let defaultValueData;

    //Normalizing an optional safe literal default for additive synchronization
    if ( defaultPresentStatusData === true ){
        defaultValueData = columnDefaultNormalize(
            String( columnTypeData ),
            columnInputData.default,
            Boolean( nullableStatusData ),
            columnNameData
        );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        name: String( columnNameData ),
        databaseName: databaseColumnNameCreate( columnNameData ),
        type: /** @type {'boolean' | 'integer' | 'json' | 'number' | 'string' | 'timestamp' | 'uuid'} */ (columnTypeData),
        nullable: Boolean( nullableStatusData ),
        generated: /** @type {'uuid' | 'identity' | null} */ (generatedData),
        defaultPresent: defaultPresentStatusData,
        default: defaultValueData
    });

}

/**
 * @param {object} tableInputData
 * @param {string} tableInputData.name
 * @param {'global' | 'tenant' | 'user'} tableInputData.scope
 * @param {Record<string, Readonly<{type: string, nullable?: boolean, generated?: 'uuid' | 'identity', default?: unknown}>>} tableInputData.columns
 * @param {string} tableInputData.primaryKey
 */
export function layerTableDefine( tableInputData ){
    //Checking the table record before reading declarative SQL metadata
    if ( plainObjectCheck( tableInputData ) === false ){
        //Passing the invalid table declaration to the schema boundary
        throw new TypeError( 'Table definition must be an object.' );

    }

    unknownFieldsAssert( tableInputData, ['columns', 'name', 'primaryKey', 'scope'], 'Table definition' );

    //Checking the table name and scope before processing its columns
    if (
        typeof tableInputData.name !== 'string' ||
        tableNamePattern.test( tableInputData.name ) === false ||
        tableInputData.name.startsWith( 'sys_' ) === true ||
        tableScopes.includes( tableInputData.scope ) === false
    ){
        //Passing unsafe or engine-reserved table metadata to the schema boundary
        throw new TypeError( 'Table name or scope is invalid.' );

    }

    //Checking the column dictionary before deriving allowlists
    if ( plainObjectCheck( tableInputData.columns ) === false ){
        //Passing the invalid column dictionary to the schema boundary
        throw new TypeError( 'Table columns must be an object.' );

    }

    const columnDefinitionsData = [];
    const databaseColumnNamesData = new Set();

    //Normalizing every developer column into immutable public and database names
    for ( const [columnNameData, columnInputData] of Object.entries( tableInputData.columns ) ){
        const columnDefinitionData = columnDefinitionCreate( columnInputData, columnNameData );

        //Checking camelCase conversion does not create duplicate PostgreSQL identifiers
        if ( databaseColumnNamesData.has( columnDefinitionData.databaseName ) === true ){
            //Passing the ambiguous schema to the server boundary
            throw new TypeError( 'Table columns resolve to duplicate database identifiers.' );

        }

        databaseColumnNamesData.add( columnDefinitionData.databaseName );
        columnDefinitionsData.push( columnDefinitionData );

    }

    //Checking the table has at least one developer-owned column
    if ( Number( columnDefinitionsData.length ) === Number( 0 ) ){
        //Passing the empty table definition to the schema boundary
        throw new TypeError( 'Table definition requires columns.' );

    }

    const primaryColumnData = columnDefinitionsData.find(function primaryColumnFind( columnData ){
        //Finding the declared primary key in the normalized column allowlist
        return String( columnData.name ) === String( tableInputData.primaryKey );

    });

    //Checking the primary key is present and cannot contain null
    if ( primaryColumnData === undefined || primaryColumnData.nullable === true ){
        //Passing the invalid primary key contract to the schema boundary
        throw new TypeError( 'Table primaryKey must reference a non-nullable column.' );

    }

    const tableDefinitionData = Object.freeze({
        name: String( tableInputData.name ),
        scope: /** @type {'global' | 'tenant' | 'user'} */ (tableInputData.scope),
        primaryKey: String( tableInputData.primaryKey ),
        columns: Object.freeze( columnDefinitionsData )
    });

    //Recording module ownership so plain payload objects cannot forge table contracts
    tableDefinitionSet.add( tableDefinitionData );

    //CallBack THE OBJECT
    return tableDefinitionData;

}

/**
 * @param {readonly ReturnType<typeof layerTableDefine>[]} tableDefinitionsData
 */
export function layerDatabaseSchemaDefine( tableDefinitionsData ){
    //Checking the application table collection before exposing it to runtime sync
    if ( Array.isArray( tableDefinitionsData ) === false ){
        //Passing the invalid schema collection to the database boundary
        throw new TypeError( 'Database schema definition must be an array.' );

    }

    const tableNamesData = new Set();
    const schemaTablesData = [];

    //Checking every table was created through the trusted declarative factory
    for ( const tableDefinitionData of tableDefinitionsData ){
        if (
            typeof tableDefinitionData !== 'object' ||
            tableDefinitionData === null ||
            tableDefinitionSet.has( tableDefinitionData ) === false
        ){
            //Passing the forged table contract to the database boundary
            throw new TypeError( 'Database schema contains an invalid table definition.' );

        }

        //Checking duplicate physical table ownership before migrations are planned
        if ( tableNamesData.has( tableDefinitionData.name ) === true ){
            //Passing the duplicate table definition to the database boundary
            throw new TypeError( `Database table ${String( tableDefinitionData.name )} is duplicated.` );

        }

        tableNamesData.add( tableDefinitionData.name );
        schemaTablesData.push( tableDefinitionData );

    }

    const schemaDefinitionData = Object.freeze({
        tables: Object.freeze( schemaTablesData )
    });

    //Recording module ownership so application payloads cannot forge schemas
    schemaDefinitionSet.add( schemaDefinitionData );

    //CallBack THE OBJECT
    return schemaDefinitionData;

}

/**
 * @param {unknown} schemaDefinitionData
 * @returns {schemaDefinitionData is ReturnType<typeof layerDatabaseSchemaDefine>}
 */
export function layerDatabaseSchemaDefinitionCheck( schemaDefinitionData ){
    //Checking the schema was created by this module instance
    return (
        typeof schemaDefinitionData === 'object' &&
        schemaDefinitionData !== null &&
        schemaDefinitionSet.has( schemaDefinitionData ) === true
    );

}

export {
    columnTypes as LAYER_DATABASE_COLUMN_TYPES,
    tableScopes as LAYER_DATABASE_TABLE_SCOPES
};
