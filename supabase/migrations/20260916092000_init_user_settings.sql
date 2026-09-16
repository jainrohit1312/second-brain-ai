-- ---------------------------------------------------------------------------
-- 20260916092000_init_user_settings.sql
--
-- Creates second_brain.user_settings: exactly one row per user, holding the
-- preferences that cannot live in the client — importance-rule weights (which
-- only the server may apply), the privacy exclusion lists, category weights, and
-- the active provider/model pair.
--
-- Depends on: 20260916085500_init_schema.sql   (the schema and all its grants)
--             20260916090000_init_extensions.sql (second_brain.set_updated_at)
-- Specified by: docs/DATABASE_SCHEMA.md, and the phase-1 plan in docs/TASKS.md.
--
-- WHY THIS TABLE EXISTS
--   The original eight-table schema had no home for per-user preferences, so the
--   settings UI had nowhere to write and the importance engine had nowhere to
--   read. `importance_rules` in particular must be server-side: the client
--   pre-score is advisory and untrusted (ADR-009), and a user who could not
--   persist their weights would silently get the defaults forever.
--
-- ONE ROW PER USER, AND NO SIGNUP TRIGGER
--   `user_id` is the primary key, so a second row is impossible. No row is
--   created at signup: readers must treat "absent" as "all defaults", and the
--   insert policy exists so the first settings write can create the row lazily.
--   A signup trigger was considered and rejected — it would put a write on the
--   auth path, where a failure breaks account creation rather than settings.
--
-- THE EXCLUSION LISTS ARE A PRIVACY CONTROL, NOT PREFERENCES
--   `excluded_domains` and `excluded_apps` are inputs to the capture-time
--   exclusion check. They are `not null default '{}'` on purpose: `null` and
--   `'{}'` would otherwise be two spellings of "no exclusions", and the
--   difference between "the user excluded nothing" and "the settings row failed
--   to load" is exactly the difference that the product's one hard promise
--   ("excluded content is never captured") cannot afford to leave ambiguous. A
--   failed read must surface as an error, not as permissive defaults.
--
-- NO SECONDARY INDEXES
--   The primary key on `user_id` is the only access path this table needs; every
--   read is a single-row lookup by the authenticated user. Deliberately no index
--   belongs in 20260916093000_init_indexes.sql.
-- ---------------------------------------------------------------------------

create table if not exists second_brain.user_settings (
  -- The owner. One row per user, and the FK is what makes account deletion take
  -- the settings with it rather than orphan them.
  user_id           uuid        primary key
    references auth.users (id) on delete cascade,

  -- Serialised `ImportanceRuleOverride[]`: the `weight`/`enabled` pairs the
  -- settings UI edits, keyed by rule id. Not the whole rule — `condition` is a
  -- function and is not persistable, and the signal list is code, not data.
  importance_rules  jsonb       not null default '{}'::jsonb,

  -- Registrable domains, lowercased, no scheme and no `www.`. Matched against
  -- the canonicalized domain at capture time, before the event object is built.
  excluded_domains  text[]      not null default '{}',

  -- Android package names. An excluded package produces no event at all — not a
  -- redacted row (ADR-009, ADR-012).
  excluded_apps     text[]      not null default '{}',

  -- Per-category multipliers applied by the category router.
  category_weights  jsonb       not null default '{}'::jsonb,

  -- The active provider/model pair. Stored per user rather than only in env so
  -- that changing it is auditable and so a user can pin a model without a
  -- redeploy. `check` constraints rather than a Postgres enum, matching the
  -- Conventions section: adding a value to a Postgres enum needs
  -- `alter type … add value`, which is a worse migration than a check rewrite.
  embedding_provider text       not null default 'nvidia'
    constraint user_settings_embedding_provider_check
    check (embedding_provider in ('nvidia', 'openai', 'gemini', 'local')),

  -- Fully-qualified model id, and part of a pair with `EMBEDDING_DIMENSIONS`.
  -- This model emits 1024 dimensions, which is what every `vector(1024)` column
  -- that stores its output expects (ADR-004, ADR-021). A model whose width
  -- differs would not error — it would return plausible-looking neighbours that
  -- mean nothing — so the two values change together or not at all.
  embedding_model    text       not null default 'nvidia/nv-embedqa-e5-v5',

  llm_provider       text       not null default 'deepseek'
    constraint user_settings_llm_provider_check
    check (llm_provider in ('deepseek', 'openai', 'gemini', 'claude', 'qwen', 'local')),

  llm_model          text       not null default 'deepseek-chat',

  -- Maintained by the trigger below, never by the client. `default now()` covers
  -- the insert; without the trigger the column would freeze at creation time.
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- `enable` and `force` together. `enable` alone does not bind the table owner,
-- and every table here is owned by `postgres` — the role migrations and
-- `seed.sql` connect as — so without `force` the owner connection reads every
-- row with the policies silently bypassed. See the RLS section of
-- supabase/README.md.
-- ---------------------------------------------------------------------------

alter table second_brain.user_settings enable row level security;
alter table second_brain.user_settings force row level security;

-- Read your own settings.
create policy user_settings_select_own
  on second_brain.user_settings
  for select
  to authenticated
  using (user_id = auth.uid());

-- Create your row on first write. There is no signup trigger, so this is the
-- only way a settings row ever comes into existence.
create policy user_settings_insert_own
  on second_brain.user_settings
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- The `with check` is not redundant here. It is what stops a user from
-- reassigning `user_id` — the primary key — to another user's id in an update,
-- which would hand their settings row to someone else.
create policy user_settings_update_own
  on second_brain.user_settings
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No DELETE policy, deliberately. Settings are not user-deletable: deletion
-- happens by deleting the account, which the `on delete cascade` above handles.
-- Absence of a policy denies the operation, which is the wanted behaviour.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
--
-- `second_brain.set_updated_at()` is the shared helper from
-- 20260916090000_init_extensions.sql; every table with an `updated_at` column
-- reuses it rather than redefining it.
-- ---------------------------------------------------------------------------

create trigger user_settings_set_updated_at
  before update on second_brain.user_settings
  for each row execute function second_brain.set_updated_at();
