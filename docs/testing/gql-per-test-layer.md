# GQL Per-Test Layer (Composer)

Thin composer that reuses the SQL Spanner emulator-per-test harness and adds a GQL client **without** creating a second SQL pool.

## Usage

```ts
import * as Effect from "effect/Effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as Gql from "@org/effect-gql-spanner/GqlClient"
import { gqlPerTestLayer } from "../../test/utils/gql-per-test-layer"

const layer = gqlPerTestLayer()

Effect.gen(function* () {
  const gql = yield* Gql.ClientTag
  const sql = yield* SqlClient.SqlClient
  // Both are available; underlying pool is shared
}).pipe(Effect.provide(layer))
```

## Internals

- Provides `Testing.layer` and `Testing.emulatorPerTestSqlLayer` from `@org/effect-sql-spanner`.
- Builds `GqlClient.layerUsingExistingSql(graphName)` so the GQL client reuses the SQL pool.
- Exposes `TestDatabaseId` (via SQL harness) for diagnostics.

