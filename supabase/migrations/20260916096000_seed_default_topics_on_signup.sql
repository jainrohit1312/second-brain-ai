-- ---------------------------------------------------------------------------
-- 20260916096000_seed_default_topics_on_signup.sql
--
-- Gives every new user the starter topic taxonomy from `DEFAULT_TOPICS` in
-- `@second-brain/shared`, so a fresh account has a usable topic tree instead of
-- an empty one.
--
-- Depends on: 20260916085500_init_schema.sql    (the schema and all its grants)
--             20260916090000_init_extensions.sql (second_brain.set_updated_at)
--             20260916091000_init_core_tables.sql (second_brain.topics)
-- Specified by: nothing in docs/DATABASE_SCHEMA.md. See "Provenance" below.
--
-- PROVENANCE — this file changed a convention question, so the reasoning is here
--   The migration conventions say "No seed data in migrations. Seeds belong in
--   supabase/seed.sql, so that migrations are schema-only and reproducible." That
--   rule governs literal `insert` statements that EXECUTE during a migration. It
--   does not govern a `create function` + `create trigger`: nothing here runs at
--   migration time, and the migration therefore stays schema-only and replayable.
--   The distinction matters because a real seed insert would run once against a
--   fixed, empty database, whereas this runs per user forever.
--
--   docs/DATABASE_SCHEMA.md should gain a short subsection stating that rule
--   explicitly, because it is currently implied rather than written down.
--
-- WHERE THE VALUES COME FROM
--   Not from the migration. The same conventions sentence continues: values "come
--   from shared constants, not from a migration literal". So the source of truth
--   is `DEFAULT_TOPICS` in packages/shared/src/constants/topics.ts, and the VALUES
--   lists below are a hand-maintained mirror of it — SQL cannot import a
--   TypeScript constant. Changing one without the other is the failure this comment
--   exists to prevent. `DEFAULT_TOPICS` carries the matching note.
--
-- WHY `security definer` IS MANDATORY
--   The insert into `auth.users` is performed by GoTrue as `supabase_auth_admin`,
--   which has no privileges on `second_brain` and no `usage` on the schema. A
--   `security invoker` function would fail with `permission denied for schema
--   second_brain` on every single signup. `security definer` runs the body as the
--   function owner, which is `postgres`, and that is what makes the write possible.
--
-- WHY RLS DOES NOT BLOCK THIS, AND WHY THAT MUST BE VERIFIED RATHER THAN ASSUMED
--   `topics` has `force row level security` and an insert policy
--   `with check (user_id = auth.uid())`. During a signup there is no JWT, so
--   `auth.uid()` is NULL, and `user_id = NULL` evaluates to NULL — not true — which
--   would reject the insert and, because the trigger is on the auth path, break
--   account creation outright.
--
--   It does not, because Postgres exempts superusers and `BYPASSRLS` roles from
--   row security *regardless of* `force`: `force` binds the table owner only when
--   the owner is not superuser/BYPASSRLS, and `postgres` is a superuser. So the
--   insert succeeds — but it succeeds by relying on an attribute of the function
--   owner that this migration never states.
--
--   That is a load-bearing implicit assumption on the worst possible path, so it is
--   asserted rather than reasoned about: see the local verification note in
--   docs/TASKS.md phase 1. If a future change makes the definer a non-superuser, or
--   drops `force row level security` and thereby changes the reasoning, this
--   trigger silently stops creating topics. Test it against a real signup, not by
--   reading it.
--
-- WHY THE EXCEPTION HANDLER EXISTS
--   A trigger on `auth.users` is on the account-creation path. Without a handler,
--   ANY failure here — a constraint on `topics` tightening later, a slug colliding
--   with a future rule — makes signup itself fail. That trade is wrong: a missing
--   starter taxonomy is cosmetic, an account that cannot be created is not.
--
--   The handler raises a `warning` rather than swallowing silently, so a systematic
--   failure is visible in the Postgres logs instead of becoming an invisible "this
--   user has no topics" report. The exception rolls back only this function's
--   inserts; the signup transaction itself continues.
--
-- WHY THE FUNCTION IS REVOKED FROM EVERY CLIENT ROLE
--   It is a `security definer` function living in a schema PostgREST serves
--   (ADR-020, ADR-018). Trigger functions cannot be invoked directly — Postgres
--   rejects `handle_new_user_default_topics()` with "trigger functions can only be
--   called as triggers" — but a definer function reachable by `anon` is a smell
--   worth closing explicitly rather than reasoning about. Migration 1 granted
--   EXECUTE to `authenticated` and `service_role` via `alter default privileges`,
--   so this revoke is not a no-op.
-- ---------------------------------------------------------------------------

create or replace function second_brain.handle_new_user_default_topics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Roots first: a child's insert joins against its parent, so the parent has to
  -- exist before it is looked up.
  insert into second_brain.topics (
    user_id, slug, label, description, keywords, category_slug
  )
  select
    new.id, seed.slug, seed.label, seed.description, seed.keywords, seed.category_slug
  from (
    values
      ('engineering', 'Engineering', 'Software design, implementation, tooling, and infrastructure.', array['software', 'architecture', 'api', 'testing', 'performance', 'refactoring'], 'engineering'),
      ('artificial-intelligence', 'AI & ML', 'Machine learning, language models, and applied AI systems.', array['llm', 'model', 'training', 'inference', 'prompt', 'evaluation'], 'ai'),
      ('research', 'Research', 'Papers, literature reviews, and investigative reading.', array['paper', 'study', 'survey', 'benchmark', 'methodology'], 'research'),
      ('product', 'Product', 'Product design, requirements, and user experience.', array['product', 'roadmap', 'user', 'feature', 'ux', 'spec'], 'product'),
      ('learning', 'Learning', 'Courses, tutorials, and deliberate skill development.', array['course', 'tutorial', 'lesson', 'guide', 'how-to', 'exercise'], 'learning')
  ) as seed (slug, label, description, keywords, category_slug)
  -- Idempotent against `topics_user_slug_key unique (user_id, slug)`. A retried
  -- signup, or a backfill run over existing users, must not fail here.
  on conflict (user_id, slug) do nothing;

  -- Children: `parent_id` is resolved by slug, because the row ids are generated
  -- per user and therefore unknowable in a constant.
  insert into second_brain.topics (
    user_id, slug, label, description, keywords, category_slug, parent_id
  )
  select
    new.id, seed.slug, seed.label, seed.description, seed.keywords, seed.category_slug,
    parent.id
  from (
    values
      ('databases', 'Databases', 'Storage engines, indexing, query planning, and vector search.', array['postgres', 'index', 'query planner', 'pgvector', 'transaction'], 'engineering', 'engineering'),
      ('software-architecture', 'Software architecture', 'Structure, boundaries, coupling, and long-lived design trade-offs.', array['architecture', 'modularity', 'coupling', 'boundaries', 'trade-off'], 'engineering', 'engineering'),
      ('retrieval', 'Retrieval', 'Hybrid search, ranking, and evaluating whether recall is actually good.', array['retrieval', 'ranking', 'reranking', 'recall', 'hybrid search', 'rag'], 'ai', 'artificial-intelligence'),
      ('embeddings', 'Embeddings', 'Vector representations, their dimensions, and how they are compared.', array['embedding', 'vector', 'cosine', 'dimension', 'similarity'], 'ai', 'artificial-intelligence'),
      ('personal-knowledge-management', 'Personal knowledge management', 'Capture, note-taking, and note longevity practices.', array['pkm', 'notes', 'second brain', 'zettelkasten', 'capture'], 'learning', 'learning')
  ) as seed (slug, label, description, keywords, category_slug, parent_slug)
  -- An inner join, so a child whose parent slug is missing or misspelled in the
  -- mirror above is simply not created rather than created as a second root.
  join second_brain.topics as parent
    on parent.user_id = new.id
   and parent.slug = seed.parent_slug
  on conflict (user_id, slug) do nothing;

  return new;
exception
  when others then
    raise warning 'default topics were not created for user %: % (%)',
      new.id, sqlerrm, sqlstate;
    return new;
end;
$function$;

comment on function second_brain.handle_new_user_default_topics() is
  'AFTER INSERT trigger on auth.users. Creates the starter topic taxonomy from '
  'DEFAULT_TOPICS in @second-brain/shared. Security definer because GoTrue''s role '
  'has no privileges on second_brain. Never fails signup: errors are downgraded to '
  'a warning so a cosmetic problem cannot block account creation.';

-- A definer function in a PostgREST-exposed schema, closed to every client role.
revoke all on function second_brain.handle_new_user_default_topics()
  from public, anon, authenticated;

-- `drop if exists` before `create` because Postgres has no `create trigger if not
-- exists`. Keeps the file replayable without depending on the trigger being absent.
drop trigger if exists on_auth_user_created_default_topics on auth.users;

create trigger on_auth_user_created_default_topics
  after insert on auth.users
  for each row
  execute function second_brain.handle_new_user_default_topics();
