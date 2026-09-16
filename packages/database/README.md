# @second-brain/database

Typed Supabase client and repository modules — the single place in the monorepo that knows Postgres.

## Status

**Scaffold.** Client construction, the security model, error normalization and the
error-code helpers are real code. Every repository method is a `// TODO(phase-2)`
stub that throws `Not implemented: <Queries>.<method>`, and there are no tests
(`vitest run --passWithNoTests` passes vacuously).

`src/types/database.ts` is a **hand-written placeholder** for the generated types.
It exists so the package type-checks before the first migration; `pnpm db:types`
will overwrite it wholesale. See "Generating `Database`" below.

## Layout

```
packages/database/
├── src/
│   ├── client.ts              createSupabaseClient, supabaseFromEnv, createUserScopedClient,
│   │                          DbError, asDbError, isUniqueViolation, isForeignKeyViolation,
│   │                          isUndefinedTable
│   ├── queries/
│   │   ├── activity.ts        createActivityQueries — write path, dedup, dashboard aggregates
│   │   ├── documents.ts       createDocumentQueries — upsert by content hash, topics, summary
│   │   ├── chunks.ts          createChunksQueries — insert, embed, match_chunks RPC
│   │   ├── memories.ts        createMemoriesQueries — insert, match_memories, supersede, decay
│   │   └── topics.ts          createTopicsQueries — upsert by slug, centroid, merge
│   ├── types/database.ts      generated `Database` type (placeholder)
│   └── index.ts               barrel
├── package.json
├── tsconfig.json
└── README.md
```

## Why queries live here

Services are allowed to know _what_ they need; they are not allowed to know how the
schema is shaped.

- **One place to change.** A column rename, a new index, or a switch from a
  client-side join to an RPC is a change in one package instead of a search across
  `services/ingestion`, `services/processing` and `services/retrieval`.
- **One place to get RLS right.** Which client a query runs on decides whether Row
  Level Security protects it. Scattering `createClient` calls across services is how
  a service-role key ends up in a request path by accident; here there are two
  factories and both are explicit about the mode.
- **Typed boundaries.** Every method's parameters and return shape are named types
  built on the generated `Database` type, so a migration that changes a column breaks
  the build at the repository, not at a `strings.Contains` deep inside a service.
- **Testability.** Services depend on a repository interface, so a processing test can
  substitute one implementation instead of standing up Postgres.

The rule for services: import a `create*Queries` factory from this package, call its
methods, and never import `@supabase/supabase-js` directly.

## Row Level Security and the two client modes

Every table is scoped to `auth.uid()`. Whether that matters depends on the client:

| Mode      | Credential                  | RLS                                                | Where it may be constructed                                 |
| --------- | --------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `public`  | `SUPABASE_ANON_KEY`         | Enforced — rows are filtered per user              | Anywhere, including browser and extension bundles           |
| `service` | `SUPABASE_SERVICE_ROLE_KEY` | **Bypassed** — every row of every table is visible | Server processes only: `services/*`, `supabase/functions/*` |

```ts
import {
  createSupabaseClient,
  createUserScopedClient,
  supabaseFromEnv,
} from '@second-brain/database';

// Browser / extension safe: RLS applies.
const pub = createSupabaseClient({ mode: 'public', url, anonKey });

// Server only. The union has no `anonKey` field, so this cannot happen by accident.
const svc = createSupabaseClient({ mode: 'service', url, serviceRoleKey });

// One client per request, carrying the caller's JWT so auth.uid() resolves and
// RLS filters for that user. This is the default shape on the server.
const userScoped = createUserScopedClient(url, anonKey, accessToken);

// From the environment. `mode` defaults to 'public': a service client must be
// asked for by name.
const fromEnv = supabaseFromEnv(process.env);
const fromEnvService = supabaseFromEnv(process.env, 'service');
```

The service-role key bypasses RLS completely and must only ever be instantiated in a
server process — never in `apps/web`, never in `apps/chrome-extension`, and never from
a value that reached the client bundle. The discriminated union on `mode` makes the
mistake visible in review; it cannot detect a leaked key at runtime.

Two consequences worth internalizing:

- A user-scoped client with an expired token returns **empty results, not an error**,
  because RLS filters rows rather than rejecting the query. If a query suddenly
  returns nothing, check the token before suspecting the data.
- Every read that is not user-scoped must filter by `user_id` itself. A service-role
  client will happily return the whole table.

## Generating `Database`

`src/types/database.ts` is machine-generated by the root script:

```bash
pnpm db:types
# runs: supabase gen types typescript --local > packages/database/src/types/database.ts
```

Workflow:

1. Write the migration in `supabase/migrations/`.
2. Apply it to the local stack (`supabase db reset`, or the root `db:*` script that wraps it).
3. `pnpm db:types` to regenerate this file.
4. `pnpm typecheck` — the repository methods are typed against the generated shapes,
   so a breaking schema change surfaces here before it reaches a service.

Never edit the generated file by hand: the next run discards the change. If a row
shape looks wrong, the migration is wrong. Two known differences between the current
placeholder and a live run:

- `pgvector` columns come back as `string` from PostgREST (the literal `'[1,2,3]'`
  form), while the placeholder types them `number[]` to match the shared domain types.
  The query modules own that conversion.
- The placeholder declares `Views` and `CompositeTypes` as empty; a real run lists
  whatever exists by then.

## Error-code helpers

`DbError` normalizes both thrown errors and Supabase's returned `PostgrestError`
objects (which are plain objects, not `Error` instances) while preserving the Postgres
SQLSTATE in `code`, plus `details` and `hint`:

| Helper                         | SQLSTATE | Meaning here                                                                                                                                                                                 |
| ------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isUniqueViolation(error)`     | `23505`  | The row already exists. For a device re-syncing a batch this is normal, not a failure: `activity_events` is unique on `(user_id, dedupe_key)`, and `documents` on `(user_id, content_hash)`. |
| `isForeignKeyViolation(error)` | `23503`  | An insert referenced a row that does not exist — usually a `device_id` the server has never registered.                                                                                      |
| `isUndefinedTable(error)`      | `42P01`  | The schema is not deployed: migrations have not run against this database.                                                                                                                   |

```ts
try {
  await activity.insertEvents(batch);
} catch (error) {
  if (isUniqueViolation(error)) return { duplicates: batch.length };
  throw error;
}
```

`asDbError(error)` is the underlying normalizer, for the cases that need the whole
error object rather than one predicate.

## Scripts

| Script      | Command                                        | Purpose                                      |
| ----------- | ---------------------------------------------- | -------------------------------------------- |
| `build`     | `tsup src/index.ts --format esm --dts`         | ESM bundle plus type declarations in `dist/` |
| `dev`       | `tsup src/index.ts --format esm --dts --watch` | Rebuild on change                            |
| `typecheck` | `tsc --noEmit`                                 | Types only                                   |
| `lint`      | `eslint src --ext .ts`                         | Repo ESLint config                           |
| `test`      | `vitest run --passWithNoTests`                 | Test suite (none yet)                        |
| `clean`     | `rimraf dist .turbo`                           | Remove build output and Turbo cache          |

## Configuration

Read from the process environment by `supabaseFromEnv`; see `.env.example`.

| Variable                    | Mode      | Notes                                                                          |
| --------------------------- | --------- | ------------------------------------------------------------------------------ |
| `SUPABASE_URL`              | both      | Required. Local stack URL is `http://127.0.0.1:55321` (`supabase/config.toml`) |
| `SUPABASE_ANON_KEY`         | `public`  | Required for public mode. Safe in client bundles because RLS is underneath     |
| `SUPABASE_SERVICE_ROLE_KEY` | `service` | Required for service mode. Server processes only — bypasses RLS                |

A missing or blank value throws a `DbError` at construction rather than failing later
on the first query.

## Related docs

- [`docs/DATABASE_SCHEMA.md`](../../docs/DATABASE_SCHEMA.md) — tables, indexes, RLS policies
- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — where the query modules sit in the pipeline
- [`docs/DECISIONS.md`](../../docs/DECISIONS.md) — ADR log, including the RLS and pgvector decisions
- [`supabase/`](../../supabase) — migrations, edge functions and CLI config
- [`../shared`](../shared) — the domain types these row shapes are derived from
