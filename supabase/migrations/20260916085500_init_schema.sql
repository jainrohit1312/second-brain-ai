-- ---------------------------------------------------------------------------
-- 20260916085500_init_schema.sql
--
-- Migration 1 of 9. Creates the application schema and its privileges, and
-- nothing else.
--
-- Everything Second Brain owns lives in the `second_brain` schema, never in
-- `public`. Rationale: ADR-020 in docs/DECISIONS.md; full shape: the
-- "Schema strategy" section of docs/DATABASE_SCHEMA.md.
--
-- WHY THIS MUST BE FIRST
--   Every later migration qualifies its objects as `second_brain.<name>`, because
--   migrations run as `postgres`, whose search_path is `"$user", public` — an
--   unqualified `create table documents (…)` would either fail or, worse, create
--   the table in `public`. So the schema has to exist before any of them run.
--   `if not exists` makes this correct both locally (where it creates the schema)
--   and on the hosted project (where an empty `second_brain` schema already exists
--   and must not cause a failure).
--
-- WHY THE GRANTS LIVE HERE RATHER THAN "LATER"
--   An RLS policy is a filter applied on top of the privilege check, not a
--   substitute for it. A role without USAGE on the schema cannot reach a table at
--   all, and the error is `permission denied for schema second_brain` — which
--   points at nothing RLS-related, so the policies get rewritten while the real
--   cause goes unexamined. Supabase's default privileges cover `public` only, so a
--   custom schema starts with nothing and everything has to be granted explicitly.
--
--   `alter default privileges` is the easy part to forget and the most expensive
--   to omit: without it, a table created by a later migration inherits no
--   privileges whatsoever, and that failure surfaces in *that* migration long after
--   this one is considered done. It applies to objects created by the role running
--   this statement, which is exactly why it belongs in the same migration as
--   `create schema`, while every object is still owned by the migration role.
--
--   Both roles need table privileges, and the reason is NOT symmetric:
--     * `authenticated` needs them because the policy is evaluated *after* the
--       privilege check; without the grant the policy is never reached.
--     * `service_role` needs them despite holding BYPASSRLS, because BYPASSRLS
--       exempts it from policies, not from the privilege system. Omitting it
--       breaks every edge function's privileged client while the policies make it
--       look allowed.
--
-- WHAT IS DELIBERATELY ABSENT
--   No `enable row level security` and no policies. RLS belongs in the migration
--   that creates each table: a table that exists without RLS is readable with the
--   anon key that ships in three client bundles, so the gap between creating a
--   table and protecting it is a real exposure, not a formality. See the migration
--   conventions in docs/DATABASE_SCHEMA.md.
--
--   No explicit `begin;`/`commit;`. The Supabase CLI wraps every migration file in
--   a transaction already; an explicit `begin` emits "there is already a
--   transaction in progress" and is ignored.
--
-- IDEMPOTENT. `create schema if not exists`, `grant`, and `revoke` are all
-- naturally idempotent, so no guard is needed and a replay is harmless.
-- ---------------------------------------------------------------------------

create schema if not exists second_brain;

comment on schema second_brain is
  'Second Brain application objects: tables, enums, RPCs, and trigger helpers. '
  'Deliberately separate from `public` so that both the PostgREST exposure list '
  'and the privilege story are explicit rather than inherited. See ADR-020.';

-- --- Schema-level privileges ------------------------------------------------
-- USAGE on the schema is a prerequisite for touching anything inside it.
grant usage on schema second_brain to authenticated, service_role;

-- Defence in depth, and documentation of intent. A brand-new schema grants
-- nothing to `anon` by default, so this is normally a no-op — but every policy in
-- this schema is written as `auth.uid() = user_id`, which is null for `anon`, so
-- anonymous access can only ever return zero rows while still widening the
-- reachable surface. Stating the revoke beats depending on the absence of a grant.
revoke all on schema second_brain from anon;

-- --- Objects that already exist --------------------------------------------
-- A no-op on a fresh database. This is the repair path for the case where a
-- migration created an object before the corresponding `alter default privileges`
-- took effect, which is the one way a table can end up ungranted.
grant select, insert, update, delete on all tables in schema second_brain
  to authenticated, service_role;

grant usage, select on all sequences in schema second_brain
  to authenticated, service_role;

-- --- Objects created by later migrations ------------------------------------
-- Written once here so no later migration has to remember.
alter default privileges in schema second_brain
  grant select, insert, update, delete on tables to authenticated, service_role;

-- The design uses UUID primary keys, so there are no sequences today. Granted
-- forward anyway: the failure mode of a missing sequence grant is a broken insert
-- with a confusing error, and one line here removes the class of problem.
alter default privileges in schema second_brain
  grant usage, select on sequences to authenticated, service_role;

-- The retrieval RPCs (`match_chunks`, `match_memories`, `hybrid_search`) are
-- called by `authenticated` directly, so EXECUTE must survive any project-level
-- tightening of Postgres's default PUBLIC grant.
alter default privileges in schema second_brain
  grant execute on functions to authenticated, service_role;
