import {layerDatabaseSchemaDefinitionCheck} from './schema-definition.js';

const columnTypeDeclarations = Object.freeze({
    boolean: 'boolean',
    integer: 'number',
    json: 'LayerJsonValue',
    number: 'number',
    string: 'string',
    timestamp: 'string',
    uuid: 'string'
});

/** @param {string} tableNameData */
function declarationNameCreate( tableNameData ){
    return tableNameData.split( '_' ).map(function declarationSectionCreate( sectionData ){
        return String( sectionData.charAt( Number( 0 ) ) ).toUpperCase() + String( sectionData.slice( Number( 1 ) ) );

    }).join( String() );

}

/** @param {Readonly<Record<string, unknown>>} columnData */
function columnTypeDeclarationCreate( columnData ){
    const baseTypeData = /** @type {Readonly<Record<string, string>>} */ (columnTypeDeclarations)[String( columnData.type )];

    if ( baseTypeData === undefined ){
        throw new TypeError( 'Database declaration contains an unsupported column type.' );

    }

    if ( columnData.nullable === true ){
        return `${String( baseTypeData )} | null`;

    }

    return baseTypeData;

}

/**
 * @param {ReturnType<typeof import('./schema-definition.js').layerDatabaseSchemaDefine>} schemaDefinitionData
 */
export function layerDatabaseSchemaDeclarationsCreate( schemaDefinitionData ){
    if ( layerDatabaseSchemaDefinitionCheck( schemaDefinitionData ) === false ){
        throw new TypeError( 'Database declarations require a trusted schema definition.' );

    }

    const declarationSectionsData = [
        'export type LayerJsonPrimitive = boolean | number | string | null;',
        'export type LayerJsonValue = LayerJsonPrimitive | readonly LayerJsonValue[] | {readonly [key: string]: LayerJsonValue};',
        '',
        'export type LayerDatabaseFilter<ColumnName extends string> = Readonly<{',
        "    operator: 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual' | 'in' | 'and' | 'or' | 'not';",
        '    column?: ColumnName;',
        '    value?: unknown;',
        '    children?: readonly LayerDatabaseFilter<ColumnName>[];',
        '}>;',
        ''
    ];
    const tableDeclarationNamesData = new Set();

    for ( const tableData of schemaDefinitionData.tables ){
        const tableDeclarationNameData = declarationNameCreate( tableData.name );

        if ( tableDeclarationNamesData.has( tableDeclarationNameData ) === true ){
            throw new TypeError( 'Database table names produce duplicate declarations.' );

        }

        tableDeclarationNamesData.add( tableDeclarationNameData );
        declarationSectionsData.push(`export interface ${String( tableDeclarationNameData )}Row {`);

        for ( const columnData of tableData.columns ){
            declarationSectionsData.push(
                `    readonly ${String( columnData.name )}: ${String( columnTypeDeclarationCreate( columnData ) )};`
            );

        }

        declarationSectionsData.push('}', '');
        declarationSectionsData.push(`export interface ${String( tableDeclarationNameData )}Insert {`);

        for ( const columnData of tableData.columns ){
            if ( columnData.generated !== null ){
                continue;

            }

            const optionalStatusData = columnData.nullable === true || columnData.defaultPresent === true;
            let optionalMarkerData = String();

            if ( optionalStatusData === true ){
                optionalMarkerData = '?';

            }

            declarationSectionsData.push(
                `    readonly ${String( columnData.name )}${String( optionalMarkerData )}: ${String( columnTypeDeclarationCreate( columnData ) )};`
            );

        }

        declarationSectionsData.push('}', '');
        declarationSectionsData.push(
            `export type ${String( tableDeclarationNameData )}Column = keyof ${String( tableDeclarationNameData )}Row;`,
            `export type ${String( tableDeclarationNameData )}Update = Partial<Omit<${String( tableDeclarationNameData )}Row, ${JSON.stringify( tableData.primaryKey )}>>;`,
            `export type ${String( tableDeclarationNameData )}Filter = LayerDatabaseFilter<${String( tableDeclarationNameData )}Column>;`,
            ''
        );

    }

    declarationSectionsData.push('export interface LayerDatabaseTables {');

    for ( const tableData of schemaDefinitionData.tables ){
        const tableDeclarationNameData = declarationNameCreate( tableData.name );

        declarationSectionsData.push(
            `    readonly ${String( tableData.name )}: Readonly<{`,
            `        row: ${String( tableDeclarationNameData )}Row;`,
            `        insert: ${String( tableDeclarationNameData )}Insert;`,
            `        update: ${String( tableDeclarationNameData )}Update;`,
            `        column: ${String( tableDeclarationNameData )}Column;`,
            `        filter: ${String( tableDeclarationNameData )}Filter;`,
            `        scope: ${JSON.stringify( tableData.scope )};`,
            '    }>;'
        );

    }

    declarationSectionsData.push(
        '}',
        '',
        'export type LayerDatabaseTableName = keyof LayerDatabaseTables;',
        'export type LayerDatabaseRow<TableName extends LayerDatabaseTableName> = LayerDatabaseTables[TableName][\'row\'];',
        'export type LayerDatabaseInsert<TableName extends LayerDatabaseTableName> = LayerDatabaseTables[TableName][\'insert\'];',
        'export type LayerDatabaseUpdate<TableName extends LayerDatabaseTableName> = LayerDatabaseTables[TableName][\'update\'];',
        'export type LayerDatabaseColumn<TableName extends LayerDatabaseTableName> = LayerDatabaseTables[TableName][\'column\'];',
        'export type LayerDatabaseResult<TableName extends LayerDatabaseTableName, ColumnName extends LayerDatabaseColumn<TableName> = LayerDatabaseColumn<TableName>> = Pick<LayerDatabaseRow<TableName>, ColumnName>;',
        ''
    );

    return declarationSectionsData.join( '\n' );

}
