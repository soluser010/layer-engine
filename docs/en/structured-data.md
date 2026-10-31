---
title: Structured CRUD and revisions
description: Application schemas, ownership isolation, atomic edits and failures.
audience: intermediate
order: 145
status: documented
updated: 2026-10-28
---

# Structured CRUD and revisions

Use `context.database` inside server operations for application tables. External PostgreSQL is required; embedded PGlite stores system data. See [database runtime](database-runtime.md) for connections and schema synchronization.

<!-- contract: database -->
## Schema and atomic edits

Export the named `databaseSchema` from `src/server/database.js`; place `messageEdit` in your server operation module. They are shown together to explain the relationship between types and revision checks.

<!-- example: application/database.mjs -->
```js
import {layerDatabaseSchemaDefine, layerTableDefine} from '@solcorp/layer-database';
import {LayerError} from '@solcorp/layer-protocol';

export const databaseSchema = layerDatabaseSchemaDefine([
    layerTableDefine({
        name: 'messages',
        scope: 'tenant',
        primaryKey: 'id',
        columns: {
            id: {type: 'uuid', generated: 'uuid'},
            text: {type: 'string'},
            revision: {type: 'integer'}
        }
    })
]);

/**
 * @param {{id: string, text: string, baseRevision: number}} payload
 * @param {{database: ReturnType<typeof import('@solcorp/layer-database').layerDatabaseFacadeCreate>}} context
 */
export async function messageEdit( payload, context ){
    //Combining ownership and revision checks in the same atomic UPDATE
    const database = context.database;
    const messages = await database.table( 'messages' ).update({
        values: {text: payload.text, revision: payload.baseRevision + 1},
        where: database.where.and(
            database.where.equal( 'id', payload.id ),
            database.where.equal( 'revision', payload.baseRevision )
        ),
        returning: ['id', 'text', 'revision']
    });

    //Reporting the same safe conflict for missing, inaccessible or changed records
    if ( messages.length !== 1 ){
        throw new LayerError( 'REVISION_CONFLICT', 'Reload the message before editing.', {status: 409} );

    }

    return messages[0];

}
```

Keep the named `databaseSchema` export; the loader does not use a default export. Register the operation with `type: 'command'`, `auth: 'session'`, `permissions: ['messages.edit']`, `transaction: true` and strict input/output schemas. Input: UUID `commandId`, UUID `id`, bounded string `text`, integer `baseRevision >= 0`; output: `id`, `text`, `revision`. The runtime creates `commandId`, but the server input schema must allow and validate this payload field. Offline replay additionally requires `offlineReplay: true`. See [complete registration](operations.md).

The UPDATE changes at most one accessible record at the expected revision. The tenant predicate comes from verified `context.security`. No match produces HTTP 409 / `REVISION_CONFLICT`, intentionally without revealing another tenant's record. Reload current data, let the user compare changes, then submit new intent with a new revision and commandId. Merely including baseRevision in the envelope does not perform this check.

## Reading, inserting and deleting

```js
const table = context.database.table( 'messages' );
const where = context.database.where;
const created = await table.insert({
    values: {text: 'Hello', revision: 1},
    returning: ['id', 'text', 'revision']
});
const message = await table.findOne({
    where: where.equal( 'id', created.id ),
    select: ['id', 'text', 'revision']
});
const page = await table.findMany({
    where: where.greaterThan( 'revision', 0 ),
    orderBy: [{column: 'id', direction: 'asc'}],
    limit: 50,
    offset: 0
});
const total = await table.count({where: where.greaterThan( 'revision', 0 )});
const present = await table.exists({where: where.equal( 'id', created.id )});
const removed = await table.delete({
    where: where.equal( 'id', created.id ),
    returning: ['id']
});
```

| Method | Result and limits |
| --- | --- |
| `findOne` | Record or null; reads at most one |
| `findMany` | Array; default limit 50, maximum 100; offset up to 100000 |
| `count`, `exists` | Number and boolean with the same ownership predicates |
| `insert` | One record; omit generated fields from values |
| `update`, `delete` | Array of affected records; where required; at most one by default |
| `returning`, `select` | Allowlisted schema fields only; omitted means declared table fields |

`delete` is physical. Bulk changes require `allowMany: true, limit: 20` (up to 100) and where. A row limit does not replace permissions or business authorization. Use stable ordering for pagination; replace large offsets with a keyset predicate.

Filters: `equal`, `notEqual`, `greaterThan`, `lessThan`, `in`, `isNull`, `and`, `or`. Groups accept 2–20 descriptors, `in` up to 100 values; maximum depth 8 and 50 nodes. Construct filters on the server: payload JSON is not an executable SQL filter.

## Types and ownership

Column types: `boolean`, `integer` (safe integer), `number` (finite), `string`, `uuid`, `timestamp`, `json`. Timestamps accept ISO strings or Date and return ISO strings; nullable permits null. JSON must be serializable. Identifiers and values are validated separately; values use SQL parameters.

`scope: 'global'` is shared data protected by operation permissions. `tenant` adds `sys_tenant_id`; `user` adds `sys_user_id`, from server identity. User-scope uses userId, which must be globally unique. For tenant-local user IDs, use tenant-scope with an additional trusted user predicate. Never convert payload.tenantId into security context.

## Transactions and complex SQL

```js
await context.database.transaction( async function( database ){
    //Rolling back both inserts if either validation or SQL execution fails
    await database.table( 'messages' ).insert({values: {text: 'First', revision: 1}});
    await database.table( 'messages' ).insert({values: {text: 'Second', revision: 1}});

});
```

Use this outside an existing transactional operation. With `transaction: true`, the executor already binds the facade to its transaction; nesting fails with `DATABASE_TRANSACTION_INVALID`. A thrown error rolls back the transaction. Do not swallow it and report success.

`database.sql` is a server-only tagged template for trusted code:
```js
const result = await context.database.sql`SELECT ${Number( payload.value )}::integer AS value`;
```
Interpolations are values, not identifiers or SQL fragments. Raw SQL does not add ownership predicates: explicitly enforce trusted tenant/user restrictions and result limits. Never expose it to browsers or untrusted plugins. Prefer CRUD for ordinary work.

## Failure contract

`DATABASE_QUERY_INVALID` means an invalid filter/field/type; `DATABASE_TABLE_NOT_FOUND` means an undeclared table; `APPLICATION_DATABASE_REQUIRED` means application tables without external PostgreSQL. Never expose driver SQL or credentials to clients. Strong reads use primary; `consistency: 'eventual'` explicitly permits a healthy replica within the lag limit. Read command results back with strong consistency.

Next: [server events](server-events.md), [offline conflicts](offline-realtime.md).
