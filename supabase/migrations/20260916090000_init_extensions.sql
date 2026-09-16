-- ---------------------------------------------------------------------------
-- 20260916090000_init_extensions.sql
--
-- Migration 2. The two non-table prerequisites every table migration depends
-- on: pgvector, and the shared `updated_at` trigger helper.
--
-- Depends on: 20260916085500_init_schema.sql (ordering only — this file touches
--             the platform `extensions` schema and the `second_brain` schema
--             created there, but it creates no object in `second_brain` that
--             needs a grant)
-- Specified by: docs/DATABASE_SCHEMA.md#migration-conventions and the
--               `set_updated_at()` references in
--               docs/DATABASE_SCHEMA.md#a-worked-migration; docs/TASKS.md
--               ("init_extensions.sql — the set_updated_at() trigger function
--               and any shared helpers").
--
-- WHY THE EXTENSION IS ENABLED BY A MIGRATION RATHER THAN BY CONFIG
--   `supabase/config.toml` carries no extension list, and nothing written there
--   would reach the hosted database anyway. The local Supabase image already
--   ships pgvector; a hosted project ships it too but does not enable it
--   per-database. A migration is the only statement that puts `supabase db
--   reset` (local) and `supabase db push` (hosted) into the same state.
--
-- WHY IT IS INSTALLED INTO `extensions` AND NOT INTO `public`
--   Supabase keeps platform extensions out of `public`; more importantly for us,
--   `extensions` is on the default search path, so `vector(1024)` resolves
--   unqualified in a column definition and the type in every table migration is
--   spelled the same way the specification spells it. If a connection ever lacks
--   that search path entry, the fix is one token at the point of use — write
--   `extensions.vector(1024)` in the table migration instead of `vector(1024)` —
--   and NOT to install the extension into `public` or to mutate the search path
--   of the migration role. (ADR-020: `public` is Supabase's namespace, and a
--   product object sitting beside a platform one is indistinguishable from it.)
--
-- WHAT IS DELIBERATELY ABSENT
--   No tables, no policies, no grants. Grants and `alter default privileges`
--   belong to 20260916085500_init_schema.sql and are installed once, before any
--   table exists.
--
--   No retrieval RPCs (`match_chunks`, `match_memories`, `hybrid_search`). They
--   read `document_chunks` and `memories`, so they belong in a migration that
--   runs after those tables exist, not in the file that merely enables pgvector.
--
--   No guard-trigger functions. Each one is defined in the migration that
--   creates the table it guards, alongside that table's policies, so that
--   "which columns may a client write" is answered by reading one file.
--
-- IDEMPOTENT. `create extension if not exists` and `create or replace function`
-- are both safe to replay. A *change* to the helper is a new migration, per the
-- append-only convention; the `or replace` exists so that a replay of this file
-- does not fail, not as a licence to edit it after it has been applied.
-- ---------------------------------------------------------------------------

-- --- pgvector ---------------------------------------------------------------
-- HNSW indexes — created by the vector-index migration, not here — require
-- pgvector >= 0.5. `if not exists` is what makes this correct against an image
-- that already has the extension enabled per-database.
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- second_brain.set_updated_at()
--
-- The shared `before update` helper every table with an `updated_at` column
-- attaches: `documents`, `memories`, and `user_settings`. Defined once, in this
-- file, so that the behaviour is one function rather than one per table, and so
-- that the reason it exists is readable in the history rather than inferred from
-- a call site.
--
-- A per-table `update … set updated_at = now()` would be the alternative, and it
-- is worse in a way that only shows up later: the column then means "updated by
-- a caller that remembered", which is indistinguishable from "never updated".
-- A trigger makes the column unconditionally true.
-- ---------------------------------------------------------------------------

create or replace function second_brain.set_updated_at()
returns trigger
language plpgsql

-- Written out although it is the default, because the default is load-bearing
-- here. The function does nothing a caller could not do for itself, so there is
-- nothing to escalate; a SECURITY DEFINER helper would run as the table owner
-- (`postgres`) and would quietly widen every write that fires it.
--
-- The same property is what the guard triggers in 20260916091000_init_core_tables.sql
-- depend on in the opposite direction: they read `current_user` to decide
-- whether the statement came from a client, which is only the caller's identity
-- while the function does not switch it.
security invoker

-- Hardened search path. The body owns no unqualified name — `now()` resolves
-- from `pg_catalog`, which is searched before any search path entry — so
-- pinning the path to empty removes the whole class of bug where a caller's
-- session state decides what a shared helper resolves to. It is the same reason
-- every DDL statement in this repository qualifies `second_brain.<name>`.
set search_path = ''

as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Left VOLATILE (the default). A function that assigns to `new` must not be
-- marked STABLE or IMMUTABLE, and a trigger function never benefits from either:
-- it runs once per affected row, by construction.

comment on function second_brain.set_updated_at() is
  'Shared BEFORE UPDATE trigger function: sets updated_at = now(). Attached by '
  'every table that has an updated_at column (documents, memories, '
  'user_settings), so the semantics are defined once.';
