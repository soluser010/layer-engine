import {randomUUID} from 'node:crypto';
import {LayerDatabaseError} from './database-error.js';
import {layerDatabaseSchemaDefinitionCheck} from './schema-definition.js';
import {
    layerSqlIdentifierQuote,
    layerSystemSchemaRead
} from './system-schema.js';

const whereDescriptorSet = new WeakSet();
const maximumFilterDepth = Number( 8 );
const maximumFilterNodes = Number( 50 );
const maximumListValues = Number( 100 );
const maximumPageSize = Number( 100 );

/**
 * @typedef {object} LayerStructuredQuery
 * @property {string} text
 * @property {readonly unknown[]} values
 * @property {'strong' | 'eventual'} [consistency]
 * @typedef {object} LayerStructuredQueryResult
 * @property {Record<string, unknown>[]} rows
 * @property {number | null} rowCount
 * @typedef {object} LayerStructuredDatabase
 * @property {'embedded' | 'postgres'} [kind]
 * @property {string} [systemSchema]
 * @property {(queryData: LayerStructuredQuery) => Promise<LayerStructuredQueryResult>} query
 * @property {<ResultData>(handlerData: (transactionDatabaseData: LayerStructuredDatabase) => Promise<ResultData>) => Promise<ResultData>} [transaction]
 * @typedef {object} LayerStructuredSecurity
 * @property {string | null} [tenantId]
 * @property {string | null} [userId]
 */

/**
 * @param {unknown} valueData
 * @returns {valueData is Record<string, unknown>}
 */
function plainObjectCheck( valueData ){
    //Checking operation records without accepting arrays or null
    return typeof valueData === 'object' && valueData !== null && Array.isArray( valueData ) === false;

};

/**
 * @param {string} codeData
 * @param {string} messageData
 * @returns {never}
 */
function databaseContractErrorThrow( codeData, messageData ){
    //Passing a stable database contract failure without query text or values
    throw new LayerDatabaseError( codeData, messageData );

}

/**
 * @param {Record<string, unknown>} objectData
 * @param {readonly string[]} supportedFieldsData
 * @param {string} subjectData
 */
function unknownFieldsAssert( objectData, supportedFieldsData, subjectData ){
    //Checking public options before any dynamic SQL is prepared
    for ( const fieldNameData of Object.keys( objectData ) ){
        if ( supportedFieldsData.includes( fieldNameData ) === false ){
            databaseContractErrorThrow(
                'DATABASE_QUERY_INVALID',
                `${String( subjectData )} contains an unknown field.`
            );

        }

    };

}

/**
 * @param {unknown} identifierData
 * @param {string} subjectData
 * @returns {string}
 */
function boundedIdentifierRead( identifierData, subjectData ){
    //Checking a server-derived ownership identity before binding it to SQL
    if (
        typeof identifierData !== 'string' ||
        Number( identifierData.length ) < Number( 1 ) ||
        Number( identifierData.length ) > Number( 200 )
    ){
        databaseContractErrorThrow(
            'DATABASE_SCOPE_REQUIRED',
            `${String( subjectData )} is required for this table.`
        );

    };

    //CallBack THE STRING
    return String( identifierData );

}

/**
 * @param {Readonly<Record<string, unknown>>} columnData
 * @param {unknown} valueData
 * @returns {unknown}
 */
function columnValueNormalize( columnData, valueData ){
    //Allowing null only when the declarative column explicitly permits it
    if ( valueData === null ){
        if ( columnData.nullable !== true ){
            databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', `Column ${String( columnData.name )} cannot be null.` );

        }

        //CallBack THE OBJECT
        return null;

    };

    //Checking string-like fields before binding their original value
    if ( columnData.type === 'string' ){
        if ( typeof valueData !== 'string' || Number( valueData.length ) > Number( 1024 * 1024 ) ){
            databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', `Column ${String( columnData.name )} requires a bounded string.` );

        }

        //CallBack THE STRING
        return valueData;

    }

    //Checking UUID identifiers without accepting arbitrary string interpolation
    if ( columnData.type === 'uuid' ){
        if (
            typeof valueData !== 'string' ||
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test( valueData ) === false
        ){
            databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', `Column ${String( columnData.name )} requires a UUID.` );

        }

        //CallBack THE STRING
        return String( valueData ).toLowerCase();

    }

    //Checking integer values without numeric coercion
    if ( columnData.type === 'integer' ){
        if ( Number.isSafeInteger( valueData ) === false ){
            databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', `Column ${String( columnData.name )} requires a safe integer.` );

        }

        //CallBack THE NUMBER
        return Number( valueData );

    }

    //Checking finite numeric values before binding them
    if ( columnData.type === 'number' ){
        if ( typeof valueData !== 'number' || Number.isFinite( valueData ) === false ){
            databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', `Column ${String( columnData.name )} requires a finite number.` );

        }

        //CallBack THE NUMBER
        return Number( valueData );

    }

    //Checking boolean fields without truthy coercion
    if ( columnData.type === 'boolean' ){
        if ( typeof valueData !== 'boolean' ){
            databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', `Column ${String( columnData.name )} requires a boolean.` );

        }

        //CallBack THE BOOLEAN
        return valueData;

    }

    //Normalizing timestamp values into an unambiguous UTC representation
    if ( columnData.type === 'timestamp' ){
        const timestampData = new Date( /** @type {string | number | Date} */ (valueData) );

        if ( Number.isFinite( timestampData.getTime() ) === false ){
            databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', `Column ${String( columnData.name )} requires a timestamp.` );

        }

        //CallBack THE STRING
        return timestampData.toISOString();

    }

    //Serializing JSON once so cyclic or unsupported values fail before the driver
    if ( columnData.type === 'json' ){
        let serializedJsonData;

        try {
            serializedJsonData = JSON.stringify( valueData );

        } catch {
            databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', `Column ${String( columnData.name )} requires serializable JSON.` );

        }

        if ( serializedJsonData === undefined || Number( serializedJsonData.length ) > Number( 1024 * 1024 ) ){
            databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', `Column ${String( columnData.name )} requires bounded JSON.` );

        }

        //CallBack THE STRING
        return serializedJsonData;

    }

    return databaseContractErrorThrow( 'DATABASE_SCHEMA_INVALID', 'The table contains an unsupported column type.' );

}

/**
 * @param {unknown} operatorData
 * @param {string | null} columnNameData
 * @param {unknown} valueData
 * @param {readonly unknown[]} childrenData
 */
function whereDescriptorCreate( operatorData, columnNameData, valueData, childrenData = [] ){
    const descriptorData = Object.freeze({
        operator: String( operatorData ),
        column: columnNameData,
        value: valueData,
        children: Object.freeze( [...childrenData] )
    });

    //Recording descriptor ownership so payload objects cannot become SQL filters
    whereDescriptorSet.add( descriptorData );

    //CallBack THE OBJECT
    return descriptorData;

}

//Function for creating the public filter factory
const whereFactoryCreate = function(){
    //CallBack THE OBJECT
    return Object.freeze({
        /** @param {string} columnNameData @param {unknown} valueData */
        equal( columnNameData, valueData ){
            //Creating an equality descriptor without reading table metadata yet
            return whereDescriptorCreate( 'equal', String( columnNameData ), valueData );

        },

        /** @param {string} columnNameData @param {unknown} valueData */
        notEqual( columnNameData, valueData ){
            //Creating an inequality descriptor without reading table metadata yet
            return whereDescriptorCreate( 'not-equal', String( columnNameData ), valueData );

        },

        /** @param {string} columnNameData @param {unknown} valueData */
        greaterThan( columnNameData, valueData ){
            //Creating a greater-than descriptor for a later allowlist check
            return whereDescriptorCreate( 'greater-than', String( columnNameData ), valueData );

        },

        /** @param {string} columnNameData @param {unknown} valueData */
        lessThan( columnNameData, valueData ){
            //Creating a less-than descriptor for a later allowlist check
            return whereDescriptorCreate( 'less-than', String( columnNameData ), valueData );

        },

        /** @param {string} columnNameData @param {readonly unknown[]} valuesData */
        in( columnNameData, valuesData ){
            //Creating a bounded membership descriptor for a later allowlist check
            return whereDescriptorCreate( 'in', String( columnNameData ), valuesData );

        },

        /** @param {string} columnNameData */
        isNull( columnNameData ){
            //Creating an explicit null check instead of overloading missing values
            return whereDescriptorCreate( 'is-null', String( columnNameData ), null );

        },

        /** @param {...unknown} descriptorsData */
        and( ...descriptorsData ){
            //Creating a conjunction from trusted child descriptors
            return whereDescriptorCreate( 'and', null, null, descriptorsData );

        },

        /** @param {...unknown} descriptorsData */
        or( ...descriptorsData ){
            //Creating a disjunction from trusted child descriptors
            return whereDescriptorCreate( 'or', null, null, descriptorsData );

        }
    });

};

/**
 * @param {Readonly<Record<string, unknown>>} tableData
 * @returns {Map<string, Readonly<Record<string, unknown>>>}
 */
function tableColumnMapCreate( tableData ){
    const columnMapData = new Map();

    //Indexing immutable declarative columns for every query allowlist check
    for ( const columnData of /** @type {readonly Readonly<Record<string, unknown>>[]} */ (tableData.columns) ){
        columnMapData.set( String( columnData.name ), columnData );

    }

    //CallBack THE OBJECT
    return columnMapData;

}

/**
 * @param {Map<string, Readonly<Record<string, unknown>>>} columnMapData
 * @param {unknown} columnNameData
 */
function tableColumnGet( columnMapData, columnNameData ){
    //Checking the public field against the declared table allowlist
    if ( typeof columnNameData !== 'string' || columnMapData.has( columnNameData ) === false ){
        databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'The query references an unknown column.' );

    }

    const columnData = columnMapData.get( columnNameData );

    if ( columnData === undefined ){
        return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'The query references an unknown column.' );

    }

    //CallBack THE OBJECT
    return columnData;

}

/**
 * @param {unknown} descriptorData
 * @param {Map<string, Readonly<Record<string, unknown>>>} columnMapData
 * @param {unknown[]} parametersData
 * @param {{nodes: number}} filterStateData
 * @param {number} depthData
 * @returns {string}
 */
function whereSqlCreate( descriptorData, columnMapData, parametersData, filterStateData, depthData = Number( 0 ) ){
    //Checking filter ownership, size, and depth before recursive compilation
    if (
        typeof descriptorData !== 'object' ||
        descriptorData === null ||
        whereDescriptorSet.has( descriptorData ) === false ||
        Number( depthData ) > Number( maximumFilterDepth )
    ){
        return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'The query filter is invalid.' );

    }

    filterStateData.nodes += Number( 1 );

    if ( Number( filterStateData.nodes ) > Number( maximumFilterNodes ) ){
        return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'The query filter is too complex.' );

    }

    const descriptorRecordData = /** @type {Readonly<{operator: string, column: string | null, value: unknown, children: readonly unknown[]}>} */ (descriptorData);

    //Compiling boolean groups only after checking every child descriptor
    if ( descriptorRecordData.operator === 'and' || descriptorRecordData.operator === 'or' ){
        if ( Number( descriptorRecordData.children.length ) < Number( 2 ) || Number( descriptorRecordData.children.length ) > Number( 20 ) ){
            return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Filter groups require between 2 and 20 conditions.' );

        }

        const childSqlData = [];

        for ( const childDescriptorData of descriptorRecordData.children ){
            childSqlData.push( whereSqlCreate(
                childDescriptorData,
                columnMapData,
                parametersData,
                filterStateData,
                Number( depthData ) + Number( 1 )
            ) );

        }

        let booleanOperatorData = String( ' OR ' );

        //Selecting conjunction only for the explicit and descriptor
        if ( descriptorRecordData.operator === 'and' ){
            booleanOperatorData = String( ' AND ' );

        }

        //CallBack THE STRING
        return `(${childSqlData.join( booleanOperatorData )})`;

    }

    const columnData = tableColumnGet( columnMapData, descriptorRecordData.column );
    const columnReferenceData = layerSqlIdentifierQuote( String( columnData.databaseName ) );

    //Compiling explicit null checks without allocating unused parameters
    if ( descriptorRecordData.operator === 'is-null' ){
        //CallBack THE STRING
        return `${String( columnReferenceData )} IS NULL`;

    }

    //Compiling bounded membership values as independent parameters
    if ( descriptorRecordData.operator === 'in' ){
        if (
            Array.isArray( descriptorRecordData.value ) === false ||
            Number( descriptorRecordData.value.length ) < Number( 1 ) ||
            Number( descriptorRecordData.value.length ) > Number( maximumListValues )
        ){
            return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'The membership filter is invalid.' );

        }

        const membershipParametersData = [];

        for ( const membershipValueData of descriptorRecordData.value ){
            const normalizedValueData = columnValueNormalize( columnData, membershipValueData );
            parametersData.push( normalizedValueData );
            membershipParametersData.push( `$${Number( parametersData.length )}` );

        }

        //CallBack THE STRING
        return `${String( columnReferenceData )} IN (${membershipParametersData.join( ', ' )})`;

    }

    //Checking scalar operators before allocating their parameter
    const operatorSqlMapData = new Map([
        ['equal', '='],
        ['not-equal', '<>'],
        ['greater-than', '>'],
        ['less-than', '<']
    ]);
    const operatorSqlData = operatorSqlMapData.get( descriptorRecordData.operator );

    if ( operatorSqlData === undefined ){
        return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'The filter operator is invalid.' );

    }

    const normalizedValueData = columnValueNormalize( columnData, descriptorRecordData.value );

    //Converting explicit null equality into SQL null semantics
    if ( normalizedValueData === null ){
        if ( descriptorRecordData.operator === 'equal' ){
            //CallBack THE STRING
            return `${String( columnReferenceData )} IS NULL`;

        }

        if ( descriptorRecordData.operator === 'not-equal' ){
            //CallBack THE STRING
            return `${String( columnReferenceData )} IS NOT NULL`;

        }

        return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Null supports only equality filters.' );

    }

    parametersData.push( normalizedValueData );

    //CallBack THE STRING
    return `${String( columnReferenceData )} ${String( operatorSqlData )} $${Number( parametersData.length )}`;

}

/**
 * @param {Readonly<Record<string, unknown>>} tableData
 * @param {LayerStructuredSecurity} securityData
 * @param {unknown[]} parametersData
 * @returns {string | null}
 */
function scopeSqlCreate( tableData, securityData, parametersData ){
    //Binding tenant ownership only from the server-resolved security context
    if ( tableData.scope === 'tenant' ){
        const tenantIdentifierData = boundedIdentifierRead( securityData.tenantId, 'Tenant identity' );
        parametersData.push( tenantIdentifierData );

        //CallBack THE STRING
        return `${layerSqlIdentifierQuote( 'sys_tenant_id' )} = $${Number( parametersData.length )}`;

    }

    //Binding user ownership only from the server-resolved security context
    if ( tableData.scope === 'user' ){
        const userIdentifierData = boundedIdentifierRead( securityData.userId, 'User identity' );
        parametersData.push( userIdentifierData );

        //CallBack THE STRING
        return `${layerSqlIdentifierQuote( 'sys_user_id' )} = $${Number( parametersData.length )}`;

    }

    //CallBack THE OBJECT
    return null;

}

/**
 * @param {unknown} selectInputData
 * @param {readonly Readonly<Record<string, unknown>>[]} columnsData
 * @param {Map<string, Readonly<Record<string, unknown>>>} columnMapData
 */
function selectedColumnsCreate( selectInputData, columnsData, columnMapData ){
    //Using every declared application column when no projection is provided
    if ( selectInputData === undefined ){
        //CallBack THE OBJECT
        return [...columnsData];

    }

    if (
        Array.isArray( selectInputData ) === false ||
        Number( selectInputData.length ) < Number( 1 ) ||
        Number( selectInputData.length ) > Number( 50 )
    ){
        return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'select must contain between 1 and 50 columns.' );

    }

    const selectedColumnsData = [];
    const selectedNamesData = new Set();

    //Resolving every projection field through the table allowlist
    for ( const columnNameData of selectInputData ){
        const columnData = tableColumnGet( columnMapData, columnNameData );

        if ( selectedNamesData.has( columnData.name ) === true ){
            return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'select contains duplicate columns.' );

        }

        selectedNamesData.add( columnData.name );
        selectedColumnsData.push( columnData );

    }

    //CallBack THE OBJECT
    return selectedColumnsData;

}

/**
 * @param {readonly Readonly<Record<string, unknown>>[]} columnsData
 * @param {string} [tableAliasData]
 */
function returningSqlCreate( columnsData, tableAliasData = String() ){
    let referencePrefixData = String();

    //Adding a trusted query alias only for mutation RETURNING clauses
    if ( Number( tableAliasData.length ) > Number( 0 ) ){
        referencePrefixData = `${layerSqlIdentifierQuote( tableAliasData )}.`;

    }

    const returningFieldsData = columnsData.map(function returningColumnCreate( columnData ){
        //Mapping the physical snake_case field back to its public schema name
        return `${String( referencePrefixData )}${layerSqlIdentifierQuote( String( columnData.databaseName ) )} AS ${layerSqlIdentifierQuote( String( columnData.name ) )}`;

    });

    //CallBack THE STRING
    return returningFieldsData.join( ', ' );

}

/**
 * @param {Record<string, unknown>[]} rowsData
 * @param {readonly Readonly<Record<string, unknown>>[]} selectedColumnsData
 */
function rowsNormalize( rowsData, selectedColumnsData ){
    const normalizedRowsData = [];

    const resultValueNormalize = function(
        /** @type {Readonly<Record<string, unknown>>} */ columnData,
        /** @type {unknown} */ valueData
    ){
        if ( valueData === null ){
            if ( columnData.nullable === true ){
                return null;

            }

            return databaseContractErrorThrow( 'DATABASE_RESULT_INVALID', 'The database returned an unexpected null.' );

        }

        if ( columnData.type === 'timestamp' ){
            const timestampData = new Date( /** @type {string | number | Date} */ (valueData) );

            if ( Number.isFinite( timestampData.getTime() ) === false ){
                return databaseContractErrorThrow( 'DATABASE_RESULT_INVALID', 'The database returned an invalid timestamp.' );

            }

            return timestampData.toISOString();

        }

        if ( columnData.type !== 'integer' ){
            return valueData;

        }

        const integerData = typeof valueData === 'string' && /^-?\d+$/.test( valueData )
            ? Number( valueData )
            : valueData;

        if ( Number.isSafeInteger( integerData ) === false ){
            return databaseContractErrorThrow(
                'DATABASE_RESULT_INVALID',
                'The database integer exceeded the safe JavaScript range.'
            );

        }

        return Number( integerData );

    };

    //Copying only selected allowlisted fields from driver-owned row objects
    for ( const rowData of rowsData ){
        const normalizedRowData = /** @type {Record<string, unknown>} */ ({});

        for ( const columnData of selectedColumnsData ){
            normalizedRowData[String( columnData.name )] = resultValueNormalize(
                columnData,
                rowData[String( columnData.name )]
            );

        }

        normalizedRowsData.push( Object.freeze( normalizedRowData ) );

    }

    //CallBack THE OBJECT
    return Object.freeze( normalizedRowsData );

}

/**
 * @param {Readonly<Record<string, unknown>>} tableData
 * @param {LayerStructuredDatabase} databaseData
 * @param {LayerStructuredSecurity} securityData
 */
function tableFacadeCreate( tableData, databaseData, securityData ){
    const tableColumnsData = /** @type {readonly Readonly<Record<string, unknown>>[]} */ (tableData.columns);
    const columnMapData = tableColumnMapCreate( tableData );
    const primaryColumnData = tableColumnGet( columnMapData, tableData.primaryKey );
    const tableReferenceData = `${layerSqlIdentifierQuote( layerSystemSchemaRead( databaseData ) )}.${layerSqlIdentifierQuote( String( tableData.name ) )}`;

    /**
     * @param {Record<string, unknown>} queryOptionsData
     * @param {number} [forcedLimitData]
     */
    const findManyExecute = async function( queryOptionsData, forcedLimitData ){
        unknownFieldsAssert(
            queryOptionsData,
            ['consistency', 'limit', 'offset', 'orderBy', 'select', 'where'],
            'findMany options'
        );

        const selectedColumnsData = selectedColumnsCreate( queryOptionsData.select, tableColumnsData, columnMapData );
        const parametersData = /** @type {unknown[]} */ ([]);
        const whereSectionsData = [];

        //Compiling an optional developer filter from trusted descriptors
        if ( queryOptionsData.where !== undefined && queryOptionsData.where !== null ){
            whereSectionsData.push( whereSqlCreate(
                queryOptionsData.where,
                columnMapData,
                parametersData,
                {nodes: 0}
            ) );

        }

        const scopeSqlData = scopeSqlCreate( tableData, securityData, parametersData );

        if ( scopeSqlData !== null ){
            whereSectionsData.push( scopeSqlData );

        }

        let limitData = queryOptionsData.limit ?? 50;

        if ( forcedLimitData !== undefined ){
            limitData = forcedLimitData;

        }

        const offsetData = queryOptionsData.offset ?? 0;

        if (
            Number.isInteger( limitData ) === false ||
            Number( limitData ) < Number( 1 ) ||
            Number( limitData ) > Number( maximumPageSize ) ||
            Number.isInteger( offsetData ) === false ||
            Number( offsetData ) < Number( 0 ) ||
            Number( offsetData ) > Number( 100000 )
        ){
            return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Pagination values are invalid.' );

        }

        const orderByInputData = queryOptionsData.orderBy ?? [{
            column: tableData.primaryKey,
            direction: 'asc'
        }];

        if ( Array.isArray( orderByInputData ) === false || Number( orderByInputData.length ) > Number( 5 ) ){
            return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'orderBy is invalid.' );

        }

        const orderBySqlData = [];

        //Compiling sort fields only from declared columns and directions
        for ( const orderData of orderByInputData ){
            if ( plainObjectCheck( orderData ) === false ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'orderBy is invalid.' );

            }

            unknownFieldsAssert( orderData, ['column', 'direction'], 'orderBy item' );

            const orderColumnData = tableColumnGet( columnMapData, orderData.column );
            const orderDirectionData = String( orderData.direction ?? 'asc' ).toLowerCase();

            if ( orderDirectionData !== 'asc' && orderDirectionData !== 'desc' ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'orderBy direction is invalid.' );

            }

            orderBySqlData.push(
                `${layerSqlIdentifierQuote( String( orderColumnData.databaseName ) )} ${String( orderDirectionData ).toUpperCase()}`
            );

        }

        parametersData.push( Number( limitData ) );
        const limitParameterData = `$${Number( parametersData.length )}`;
        parametersData.push( Number( offsetData ) );
        const offsetParameterData = `$${Number( parametersData.length )}`;
        let whereSqlData = String();

        if ( Number( whereSectionsData.length ) > Number( 0 ) ){
            whereSqlData = `WHERE ${whereSectionsData.join( ' AND ' )}`;

        }

        const consistencyData = queryOptionsData.consistency ?? 'strong';

        if ( consistencyData !== 'strong' && consistencyData !== 'eventual' ){
            return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Query consistency is invalid.' );

        }

        //Sending one bounded parameterized query through the selected database adapter
        const queryResultData = await databaseData.query({
            text: `
                SELECT ${returningSqlCreate( selectedColumnsData )}
                FROM ${String( tableReferenceData )}
                ${String( whereSqlData )}
                ORDER BY ${orderBySqlData.join( ', ' )}
                LIMIT ${String( limitParameterData )}
                OFFSET ${String( offsetParameterData )}
            `,
            values: parametersData,
            consistency: /** @type {'strong' | 'eventual'} */ (consistencyData)
        });

        //CallBack THE OBJECT
        return rowsNormalize( queryResultData.rows, selectedColumnsData );

    };

    /**
     * @param {unknown} valuesInputData
     * @param {boolean} mutationStatusData
     */
    const mutationValuesCreate = function( valuesInputData, mutationStatusData ){
        if ( plainObjectCheck( valuesInputData ) === false ){
            return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Mutation values must be an object.' );

        }

        const mutationValuesData = [];

        //Checking every supplied mutation field against table ownership and type metadata
        for ( const [columnNameData, columnValueData] of Object.entries( valuesInputData ) ){
            const columnData = tableColumnGet( columnMapData, columnNameData );

            if ( mutationStatusData === true && String( columnData.name ) === String( tableData.primaryKey ) ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'The primary key cannot be updated.' );

            }

            if ( columnData.generated !== null ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Generated columns cannot be assigned.' );

            }

            mutationValuesData.push({
                column: columnData,
                value: columnValueNormalize( columnData, columnValueData )
            });

        }

        if ( Number( mutationValuesData.length ) === Number( 0 ) ){
            return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Mutation values cannot be empty.' );

        }

        //CallBack THE OBJECT
        return mutationValuesData;

    };

    /**
     * @param {Record<string, unknown>} mutationOptionsData
     * @param {'update' | 'delete'} mutationTypeData
     */
    const boundedMutationExecute = async function( mutationOptionsData, mutationTypeData ){
        const supportedFieldsData = ['allowMany', 'limit', 'returning', 'where'];

        if ( mutationTypeData === 'update' ){
            supportedFieldsData.push( 'values' );

        }

        unknownFieldsAssert( mutationOptionsData, supportedFieldsData, `${String( mutationTypeData )} options` );

        //Requiring an explicit developer filter in addition to automatic ownership scope
        if ( mutationOptionsData.where === undefined || mutationOptionsData.where === null ){
            return databaseContractErrorThrow(
                'DATABASE_MASS_MUTATION_FORBIDDEN',
                `${String( mutationTypeData )} requires an explicit where filter.`
            );

        }

        const allowManyStatusData = mutationOptionsData.allowMany ?? false;

        if ( typeof allowManyStatusData !== 'boolean' ){
            return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'allowMany must be a boolean.' );

        }

        let mutationLimitData = Number( 1 );

        //Requiring an explicit bounded limit before changing multiple records
        if ( allowManyStatusData === true ){
            if (
                Number.isInteger( mutationOptionsData.limit ) === false ||
                Number( mutationOptionsData.limit ) < Number( 1 ) ||
                Number( mutationOptionsData.limit ) > Number( maximumPageSize )
            ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Mass mutation requires a limit between 1 and 100.' );

            }

            mutationLimitData = Number( mutationOptionsData.limit );

        } else if ( mutationOptionsData.limit !== undefined && Number( mutationOptionsData.limit ) !== Number( 1 ) ){
            return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Single-record mutation limit must be 1.' );

        }

        const selectedColumnsData = selectedColumnsCreate(
            mutationOptionsData.returning,
            tableColumnsData,
            columnMapData
        );
        const parametersData = [];
        const setSqlData = [];

        //Preparing update values before filter parameters so placeholder ordering is deterministic
        if ( mutationTypeData === 'update' ){
            const mutationValuesData = mutationValuesCreate( mutationOptionsData.values, true );

            for ( const mutationValueData of mutationValuesData ){
                parametersData.push( mutationValueData.value );
                let parameterSqlData = `$${Number( parametersData.length )}`;

                if ( mutationValueData.column.type === 'json' ){
                    parameterSqlData += '::jsonb';

                }

                setSqlData.push(
                    `${layerSqlIdentifierQuote( String( mutationValueData.column.databaseName ) )} = ${String( parameterSqlData )}`
                );

            }

        }

        const whereSectionsData = [whereSqlCreate(
            mutationOptionsData.where,
            columnMapData,
            parametersData,
            {nodes: 0}
        )];
        const scopeSqlData = scopeSqlCreate( tableData, securityData, parametersData );

        if ( scopeSqlData !== null ){
            whereSectionsData.push( scopeSqlData );

        }

        parametersData.push( mutationLimitData );
        const limitParameterData = `$${Number( parametersData.length )}`;
        const primaryDatabaseNameData = layerSqlIdentifierQuote( String( primaryColumnData.databaseName ) );
        let mutationSqlData;

        //Creating a bounded physical delete through a locked primary-key target set
        if ( mutationTypeData === 'delete' ){
            mutationSqlData = `
                WITH layer_targets AS (
                    SELECT ${String( primaryDatabaseNameData )}
                    FROM ${String( tableReferenceData )}
                    WHERE ${whereSectionsData.join( ' AND ' )}
                    LIMIT ${String( limitParameterData )}
                    FOR UPDATE
                )
                DELETE FROM ${String( tableReferenceData )} AS layer_record
                USING layer_targets
                WHERE layer_record.${String( primaryDatabaseNameData )} = layer_targets.${String( primaryDatabaseNameData )}
                RETURNING ${returningSqlCreate( selectedColumnsData, 'layer_record' )}
            `;

        } else {
            //Creating a bounded update through the same locked primary-key target set
            mutationSqlData = `
                WITH layer_targets AS (
                    SELECT ${String( primaryDatabaseNameData )}
                    FROM ${String( tableReferenceData )}
                    WHERE ${whereSectionsData.join( ' AND ' )}
                    LIMIT ${String( limitParameterData )}
                    FOR UPDATE
                )
                UPDATE ${String( tableReferenceData )} AS layer_record
                SET ${setSqlData.join( ', ' )}
                FROM layer_targets
                WHERE layer_record.${String( primaryDatabaseNameData )} = layer_targets.${String( primaryDatabaseNameData )}
                RETURNING ${returningSqlCreate( selectedColumnsData, 'layer_record' )}
            `;

        }

        //Executing the bounded mutation and returning only allowlisted fields
        const mutationResultData = await databaseData.query({
            text: mutationSqlData,
            values: parametersData,
            consistency: 'strong'
        });

        //CallBack THE OBJECT
        return rowsNormalize( mutationResultData.rows, selectedColumnsData );

    };

    //CallBack THE OBJECT
    return Object.freeze({
        async findMany( queryOptionsData = {} ){
            //Checking the query options record before compiling projections and filters
            if ( plainObjectCheck( queryOptionsData ) === false ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'findMany options must be an object.' );

            }

            return findManyExecute( queryOptionsData );

        },

        async findOne( queryOptionsData = {} ){
            //Checking the query options record before enforcing a single-row limit
            if ( plainObjectCheck( queryOptionsData ) === false ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'findOne options must be an object.' );

            }

            const normalizedOptionsData = {
                ...queryOptionsData
            };

            delete normalizedOptionsData.limit;

            const recordsData = await findManyExecute( normalizedOptionsData, 1 );

            //Returning explicit absence without fabricating an empty record
            if ( recordsData[0] === undefined ){
                //CallBack THE OBJECT
                return null;

            }

            //CallBack THE OBJECT
            return recordsData[0];

        },

        async count( queryOptionsData = {} ){
            //Checking count options before compiling the bounded ownership filter
            if ( plainObjectCheck( queryOptionsData ) === false ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'count options must be an object.' );

            }

            unknownFieldsAssert( queryOptionsData, ['consistency', 'where'], 'count options' );

            const parametersData = /** @type {unknown[]} */ ([]);
            const whereSectionsData = [];

            if ( queryOptionsData.where !== undefined && queryOptionsData.where !== null ){
                whereSectionsData.push( whereSqlCreate(
                    queryOptionsData.where,
                    columnMapData,
                    parametersData,
                    {nodes: 0}
                ) );

            }

            const scopeSqlData = scopeSqlCreate( tableData, securityData, parametersData );

            if ( scopeSqlData !== null ){
                whereSectionsData.push( scopeSqlData );

            }

            let whereSqlData = String();

            if ( Number( whereSectionsData.length ) > Number( 0 ) ){
                whereSqlData = `WHERE ${whereSectionsData.join( ' AND ' )}`;

            }

            const consistencyData = queryOptionsData.consistency ?? 'strong';

            if ( consistencyData !== 'strong' && consistencyData !== 'eventual' ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Query consistency is invalid.' );

            }

            const countResultData = await databaseData.query({
                text: `SELECT COUNT(*)::bigint AS count FROM ${String( tableReferenceData )} ${String( whereSqlData )}`,
                values: parametersData,
                consistency: /** @type {'strong' | 'eventual'} */ (consistencyData)
            });
            const countData = Number( countResultData.rows[0]?.count ?? 0 );

            if ( Number.isSafeInteger( countData ) === false || Number( countData ) < Number( 0 ) ){
                return databaseContractErrorThrow( 'DATABASE_RESULT_INVALID', 'The database returned an invalid count.' );

            }

            //CallBack THE NUMBER
            return countData;

        },

        async exists( queryOptionsData = {} ){
            //Getting a bounded count through the same ownership and filter policy
            const countData = await this.count( queryOptionsData );

            //CallBack THE BOOLEAN
            return Number( countData ) > Number( 0 );

        },

        /** @param {Record<string, unknown>} insertOptionsData */
        async insert( insertOptionsData ){
            //Checking insert options before reading developer values
            if ( plainObjectCheck( insertOptionsData ) === false ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'insert options must be an object.' );

            }

            unknownFieldsAssert( insertOptionsData, ['returning', 'values'], 'insert options' );

            const providedValuesData = mutationValuesCreate( insertOptionsData.values, false );
            const providedColumnNamesData = new Set( providedValuesData.map(function providedColumnNameRead( valueData ){
                //Getting the normalized public field used by required-column checks
                return String( valueData.column.name );

            }) );
            const insertValuesData = [...providedValuesData];

            //Creating generated values and checking required columns before SQL execution
            for ( const columnData of tableColumnsData ){
                if ( providedColumnNamesData.has( String( columnData.name ) ) === true ){
                    continue;

                }

                if ( columnData.generated === 'uuid' ){
                    insertValuesData.push({
                        column: columnData,
                        value: randomUUID()
                    });

                    continue;

                }

                if ( columnData.generated === 'identity' || columnData.defaultPresent === true || columnData.nullable === true ){
                    continue;

                }

                return databaseContractErrorThrow(
                    'DATABASE_QUERY_INVALID',
                    `Required column ${String( columnData.name )} was not provided.`
                );

            }

            const parametersData = [];
            const insertColumnsData = [];
            const insertParametersData = [];

            //Preparing every developer value with parameter binding and JSON casts
            for ( const insertValueData of insertValuesData ){
                insertColumnsData.push( layerSqlIdentifierQuote( String( insertValueData.column.databaseName ) ) );
                parametersData.push( insertValueData.value );

                let parameterSqlData = `$${Number( parametersData.length )}`;

                if ( insertValueData.column.type === 'json' ){
                    parameterSqlData += '::jsonb';

                }

                insertParametersData.push( parameterSqlData );

            }

            //Adding tenant or user ownership from trusted server identity only
            if ( tableData.scope === 'tenant' ){
                insertColumnsData.push( layerSqlIdentifierQuote( 'sys_tenant_id' ) );
                parametersData.push( boundedIdentifierRead( securityData.tenantId, 'Tenant identity' ) );
                insertParametersData.push( `$${Number( parametersData.length )}` );

            } else if ( tableData.scope === 'user' ){
                insertColumnsData.push( layerSqlIdentifierQuote( 'sys_user_id' ) );
                parametersData.push( boundedIdentifierRead( securityData.userId, 'User identity' ) );
                insertParametersData.push( `$${Number( parametersData.length )}` );

            }

            const selectedColumnsData = selectedColumnsCreate(
                insertOptionsData.returning,
                tableColumnsData,
                columnMapData
            );
            const insertResultData = await databaseData.query({
                text: `
                    INSERT INTO ${String( tableReferenceData )} (${insertColumnsData.join( ', ' )})
                    VALUES (${insertParametersData.join( ', ' )})
                    RETURNING ${returningSqlCreate( selectedColumnsData )}
                `,
                values: parametersData,
                consistency: 'strong'
            });
            const insertedRowsData = rowsNormalize( insertResultData.rows, selectedColumnsData );

            //Checking the database returned exactly one inserted record
            if ( Number( insertedRowsData.length ) !== Number( 1 ) ){
                return databaseContractErrorThrow( 'DATABASE_RESULT_INVALID', 'Insert did not return one record.' );

            }

            //CallBack THE OBJECT
            return insertedRowsData[0];

        },

        /** @param {Record<string, unknown>} updateOptionsData */
        async update( updateOptionsData ){
            //Checking update options before entering the bounded mutation compiler
            if ( plainObjectCheck( updateOptionsData ) === false ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'update options must be an object.' );

            }

            return boundedMutationExecute( updateOptionsData, 'update' );

        },

        /** @param {Record<string, unknown>} deleteOptionsData */
        async delete( deleteOptionsData ){
            //Checking delete options before entering the hard-delete compiler
            if ( plainObjectCheck( deleteOptionsData ) === false ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'delete options must be an object.' );

            }

            return boundedMutationExecute( deleteOptionsData, 'delete' );

        }
    });

}

/**
 * @param {object} facadeOptionsData
 * @param {LayerStructuredDatabase} facadeOptionsData.database
 * @param {unknown} facadeOptionsData.schema
 * @param {LayerStructuredSecurity} [facadeOptionsData.security]
 * @param {boolean} [facadeOptionsData.transaction]
 */
export const layerDatabaseFacadeCreate = function( facadeOptionsData ){
    //Checking the low-level adapter remains private and exposes only required primitives
    if (
        plainObjectCheck( facadeOptionsData ) === false ||
        typeof facadeOptionsData.database?.query !== 'function'
    ){
        return databaseContractErrorThrow( 'DATABASE_CONFIGURATION_INVALID', 'Database facade options are invalid.' );

    }

    //Checking schema ownership before trusting table and column identifiers
    if ( layerDatabaseSchemaDefinitionCheck( facadeOptionsData.schema ) === false ){
        return databaseContractErrorThrow( 'DATABASE_SCHEMA_INVALID', 'Application database schema is invalid.' );

    }

    const schemaData = facadeOptionsData.schema;
    const securityData = facadeOptionsData.security ?? {};
    const transactionStatusData = facadeOptionsData.transaction ?? false;

    //Preventing application tables from using the single-user system-only PGlite mode
    if ( Number( schemaData.tables.length ) > Number( 0 ) && facadeOptionsData.database.kind !== 'postgres' ){
        return databaseContractErrorThrow(
            'APPLICATION_DATABASE_REQUIRED',
            'Application tables require an external PostgreSQL primary.'
        );

    }

    const tableMapData = new Map();

    //Indexing schema-owned tables without exposing the low-level database adapter
    for ( const tableData of schemaData.tables ){
        tableMapData.set( tableData.name, tableData );

    }

    const whereData = whereFactoryCreate();

    //CallBack THE OBJECT
    return Object.freeze({
        where: whereData,

        /** @param {string} tableNameData */
        table( tableNameData ){
            //Checking a static application table name against the schema allowlist
            if ( typeof tableNameData !== 'string' || tableMapData.has( tableNameData ) === false ){
                return databaseContractErrorThrow( 'DATABASE_TABLE_NOT_FOUND', 'The application table was not found.' );

            }

            const tableData = tableMapData.get( tableNameData );

            if ( tableData === undefined ){
                return databaseContractErrorThrow( 'DATABASE_TABLE_NOT_FOUND', 'The application table was not found.' );

            }

            //CallBack THE OBJECT
            return tableFacadeCreate( tableData, facadeOptionsData.database, securityData );

        },

        /** @param {(transactionFacadeData: ReturnType<typeof layerDatabaseFacadeCreate>) => Promise<unknown>} transactionHandlerData */
        async transaction( transactionHandlerData ){
            //Rejecting malformed or nested transactions before allocating a connection
            if (
                typeof transactionHandlerData !== 'function' ||
                transactionStatusData === true ||
                typeof facadeOptionsData.database.transaction !== 'function'
            ){
                return databaseContractErrorThrow( 'DATABASE_TRANSACTION_INVALID', 'Database transaction is unavailable.' );

            }

            //Creating a new facade bound to the dedicated transaction adapter
            return facadeOptionsData.database.transaction(async function structuredTransactionExecute( transactionDatabaseData ){
                const transactionFacadeData = layerDatabaseFacadeCreate({
                    database: transactionDatabaseData,
                    schema: schemaData,
                    security: securityData,
                    transaction: true
                });

                //CallBack THE OBJECT
                return transactionHandlerData( transactionFacadeData );

            });

        },

        /** @param {TemplateStringsArray} stringsData @param {...unknown} valuesData */
        async sql( stringsData, ...valuesData ){
            //Checking this call came from a JavaScript tagged template literal
            if (
                Array.isArray( stringsData ) === false ||
                Object.prototype.hasOwnProperty.call( stringsData, 'raw' ) === false ||
                Number( stringsData.length ) !== Number( valuesData.length ) + Number( 1 )
            ){
                return databaseContractErrorThrow( 'DATABASE_QUERY_INVALID', 'Raw SQL requires a tagged template literal.' );

            }

            let queryTextData = String( stringsData[0] );

            //Replacing every interpolation with a positional parameter
            for ( const valueIndexData of valuesData.keys() ){
                queryTextData += `$${Number( valueIndexData ) + Number( 1 )}${String( stringsData[Number( valueIndexData ) + Number( 1 )] )}`;

            }

            //Sending server-only raw SQL with values separated from its trusted static text
            return facadeOptionsData.database.query({
                text: queryTextData,
                values: valuesData,
                consistency: 'strong'
            });

        }
    });

};
