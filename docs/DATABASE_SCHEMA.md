# Second Brain — Database Schema

The complete specification of the application Postgres schema — `second_brain`: eight tables, their columns, indexes, constraints, and row-level security policies.

Status: draft — **no migrations exist yet**. This document is the specification that `supabase/migrations/**` will be written from, and the frozen contract that `packages/shared` types and `packages/database` query modules must agree with. Where this document and a shared type disagree, that is a bug in one of them, to be fixed before either is implemented.

## Conventions

| Convention                 | Rule                                                                                                                           | Why                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Enum representation**    | `text` column plus a `check` constraint, never a Postgres `enum` type                                                          | Adding a value to a Postgres enum requires `alter type … add value`, which cannot run inside a transaction in older versions and cannot remove a value at all. A `check` is a normal migration, and it mirrors the TypeScript union one-for-one. |
| **Primary keys**           | `uuid`, `default gen_random_uuid()`                                                                                            | `activity_events.id` is the deliberate exception in provenance: the _client_ mints a UUIDv7 so the offline queue can index and dedupe before sync; the default exists only for server-generated rows.                                            |
| **Ownership**              | Every user-content table has `user_id uuid not null references auth.users (id) on delete cascade`                              | Makes "delete my account" one statement, and makes ownership a column rather than an inference.                                                                                                                                                  |
| **Timestamps**             | `timestamptz`, never `timestamp`                                                                                               | The system is multi-device across timezones; `dayKeyUtc` and `startOfLocalDay` in `@second-brain/shared` handle bucketing at the application boundary.                                                                                           |
| **Soft delete**            | `deleted_at timestamptz null` on `documents` only                                                                              | See [Soft delete vs supersede](#soft-delete-vs-supersede).                                                                                                                                                                                       |
| **Composite foreign keys** | Child tables reference `(parent_id, user_id)` against a unique `(id, user_id)` on the parent                                   | This is what makes ADR-003's claim true: a child row cannot be attached to another user's parent, enforced by the database rather than by application code.                                                                                      |
| **RLS**                    | Enabled **and forced** on every table; deny by default                                                                         | A table with no policy is inaccessible, not open. The failure direction matters.                                                                                                                                                                 |
| **Naming**                 | Tables and columns `snake_case` singular-plural per table; indexes `<table>_<columns>_<type>`; policies `<table>_<op>_<scope>` | Predictable names make a `grep` in migrations and in query modules useful.                                                                                                                                                                       |
| **Migrations**             | Append-only, `YYYYMMDDHHMMSS_snake_name.sql`                                                                                   | See [Migration conventions](#migration-conventions).                                                                                                                                                                                             |

### The eight tables

| Table             | Grain                                                  | ~Rows per user per year                | Retention                                            |
| ----------------- | ------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------- |
| `devices`         | One authorised device                                  | 2–6 total                              | Until revoked or account deleted                     |
| `activity_events` | One captured event                                     | 10⁴–10⁵                                | Band-based TTL — see [Retention](#retention-and-ttl) |
| `documents`       | One distinct piece of content, deduped by content hash | 10³–10⁴                                | Until deleted; extracted text is the expensive part  |
| `document_chunks` | One retrievable passage                                | 10⁴–10⁵                                | Cascade with the document                            |
| `memories`        | One durable statement                                  | 10²–10³, **including superseded rows** | Indefinite                                           |
| `topics`          | One user-scoped subject                                | 10²–10³                                | Until deleted                                        |
| `document_topics` | One assignment                                         | ≈1–3× documents                        | Cascade                                              |
| `memory_sources`  | One memory↔evidence link                               | ≈1–3× memories                         | Cascade                                              |

The row counts are order-of-magnitude expectations used to justify index choices (notably HNSW over IVFFlat and the absence of a need for partitioning), not measurements.

## Entity-relationship diagram

```
                        auth.users (Supabase-managed)
                             │ 1
                             │
        ┌────────────────────┼─────────────────────────┬──────────────────┐
        │                    │                         │                  │
        ▼ N                  ▼ N                       ▼ N                ▼ N
   ┌──────────┐       ┌──────────────┐          ┌──────────┐       ┌───────────┐
   │ devices  │       │activity_events│         │ documents│       │  topics   │
   ├──────────┤       ├──────────────┤          ├──────────┤       ├───────────┤
   │ id    PK │◄──────┤ device_id FK │          │ id    PK │       │ id     PK │
   │ user_id  │   N:1 │ user_id   FK │          │ user_id  │       │ user_id   │
   │ platform │       │ type   CHECK │          │ device_id│──┐    │ slug      │
   │ label    │       │ occurred_at  │          │ source   │  │    │ label     │
   │ ingest_  │       │ importance   │          │content_  │  │    │ parent_id │─┐
   │ secret_  │       │ server_      │          │  hash    │  │    │ category_ │ │
   │  hash    │       │  importance  │          │extracted_│  │    │  slug     │ │
   │ revoked_ │       │ dedupe_key   │          │  text    │  │    │ centroid  │ │
   │  at      │       │ payload jsonb│          │ topic_ids│  │    └───────────┘ │
   └──────────┘       │ metadata     │          │  uuid[]  │  │      ▲  ┆        │
                      └──────────────┘          │ fts TSV  │  │      │  ┆        │
                                                └────┬─────┘  │      │  ┆        │
                                                     │ 1      │      │  ┆        │
                                                     │        │      │  ┆        │
                             ┌───────────────────────┘        │      │  ┆        │
                             ▼ N                              │      │  ┆ self-  │
                    ┌──────────────────┐                      │      │  ┆ ref    │
                    │ document_chunks  │                      │      │  ┆        │
                    ├──────────────────┤                      │      │  ┆        │
                    │ id          PK   │                      │      │  ┆        │
                    │ document_id FK ──┼──(composite, with user_id)   │  ┆        │
                    │ user_id     FK   │                      │      │  ┆        │
                    │ ordinal          │                      │      │  ┆        │
                    │ text             │                      │      │  ┆        │
                    │ heading_path[]   │                      │      │  ┆        │
                    │ strategy  CHECK  │                      │      │  ┆        │
                    │ embedding v(1024)│                      │      │  ┆        │
                    │ fts TSV          │                      │      │  ┆        │
                    └───────┬──────────┘                      │      │  ┆        │
                            │                                 │      │  ┆        │
                            │ N                               │      │  ┆        │
                            │                                 │      │  ┆        │
   ┌────────────────────────┼─────────────────────────────────┘      │  ┆        │
   │                        │                                        │  ┆        │
   │  ┌─────────────────────▼──────┐                                │  ┆        │
   │  │      memory_sources        │                                │  ┆        │
   │  ├────────────────────────────┤                                │  ┆        │
   │  │ memory_id  PK, FK ─────────┼────┐                           │  ┆        │
   │  │ chunk_id   PK, FK          │    │                           │  ┆        │
   │  │ document_id   FK           │    │                           │  ┆        │
   │  │ user_id       FK           │    │                           │  ┆        │
   │  │ similarity                 │    │                           │  ┆        │
   │  │ excerpt (frozen span)      │    │                           │  ┆        │
   │  └────────────────────────────┘    │                           │  ┆        │
   │                                    │ N                         │  ┆        │
   │                                    ▼                           │  ┆        │
   │                          ┌──────────────────┐                  │  ┆        │
   │                          │    memories      │                  │  ┆        │
   │                          ├──────────────────┤                  │  ┆        │
   │                          │ id           PK  │                  │  ┆        │
   │                          │ user_id      FK  │                  │  ┆        │
   │                          │ kind      CHECK  │                  │  ┆        │
   │                          │ statement        │                  │  ┆        │
   │                          │ status    CHECK  │                  │  ┆        │
   │                          │ confidence       │                  │  ┆        │
   │                          │ source_chunk_ids │                  │  ┆        │
   │                          │ embedding v(1024)│                  │  ┆        │
   │                          │ valid_from/to    │                  │  ┆        │
   │                          │ superseded_by ───┼──┐ self-ref       │  ┆        │
   │                          └──────────────────┘  │               │  ┆        │
   │                                                └───────────────┘  ┆        │
   │                                                                   ┆        │
   │  ┌──────────────────────────────┐                                 ┆        │
   └─►│       document_topics        │◄────────────────────────────────┘        │
      ├──────────────────────────────┤                                          │
      │ document_id FK (composite)   │                                          │
      │ topic_id    FK ──────────────┼──────────────────────────────────────────┘
      │ user_id     FK               │
      │ confidence                   │
      │ is_primary  (≤1 per document)│
      └──────────────────────────────┘
```

Reading notes for the diagram:

- **`activity_events` is connected but not a parent.** Events _inform_ documents (they carry the content hash that seeds one, and they contribute importance signals), but the link is logical, not a foreign key, because N events map to 1 document and the aggregation happens in `services/processing`. Documents reference the device that first produced them (`device_id`, `on delete set null`), not the events.
- **`memory_sources` is keyed on `(memory_id, chunk_id)`.** A memory's evidence is always a span, and the composite key makes the link idempotent across a retried distillation. See the table below for what happens to a memory when its evidence is deleted.
- **`topics.parent_id` is a self-reference** for a topic hierarchy, and `topics.centroid` is a `vector(1024)` with **no** index (tens of rows, read in full — see [ADR-016](./DECISIONS.md#adr-016-hnsw-rather-than-ivfflat-for-vector-indexes)).
- **There is no `users` table in `second_brain`.** Users live in `auth.users`, managed by Supabase. Every `user_id` is a foreign key to it.
- **There is no join table between `activity_events` and `documents`.** Deliberate: the aggregation window and the matching rule are processing concerns that will change, and a persisted join would freeze a heuristic.

## Schema strategy: one shared application schema, not `public`

Every application object this document specifies — the eight tables, their indexes, constraints and checks, any RPC, and the `set_updated_at()` trigger helper — lives in a dedicated **`second_brain`** schema. None of our objects live in `public`.

**This is not multi-tenancy, and it changes nothing about the boundary.** It is still one shared schema in which every user's rows sit in the same tables, with RLS as the only thing separating them; a child row cannot be attached to another user's parent because of the composite foreign keys, not because of a namespace. The tenancy decision is [ADR-003](./DECISIONS.md#adr-003-one-shared-postgres-schema-with-rls-rather-than-schema-per-user) and remains Accepted. The decision recorded here is only about where our objects live and who can reach them — [ADR-020](./DECISIONS.md#adr-020-isolate-all-application-objects-in-a-dedicated-second_brain-schema-rather-than-public).

### Why a dedicated schema rather than `public`

| Reason                              | What it buys                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Explicit object ownership**       | `public` is Supabase's own namespace: it holds platform functions and helpers, and a product object sitting beside them is indistinguishable from a platform one. A `drop`, a `revoke`, or an audit query aimed at one can catch the other.                        |
| **An explicit exposure list**       | PostgREST serves a schema only when `supabase/config.toml` names it in `[api].schemas`. Its own schema makes "what is reachable over HTTP" a one-line list, rather than "everything in `public` except what someone remembered to revoke".                         |
| **One auditable privilege story**   | The `usage` grant, the table grants, and the `alter default privileges` line are written together in the migration that creates the schema, so "what can the anon key reach" is answered by reading one file rather than by reconstructing platform defaults.      |
| **A mis-bound client fails loudly** | Clients bind the schema at construction (`db: { schema: 'second_brain' }`). A client that forgets resolves against `public`, which holds none of our tables, and gets "relation … does not exist" instead of silently reading a table that happens to exist there. |

### PostgREST serves only the schemas it is told about

`supabase/config.toml` carries `[api].schemas = ["public", "graphql_public", "second_brain"]`, and `extra_search_path = ["public", "extensions", "second_brain"]`. **PostgREST does not serve a schema that is not on that list.** Dropping `second_brain` from it fails every request against the schema with `PGRST106` _before_ any policy is evaluated, so a perfectly correct RLS design is no defence against that particular mistake — and the error names the incoming request rather than this configuration file.

`public` stays on the list, and stays first. Two reasons, both deliberate: Supabase's own helpers (Auth, Storage, the storage extensions) assume it, and it is the default schema for a request that sends no `Accept-Profile` header — which is what turns a mis-bound client into a loud failure instead of a quiet read of the wrong schema.

### Three surfaces that must move together

| Surface                         | Where                                     | What breaks when it is stale                                                                                         |
| ------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_SCHEMA`                | `packages/database/src/client.ts`         | Every constructor binds it as `db: { schema: … }`, so a stale value silently points every query at the wrong schema. |
| `[api].schemas`                 | `supabase/config.toml`                    | PostgREST does not serve the schema at all — every request is `PGRST106`, policies notwithstanding.                  |
| The top-level key of `Database` | `packages/database/src/types/database.ts` | Types compile and describe a schema no client ever touches: a `from('documents')` type-checks and returns nothing.   |

Renaming the schema is therefore a three-surface change plus a `pnpm db:types` re-run, not a search-and-replace inside `supabase/migrations/`.

### Privileges: RLS policies are filters, not grants

A policy says which rows a role may see **if it can see the table at all**. The gateway to the table is a `usage` privilege on the schema plus a table privilege on the relation, and **Supabase's default privileges cover `public` only** — they are configured for that schema. A custom schema therefore starts out unreachable, and the symptom of forgetting the grants is not a policy error: it is `permission denied for schema second_brain`, or an empty result set that looks like a missing policy and is not.

The migration that creates the schema therefore carries the grants, and it is the file a reviewer should be able to point at when asked "what can the anon key reach":

```sql
create schema if not exists second_brain;

grant usage on schema second_brain to authenticated, service_role;

-- The capability. `authenticated` is granted all four operations, and that is
-- less broad than it looks: with RLS enabled, a table with no INSERT policy
-- still rejects inserts. The privilege is the capability; the policy narrows it.
grant select, insert, update, delete on all tables in schema second_brain to authenticated;

-- The line that keeps a *future* table from being invisible. The grant above
-- applies only to the tables that exist when it runs; a table created by a later
-- migration inherits nothing, and the symptom is a feature that returns zero rows
-- while every policy and index looks correct.
alter default privileges in schema second_brain
  grant select, insert, update, delete on tables to authenticated;
```

Three details that decide whether the above actually works:

- **`alter default privileges` applies to objects created by the role that runs it.** Migrations run as `postgres`, which is also the role that creates the tables, so the statement must be executed by that same role for the later tables to inherit anything (a different creating role needs its own `for role …` clause).
- **`service_role` bypasses RLS by role attribute, not by table ownership.** Its schema-level `usage` grant (shown above) is a precondition, not the whole story: it needs table privileges as well, which each table migration grants alongside the `authenticated` privileges. What it does _not_ need is a policy — bypassing RLS means the policies never apply to it — and its grants exist so that privileged server code can reach the tables at all, not to widen what any other role can do.
- **Policies do not bind the table's owner, which is `postgres`.** Migrations and `supabase/seed.sql` both connect as `postgres`, so every table gets `force row level security` as well as `enable` — see [Migration conventions](#migration-conventions); the wider model is in [ARCHITECTURE.md](./ARCHITECTURE.md#security-model). Plain `enable` leaves a table owned by `postgres` readable with its policies bypassed by anything connecting as the owner.

## `devices`

One row per authorised device. The device is the unit of ingest authentication and the second half of the idempotency key.

| Column                     | Type          | Null | Default             | Notes                                                                                                                                                                                                                                         |
| -------------------------- | ------------- | ---- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid`        | no   | `gen_random_uuid()` | Server-issued at registration. Client-supplied ids are rejected.                                                                                                                                                                              |
| `user_id`                  | `uuid`        | no   | —                   | `references auth.users (id) on delete cascade`.                                                                                                                                                                                               |
| `platform`                 | `text`        | no   | —                   | `check (platform in ('chrome-extension','android','web','api'))`, mirroring `DevicePlatform`. `web` and `api` are for first-party web sessions and scripted access.                                                                           |
| `label`                    | `text`        | no   | `''`                | User-editable display name ("Work laptop").                                                                                                                                                                                                   |
| `app_version`              | `text`        | yes  | —                   | `Device.appVersion`. Telemetry for schema-skew debugging.                                                                                                                                                                                     |
| `os_version`               | `text`        | yes  | —                   | `Device.osVersion`.                                                                                                                                                                                                                           |
| `ingest_secret_hash`       | `text`        | yes  | —                   | Hash of the per-device ingest secret (ADR-018). **Not part of the `Device` type** — deliberately absent from every read model. Nullable so a device can exist before its secret is issued, and so a revoked device can have its hash cleared. |
| `ingest_secret_rotated_at` | `timestamptz` | yes  | —                   | Set on issue and on rotate. Makes "this secret is 14 months old" a query.                                                                                                                                                                     |
| `last_seen_at`             | `timestamptz` | no   | `now()`             | Updated on each successful ingest. Drives the "device has not synced" warning.                                                                                                                                                                |
| `created_at`               | `timestamptz` | no   | `now()`             | `Device.createdAt`.                                                                                                                                                                                                                           |
| `revoked_at`               | `timestamptz` | yes  | —                   | `Device.revokedAt`. Non-null rejects ingest with `403 device_revoked`.                                                                                                                                                                        |

### Indexes

| Index                            | Definition                   | Purpose                                                                                  |
| -------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `devices_pkey`                   | `(id)`                       | Primary key.                                                                             |
| `devices_user_id_created_at_idx` | `(user_id, created_at desc)` | The settings screen's device list.                                                       |
| `devices_id_user_id_key`         | `unique (id, user_id)`       | Required as the target of composite foreign keys from `activity_events` and `documents`. |

There is deliberately **no index on `ingest_secret_hash`**. Ingest authentication resolves `device_id` from the request body first (it must, to look up the hash at all), so the lookup is by primary key; a hash index would encourage an unindexed full-table scan in the wrong direction.

### Constraints

| Name                                | Definition                                         | Why                                                                                                        |
| ----------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `devices_platform_check`            | `platform in (…)`                                  | Enum-as-check, per the conventions.                                                                        |
| `devices_label_len_check`           | `char_length(label) <= 64`                         | Keeps a user-supplied string out of unbounded storage.                                                     |
| `devices_revoked_consistency_check` | `revoked_at is null or ingest_secret_hash is null` | A revoked device must not retain a usable secret hash. Enforces at the schema level what revocation means. |

### RLS policies

| Policy               | Operation | Roles           | Predicate                                                                             |
| -------------------- | --------- | --------------- | ------------------------------------------------------------------------------------- |
| `devices_select_own` | `SELECT`  | `authenticated` | `using (user_id = auth.uid())`                                                        |
| `devices_update_own` | `UPDATE`  | `authenticated` | `using (user_id = auth.uid()) with check (user_id = auth.uid())`                      |
| _(none)_             | `INSERT`  | —               | Registration is server-side (ADR-018). A client cannot mint its own device or secret. |
| _(none)_             | `DELETE`  | —               | Devices disappear through `auth.users` cascade, so a delete cannot orphan activity.   |

**Trigger `devices_guard_immutable_columns`** (before update): rejects changes to `user_id`, `ingest_secret_hash`, `ingest_secret_rotated_at`, `created_at`, and `revoked_at` unless the statement runs as the service role. RLS cannot restrict columns, so the policy above would otherwise let a user set their own `ingest_secret_hash` to a value they choose — which would not grant them anything they do not already have, but would break the invariant that secrets are server-issued. The trigger is what makes `devices_update_own` safe to grant.

## `activity_events`

One row per captured event, across all nine event types. The highest-write table in the schema and the one with a TTL.

| Column               | Type          | Null | Default             | Notes                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------- | ---- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`        | no   | `gen_random_uuid()` | **Client-minted UUIDv7** in practice, so the offline queue can index it before sync. The default covers server-generated rows.                                                                                                                                                                                                |
| `user_id`            | `uuid`        | no   | —                   | `references auth.users (id) on delete cascade`. Resolved server-side from the JWT, never from the body.                                                                                                                                                                                                                       |
| `device_id`          | `uuid`        | no   | —                   | Composite FK to `devices (id, user_id)`. Non-null: an event with no device has no provenance and is not representable.                                                                                                                                                                                                        |
| `type`               | `text`        | no   | —                   | `check (type in ('page_view','page_read','selection','copy','youtube_watch','app_session','search','bookmark','download'))`, mirroring `ACTIVITY_EVENT_TYPES`.                                                                                                                                                                |
| `occurred_at`        | `timestamptz` | no   | —                   | Client-supplied. The ordering key for everything. Clamped at ingest if implausible, with the clamp recorded in `metadata`.                                                                                                                                                                                                    |
| `received_at`        | `timestamptz` | no   | `now()`             | Server-stamped at ingest (`ActivityEventBase.receivedAt`). Never used for ordering.                                                                                                                                                                                                                                           |
| `importance`         | `real`        | no   | `0`                 | The **client pre-score**, immutable once written (ADR-009).                                                                                                                                                                                                                                                                   |
| `importance_band`    | `text`        | no   | `'normal'`          | `check (importance_band in ('noise','low','normal','high','critical'))`, mirroring `ImportanceBand`. Written together with whichever score produced it, using the lower-bound thresholds from `IMPORTANCE_BAND_THRESHOLDS`. Exists so the retention sweep is an indexed predicate rather than an arithmetic range on a float. |
| `server_importance`  | `real`        | yes  | —                   | The re-score. Nullable until processing runs.                                                                                                                                                                                                                                                                                 |
| `importance_version` | `text`        | yes  | —                   | `ImportanceScore.version` for whichever score is current. The `where` clause of the re-scoring job.                                                                                                                                                                                                                           |
| `dedupe_key`         | `text`        | no   | —                   | `ActivityEventBase.dedupeKey`. Half of the idempotency constraint (ADR-010).                                                                                                                                                                                                                                                  |
| `url`                | `text`        | yes  | —                   | Present for browser-shaped events; null for `app_session`.                                                                                                                                                                                                                                                                    |
| `title`              | `text`        | yes  | —                   | Page or video title.                                                                                                                                                                                                                                                                                                          |
| `domain`             | `text`        | yes  | —                   | Promoted from `page_view` / `page_read` because per-site aggregation is a primary dashboard query. Required by constraint for those two types.                                                                                                                                                                                |
| `duration_seconds`   | `integer`     | yes  | —                   | Normalised duration across `page_view` (`durationMs / 1000`), `app_session`, and `youtube_watch` (`watchedSeconds`), so "time spent" is one column instead of three payload keys. Required by constraint for those three types.                                                                                               |
| `payload`            | `jsonb`       | no   | `'{}'::jsonb`       | The variant-specific fields, keyed per type — see the map below.                                                                                                                                                                                                                                                              |
| `metadata`           | `jsonb`       | no   | `'{}'::jsonb`       | `ActivityEventBase.metadata`, plus the ingest-derived annotations described below. Free-form and cross-type.                                                                                                                                                                                                                  |

There is deliberately **no `tsvector` and no GIN index on this table.** It is the highest-write table in the schema; an `fts` column would add index maintenance to every ingest for a capability no read path needs. Events are read by time, device, type, domain, and band — never by lexical relevance. Selected-text and query-string search, if it is ever wanted, is a targeted expression index on `payload->>'text'`, added when the query exists rather than speculatively.

### Where each type's fields live

Promoted columns are listed above. Everything else is in `payload`, and this map is the contract that `packages/database` implements when it deserialises a row into the `ActivityEvent` union:

| `type`          | Promoted                                     | `payload` keys                                                                   |
| --------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| `page_view`     | `url`, `title`, `domain`, `duration_seconds` | `scrollDepthPct`                                                                 |
| `page_read`     | `url`, `title`, `domain`                     | `wordCount`, `readingTimeSeconds`, `contentHash`                                 |
| `selection`     | `url`, `title`                               | `text`, `contextBefore`, `contextAfter`, `selectionLength`                       |
| `copy`          | `url`, `title`                               | `text`, `selectionLength`                                                        |
| `youtube_watch` | `url`, `title`, `duration_seconds`           | `videoId`, `channelName`, `durationSeconds`, `watchedPct`, `transcriptAvailable` |
| `app_session`   | `duration_seconds`                           | `packageName`, `appLabel`, `startAt`, `endAt`, `isForeground`                    |
| `search`        | `url`                                        | `query`, `engine`                                                                |
| `bookmark`      | `url`, `title`                               | `folder`                                                                         |
| `download`      | `url`, `title`                               | `filename`, `mimeType`, `bytes`                                                  |

Ingest-derived annotations written into `metadata` (never into `payload`, which belongs to the event type):

| Key                 | Meaning                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `syncLagMs`         | `received_at − clientSentAt`, derived from `ActivityBatch.clientSentAt`.                                     |
| `occurredAtClamped` | Set when a client timestamp was outside the accepted window and was clamped.                                 |
| `confidenceCheck`   | Set when a claimed signal (e.g. `durationMs`) diverges materially from the server's recomputation (ADR-009). |

### Indexes

| Index                                      | Definition                                                                  | Purpose                                                                                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity_events_pkey`                     | `(id)`                                                                      | Primary key.                                                                                                                                                                                                                              |
| `activity_events_device_dedupe_key`        | `unique (device_id, dedupe_key)`                                            | **The idempotency constraint.** `insert … on conflict do nothing` makes every retry safe (ADR-010).                                                                                                                                       |
| `activity_events_user_occurred_id_idx`     | `(user_id, occurred_at desc, id desc)`                                      | The keyset pagination index for the activity dashboard (ADR-017), and the ordering index for the temporal query intent.                                                                                                                   |
| `activity_events_user_type_occurred_idx`   | `(user_id, type, occurred_at desc)`                                         | Per-type filtering in the dashboard and the `activity` intent's aggregates.                                                                                                                                                               |
| `activity_events_user_domain_occurred_idx` | `(user_id, domain, occurred_at desc)` where `domain is not null`            | Per-site time aggregation. Partial, because `app_session` rows have no domain.                                                                                                                                                            |
| `activity_events_retention_idx`            | `(importance_band, occurred_at)` where `importance_band in ('noise','low')` | The retention sweep's driving index — see [Retention](#retention-and-ttl).                                                                                                                                                                |
| `activity_events_user_device_occurred_idx` | `(user_id, device_id, occurred_at desc)`                                    | The per-device filter and the sync-cursor read.                                                                                                                                                                                           |
| `activity_events_payload_gin_idx`          | `gin (payload jsonb_path_ops)`                                              | **Deferred to phase 6.** Added only when a real query filters on a payload key (`packageName` for per-app analytics). `jsonb_path_ops` over the default `jsonb_ops` because it is smaller and supports containment, which is all we need. |

### Constraints

| Name                                      | Definition                                                                                                                                                    | Why                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity_events_type_check`              | `type in (…)`                                                                                                                                                 | Enum-as-check.                                                                                                                                                                                            |
| `activity_events_importance_check`        | `importance >= 0 and importance <= 1`                                                                                                                         | The score is a normalised value; a stray 87 is a bug, not data.                                                                                                                                           |
| `activity_events_server_importance_check` | `server_importance is null or (server_importance >= 0 and server_importance <= 1)`                                                                            | Same, nullable for "not yet re-scored".                                                                                                                                                                   |
| `activity_events_band_check`              | `importance_band in (…)`                                                                                                                                      | Enum-as-check.                                                                                                                                                                                            |
| `activity_events_promoted_fields_check`   | `(type not in ('page_view','page_read') or domain is not null) and (type not in ('page_view','app_session','youtube_watch') or duration_seconds is not null)` | Guarantees the promoted columns are populated exactly where the read paths assume they are. The _rest_ of each event's shape is enforced by zod at the ingestion boundary, not by the database (ADR-015). |
| `activity_events_dedupe_key_len_check`    | `char_length(dedupe_key) between 8 and 128`                                                                                                                   | A dedupe key that is empty or accidentally a whole document would silently collapse or defeat the unique constraint.                                                                                      |

### RLS policies

| Policy                       | Operation | Roles           | Predicate                                                                                                                                                        |
| ---------------------------- | --------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity_events_select_own` | `SELECT`  | `authenticated` | `using (user_id = auth.uid())`                                                                                                                                   |
| `activity_events_delete_own` | `DELETE`  | `authenticated` | `using (user_id = auth.uid())` — user-initiated purge of a range.                                                                                                |
| _(none)_                     | `INSERT`  | —               | **Ingestion is the only write path** (ADR-018). No insert policy means a client cannot write activity directly, or bypass validation or the exclusion invariant. |
| _(none)_                     | `UPDATE`  | —               | Re-scoring writes `server_importance` under the service role. A client cannot raise its own score (ADR-009).                                                     |

## `documents`

One row per distinct piece of content the user has encountered, deduplicated by content hash. The grain is "a thing that was read", not "a URL" and not "a page view".

| Column                      | Type          | Null | Default             | Notes                                                                                                                                                                                                                                                                  |
| --------------------------- | ------------- | ---- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `uuid`        | no   | `gen_random_uuid()` |                                                                                                                                                                                                                                                                        |
| `user_id`                   | `uuid`        | no   | —                   | `references auth.users (id) on delete cascade`.                                                                                                                                                                                                                        |
| `device_id`                 | `uuid`        | yes  | —                   | Composite FK to `devices (id, user_id)`, `on delete set null`. The device that first produced the content. Nullable so that deleting a device does not delete the user's reading history.                                                                              |
| `source`                    | `text`        | no   | —                   | `check (source in ('web','youtube','pdf','gdoc','newsletter','manual'))`, mirroring `DocumentSource`.                                                                                                                                                                  |
| `url`                       | `text`        | yes  | —                   | As captured. Null for `manual` documents with no origin.                                                                                                                                                                                                               |
| `canonical_url`             | `text`        | yes  | —                   | `canonicalizeUrl` output, used for cross-device dedup (the same article at `?utm_source=…` is one document).                                                                                                                                                           |
| `title`                     | `text`        | no   | `''`                | Never null, so excerpting and citation never handle a missing title.                                                                                                                                                                                                   |
| `author`                    | `text`        | yes  | —                   |                                                                                                                                                                                                                                                                        |
| `site_name`                 | `text`        | yes  | —                   |                                                                                                                                                                                                                                                                        |
| `published_at`              | `timestamptz` | yes  | —                   | From metadata when available. Distinct from `captured_at`, and both are used by temporal queries.                                                                                                                                                                      |
| `captured_at`               | `timestamptz` | no   | `now()`             | When the user encountered it. The temporal ordering key for documents.                                                                                                                                                                                                 |
| `word_count`                | `integer`     | no   | `0`                 | `wordCount` from `@second-brain/shared`.                                                                                                                                                                                                                               |
| `reading_time_seconds`      | `integer`     | no   | `0`                 | `readingTimeSeconds` from `@second-brain/shared`. Observed for a read, estimated for a manual document.                                                                                                                                                                |
| `content_hash`              | `text`        | no   | —                   | `contentHash` over the extracted text. The dedup key together with `user_id`.                                                                                                                                                                                          |
| `extracted_text`            | `text`        | yes  | —                   | Readable plain text. Nullable because extraction can fail or not have run — see `extraction_status`.                                                                                                                                                                   |
| `summary`                   | `text`        | yes  | —                   | `Document.summary`: a machine-generated 1–3 sentence abstract that feeds classification and the dashboard. **Not embedded and not retrievable** (ADR-007) — retrieval reads chunks and memories, never this.                                                           |
| `language`                  | `text`        | yes  | —                   | BCP-47-ish primary subtag or full tag. Used to select the `tsvector` configuration.                                                                                                                                                                                    |
| `importance`                | `real`        | no   | `0`                 | `Document.importance`, derived from the server-scored contributing events. Gates distillation: only a document at or above `DISTILLATION_MIN_BAND` (`normal`) is distilled, so anything below it is captured, embedded, and searchable but never becomes a memory.     |
| `topic_ids`                 | `uuid[]`      | no   | `'{}'`              | **Denormalised**, maintained by trigger from `document_topics`. Maps `Document.topicIds` and lets a metadata filter be an array containment check instead of a join. `document_topics` remains the source of truth.                                                    |
| `extraction_status`         | `text`        | no   | `'pending'`         | `check (extraction_status in ('pending','succeeded','failed','skipped'))`, mirroring `ExtractionStatus`. Makes failure a first-class state rather than a null that looks like "not yet" (see [Failure modes](./ARCHITECTURE.md#failure-modes-and-degraded-behaviour)). |
| `extraction_failure_reason` | `text`        | yes  | —                   | Maps to `ExtractionResult.failureReason` (`paywall`, `cookie_wall`, `js_required`, `transcript_unavailable`, …). Surfaced in the dashboard.                                                                                                                            |
| `extraction_version`        | `text`        | yes  | —                   | Which extractor produced `extracted_text`. The `where` clause of an extraction backfill.                                                                                                                                                                               |
| `fts`                       | `tsvector`    | no   | _generated_         | `generated always as (to_tsvector('english', coalesce(title,'') \|\| ' ' \|\| coalesce(extracted_text,''))) stored` — see [The two search surfaces](#the-two-search-surfaces).                                                                                         |
| `deleted_at`                | `timestamptz` | yes  | —                   | Soft delete. See [Soft delete vs supersede](#soft-delete-vs-supersede).                                                                                                                                                                                                |
| `created_at`                | `timestamptz` | no   | `now()`             | Row creation, distinct from `captured_at` (a document may be created when processing catches up).                                                                                                                                                                      |
| `updated_at`                | `timestamptz` | no   | `now()`             | Main trigger maintained.                                                                                                                                                                                                                                               |

### Indexes

| Index                                | Definition                                                     | Purpose                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `documents_pkey`                     | `(id)`                                                         | Primary key.                                                                                                                 |
| `documents_id_user_id_key`           | `unique (id, user_id)`                                         | Composite FK target for `document_chunks`, `document_topics`, `memory_sources`.                                              |
| `documents_user_content_hash_key`    | `unique (user_id, content_hash)`                               | **The document dedup constraint.** The same article read on three devices is one document.                                   |
| `documents_user_captured_id_idx`     | `(user_id, captured_at desc, id desc)`                         | Keyset pagination for the document list (ADR-017).                                                                           |
| `documents_user_source_captured_idx` | `(user_id, source, captured_at desc)`                          | The `sourceTypes` metadata filter.                                                                                           |
| `documents_user_importance_idx`      | `(user_id, importance desc, captured_at desc)`                 | The dashboard's "most important recent" view.                                                                                |
| `documents_fts_gin_idx`              | `gin (fts)`                                                    | The full-text leg — see [The two search surfaces](#the-two-search-surfaces).                                                 |
| `documents_user_topic_ids_gin_idx`   | `gin (topic_ids)`                                              | The `topicIds` metadata filter via `topic_ids && $1`.                                                                        |
| `documents_pending_extraction_idx`   | `(user_id, captured_at)` where `extraction_status = 'pending'` | The extraction backlog query. Partial, because the backlog is small and the table is not.                                    |
| `documents_active_idx`               | `(user_id, captured_at desc)` where `deleted_at is null`       | Every user-facing read filters on `deleted_at is null`; a partial index makes that the cheap path rather than a post-filter. |

**There is no `embedding` column on this table.** Retrieval granularity is the chunk, not the document, and a document-level vector would duplicate information already present in its chunks while creating a third thing to keep in sync on a re-embed (ADR-004). `documents` participates in retrieval through its chunks and through `fts`.

### Constraints

| Name                                     | Definition                                                         | Why                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents_source_check`                 | `source in (…)`                                                    | Enum-as-check.                                                                                                                                                 |
| `documents_extraction_status_check`      | `extraction_status in (…)`                                         | Enum-as-check.                                                                                                                                                 |
| `documents_importance_check`             | `importance >= 0 and importance <= 1`                              | Normalised score.                                                                                                                                              |
| `documents_extraction_consistency_check` | `(extraction_status = 'succeeded') = (extracted_text is not null)` | A document cannot claim success with no text, or hold text while claiming it never extracted. This is the constraint that makes the failure state trustworthy. |
| `documents_word_count_check`             | `word_count >= 0 and reading_time_seconds >= 0`                    |                                                                                                                                                                |
| `documents_deleted_consistency_check`    | `deleted_at is null or extraction_status <> 'pending'`             | A deleted document must not sit in the extraction backlog.                                                                                                     |

### RLS policies

| Policy                 | Operation | Roles           | Predicate                                                                                                                       |
| ---------------------- | --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `documents_select_own` | `SELECT`  | `authenticated` | `using (user_id = auth.uid())`                                                                                                  |
| `documents_update_own` | `UPDATE`  | `authenticated` | `using (user_id = auth.uid()) with check (user_id = auth.uid())` — for re-titling, editing `summary`, and setting `deleted_at`. |
| `documents_delete_own` | `DELETE`  | `authenticated` | `using (user_id = auth.uid())` — the hard delete behind "forget this". Cascades to chunks, topics links, and `memory_sources`.  |
| _(none)_               | `INSERT`  | —               | Documents are created by `services/processing`.                                                                                 |

**Trigger `documents_guard_immutable_columns`** (before update): rejects changes to `user_id`, `content_hash`, `extracted_text`, `word_count`, `reading_time_seconds`, `source`, `captured_at`, and `extraction_status` unless running as the service role. The mutable surface a user owns is `title`, `summary`, and `deleted_at`. Without this trigger, `documents_update_own` would let a user rewrite `extracted_text`, which would silently orphan every chunk derived from it.

## `document_chunks`

One retrievable passage. This is the vector-search surface and, with `memories`, one of the two things retrieval actually reads.

| Column            | Type           | Null | Default             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | -------------- | ---- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `uuid`         | no   | `gen_random_uuid()` |                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `document_id`     | `uuid`         | no   | —                   | Composite FK to `documents (id, user_id)`, `on delete cascade`.                                                                                                                                                                                                                                                                                                                                                                     |
| `user_id`         | `uuid`         | no   | —                   | Denormalised from the document so that RLS on this table is a single-column predicate and the HNSW index can be scoped per user.                                                                                                                                                                                                                                                                                                    |
| `ordinal`         | `integer`      | no   | —                   | Position within the document, from 0. Determines citation order and neighbour context.                                                                                                                                                                                                                                                                                                                                              |
| `text`            | `text`         | no   | —                   | The chunk's text. Citations are drawn from here.                                                                                                                                                                                                                                                                                                                                                                                    |
| `token_count`     | `integer`      | no   | `0`                 | `estimateTokens` from `@second-brain/shared`. Used to pack the context window.                                                                                                                                                                                                                                                                                                                                                      |
| `heading_path`    | `text[]`       | no   | `'{}'`              | The heading ancestry at the chunk's start (`{'Cost tradeoffs','Q3'}`). **Prepended to `text` before embedding**, so a chunk like "see the table above" remains meaningful in isolation; it is also what makes a citation locate itself, and it is free with recursive chunking (ADR-013). Because it is part of the embedding input, a change to how `heading_path` is built changes the vector and therefore counts as a re-embed. |
| `strategy`        | `text`         | no   | —                   | `check (strategy in ('recursive','semantic','fixed'))`. In v1 this is always `'recursive'`; a row claiming `'semantic'` before phase 7 is a bug (ADR-013).                                                                                                                                                                                                                                                                          |
| `content_hash`    | `text`         | no   | —                   | Hash over the chunk text plus strategy. Makes a re-chunk incremental: unchanged chunks are not rewritten or re-embedded.                                                                                                                                                                                                                                                                                                            |
| `embedding`       | `vector(1024)` | yes  | —                   | Nullable, because a chunk is valid before its embedding exists and because a re-embed migration writes a new column before the old one is dropped (ADR-004).                                                                                                                                                                                                                                                                        |
| `embedding_model` | `text`         | yes  | —                   | Which model produced `embedding`. **A vector whose stamp is missing or mismatched is treated as absent by retrieval**, never as approximately correct.                                                                                                                                                                                                                                                                              |
| `fts`             | `tsvector`     | no   | _generated_         | `generated always as (to_tsvector('english', text)) stored`                                                                                                                                                                                                                                                                                                                                                                         |
| `created_at`      | `timestamptz`  | no   | `now()`             |                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Indexes

| Index                                  | Definition                                               | Purpose                                                                                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_chunks_pkey`                 | `(id)`                                                   | Primary key.                                                                                                                                                                                                           |
| `document_chunks_document_ordinal_key` | `unique (document_id, ordinal)`                          | Makes chunking idempotent: a re-chunk upserts by position rather than duplicating.                                                                                                                                     |
| `document_chunks_embedding_hnsw_idx`   | `using hnsw (embedding vector_cosine_ops)`               | **The vector search surface.** HNSW rather than IVFFlat — see [ADR-016](./DECISIONS.md#adr-016-hnsw-rather-than-ivfflat-for-vector-indexes) and [Vector dimensions](#vector-dimensions-and-the-cost-of-changing-them). |
| `document_chunks_fts_gin_idx`          | `gin (fts)`                                              | **The full-text search surface.**                                                                                                                                                                                      |
| `document_chunks_user_document_idx`    | `(user_id, document_id, ordinal)`                        | Citation resolution and neighbour context lookups.                                                                                                                                                                     |
| `document_chunks_reembed_idx`          | `(user_id, document_id)` where `embedding_model is null` | The re-embed backlog query. Partial: the backlog is a small fraction of the table.                                                                                                                                     |

The HNSW index is **not** partial on `user_id`. A per-user partial index would require one index per user and would not be creatable in advance; per-user scoping is applied as a filter in the query, and Postgres combines it with the HNSW scan. This is a known tradeoff of a shared-table multi-tenant design (ADR-003): the index is global, the filter is a predicate, and the recall/latency effect of filtering after an ANN scan is one of the things to measure in phase 4.

### Constraints

| Name                                                | Definition                                        | Why                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_chunks_strategy_check`                    | `strategy in ('recursive','semantic','fixed')`    | Enum-as-check.                                                                                                                               |
| `document_chunks_ordinal_check`                     | `ordinal >= 0`                                    |                                                                                                                                              |
| `document_chunks_token_count_check`                 | `token_count >= 0`                                |                                                                                                                                              |
| `document_chunks_embedding_model_consistency_check` | `(embedding is null) = (embedding_model is null)` | A vector with no stamp is unsearchable-by-policy and a stamp with no vector is a lie. Both are prevented here rather than by a code comment. |

### RLS policies

| Policy                       | Operation | Roles           | Predicate                                                                       |
| ---------------------------- | --------- | --------------- | ------------------------------------------------------------------------------- |
| `document_chunks_select_own` | `SELECT`  | `authenticated` | `using (user_id = auth.uid())`                                                  |
| `document_chunks_delete_own` | `DELETE`  | `authenticated` | `using (user_id = auth.uid())` — normally reached through the document cascade. |
| _(none)_                     | `INSERT`  | —               | Written by `services/processing`.                                               |
| _(none)_                     | `UPDATE`  | —               | Embeddings and re-chunks are service-role operations.                           |

## `memories`

One durable statement per row. The retrieval surface that answers questions rather than returning documents, and the table where the temporal model lives.

| Column                        | Type           | Null | Default             | Notes                                                                                                                                                                                                               |
| ----------------------------- | -------------- | ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                          | `uuid`         | no   | `gen_random_uuid()` |                                                                                                                                                                                                                     |
| `user_id`                     | `uuid`         | no   | —                   | `references auth.users (id) on delete cascade`.                                                                                                                                                                     |
| `kind`                        | `text`         | no   | —                   | `check (kind in ('fact','preference','decision','project','entity','insight','task','reference'))`, mirroring `MemoryKind`.                                                                                         |
| `statement`                   | `text`         | no   | —                   | One self-contained proposition. Immutable once `active`, except for a user correction inside the grace window (ADR-008).                                                                                            |
| `status`                      | `text`         | no   | `'candidate'`       | `check (status in ('candidate','active','superseded','archived','rejected'))`, mirroring `MemoryStatus`.                                                                                                            |
| `confidence`                  | `real`         | no   | `0.5`               | The extractor's certainty. **Distinct from `importance`** and never collapsed with it: a confident statement about something trivial and a speculative statement about something crucial are different things.      |
| `importance`                  | `real`         | no   | `0`                 | How much this should affect retrieval ranking.                                                                                                                                                                      |
| `topic_ids`                   | `uuid[]`       | no   | `'{}'`              | Denormalised from topic assignment for filter-by-topic without a join.                                                                                                                                              |
| `source_chunk_ids`            | `uuid[]`       | no   | `'{}'`              | `Memory.sourceChunkIds`. Denormalised for cheap display and because the arrays survive a cascade that removes `memory_sources`; that table is the authoritative link, carrying `similarity` and a frozen `excerpt`. |
| `source_document_ids`         | `uuid[]`       | no   | `'{}'`              | `Memory.sourceDocumentIds`, same reasoning.                                                                                                                                                                         |
| `embedding`                   | `vector(1024)` | yes  | —                   | Nullable for the same reasons as chunks.                                                                                                                                                                            |
| `embedding_model`             | `text`         | yes  | —                   | Same absence-is-not-approximation rule.                                                                                                                                                                             |
| `valid_from`                  | `timestamptz`  | no   | `now()`             | When the statement became true, as distinct from when it was extracted.                                                                                                                                             |
| `valid_to`                    | `timestamptz`  | yes  | —                   | `null` means "still believed".                                                                                                                                                                                      |
| `superseded_by`               | `uuid`         | yes  | —                   | Self-reference to the replacement memory.                                                                                                                                                                           |
| `access_count`                | `integer`      | no   | `0`                 | Incremented when the memory is actually used in an answer.                                                                                                                                                          |
| `last_accessed_at`            | `timestamptz`  | yes  | —                   | The only feedback signal about retrieval usefulness (see [Observability](./ARCHITECTURE.md#observability)).                                                                                                         |
| `distillation_prompt_version` | `text`         | yes  | —                   | Provenance: which prompt produced this statement. The `where` clause of a targeted re-distill.                                                                                                                      |
| `distillation_model`          | `text`         | yes  | —                   | Which LLM produced it.                                                                                                                                                                                              |
| `fts`                         | `tsvector`     | no   | _generated_         | `generated always as (to_tsvector('english', statement)) stored`                                                                                                                                                    |
| `created_at`                  | `timestamptz`  | no   | `now()`             |                                                                                                                                                                                                                     |
| `updated_at`                  | `timestamptz`  | no   | `now()`             | Maintained by trigger.                                                                                                                                                                                              |

There is deliberately **no `deleted_at`** on this table. Deletion is a real delete, not a status, because a status that retains the content is not a deletion ([Soft delete vs supersede](#soft-delete-vs-supersede)).

### Indexes

| Index                              | Definition                                                           | Purpose                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memories_pkey`                    | `(id)`                                                               | Primary key.                                                                                                                                                                                                                       |
| `memories_id_user_id_key`          | `unique (id, user_id)`                                               | Composite FK target for `memory_sources`.                                                                                                                                                                                          |
| `memories_embedding_hnsw_idx`      | `using hnsw (embedding vector_cosine_ops)` where `status = 'active'` | **The memory vector surface, partial on `status = 'active'`.** This is the index that makes forgetting `status = 'active'` an _unindexed_ query rather than a silently incorrect one: the fast path is the correct path (ADR-008). |
| `memories_fts_gin_idx`             | `gin (fts)` where `status = 'active'`                                | Full-text over statements, same partiality and the same reason.                                                                                                                                                                    |
| `memories_user_status_created_idx` | `(user_id, status, created_at desc)`                                 | The review queue (`status = 'candidate'`) and the memory list.                                                                                                                                                                     |
| `memories_user_kind_status_idx`    | `(user_id, kind, status)`                                            | The `kinds` metadata filter.                                                                                                                                                                                                       |
| `memories_user_valid_from_idx`     | `(user_id, valid_from desc, id desc)`                                | Temporal queries including closed rows — the _non_-partial index, which is what makes historical queries possible at all.                                                                                                          |
| `memories_superseded_by_idx`       | `(superseded_by)` where `superseded_by is not null`                  | Supersede-chain traversal.                                                                                                                                                                                                         |
| `memories_user_topic_ids_gin_idx`  | `gin (topic_ids)`                                                    | Topic filtering.                                                                                                                                                                                                                   |
| `memories_reembed_idx`             | `(user_id)` where `status = 'active' and embedding_model is null`    | The re-embed backlog.                                                                                                                                                                                                              |

### Constraints

| Name                                         | Definition                                                                       | Why                                                                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memories_kind_check`                        | `kind in (…)`                                                                    | Enum-as-check.                                                                                                                                                              |
| `memories_status_check`                      | `status in (…)`                                                                  | Enum-as-check.                                                                                                                                                              |
| `memories_confidence_check`                  | `confidence >= 0 and confidence <= 1`                                            |                                                                                                                                                                             |
| `memories_importance_check`                  | `importance >= 0 and importance <= 1`                                            |                                                                                                                                                                             |
| `memories_statement_len_check`               | `char_length(statement) between 8 and 512`                                       | A memory is one sentence. A 512-character cap is generous for a statement and hostile to a paragraph.                                                                       |
| `memories_supersede_consistency_check`       | `status <> 'superseded' or (valid_to is not null and superseded_by is not null)` | **The temporal invariant.** A superseded memory must have a closed window and a named replacement. This is what makes "the belief at time t" a well-formed query (ADR-008). |
| `memories_supersede_window_check`            | `valid_to is null or valid_to >= valid_from`                                     | A negative validity window is meaningless.                                                                                                                                  |
| `memories_not_self_superseding_check`        | `superseded_by is null or superseded_by <> id`                                   | A self-loop would make chain traversal non-terminating.                                                                                                                     |
| `memories_embedding_model_consistency_check` | `(embedding is null) = (embedding_model is null)`                                | Same rule as chunks.                                                                                                                                                        |
| `memories_access_count_check`                | `access_count >= 0`                                                              |                                                                                                                                                                             |

There is **no** constraint forcing `valid_from` to be at or before `now()`. Backdated memories are legitimate — a statement distilled today about a decision made last month has a `valid_from` in the past — and the distiller is allowed to infer one.

### RLS policies

| Policy                | Operation | Roles           | Predicate                                                                                                                                                                                                                |
| --------------------- | --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `memories_select_own` | `SELECT`  | `authenticated` | `using (user_id = auth.uid())` — note that this includes superseded, archived, and rejected rows, because the _user_ is allowed to see their own history. Retrieval filters to `active` in the query, not in the policy. |
| `memories_insert_own` | `INSERT`  | `authenticated` | `with check (user_id = auth.uid() and status = 'active')` — a user may write a memory by hand, and a user-created memory is immediately active rather than a candidate.                                                  |
| `memories_update_own` | `UPDATE`  | `authenticated` | `using (user_id = auth.uid()) with check (user_id = auth.uid())` — for correcting a statement, changing `kind`, archiving, or rejecting.                                                                                 |
| `memories_delete_own` | `DELETE`  | `authenticated` | `using (user_id = auth.uid())` — "forget this", a real delete.                                                                                                                                                           |

**Trigger `memories_guard_supersede_columns`** (before update): rejects client-role changes to `valid_from`, `valid_to`, `superseded_by`, `embedding`, `embedding_model`, `confidence`, `distillation_prompt_version`, and `distillation_model`. Superseding is a service-side transaction (ADR-008); a user editing a statement must not be able to forge a validity window or a supersede link, because those columns are what citations and temporal queries depend on.

## `topics`

One user-scoped subject. Topics exist to make metadata filtering useful, so they are per-user rather than global: "engineering" means something different to every user.

| Column           | Type           | Null | Default                   | Notes                                                                                                                                                                                                                     |
| ---------------- | -------------- | ---- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `uuid`         | no   | `gen_random_uuid()`       |                                                                                                                                                                                                                           |
| `user_id`        | `uuid`         | no   | —                         | `references auth.users (id) on delete cascade`.                                                                                                                                                                           |
| `slug`           | `text`         | no   | —                         | `check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`. Stable, URL-safe, and the key a `TopicSuggestion` proposes.                                                                                                                  |
| `label`          | `text`         | no   | —                         | Display name.                                                                                                                                                                                                             |
| `description`    | `text`         | yes  | —                         |                                                                                                                                                                                                                           |
| `parent_id`      | `uuid`         | yes  | —                         | Composite self-FK to `(id, user_id)`, `on delete set null`.                                                                                                                                                               |
| `keywords`       | `text[]`       | no   | `'{}'`                    | The cheap first-pass matcher. Populated by classification, editable by the user.                                                                                                                                          |
| `category_slug`  | `text`         | no   | _`DEFAULT_CATEGORY_SLUG`_ | The coarse bucket from `CATEGORIES` / `CATEGORY_LABELS`. The default must be the **value of** `DEFAULT_CATEGORY_SLUG` from `@second-brain/shared`, not a literal typed into a migration that can drift from the constant. |
| `document_count` | `integer`      | no   | `0`                       | **Denormalised**, maintained by trigger from `document_topics`. Lets the topic tree render without an aggregate per node.                                                                                                 |
| `memory_count`   | `integer`      | no   | `0`                       | Same, over active memories.                                                                                                                                                                                               |
| `centroid`       | `vector(1024)` | yes  | —                         | Mean embedding of the topic's chunks, used for nearest-centroid assignment. **No index** — tens of rows, read in full (ADR-016).                                                                                          |
| `centroid_model` | `text`         | yes  | —                         | Which model produced the centroid. Same absence-is-not-approximation rule as everywhere else, and it is what makes centroid recomputation after a re-embed an explicit step.                                              |
| `first_seen_at`  | `timestamptz`  | no   | `now()`                   |                                                                                                                                                                                                                           |
| `last_seen_at`   | `timestamptz`  | no   | `now()`                   | Updated on each new assignment. Orders the topic list by recency.                                                                                                                                                         |

### Indexes

| Index                       | Definition                              | Purpose                                                                                                             |
| --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `topics_pkey`               | `(id)`                                  | Primary key.                                                                                                        |
| `topics_user_slug_key`      | `unique (user_id, slug)`                | Topic identity per user. This is what makes `TopicSuggestion` idempotent — proposing an existing slug is an update. |
| `topics_id_user_id_key`     | `unique (id, user_id)`                  | Composite FK target for the self-reference and for `document_topics`.                                               |
| `topics_user_parent_idx`    | `(user_id, parent_id)`                  | Rendering the topic tree.                                                                                           |
| `topics_user_last_seen_idx` | `(user_id, last_seen_at desc, id desc)` | The topic list's keyset pagination (ADR-017).                                                                       |
| `topics_keywords_gin_idx`   | `gin (keywords)`                        | The keyword first pass: `keywords && $1`.                                                                           |
| `topics_user_category_idx`  | `(user_id, category_slug)`              | Grouping the topic view by `CATEGORIES`.                                                                            |

### Constraints

| Name                                      | Definition                                      | Why                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topics_slug_format_check`                | `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`             | A slug is used as a stable identifier and in URLs; constraining the shape prevents a generated slug with spaces or punctuation from becoming a permanent identifier.                                                                                                                         |
| `topics_slug_len_check`                   | `char_length(slug) between 2 and 64`            |                                                                                                                                                                                                                                                                                              |
| `topics_label_len_check`                  | `char_length(label) between 1 and 96`           |                                                                                                                                                                                                                                                                                              |
| `topics_category_slug_check`              | `category_slug <> ''`                           | The valid set lives in `CATEGORIES` in shared code; a `check` enumerating it here would need a migration every time the taxonomy changes, so only non-emptiness is enforced. This is a deliberate relaxation of the enum-as-check convention, stated so it is not mistaken for an oversight. |
| `topics_not_self_parent_check`            | `parent_id is null or parent_id <> id`          |                                                                                                                                                                                                                                                                                              |
| `topics_counts_check`                     | `document_count >= 0 and memory_count >= 0`     |                                                                                                                                                                                                                                                                                              |
| `topics_centroid_model_consistency_check` | `(centroid is null) = (centroid_model is null)` |                                                                                                                                                                                                                                                                                              |
| `topics_parent_depth_check`               | **not enforced in SQL**                         | Cycles in `parent_id` are possible and would not be caught. Preventing them requires a recursive check in a trigger, which is possible but expensive on every write. Listed as an open question rather than silently unhandled — see [Open schema questions](#open-schema-questions).        |

### RLS policies

| Policy              | Operation | Roles           | Predicate                                                                                                                                                   |
| ------------------- | --------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topics_select_own` | `SELECT`  | `authenticated` | `using (user_id = auth.uid())`                                                                                                                              |
| `topics_insert_own` | `INSERT`  | `authenticated` | `with check (user_id = auth.uid())` — a user may create a topic by hand.                                                                                    |
| `topics_update_own` | `UPDATE`  | `authenticated` | `using (user_id = auth.uid()) with check (user_id = auth.uid())` — renaming, re-keywording, moving.                                                         |
| `topics_delete_own` | `DELETE`  | `authenticated` | `using (user_id = auth.uid())` — cascades to `document_topics`; memories keep their denormalised `topic_ids`, which is why that array is not a foreign key. |

**Trigger `topics_guard_counters`** (before update): rejects client-role changes to `document_count`, `memory_count`, `centroid`, `centroid_model`, `first_seen_at`, and `last_seen_at`. These are derived; a client that could write them could desynchronise the topic tree from reality.

## `document_topics`

The assignment join table. One row per (document, topic), carrying the confidence and which assignment is primary.

| Column                   | Type          | Null | Default | Notes                                                                                                                                              |
| ------------------------ | ------------- | ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_id`            | `uuid`        | no   | —       | Part of the composite PK and a composite FK to `documents (id, user_id)`, `on delete cascade`.                                                     |
| `topic_id`               | `uuid`        | no   | —       | Composite FK to `topics (id, user_id)`, `on delete cascade`.                                                                                       |
| `user_id`                | `uuid`        | no   | —       | Carried explicitly so RLS on this table is a single-column predicate, and so the composite FKs can guarantee both parents belong to the same user. |
| `confidence`             | `real`        | no   | —       | `TopicAssignment.confidence`.                                                                                                                      |
| `is_primary`             | `boolean`     | no   | `false` | At most one primary per document, enforced by a partial unique index.                                                                              |
| `classification_version` | `text`        | yes  | —       | Which classifier produced the assignment. The `where` clause of a re-classification.                                                               |
| `assigned_at`            | `timestamptz` | no   | `now()` |                                                                                                                                                    |

### Indexes

| Index                                  | Definition                                | Purpose                                                                             |
| -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `document_topics_pkey`                 | `(document_id, topic_id)`                 | Primary key; makes reassignment an upsert.                                          |
| `document_topics_one_primary_idx`      | `unique (document_id)` where `is_primary` | **The one-primary invariant.** A document has a single primary topic or none.       |
| `document_topics_topic_confidence_idx` | `(topic_id, confidence desc)`             | Listing a topic's documents by confidence, and recomputing `topics.document_count`. |
| `document_topics_user_idx`             | `(user_id)`                               | RLS predicate support.                                                              |

### Constraints

| Name                               | Definition                                                                                          | Why                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `document_topics_confidence_check` | `confidence >= 0 and confidence <= 1`                                                               |                                                      |
| `document_topics_pk`               | `primary key (document_id, topic_id)`                                                               | An assignment is idempotent.                         |
| _(composite FKs)_                  | `(document_id, user_id) → documents (id, user_id)` and `(topic_id, user_id) → topics (id, user_id)` | Makes cross-user assignment structurally impossible. |

### RLS policies

| Policy                       | Operation | Roles           | Predicate                                                                                                                                                                           |
| ---------------------------- | --------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_topics_select_own` | `SELECT`  | `authenticated` | `using (user_id = auth.uid())`                                                                                                                                                      |
| _(none)_                     | any write | —               | Assignments are produced by `services/processing`. The user's way to change a topic assignment is to edit the topic or use the review UI, which writes through a service-role path. |

## `memory_sources`

The evidence link. Every memory points at the chunks that support it, with a frozen excerpt so a citation survives a re-chunk. This table is the persisted form of `MemorySourceLink`.

| Column        | Type          | Null | Default | Notes                                                                                                                                                                                                                                                      |
| ------------- | ------------- | ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_id`   | `uuid`        | no   | —       | Part of the composite PK and a composite FK to `memories (id, user_id)`, `on delete cascade`.                                                                                                                                                              |
| `chunk_id`    | `uuid`        | no   | —       | Part of the composite PK and a composite FK to `document_chunks (id, user_id)`, `on delete cascade`. **Non-null**, matching `MemorySourceLink`: evidence is a span, and a claim that cites no span is not verifiable.                                      |
| `user_id`     | `uuid`        | no   | —       | RLS predicate support and composite FK participation.                                                                                                                                                                                                      |
| `document_id` | `uuid`        | no   | —       | Composite FK to `documents (id, user_id)`, `on delete cascade`. Denormalised from the chunk so "which memories came from this document" is a single-column read rather than a join.                                                                        |
| `similarity`  | `real`        | yes  | —       | `MemorySourceLink.similarity` — cosine similarity between the candidate statement and this chunk, when it was computed. Nullable because a memory written by hand has no candidate-embedding comparison behind it.                                         |
| `excerpt`     | `text`        | no   | —       | The specific span supporting the statement, **frozen at write time**. This is what makes a citation stable: `document_chunks.text` can be rewritten by a re-chunk, but the excerpt a memory cited does not change (ADR-008's citation-integrity argument). |
| `created_at`  | `timestamptz` | no   | `now()` |                                                                                                                                                                                                                                                            |

### Indexes

| Index                         | Definition                                | Purpose                                                                                                                                      |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_sources_pkey`         | `(memory_id, chunk_id)`                   | Primary key. Prevents linking the same chunk to the same memory twice on a retried distillation, and makes the link idempotent.              |
| `memory_sources_memory_idx`   | `(memory_id, similarity desc nulls last)` | Loading a memory's evidence in support order. `nulls last` so a hand-written memory's unranked evidence does not sort above ranked evidence. |
| `memory_sources_chunk_idx`    | `(chunk_id)`                              | "Which memories cite this chunk" — needed when a document is deleted or a chunk is re-generated, so the UI can show what was affected.       |
| `memory_sources_document_idx` | `(document_id)`                           | Same, at document granularity.                                                                                                               |
| `memory_sources_user_idx`     | `(user_id)`                               | RLS predicate support.                                                                                                                       |

### Constraints

| Name                               | Definition                                                                                                                                                       | Why                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `memory_sources_pk`                | `primary key (memory_id, chunk_id)`                                                                                                                              | A memory cites a given chunk at most once.                                                                 |
| `memory_sources_similarity_check`  | `similarity is null or (similarity >= -1 and similarity <= 1)`                                                                                                   | Cosine similarity's actual range. A value outside it is a bug, not data.                                   |
| `memory_sources_excerpt_len_check` | `char_length(excerpt) between 1 and 2000`                                                                                                                        | An excerpt is a span, not the document. Non-empty, because a citation with no quoted text is unverifiable. |
| _(composite FKs)_                  | `(memory_id, user_id) → memories (id, user_id)` and `(chunk_id, user_id) → document_chunks (id, user_id)` and `(document_id, user_id) → documents (id, user_id)` | Makes cross-user evidence structurally impossible.                                                         |

### RLS policies

| Policy                      | Operation | Roles           | Predicate                                                                            |
| --------------------------- | --------- | --------------- | ------------------------------------------------------------------------------------ |
| `memory_sources_select_own` | `SELECT`  | `authenticated` | `using (user_id = auth.uid())`                                                       |
| _(none)_                    | any write | —               | Written by the distillation persistence transaction, which runs as the service role. |

### What happens to the evidence when the source is deleted

All three foreign keys are `on delete cascade`, so deleting a document removes its `document_chunks`, which removes the `memory_sources` rows that cited them — while **the memory itself survives**, because nothing cascades into `memories`.

That leaves a memory whose evidence rows are gone. The provenance is not lost, because `memories.source_chunk_ids` and `memories.source_document_ids` are denormalised arrays written at the same time and never cascade. The consequence to be explicit about: **a memory keeps a durable pointer to its sources but loses the quoted span** once the sources are purged. This is the reason the `excerpt` column exists (a citation is stable while the evidence lives) and the reason it is not enough on its own (the evidence can be removed by retention). Recorded as an open question in [ROADMAP.md](./ROADMAP.md) rather than papered over.

## Vector dimensions and the cost of changing them

Every vector column is `vector(1024)`: `document_chunks.embedding`, `memories.embedding`, and `topics.centroid`. The default provider is `nv-embedqa-e5-v5` at 1024 dimensions (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` in [`.env.example`](../.env.example)).

| Candidate model                 | Native dimensions | `vector(N)` column    | Notes                                                                                                                                                                                                                           |
| ------------------------------- | ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NVIDIA `nv-embedqa-e5-v5`       | 1024              | `vector(1024)`        | **Default.** Asymmetric — it takes an `input_type` of `query` or `passage`, which the shared `EmbedOptions` must carry.                                                                                                         |
| OpenAI `text-embedding-3-small` | 1536              | `vector(1536)`        | Leading fallback. Supports native reduced dimensions, which may permit a `vector(1024)` column — **must be verified, not assumed**: a truncated 1536-dimension vector is not the same embedding as a native 1024-dimension one. |
| Gemini `text-embedding-004`     | 768               | `vector(768)`         | Smaller and cheaper per row; two of the three candidate widths are _narrower_ than the pinned one.                                                                                                                              |
| Local (Ollama / vLLM)           | model-dependent   | must match the column | Model choice is a deployment concern; the interface and the column constrain it.                                                                                                                                                |

### Why 1024

It is the width of the chosen default, and a `vector(N)` column cannot hold a vector of a different width. The reasoning, the rejected widths, and the fallback are in [ADR-004](./DECISIONS.md#adr-004-pinned-embedding-dimensions-and-a-mandatory-re-embedding-migration). The schema-level consequences are:

- **`vector(N)` is not a hint; it is a type.** `insert … embedding = '[1,2,3]'::vector` into a `vector(1024)` column fails if the literal has 1536 components. There is no coercion and no truncation.
- **Two different models at the same width still require a re-embed.** The dimensions being equal does not make the vector spaces comparable. `embedding_model` exists so that mixed-model vectors are _detectably_ mixed: retrieval excludes any row whose stamp does not match the configured model.
- **A partially migrated column is usable.** Because the stamp is per row, a dimorphic table (some rows stamped `nv-embedqa-e5-v5`, some `text-embedding-3-small`) is a valid state that retrieval handles by excluding the mismatched rows from the vector leg. This is what makes a long-running migration safe.

### What a dimension change costs

| Cost                                   | Detail                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Token spend**                        | Every chunk and every active memory must be re-embedded: roughly the corpus's total token count, at the provider's price. This is the dominant cost and it scales with the whole corpus, not with a delta.                                                                   |
| **Wall-clock**                         | Bounded by provider rate limits, not by the database. It is a batched job that runs for as long as the rate limit allows.                                                                                                                                                    |
| **Storage, temporarily**               | A dual-read window holds two vector columns and two HNSW indexes per surface. `vector(1024)` at `real4` precision is ~4 KB per vector, so a 50,000-chunk corpus is ~200 MB per column plus index overhead — the amount to plan for, not a rounding error.                    |
| **Index rebuild time**                 | HNSW builds are slow and slow down as the table grows ([ADR-016](./DECISIONS.md#adr-016-hnsw-rather-than-ivfflat-for-vector-indexes)). The migration reorders work to build the new index before the old one is dropped, which means the build happens on a populated table. |
| **Re-derivation of `topics.centroid`** | Centroids must be recomputed from the new chunk vectors. During the transition a centroid can be inconsistent with the chunks it summarises, so nearest-centroid assignment should be disabled or weighted down for the duration.                                            |
| **Downstream invalidation**            | A changed embedding space changes retrieval rankings, which changes which memories are retrieved, which changes chat answers. There is no need to re-distill, but the retrieval evaluation baseline must be re-measured rather than compared across the change.              |

### The migration shape

The full procedure is in [ADR-004](./DECISIONS.md#adr-004-pinned-embedding-dimensions-and-a-mandatory-re-embedding-migration). In schema terms it is exactly this, in two separate migrations:

```sql
-- Migration 1: add the new column and its index, keep serving from the old one.
alter table second_brain.document_chunks
  add column embedding_v2 vector(1536),
  add column embedding_v2_model text;

alter table second_brain.document_chunks
  add constraint document_chunks_embedding_v2_model_consistency_check
  check ((embedding_v2 is null) = (embedding_v2_model is null));

create index document_chunks_embedding_v2_hnsw_idx
  on second_brain.document_chunks using hnsw (embedding_v2 vector_cosine_ops);
-- then: backfill in batches from `text`, dual-read, measure, and only then...

-- Migration 2: drop the old column and index.
alter table second_brain.document_chunks
  drop constraint document_chunks_embedding_model_consistency_check,
  drop column embedding,
  drop column embedding_model;

alter table second_brain.document_chunks rename column embedding_v2 to embedding;
alter table second_brain.document_chunks rename column embedding_v2_model to embedding_model;
```

Two things make this safe that are worth naming: the constraint in migration 1 mirrors the existing `(embedding is null) = (embedding_model is null)` rule for the new pair, so the dual-window state cannot contain an unstamped vector; and the rename in migration 2 is why the dual-read code reads the _old_ column name last — the application flips from "prefer v2, fall back to v1" to "read `embedding`" without another deploy.

## The two search surfaces

Retrieval reads two independent search surfaces on the same rows, and they exist for different reasons. This is the schema-level half of [ADR-006](./DECISIONS.md#adr-006-reciprocal-rank-fusion-rather-than-score-interpolation); the fusion half is in [ARCHITECTURE.md](./ARCHITECTURE.md#the-retrieval-pipeline).

|                                      | Vector surface                                                      | Full-text surface                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Column                               | `embedding vector(1024)`                                            | `fts tsvector` (generated, stored)                                                                      |
| Index                                | `hnsw (embedding vector_cosine_ops)`                                | `gin (fts)`                                                                                             |
| Operator                             | `<=>` (cosine distance, ascending)                                  | `@@` with `websearch_to_tsquery`                                                                        |
| Ranking                              | Distance, converted to a rank position                              | `ts_rank_cd(fts, query)`                                                                                |
| Strength                             | Paraphrase, synonymy, cross-lingual recall, "the idea of the thing" | Exact tokens: identifiers, error codes, function names, ticket ids, product names, quoted strings, URLs |
| Weakness                             | Poor on rare exact tokens; a well-known failure of dense retrieval  | Poor on paraphrase; a question and its answer often share no tokens                                     |
| Dependencies                         | An external embedding provider at ingest **and** at query time      | None — Postgres alone                                                                                   |
| Nondeterminism                       | Model-version dependent                                             | Deterministic for a given `text_search_config`                                                          |
| Availability when providers are down | **Unavailable**                                                     | **Always available**                                                                                    |

### Why both, and not one

1. **They fail in opposite directions.** A vector search for "why did the retry storm happen" finds a passage that never uses the words "retry" or "storm". A full-text search for `ERR_TIMEOUT_503` finds the passage that contains it and no other. A single-surface system is either bad at paraphrase or bad at identifiers, and the user asks both kinds of question in the same session.
2. **The full-text leg is the entire degradation story.** When the embedding provider is unreachable, retrieval continues on the FTS leg alone with `degraded: true` (S6 in [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)). Without it, a provider outage is a total outage of recall.
3. **RRF needs two ranked lists to be worth its name.** With one list, fusion is a passthrough. The fusion exists because the two signals disagree in useful ways, which is the same reason they are indexed separately.
4. **Both are cheap.** A GIN index on a `tsvector` costs one extra index write per chunk insert, and the generated column costs nothing at read time. The cost of the second surface is a fraction of the cost of the first.

### Why generated-and-stored, not an expression index and not a trigger

- `fts` is a **generated column** (`generated always as (…) stored`), so it cannot drift from the text it indexes. A trigger can be forgotten; a generated column cannot.
- `stored` rather than virtual: Postgres can evaluate a virtual generated column on read, but only a stored one can be indexed with GIN. Since the whole point is the index, stored is required.
- An expression index (`gin (to_tsvector('english', text))`) would work but re-declares the configuration at every index and forces every query to repeat the same expression verbatim to match. The column makes the configuration a single named thing, and a query that writes `to_tsvector('english', …)` against a column generated with a different config would silently not use the index.
- The configuration is `'english'` today. `documents.language` exists so a future migration can add per-language columns or a different config; **the current schema does not**, and a multilingual corpus is a known limitation rather than a solved problem — see [Open schema questions](#open-schema-questions).

### Which rows are in which surface

| Table             | Vector                                      | Full-text                 | Reasoning                                                                                                                                       |
| ----------------- | ------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_chunks` | yes                                         | yes                       | The primary surface. Chunk granularity is what makes a citation precise.                                                                        |
| `memories`        | yes (partial on `active`)                   | yes (partial on `active`) | Statements are searched the same way, and partiality is what keeps superseded beliefs out (ADR-008).                                            |
| `documents`       | **no**                                      | yes                       | Document-level vectors would duplicate their chunks; but a title match is useful and cheap, so `fts` exists over `title` plus `extracted_text`. |
| `topics`          | **no** (centroid is `vector` but unindexed) | **no**                    | Tens of rows, read in full, matched by keyword and centroid arithmetic.                                                                         |
| `activity_events` | no                                          | **no**                    | Highest-write table; no read path wants lexical relevance over events (see the note in [`activity_events`](#activity_events)).                  |

## Retention and TTL

Two regimes, because raw events and memories have fundamentally different value decay.

### Raw activity events

| Band       | Default retention   | Reasoning                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `noise`    | **never persisted** | Below `IMPORTANCE_BAND_THRESHOLDS.low` (`0.25`), which is what `IMPORTANCE_MIN_THRESHOLD` mirrors. The client gate drops these before they enter the sync queue, so a `noise` event has no row to age out. Rows that _arrive_ in this band by a re-score (see below) are the sweep's first target. |
| `low`      | 90 days             | The bulk of activity. Long enough for "what was I doing last month", short enough that the table does not grow without bound.                                                                                                                                                                      |
| `normal`   | 365 days            | Ordinary reading worth a year of history. Also the band at which a document becomes eligible for distillation (`DISTILLATION_MIN_BAND`).                                                                                                                                                           |
| `high`     | indefinite          | Deliberately kept. This is the material the user cares about.                                                                                                                                                                                                                                      |
| `critical` | indefinite          | Same, and never swept regardless of age.                                                                                                                                                                                                                                                           |

Band thresholds are _lower bounds_ and come from `IMPORTANCE_BAND_THRESHOLDS` in `@second-brain/shared`: `noise: 0`, `low: 0.25`, `normal: 0.45`, `high: 0.7`, `critical: 0.9`. They are duplicated here for readability and must not be duplicated in a migration — a retention policy that hard-codes `0.25` would drift from the constant. The sweep reads `importance_band`, which is stored, rather than recomputing the band from a float.

**How a row can be in the `noise` band at all.** Two paths, and they are the reason the band is stored rather than inferred:

1. **Explicit-intent events bypass the gate.** `EXPLICIT_INTENT_EVENT_TYPES` (`selection`, `copy`, `search`, `bookmark`, `download`) carry intent by construction and are queued regardless of score, so one can persist in a band below `low` if its other signals are weak.
2. **A re-score can move an existing row down.** Adding a package to the exclusion list makes `appIsExcluded` true, which forces the score to zero (ADR-009). The row exists, so the convergence is a band change plus a sweep, not a delete at the source.

The retention statement above describes a `delete not update` sweep. That is the design; **no sweep exists yet** — it is a phase-7 task in [TASKS.md](./TASKS.md).

| Aspect                     | Rule                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default basis              | `.env.example` sets no retention value; the defaults above live in the retention policy module and are overridable per user and per device (a work laptop may keep less than a personal machine).                                           |
| Sweep mechanism            | A scheduled job (phase 7) issuing `delete from activity_events where importance_band in (…) and occurred_at < now() - interval '…'`, driven by `activity_events_retention_idx`.                                                             |
| `delete` not `update`      | Retention removes rows. There is no `purged_at` marker, because a marker on a deleted row is a contradiction.                                                                                                                               |
| Interaction with documents | Deleting events does **not** delete documents. The document holds the extracted text and the memories; events are the raw trace that produced it. Sweeping away a `low` `page_view` must not remove an article the user read and now cites. |
| Idempotency                | The sweep is a pure predicate, so a re-run deletes nothing new. It is safe to run concurrently with itself in the sense that the predicate is stable, not in the sense that two active sweeps are advisable.                                |
| Non-overridable floors     | A user may shorten retention but may not lengthen `noise` beyond a bound, because unbounded noise retention is the failure mode the threshold and the TTL exist to prevent.                                                                 |

### Memories and documents

- **`memories` has no TTL.** Superseded rows are retained indefinitely, because they are what makes temporal queries answerable and citations stable (ADR-008).
- **`documents` and `document_chunks` have no TTL.** They are removed by an explicit user delete, or preserved indefinitely. Deleting a document cascades to its chunks and then to the `memory_sources` rows that cited them, while **the memory survives** — its `source_chunk_ids` / `source_document_ids` arrays are denormalised and never cascade, so the provenance pointer outlives the quoted span. See [What happens to the evidence when the source is deleted](#what-happens-to-the-evidence-when-the-source-is-deleted).
- **`activity_events` retention is the only automated deletion in the system.** Stated plainly because it is the only place where data disappears without the user asking.

## Soft delete vs supersede

Two mechanisms that both make a row stop appearing, and they are not interchangeable. Conflating them is the most likely source of a subtle bug in this schema, so the distinction is a rule:

|                            | **Supersede**                                        | **Soft delete**                                               | **Hard delete**                                                                                      |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Whose intent               | The system's inference that the world changed        | The user's or retention policy's intent to remove             | The user's intent to destroy                                                                         |
| Columns                    | `valid_to`, `superseded_by`, `status = 'superseded'` | `deleted_at`                                                  | Row is gone                                                                                          |
| Row retained               | Yes, fully, with its content                         | Yes, fully, with its content                                  | No                                                                                                   |
| Visible to the user        | Yes — as history                                     | No, by default; recoverable within a window                   | No                                                                                                   |
| Answers historical queries | Yes, by design                                       | No                                                            | No                                                                                                   |
| Citations still resolve    | Yes                                                  | Technically, but the UI should not surface a deleted document | No — and this is why a memory's `excerpt` is frozen and its source FKs are `set null`, not `cascade` |
| Applies to                 | `memories` only                                      | `documents` only                                              | All tables, `memories` included                                                                      |
| Reversible                 | Not by the user; the chain is the record             | Yes, `deleted_at = null`                                      | No                                                                                                   |

Rules that follow:

- **`memories` is never soft-deleted.** There is no `deleted_at` column, deliberately. A memory is either current (`active`), no longer believed (`superseded`), no longer relevant (`archived`), wrong (`rejected`), or gone. A soft delete column would create a sixth state that means the same as "gone" while retaining the content, which is exactly the dishonesty the privacy commitments in [ROADMAP.md](./ROADMAP.md) rule out.
- **`documents` is soft-deleted, then purged.** `deleted_at` hides a document from every read path immediately; a later purge deletes the row. The reason for two steps rather than one is that a destructive action in a UI should be recoverable for a window, while the _purge_ is what honouring a deletion request means.
- **`deleted_at` is filtered in the query, not in RLS.** The policy allows the user to see their own soft-deleted rows (so an "undismiss" is possible); every read path adds `and deleted_at is null`, backed by the `documents_active_idx` partial index.
- **A superseded memory is not deleted, and a deleted memory is not superseded.** A user who forgets a memory does not leave a closed window behind; the row is gone, and any chat answer that cited it now cites a missing row — which the citation-integrity check (S2) catches at generation time, not at read time. This is an accepted, stated consequence.

## Migration conventions

- **Append-only.** A migration that has been applied anywhere is never edited. A mistake is fixed by a new migration. This is what makes the history replayable from scratch and makes `supabase db reset` a valid way to reach any state.
- **Filename:** `supabase/migrations/YYYYMMDDHHMMSS_snake_case_description.sql`. The timestamp is the authoring time, generated by `supabase migration new <description>`, not a version number — migrations are ordered by filename, and two authors on the same day are ordered by their timestamps.
- **One concern per migration.** A table and its indexes and policies may share a file; a table and an unrelated data backfill may not, because the backfill may need to run separately on a large database.
- **Every object is qualified with its schema.** Migrations and `supabase/seed.sql` run as `postgres`, whose `search_path` is `"$user", public` — `second_brain` is not on it. An unqualified `create table documents (…)` either fails or, worse, creates the table in `public`. Write `second_brain.documents` everywhere, including in `alter table`, index definitions, and trigger definitions.
- **The schema and its grants land first.** `create schema if not exists second_brain` plus the `usage`, table, and `alter default privileges` grants are in the first migration, before any table exists. See [Privileges: RLS policies are filters, not grants](#privileges-rls-policies-are-filters-not-grants).
- **RLS is part of the table's migration, not a follow-up.** `enable row level security`, `force row level security`, and the policies go in the same file that creates the table. A table that exists without RLS, even briefly, is a table that can be read by the anon key (ADR-018).
- **`force row level security` is applied as well as `enable`, never instead of it.** `enable` alone does not bind the table's **owner**, and every table is owned by `postgres`, which is the role migrations and `seed.sql` connect as. Without `force`, a connection as the owner reads the table with every policy bypassed — which is exactly the connection a migration or a seed script uses, so the gap is reachable by accident rather than only by an attacker. (`service_role` bypasses RLS by role attribute regardless of `force`; that is a separate mechanism, covered in [ARCHITECTURE.md](./ARCHITECTURE.md#security-model).)
- **No destructive migration without a stated backfill.** A `drop column` or a `not null` addition must be in a migration whose comment explains what happened to existing rows.
- **No seed data in migrations.** Seeds belong in `supabase/seed.sql`, so that migrations are schema-only and reproducible. `DEFAULT_CATEGORY_SLUG`-style values come from shared constants, not from a migration literal.

### A worked migration

This is the shape every table migration follows, using `documents` as the example. It is a specification of the convention, not a file that exists.

```sql
-- supabase/migrations/20260916093000_init_documents.sql
--
-- Creates second_brain.documents: one row per distinct piece of content the user
-- has encountered, deduped by (user_id, content_hash).
--
-- Depends on: 20260916085500_init_schema.sql (the schema and its grants)
--             20260916090000_init_extensions.sql (pgvector, second_brain.set_updated_at)
--             20260916091500_init_devices.sql (composite FK target)
-- Specified by: docs/DATABASE_SCHEMA.md#documents

-- ---------------------------------------------------------------------------
-- Schema bootstrap. This block belongs to 20260916085500_init_schema.sql and is
-- repeated here only so that the whole preamble a table migration depends on is
-- visible in one place. Every statement is idempotent, so re-running it is
-- harmless. See
-- docs/DATABASE_SCHEMA.md#privileges-rls-policies-are-filters-not-grants
-- ---------------------------------------------------------------------------
create schema if not exists second_brain;

-- Policies are filters, not grants: Supabase's default privileges cover `public`
-- only, so a custom schema is unreachable until it is granted explicitly.
grant usage on schema second_brain to authenticated, service_role;
grant select, insert, update, delete on all tables in schema second_brain to authenticated;

-- Without this, the *next* table migration creates a table that inherits no
-- privileges for `authenticated` and is unreachable however correct its policies
-- are. The symptom is empty results, not an error.
alter default privileges in schema second_brain
  grant select, insert, update, delete on tables to authenticated;

-- pgvector. Supabase installs extensions into the `extensions` schema, which is
-- on the default search_path, so `vector(1024)` resolves without qualification.
-- If it does not, the column type becomes `extensions.vector(1024)`.
-- HNSW indexes (used by document_chunks, not here) require pgvector >= 0.5.
-- This line and second_brain.set_updated_at() belong to
-- 20260916090000_init_extensions.sql.
create extension if not exists vector with schema extensions;

create table if not exists second_brain.documents (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users (id) on delete cascade,

  -- composite FK so a document can never point at another user's device (ADR-003)
  device_id             uuid,
  constraint documents_device_fk
    foreign key (device_id, user_id) references second_brain.devices (id, user_id) on delete set null,

  source                text        not null
    constraint documents_source_check
    check (source in ('web','youtube','pdf','gdoc','newsletter','manual')),

  url                   text,
  canonical_url         text,
  title                 text        not null default '',
  author                text,
  site_name             text,
  published_at          timestamptz,
  captured_at           timestamptz not null default now(),
  word_count            integer     not null default 0,
  reading_time_seconds  integer     not null default 0,
  content_hash          text        not null,

  extracted_text        text,
  summary               text,
  language              text,
  importance            real        not null default 0,

  -- denormalised cache of document_topics; that table stays the source of truth
  topic_ids             uuid[]      not null default '{}',

  extraction_status     text        not null default 'pending'
    constraint documents_extraction_status_check
    check (extraction_status in ('pending','succeeded','failed','skipped')),
  extraction_failure_reason text,
  extraction_version    text,

  -- generated, so it cannot drift from the text it indexes
  fts                   tsvector generated always as (
                          to_tsvector('english',
                            coalesce(title, '') || ' ' || coalesce(extracted_text, ''))
                        ) stored,

  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint documents_id_user_id_key unique (id, user_id),          -- composite FK target
  constraint documents_user_content_hash_key unique (user_id, content_hash),
  constraint documents_importance_check check (importance >= 0 and importance <= 1),
  constraint documents_word_count_check check (word_count >= 0 and reading_time_seconds >= 0),

  -- extraction_status is the trustworthy state, so it must agree with the text
  constraint documents_extraction_consistency_check
    check ((extraction_status = 'succeeded') = (extracted_text is not null)),

  -- nothing soft-deleted may sit in the extraction backlog
  constraint documents_deleted_consistency_check
    check (deleted_at is null or extraction_status <> 'pending')
);

create index documents_user_captured_id_idx
  on second_brain.documents (user_id, captured_at desc, id desc);

create index documents_user_source_captured_idx
  on second_brain.documents (user_id, source, captured_at desc);

create index documents_user_importance_idx
  on second_brain.documents (user_id, importance desc, captured_at desc);

create index documents_fts_gin_idx
  on second_brain.documents using gin (fts);

create index documents_user_topic_ids_gin_idx
  on second_brain.documents using gin (topic_ids);

-- partial: the backlog is small, the table is not
create index documents_pending_extraction_idx
  on second_brain.documents (user_id, captured_at)
  where extraction_status = 'pending';

-- partial: every user-facing read filters deleted_at, so make that the cheap path
create index documents_active_idx
  on second_brain.documents (user_id, captured_at desc)
  where deleted_at is null;

-- updated_at maintenance. second_brain.set_updated_at() is a tiny plpgsql trigger
-- function created in 20260916090000_init_extensions.sql, not taken from an
-- extension, so its behaviour is ours and visible in the history.
create trigger documents_set_updated_at
  before update on second_brain.documents
  for each row execute function second_brain.set_updated_at ();

-- ---------------------------------------------------------------------------
-- Row Level Security. Enable AND force, then deny-by-default with a narrow grant.
-- `force` is what binds the table's owner (`postgres`, the role migrations and
-- seed.sql connect as); plain `enable` would leave the owner exempt.
-- ---------------------------------------------------------------------------
alter table second_brain.documents enable row level security;
alter table second_brain.documents force row level security;

-- read your own documents (including your own soft-deleted ones, so a delete
-- can be undone; the read paths add `and deleted_at is null` themselves)
create policy documents_select_own
  on second_brain.documents
  for select
  to authenticated
  using (user_id = auth.uid());

-- a user owns title, summary, and deleted_at. Everything else is guarded by
-- documents_guard_immutable_columns, defined in the same migration.
create policy documents_update_own
  on second_brain.documents
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- "forget this document": a real delete, cascading to chunks and source links
create policy documents_delete_own
  on second_brain.documents
  for delete
  to authenticated
  using (user_id = auth.uid());

-- No insert policy: documents are created by services/processing under the
-- service role. Absence of a policy is the denial (ADR-018).
```

A later, additive migration — the form most migrations will actually take — looks like this, and it is worth showing because it is the shape a reviewer will see most often:

```sql
-- supabase/migrations/20261020140000_add_documents_reading_progress.sql
--
-- Adds a nullable progress column so the dashboard can distinguish "opened" from
-- "finished". Nullable and defaulted, so no backfill is required and no existing
-- row changes meaning.
--
-- Specified by: docs/DATABASE_SCHEMA.md#documents

alter table second_brain.documents
  add column if not exists reading_progress_pct real;

alter table second_brain.documents
  add constraint documents_reading_progress_check
  check (reading_progress_pct is null
         or (reading_progress_pct >= 0 and reading_progress_pct <= 1));

comment on column second_brain.documents.reading_progress_pct is
  'Observed or estimated reading completion, 0..1. Null means unknown, never 0.';
```

## Open schema questions

Recorded with the phase that must resolve each. These are genuine gaps, not placeholders.

| Question                                                                                                                                                                                                                                                               | Options and tradeoff                                                                                                                                                                                                                                                                                                                                                                                | Resolved by                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Topic hierarchy cycles.** `topics.parent_id` can form a cycle, which would make tree traversal non-terminating.                                                                                                                                                      | (a) A recursive `before insert/update` trigger that rejects a cycle — correct, and it runs a recursive query on every topic write. (b) Enforce a maximum depth and validate on read — cheaper, but the invariant lives in application code. (c) Do not model a hierarchy at all; `parent_id` stays unused in v1.                                                                                    | Phase 2, before classification writes topics                            |
| **Multilingual full-text search.** `fts` uses the `english` configuration while `documents.language` records the actual language.                                                                                                                                      | (a) Per-language `fts` columns (`fts_en`, `fts_de`, …) — correct, and it multiplies the GIN indexes and the query complexity. (b) Single `fts` now; add per-language columns in a later migration for the languages that actually appear in a user's corpus. (c) Language-specific `to_tsvector` config chosen at query time — impossible with a generated column, so this is not available.        | Phase 4, when retrieval quality is measurable                           |
| **`memory_sources.excerpt` is frozen but its source can be purged.** The excerpt survives a re-chunk, but a document delete cascades the evidence row away, leaving a memory with provenance arrays and no quoted span.                                                | (a) Accept it: the memory's statement is the durable thing, and a citation to a deleted source is reported as historical. (b) Copy the excerpt onto the memory before the cascade, which denormalises further. (c) Refuse to delete a document that a memory cites — which conflicts with the hard-delete commitment.                                                                               | Phase 7, with the retention work                                        |
| **Whether `activity_events` needs a `payload` GIN index.**                                                                                                                                                                                                             | (a) Add it when a per-app-analytics query exists (phase 6) — measured need. (b) Add it now — insurance, at the cost of index maintenance on the highest-write table.                                                                                                                                                                                                                                | Phase 6                                                                 |
| **Retention floor semantics.** The defaults are in this document; the per-user override and its bounds are not.                                                                                                                                                        | (a) A `retention_policies` table per user/device. (b) Columns on `devices`. (c) A single user-level setting with per-band overrides in one JSONB column.                                                                                                                                                                                                                                            | Phase 7                                                                 |
| **Where do per-user importance rule weights live?** `ImportanceRule` (`id`, `description`, `signals`, `weight`, `enabled`) is the tunable surface the Settings screen exposes, and there is no table in this schema for it. The eight tables above are the frozen set. | (a) A ninth table, `importance_rules`, one row per rule per user — the obvious answer, and it breaks the "exactly eight tables" scope. (b) Store the override set as a JSONB column on `devices` or a user-preferences row. (c) Ship defaults in code (per `ImportanceRule` in `@second-brain/shared`) and support no per-user override in v1, which makes the Settings weight editor a v2 feature. | Phase 5, when the Settings screen is built                              |
| **A `processing_runs` table.** Provenance is currently stamped on the affected rows (per ADR-009). A run-level record would make "what did the last distillation run do" a query rather than an aggregate.                                                             | (a) Add `processing_runs` — one more table and a clear audit story. (b) Keep row-level stamps only — no new table, but no run-level view.                                                                                                                                                                                                                                                           | Phase 2, when the pipeline actually runs                                |
| **Whether `documents.device_id` should exist at all.** It records the first device that produced the content, which is arguably event-level information already available in `activity_events`.                                                                        | (a) Keep it — cheap and makes "which device brought this in" a single-column read. (b) Remove it — one less denormalised field, at the cost of a join to events that a retention sweep may have deleted.                                                                                                                                                                                            | Phase 1, while the schema is still being written                        |
| **Partitioning.** Not needed at the expected row counts, and partition maintenance complicates RLS and every index.                                                                                                                                                    | (a) No partitioning (current). (b) Range-partition `activity_events` by month, which makes retention a `drop partition` instead of a `delete` — genuinely better at scale, and a much heavier schema.                                                                                                                                                                                               | Only if the re-architecture triggers in [ROADMAP.md](./ROADMAP.md) fire |

## Related documents

| Document                                 | Why                                                                                                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)     | How these tables are written and read: the sync protocol, the processing pipeline, the retrieval pipeline, and every failure mode.                                                                                                       |
| [DECISIONS.md](./DECISIONS.md)           | The reasoning behind ADR-003 (shared schema), ADR-004 (pinned dimensions), ADR-008 (supersede), ADR-015 (one events table), ADR-016 (HNSW), ADR-017 (keyset), ADR-018 (keys and secrets), ADR-020 (`second_brain` rather than `public`). |
| [API_REFERENCE.md](./API_REFERENCE.md)   | The endpoints that read and write these tables.                                                                                                                                                                                          |
| [RESEARCH_NOTES.md](./RESEARCH_NOTES.md) | The provider comparison behind the 1024-dimension default, and what "a memory" means for the `memories` table's content.                                                                                                                 |
| [TASKS.md](./TASKS.md)                   | Phase 1 writes the first migrations from this specification.                                                                                                                                                                             |
| [ROADMAP.md](./ROADMAP.md)               | Retention defaults, deletion commitments, and the triggers that would force a schema change.                                                                                                                                             |
