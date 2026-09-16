# supabase

Database migrations, edge functions, and local seed data for Second Brain's Postgres + pgvector + Auth + Storage backend.

## Status

**Scaffold — no migrations exist yet.** `supabase/migrations/` is empty apart from a `.gitkeep` placeholder, so the schema described in [docs/DATABASE_SCHEMA.md](../docs/DATABASE_SCHEMA.md) is not created by this repository yet. That has two visible consequences today:

- `supabase db reset` succeeds as far as creating an empty database, then fails on `seed.sql` because its tables do not exist yet. Once the first migration lands, that goes away.
- `pnpm db:types` produces an almost-empty types file, because there is almost no schema to reflect.

The three edge functions in `functions/` are wired end to end — env handling, CORS, method guards, structured errors, request-id logging — but every one of them returns `501 Not Implemented` from a body marked `// TODO(phase-2)`. They are the contract, not the behaviour.

## Layout

```
supabase/
├── config.toml                 CLI configuration for the local stack
├── migrations/
│   └── .gitkeep                real migrations land here (currently empty)
├── functions/
│   ├── process-activity/       activity batch intake (verify_jwt)
│   │   ├── index.ts
│   │   └── deno.json           import map + compiler options for this function
│   ├── embed/                  batch chunk embedding (verify_jwt)
│   │   ├── index.ts
│   │   └── deno.json
│   └── distill/                chunk → memory extraction (verify_jwt)
│       ├── index.ts
│       └── deno.json
├── seed.sql                    optional local-only demo data
└── README.md
```

`functions/` is deliberately outside the pnpm workspace: Deno resolves its own imports from each function's `deno.json`, those files are not covered by `tsconfig.base.json`, and `supabase/functions` is listed in ESLint's `ignorePatterns` for the same reason. Consequences worth knowing:

- Edge functions cannot import `@second-brain/shared` or `@second-brain/providers`. Each `index.ts` therefore declares the narrow `Wire*` types it needs, with a comment naming the shared type file it must be kept in sync with.
- Type-checking an edge function is `deno check supabase/functions/<name>/index.ts` (or the CLI's own bundling at deploy time), not `pnpm typecheck`.

## Scripts

| Command                                              | What it does                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `supabase start`                                     | Boot the local stack (Postgres, Auth, Storage, Realtime, Studio, Inbucket, edge runtime).                |
| `supabase stop`                                      | Stop the stack. Add `--no-backup` to also drop volumes.                                                  |
| `supabase status`                                    | Print URLs and keys. Non-zero exit when the stack is not running — this is what `scripts/dev.sh` probes. |
| `supabase db reset`                                  | **Destructive.** Drops the local database, replays `migrations/` in order, then runs `seed.sql`.         |
| `supabase migration new <description>`               | Create an empty, correctly timestamped migration file.                                                   |
| `supabase db push`                                   | Apply pending migrations to the linked **remote** database. Forward-only.                                |
| `supabase functions serve <name> --env-file ../.env` | Run one edge function locally with auto-reload.                                                          |
| `supabase functions deploy <name>`                   | Deploy one function to the linked project. Never pass `--no-verify-jwt` here.                            |
| `supabase secrets set KEY=value`                     | Set a remote function secret.                                                                            |
| `pnpm db:types`                                      | Regenerate `packages/database/src/types/database.ts` (defined in the root `package.json`).               |

The repo-level wrappers are `scripts/setup.sh` (one-time bootstrap, optional `--reset-db`), `scripts/dev.sh` (run the stack and/or the JS workspaces), and `scripts/deploy.sh` (dry run by default; `--apply` to execute).

## Local stack

```bash
supabase start        # first run pulls several containers; afterwards it is fast
supabase status       # copy the anon key and service-role key into the root .env
supabase stop
```

Local endpoints (fixed in `config.toml` because every client default points at them):

| Service                  | URL                                                     |
| ------------------------ | ------------------------------------------------------- |
| API (PostgREST)          | http://127.0.0.1:55321                                  |
| Postgres                 | postgresql://postgres:postgres@127.0.0.1:55322/postgres |
| Studio                   | http://127.0.0.1:55323                                  |
| Inbucket (captured mail) | http://127.0.0.1:55324                                  |
| Edge function inspector  | http://127.0.0.1:8083                                   |

`supabase start` does not populate the root `.env` file. Copy the keys from `supabase status` into `.env` (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`); `scripts/setup.sh` prints the reminder but deliberately never writes secrets into your environment file.

`supabase db reset` is the only routine command in this directory that destroys data, and it only affects the local database and local volumes. Because `seed.sql` runs as part of it, the reset is also the fastest way to get a demo user's rows back after experimenting.

## Migrations

Naming convention is the CLI's own and must not be hand-invented:

```
supabase/migrations/YYYYMMDDHHMMSS_description.sql
```

e.g. `supabase/migrations/20260916143000_enable_pgvector_and_events.sql`. Timestamps sort lexicographically, so the order files are named in is the order they are applied.

Rules:

- **Append-only.** Once a migration has been pushed to any shared environment it is never edited or deleted — a change is a new migration that moves the schema forward. Editing a pushed migration means the local and remote schemas silently disagree, and nothing reports it.
- **Forward-only.** There are no down migrations here. Recovery from a bad migration is a corrective migration, which is why `scripts/deploy.sh` pushes only after a build and a loud warning.
- **One concern per migration.** Small, named migrations keep failures attributable; a migration that both creates a table and back-fills it is two migrations.
- **Extensions go in migrations.** See below.

`migrations/.gitkeep` is empty on purpose — `.gitkeep` is a directory placeholder and has no syntax for comments, so the explanation of the empty-migrations situation lives here instead.

### pgvector

The `vector` extension is enabled **by a migration, not by `config.toml`**. Two reasons:

1. `supabase/config.toml` has no extension list, and anything written there would not reach the hosted database anyway.
2. The local Supabase image already ships `vector`, so the only thing needed in both environments is a migration containing:

   ```sql
   create extension if not exists vector;
   ```

   `create extension if not exists` makes it safe to re-run against an image that already has it and correct against a hosted project where it is present but not yet enabled per-database.

The extension lives in the `extensions` schema, which is why `extra_search_path` includes it — `vector` operators and functions then resolve unqualified in queries and migrations. `config.toml`'s `[db]` block carries the same note next to `major_version`.

### Schema

Every application object — the tables, the enums, the RPCs, and the `set_updated_at()` trigger helper — lives in the **`second_brain`** schema, not `public`. Rationale is in [ADR-020](../docs/DECISIONS.md); the shape is specified in [DATABASE_SCHEMA.md](../docs/DATABASE_SCHEMA.md).

Three surfaces must move together, and each fails _differently_ when it goes stale:

| Surface                  | Where                                     | What breaks when it is stale                                              |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------- |
| `DEFAULT_SCHEMA`         | `packages/database/src/client.ts`         | Queries resolve against the wrong schema.                                 |
| `[api].schemas`          | `config.toml`                             | PostgREST does not serve the schema at all — every request is `PGRST106`. |
| `Database` top-level key | `packages/database/src/types/database.ts` | Types compile but describe a schema the client never touches.             |

Anything that _imports_ `DEFAULT_SCHEMA` follows the constant automatically and needs no edit — `apps/web`'s browser and server clients do exactly that, so they cannot drift from it. The Chrome extension's Supabase client is auth-only (GoTrue lives in the `auth` schema) and deliberately does not bind an application schema, because it never touches application tables.

`public` stays in `[api].schemas` and stays the _default_ schema for a request that sends no `Accept-Profile` header. That is deliberate: `second_brain` holds every application table and `public` holds none of ours, so a client that forgets to bind the schema gets a loud "relation does not exist" instead of quietly reading the wrong data.

**RLS policies are filters, not grants.** Supabase's default privileges cover `public` only, so a custom schema is unreachable until it is granted explicitly. The migration that creates the schema must therefore include:

```sql
create schema if not exists second_brain;

grant usage on schema second_brain to authenticated, service_role;

-- BOTH roles need table privileges, and the reason is NOT symmetric:
--   * `authenticated` needs them because an RLS policy is a filter applied *on top
--     of* the privilege check. Without the grant the policy is never reached and the
--     query fails with "permission denied for table …" instead.
--   * `service_role` needs them despite holding BYPASSRLS, because BYPASSRLS exempts
--     it from *policies*, not from the privilege system. Omitting it here is the
--     trap: every edge function's privileged client fails with permission denied
--     while a reader of the policies concludes it should be allowed.
grant select, insert, update, delete on all tables in schema second_brain
  to authenticated, service_role;

-- The line that keeps a *future* table from being invisible. Without it, a table
-- added by a later migration inherits no privileges and stays unreachable no matter
-- how correct its RLS policies are. It applies to objects created by the role that
-- runs this statement, which is why it belongs in the same migration as
-- `create schema`, while every object is still owned by the migration role.
alter default privileges in schema second_brain
  grant select, insert, update, delete on tables to authenticated, service_role;
```

`service_role` bypasses RLS by role attribute, so its grants exist to let privileged server code reach the tables at all — not to widen anyone's access.

Because migrations and seeds run as `postgres`, which owns every table it creates, and RLS does not apply to the owner by default, `seed.sql` and the migrations qualify table names as `second_brain.<table>` — psql's default `search_path` is `"$user", public`, so an unqualified name fails there even once the table exists.

### Row Level Security

**Every table in `second_brain` has RLS enabled and at least one policy.** There is no exception and no "temporarily disabled while developing" state. A table without RLS is reachable through PostgREST with the anon key, which is shipped in the browser extension, the web bundle, and the Android app — so a missing policy is a public endpoint, not an internal detail.

Conventions the migrations must follow:

- `enable row level security` **and** `force row level security` in the same migration that creates the table, with policies grouped underneath it. `force` is the one that actually binds: migrations run as `postgres`, which owns the tables it creates, and plain `enable` leaves the table readable with its policies bypassed by anything connecting as the owner.
- Policies are written against `auth.uid() = user_id`. Where a row is reachable through a parent (a chunk through its document), the policy joins to the parent rather than denormalising a second owner column.
- The service-role key bypasses RLS entirely. Anything running under it — every edge function's privileged client — must filter on `user_id` explicitly, because the database will not do it.
- Every edge function in `functions/` therefore builds two clients: a service-role client for privileged writes, and a caller-scoped client built from the `Authorization` header for reads. Each `index.ts` header comment states which is which and why.

## Edge functions

### Local development loop

```bash
supabase functions serve process-activity --env-file ../.env
# in another shell
curl -i -X POST http://127.0.0.1:55321/functions/v1/process-activity \
  -H 'Authorization: Bearer <access token>' \
  -H 'Content-Type: application/json' \
  -d '{"schemaVersion":1,"deviceId":"…","clientSentAt":"…","events":[]}'
```

`--env-file ../.env` passes the repo-root `.env` (the path is relative to `supabase/`, i.e. one level up) so the functions see the same provider keys and thresholds the services do. Do not create a second secrets file inside `supabase/`: `supabase/.env` is gitignored, and a local override there is exactly the kind of divergence that makes a function work on one machine only. Deployed functions get their values from `supabase secrets set` instead — never from a committed file.

The inspector is on `http://127.0.0.1:8083` (`chrome://inspect`), and `[edge_runtime] policy = "per_worker"` keeps an isolate alive between requests so a breakpoint in a long-running function is not torn down mid-step.

Each function bundles from its own directory; changes to `deno.json` (import map changes, compiler options) take effect on reload.

### `verify_jwt`

All three functions set `verify_jwt = true` in `config.toml`, and none of them may ever be deployed with `--no-verify-jwt`:

| Function           | `verify_jwt` | Why                                                                                                                                                                                           |
| ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `process-activity` | `true`       | Called by signed-in clients. The caller's JWT is what identifies whose rows are being written, so verification is the write scope itself.                                                     |
| `embed`            | `true`       | Called by the processing service. Needs a long wall-clock budget, but the fix for that is a background/queued invocation, not an unauthenticated endpoint — see the comment in `config.toml`. |
| `distill`          | `true`       | Called by the processing service. Longest-running function in the system, always background, and must stay idempotent because retries are expected.                                           |

Note that JWT verification only proves _who_ the caller is. It does not mean RLS applies: `verify_jwt` gates the request, the service-role client still bypasses policies, and so the `user_id` a privileged write uses must come from the verified token rather than from the request body.

### Secrets per function

Values in the first group are provided by the platform for both local and deployed functions and only need overriding if you point a function at a different project.

| Function           | Secrets                                                                                                                                                                                     | Notes                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| all three          | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`                                                                                                                            | Injected by the platform. The service-role key is server-only and must never reach the extension, the web bundle, or Android.                                                                                                   |
| `process-activity` | `INGEST_SHARED_SECRET`, `IMPORTANCE_MIN_THRESHOLD`, `SYNC_BATCH_SIZE`                                                                                                                       | The threshold and batch size come from `.env.example` so local and service-side scoring agree.                                                                                                                                  |
| `embed`            | `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, plus the key for the active provider: `NVIDIA_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` and the matching `*_BASE_URL` | `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` are a pinned pair — the dimension is a correctness constraint against the `vector(N)` column, not a tuning knob. Changing the model is a migration plus a full re-embed (ADR-004). |
| `distill`          | `LLM_PROVIDER`, `LLM_MODEL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `IMPORTANCE_MIN_THRESHOLD`                                                             | The provider and model are resolved server-side; a caller queues work, it does not choose the model.                                                                                                                            |

Set them with:

```bash
supabase secrets set EMBEDDING_DIMENSIONS=1024
supabase secrets list        # verify; values are never printed back
```

### Generated types

`packages/database/src/types/database.ts` is generated, never edited by hand, and owned by the `packages/database` workspace:

```bash
supabase start        # the generator reads the local database
pnpm db:types         # supabase gen types typescript --local > packages/database/src/types/database.ts
```

Regenerate after every migration, and commit the result in the same change as the migration so the code and the schema cannot drift apart in review.

## Configuration

Source of truth for the local stack is [`config.toml`](./config.toml); every non-obvious value there carries a comment. The values most likely to surprise:

| Setting    | Value   | Why |
| ---------- | ------- | --- |
| `api.port` | `55321` |

                                        | Every client default (`.env.example`, web, extension, Android) points here.                                        |

| `api.schemas` | `["public", "graphql_public", "second_brain"]` | PostgREST serves only the schemas listed here. Omitting `second_brain` fails every request with `PGRST106`. |
| `api.extra_search_path` | `["public", "extensions", "second_brain"]` | Lets `vector` and `pg_trgm` resolve unqualified, and puts `second_brain` on the search path for raw SQL. |
| `db.major_version` | `15` | Matches the hosted project so a migration cannot pass locally on a different major. |
| `db.seed` | `enabled = true`, `sql_paths = ["./seed.sql"]` | Declared explicitly so `db reset` behaviour is visible in the file; set `enabled = false` for a schema-only reset. |
| `auth.enable_confirmations` | `false` | Local only — skips the mail round-trip. Must be `true` in staging/prod. |
| `edge_runtime.policy` | `"per_worker"` | Keeps an isolate warm so long distillation work is not killed at request end. |
| `analytics.enabled` | `false` | The Logflare container is unused; `supabase start` stays quick. |

Everything secret lives in the repo-root `.env` (copied from `.env.example`, gitignored, never committed) or in `supabase secrets set` for deployed functions.

## Related docs

- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — how the pieces fit and where the edge functions sit in the pipeline.
- [../docs/DATABASE_SCHEMA.md](../docs/DATABASE_SCHEMA.md) — tables, indexes, and the RLS policy matrix.
- [../docs/DECISIONS.md](../docs/DECISIONS.md) — ADR-004 covers embedding model pinning and re-embed migrations.
- [../docs/API_REFERENCE.md](../docs/API_REFERENCE.md) — the HTTP surface these functions expose.
- `../scripts/setup.sh`, `../scripts/dev.sh`, `../scripts/deploy.sh` — the repo-level wrappers around `supabase start`, `supabase db push`, and `supabase functions deploy`. Each carries its own `--help`.
- [Root README](../README.md) — monorepo layout and overall getting-started.
