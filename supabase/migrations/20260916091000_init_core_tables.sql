-- ---------------------------------------------------------------------------
-- 20260916091000_init_core_tables.sql
--
-- The eight application tables, in dependency order, each with its columns, its
-- constraints, its RLS policies, and its triggers. This is the migration that
-- makes the schema in docs/DATABASE_SCHEMA.md real.
--
-- Depends on: 20260916085500_init_schema.sql    (the `second_brain` schema, the
--                                                `usage` grant, and the `alter
--                                                default privileges` line that
--                                                makes these tables reachable —
--                                                without it every one of them is
--                                                invisible to `authenticated`
--                                                however correct its policies are)
--             20260916090000_init_extensions.sql (pgvector and
--                                                second_brain.set_updated_at())
-- Specified by: docs/DATABASE_SCHEMA.md — one section per table, each with its
--               own "Indexes", "Constraints", and "RLS policies" subsections.
--               Constraint and policy names below are the ones that document
--               specifies, so a `grep` in a query module or a policy test finds
--               the same string in both places.
--
-- WHY THE ORDER IS WHAT IT IS
--   devices -> activity_events -> documents -> document_chunks -> topics ->
--   memories -> document_topics -> memory_sources
--
--   Every composite foreign key needs its target's `unique (id, user_id)` to
--   exist first, and `document_topics` references two parents, so the referenced
--   table always precedes the referencing one. `auth.users` is the ultimate
--   parent and already exists. The order is not the document's, which happens to
--   list the tables in a different sequence.
--
-- WHY ONE FILE FOR EIGHT TABLES, WHEN THE SPEC IMPLIES ONE PER TABLE
--   docs/DATABASE_SCHEMA.md#a-worked-migration names a per-table file
--   (`20260916091500_init_devices.sql`) and docs/TASKS.md repeats that split.
--   They are consolidated here because the eight tables are one dependency
--   closure: of the fifteen foreign keys in this file, ten point at another
--   table in this list and only five (the five `user_id`s) point outside it, at
--   `auth.users`. A per-table split would mean eight migrations that cannot be
--   reviewed apart from each other, because each one's foreign keys name the
--   others. The dependency note at the top of each table
--   section stands in for the "Depends on" lines the split would have produced.
--   A later *change* to any table is still its own migration, per the
--   append-only rule.
--
-- WHAT IS DELIBERATELY ABSENT
--   * No non-unique indexes, and no partial unique index. Every `create index`
--     statement the spec lists under a table's "Indexes" subsection belongs to
--     the index migrations — `document_topics_one_primary_idx` and everything
--     else — which run after this one.
--
--     Every *uniqueness* rule, by contrast, is a constraint here, named exactly
--     as the spec names it — including the ones the spec lists under "Indexes"
--     purely as an inventory of the object names: `*_pkey`, the four composite-FK
--     targets `unique (id, user_id)`, and the identity/idempotency constraints
--     `activity_events_device_dedupe_key`, `documents_user_content_hash_key`,
--     `document_chunks_document_ordinal_key`, and `topics_user_slug_key`. The
--     split is deliberate and is stated from the other side in the header of
--     20260916093000_init_indexes.sql, which defers `*_pkey` and `*_key` to this
--     file for the same reason: these are the rules that say what a row *is*
--     ("this article, for this user", "this chunk's position", "this event, once
--     per device"), and a table created without them is a table that accepts
--     duplicates. Two of them are load-bearing for a caller's correctness rather
--     than for hygiene — `activity_events_device_dedupe_key` is what makes
--     `insert … on conflict do nothing` idempotent on a retried batch (ADR-010),
--     and `documents_user_content_hash_key` is the dedup identity of a document.
--
--     A composite foreign key also cannot be created unless its target unique
--     constraint already exists, so deferring the four `(id, user_id)` targets to
--     a later file would make these CREATE TABLE statements unrunnable at all.
--
--   * No `begin;` / `commit;`. The Supabase CLI wraps every migration in a
--     transaction; an explicit `begin` is ignored and emits a warning.
--
--   * No grants. 20260916085500_init_schema.sql granted both `authenticated` and
--     `service_role` all four table privileges AND installed `alter default
--     privileges` so that tables created afterwards inherit them. A grant here
--     would be redundant; a missing one there would be the bug.
--
--   * No seed data, and no `insert` of any kind. Seeds belong in
--     supabase/seed.sql, so that migrations are schema-only and reproducible.
--
--   * No Postgres `enum` types. Every enumerated value is a `text` column plus a
--     named `check`, per the Conventions table: adding a value to a Postgres enum
--     cannot be done in a transaction and removing one cannot be done at all,
--     while a `check` is an ordinary migration that mirrors the TypeScript union
--     one-for-one.
--
-- THE GUARD TRIGGERS, AND HOW "A CLIENT" IS DECIDED
--   RLS cannot restrict columns. A policy that lets a user update their own row
--   therefore lets them update *every* column of it, which would let them rewrite
--   `documents.extracted_text`, forge `memories.valid_from`, or set
--   `devices.ingest_secret_hash` to a value they chose. Four tables carry a
--   `before update` trigger that rejects changes to the derived and server-owned
--   columns and leaves the user-owned ones alone. The trigger is what makes the
--   accompanying update policy safe to grant.
--
--   The test is `current_user in ('anon', 'authenticated')` — a deny-list of the
--   only two roles a client request can ever carry — rather than an allow-list of
--   `service_role`. Two reasons. A migration, `supabase/seed.sql`, or an
--   operator's psql session connects as the owner (`postgres`) and must be able
--   to repair a row; an allow-list naming only `service_role` would refuse the
--   file that creates the schema. And a role that is neither `anon` nor
--   `authenticated` cannot reach these tables at all without being granted
--   privileges explicitly, which is a deliberate act rather than an accident.
--
--   `current_user` is the effective role for the statement. Under PostgREST that
--   is the role the request was made with: `anon` with only an anon key,
--   `authenticated` with a user JWT, `service_role` with the service key. These
--   functions are all SECURITY INVOKER so that it stays the caller's identity —
--   a SECURITY DEFINER guard would read the function owner's role and pass every
--   client through.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. devices
--    Specified by: docs/DATABASE_SCHEMA.md#devices
--    Depends on:   auth.users (already exists)
-- ===========================================================================

create table if not exists second_brain.devices (
  id                        uuid        primary key default gen_random_uuid(),
  user_id                   uuid        not null references auth.users (id) on delete cascade,

  platform                  text        not null,
  label                     text        not null default '',
  app_version               text,
  os_version                text,

  -- Server-issued only (ADR-018), and deliberately not part of the `Device`
  -- read model so it cannot leak through a serialisation path. Nullable so a
  -- device can exist before its secret is issued, and so revocation can clear it.
  ingest_secret_hash        text,
  ingest_secret_rotated_at  timestamptz,

  last_seen_at              timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  revoked_at                timestamptz,

  constraint devices_platform_check
    check (platform in ('chrome-extension','android','web','api')),

  -- a user-supplied display name must not become unbounded storage
  constraint devices_label_len_check
    check (char_length(label) <= 64),

  -- Revocation must actually revoke. Without this, a revoked device keeps a hash
  -- that still authenticates, and the only thing rejecting it is application
  -- code remembering to check `revoked_at` first.
  constraint devices_revoked_consistency_check
    check (revoked_at is null or ingest_secret_hash is null),

  -- Composite-FK target for activity_events and documents. See the file header
  -- for why this constraint cannot be deferred to the index migration.
  constraint devices_id_user_id_key unique (id, user_id)
);

alter table second_brain.devices enable row level security;
alter table second_brain.devices force row level security;

-- Read your own devices: the settings screen's device list.
create policy devices_select_own
  on second_brain.devices
  for select
  to authenticated
  using (user_id = auth.uid());

-- Rename a device, or correct its app/os version. Nothing else is writable by a
-- client — the trigger below is what enforces that.
create policy devices_update_own
  on second_brain.devices
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No INSERT policy: registration is server-side, so a client cannot mint a
-- device it was never authorised on (ADR-018). No DELETE policy: devices
-- disappear through the `auth.users` cascade, so a delete cannot orphan activity
-- events. Absence of a policy is the denial.
--
-- No `set_updated_at` trigger either: this table has no `updated_at` column. Its
-- recency columns are `created_at` and `last_seen_at`, both of which mean
-- something specific and neither of which is "row last modified".

create or replace function second_brain.devices_guard_immutable_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.user_id                     is distinct from old.user_id
      or new.ingest_secret_hash        is distinct from old.ingest_secret_hash
      or new.ingest_secret_rotated_at  is distinct from old.ingest_secret_rotated_at
      or new.created_at                is distinct from old.created_at
      or new.revoked_at                is distinct from old.revoked_at
    then
      raise exception
        'devices: user_id, ingest_secret_hash, ingest_secret_rotated_at, created_at and revoked_at are server-owned'
        using errcode = '42501',  -- insufficient_privilege
              hint = 'Secrets are issued and rotated server-side; revocation is a service-role write.';
    end if;
  end if;
  return new;
end;
$$;

-- `is distinct from` rather than `<>`: a change from NULL to a value (or back)
-- is exactly the change this trigger exists to catch, and `<>` would miss it.
create trigger devices_guard_immutable_columns
  before update on second_brain.devices
  for each row execute function second_brain.devices_guard_immutable_columns();


-- ===========================================================================
-- 2. activity_events
--    Specified by: docs/DATABASE_SCHEMA.md#activity_events
--    Depends on:   devices (composite FK), auth.users
-- ===========================================================================

create table if not exists second_brain.activity_events (
  -- Client-minted UUIDv7 in practice, so the offline queue can index and dedupe
  -- a row before it syncs. The default covers server-generated rows.
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users (id) on delete cascade,

  -- Non-null: an event with no device has no provenance and is not
  -- representable. The `no action` below is therefore the only coherent choice —
  -- `set null` is impossible against a NOT NULL column, and `cascade` would
  -- delete the user's captured history when a device row disappears. Devices are
  -- never deleted in isolation (there is no DELETE policy, and revocation is a
  -- column write), and an account deletion removes the events and the devices in
  -- the same statement, so the check passes.
  device_id           uuid        not null,
  constraint activity_events_device_fk
    foreign key (device_id, user_id) references second_brain.devices (id, user_id) on delete no action,

  type                text        not null
    constraint activity_events_type_check
    check (type in ('page_view','page_read','selection','copy','youtube_watch',
                    'app_session','search','bookmark','download')),

  -- Client-supplied and arguably untrusted: it is the ordering key for
  -- everything, it is clamped at ingest if implausible, and the clamp is
  -- recorded in `metadata.occurredAtClamped` rather than by rewriting a payload.
  occurred_at         timestamptz not null,

  -- Server-stamped. Never used for ordering, only for `syncLagMs`.
  received_at         timestamptz not null default now(),

  -- The client pre-score, immutable once written (ADR-009).
  importance          real        not null default 0,

  -- Stored rather than derived so the retention sweep is an indexed predicate
  -- (`activity_events_retention_idx`) instead of an arithmetic range over a
  -- float whose thresholds live in shared code.
  importance_band     text        not null default 'normal'
    constraint activity_events_band_check
    check (importance_band in ('noise','low','normal','high','critical')),

  -- The re-score, nullable until processing runs.
  server_importance   real,
  importance_version  text,

  -- Half of the idempotency constraint together with `device_id` (ADR-010).
  dedupe_key          text        not null,

  url                 text,
  title               text,
  domain              text,
  duration_seconds    integer,

  -- The variant-specific fields, keyed per event type. `metadata` is free-form
  -- and cross-type, including the ingest-derived annotations (`syncLagMs`,
  -- `occurredAtClamped`, `confidenceCheck`).
  payload             jsonb       not null default '{}'::jsonb,
  metadata            jsonb       not null default '{}'::jsonb,

  constraint activity_events_importance_check
    check (importance >= 0 and importance <= 1),

  constraint activity_events_server_importance_check
    check (server_importance is null or (server_importance >= 0 and server_importance <= 1)),

  -- Guarantees the promoted columns are populated exactly where the read paths
  -- assume they are. The rest of each event's shape is enforced by zod at the
  -- ingestion boundary, not here (ADR-015).
  constraint activity_events_promoted_fields_check
    check (
      (type not in ('page_view','page_read') or domain is not null)
      and (type not in ('page_view','app_session','youtube_watch') or duration_seconds is not null)
    ),

  -- A dedupe key that is empty or accidentally a whole document would either
  -- collapse unrelated events into one or defeat the unique constraint entirely.
  constraint activity_events_dedupe_key_len_check
    check (char_length(dedupe_key) between 8 and 128),

  -- The idempotency constraint: one event per device per dedupe key, which is
  -- what makes `insert … on conflict do nothing` safe on a retried batch
  -- (ADR-010). The client mints the key, so a retry after a lost response
  -- collides here instead of duplicating a row.
  constraint activity_events_device_dedupe_key unique (device_id, dedupe_key)
);

alter table second_brain.activity_events enable row level security;
alter table second_brain.activity_events force row level security;

create policy activity_events_select_own
  on second_brain.activity_events
  for select
  to authenticated
  using (user_id = auth.uid());

-- A user-initiated purge of a range. The retention sweep is a service-role job
-- and does not need a policy.
create policy activity_events_delete_own
  on second_brain.activity_events
  for delete
  to authenticated
  using (user_id = auth.uid());

-- No INSERT policy: ingestion is the only write path (ADR-018), so a client
-- cannot write activity directly and cannot bypass validation or the exclusion
-- invariant. No UPDATE policy: re-scoring writes `server_importance` under the
-- service role, so a client cannot raise its own score (ADR-009).
--
-- There is deliberately no guard trigger and no `tsvector` on this table. It is
-- the highest-write table in the schema, its only client write path is a
-- delete, and no read path wants lexical relevance over events.


-- ===========================================================================
-- 3. documents
--    Specified by: docs/DATABASE_SCHEMA.md#documents
--    Depends on:   devices (composite FK), auth.users
-- ===========================================================================

create table if not exists second_brain.documents (
  id                        uuid        primary key default gen_random_uuid(),
  user_id                   uuid        not null references auth.users (id) on delete cascade,

  -- The device that first produced the content, nullable so that losing a device
  -- does not delete the user's reading history.
  --
  -- `on delete set null (device_id)` names the column on purpose. A bare
  -- `set null` on a composite foreign key nulls *every* referencing column, and
  -- `user_id` is NOT NULL — so the bare form would make a device delete fail
  -- with a not-null violation instead of detaching the document. The column list
  -- form needs PostgreSQL 15, which is the pinned `db.major_version` and the
  -- hosted project's version.
  device_id                 uuid,
  constraint documents_device_fk
    foreign key (device_id, user_id) references second_brain.devices (id, user_id)
    on delete set null (device_id),

  source                    text        not null
    constraint documents_source_check
    check (source in ('web','youtube','pdf','gdoc','newsletter','manual')),

  url                       text,
  canonical_url             text,
  title                     text        not null default '',
  author                    text,
  site_name                 text,
  published_at              timestamptz,
  captured_at               timestamptz not null default now(),
  word_count                integer     not null default 0,
  reading_time_seconds      integer     not null default 0,
  content_hash              text        not null,

  -- Nullable because extraction can fail or not have run; `extraction_status` is
  -- the trustworthy state, and the consistency check below is what keeps the two
  -- from disagreeing.
  extracted_text            text,
  summary                   text,
  language                  text,
  importance                real        not null default 0,

  -- Denormalised cache of `document_topics`, maintained by the processing
  -- service. That table remains the source of truth; this array exists so a
  -- metadata filter is an array containment check instead of a join.
  topic_ids                 uuid[]      not null default '{}',

  extraction_status         text        not null default 'pending'
    constraint documents_extraction_status_check
    check (extraction_status in ('pending','succeeded','failed','skipped')),
  extraction_failure_reason text,
  extraction_version        text,

  -- Generated, so it cannot drift from the text it indexes, and stored, because
  -- only a stored generated column can be indexed with GIN. Configuration is
  -- `english` today; `documents.language` exists so a later migration can add
  -- per-language columns.
  fts                       tsvector generated always as (
                              to_tsvector('english',
                                coalesce(title, '') || ' ' || coalesce(extracted_text, ''))
                            ) stored,

  deleted_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- Composite-FK target for document_chunks, document_topics, and
  -- memory_sources. See the file header for why it is created here rather than
  -- in the index migration.
  constraint documents_id_user_id_key unique (id, user_id),

  -- The document dedup identity: the same article read on three devices, or
  -- reached through a tracking link, is one row. `content_hash` is over the
  -- extracted text, not the URL, so the URL is free to differ.
  constraint documents_user_content_hash_key unique (user_id, content_hash),

  constraint documents_importance_check
    check (importance >= 0 and importance <= 1),

  constraint documents_word_count_check
    check (word_count >= 0 and reading_time_seconds >= 0),

  -- A document cannot claim success with no text, or hold text while claiming it
  -- never extracted. This is the constraint that makes the failure state
  -- trustworthy rather than a null that looks like "not yet".
  constraint documents_extraction_consistency_check
    check ((extraction_status = 'succeeded') = (extracted_text is not null)),

  -- nothing soft-deleted may sit in the extraction backlog
  constraint documents_deleted_consistency_check
    check (deleted_at is null or extraction_status <> 'pending')
);

alter table second_brain.documents enable row level security;
alter table second_brain.documents force row level security;

-- Read your own documents, soft-deleted ones included, so that a delete can be
-- undone. Every read path adds `and deleted_at is null` itself, backed by the
-- partial `documents_active_idx` — the filter belongs in the query, not here.
create policy documents_select_own
  on second_brain.documents
  for select
  to authenticated
  using (user_id = auth.uid());

-- A user owns `title`, `summary`, and `deleted_at`. Everything else is guarded by
-- documents_guard_immutable_columns, below.
create policy documents_update_own
  on second_brain.documents
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- "Forget this document": a real delete, cascading to chunks, topic links, and
-- the memory_sources rows that cited them.
create policy documents_delete_own
  on second_brain.documents
  for delete
  to authenticated
  using (user_id = auth.uid());

-- No INSERT policy: documents are created by services/processing under the
-- service role.

create or replace function second_brain.documents_guard_immutable_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.user_id                   is distinct from old.user_id
      or new.content_hash            is distinct from old.content_hash
      or new.extracted_text          is distinct from old.extracted_text
      or new.word_count              is distinct from old.word_count
      or new.reading_time_seconds    is distinct from old.reading_time_seconds
      or new.source                  is distinct from old.source
      or new.captured_at             is distinct from old.captured_at
      or new.extraction_status       is distinct from old.extraction_status
    then
      raise exception
        'documents: user_id, content_hash, extracted_text, word_count, reading_time_seconds, source, captured_at and extraction_status are server-owned'
        using errcode = '42501',  -- insufficient_privilege
              hint = 'The mutable surface a user owns is title, summary and deleted_at.';
    end if;
  end if;
  return new;
end;
$$;

-- Without this trigger, `documents_update_own` would let a user rewrite
-- `extracted_text`, silently orphaning every chunk derived from it — the chunks
-- would still carry the old text, and `fts` would then index new text that no
-- chunk contains.
--
-- The guarded list is exactly the one the specification names, and it is
-- narrower than the specification's prose: the RLS section says "the mutable
-- surface a user owns is title, summary, and deleted_at", while the trigger's
-- list does not include `topic_ids`, `author`, `canonical_url`, `language`,
-- `url`, or `site_name`, so those remain client-writable through
-- `documents_update_own`. That is not an omission here — `topic_ids` in
-- particular is a denormalised cache whose desynchronisation is recoverable,
-- since every topic read path resolves through `document_topics`. Widening the
-- guard is a one-line change in a later migration if the prose is the intent.
create trigger documents_guard_immutable_columns
  before update on second_brain.documents
  for each row execute function second_brain.documents_guard_immutable_columns();

create trigger documents_set_updated_at
  before update on second_brain.documents
  for each row execute function second_brain.set_updated_at();


-- ===========================================================================
-- 4. document_chunks
--    Specified by: docs/DATABASE_SCHEMA.md#document_chunks
--    Depends on:   documents (composite FK)
-- ===========================================================================

create table if not exists second_brain.document_chunks (
  id              uuid        primary key default gen_random_uuid(),

  document_id     uuid        not null,

  -- Denormalised from the document so that RLS on this table is a single-column
  -- predicate and the HNSW index can be scoped per user. No independent foreign
  -- key to `auth.users` is needed: the composite FK below already requires this
  -- value to equal a `documents.user_id`, which cascades from `auth.users`.
  user_id         uuid        not null,

  ordinal         integer     not null,
  text            text        not null,
  token_count     integer     not null default 0,

  -- Prepended to `text` before embedding, so "see the table above" survives being
  -- chunked away from its heading. Because it is part of the embedding input, a
  -- change to how it is built changes the vector and counts as a re-embed.
  heading_path    text[]      not null default '{}',

  strategy        text        not null
    constraint document_chunks_strategy_check
    check (strategy in ('recursive','semantic','fixed')),

  -- Hash over the chunk text plus strategy, so a re-chunk is incremental.
  content_hash    text        not null,

  -- Nullable: a chunk is valid before its embedding exists, and a re-embed
  -- migration writes the new column before dropping the old one (ADR-004).
  embedding       extensions.vector(1024),
  embedding_model text,

  fts             tsvector generated always as (to_tsvector('english', text)) stored,

  created_at      timestamptz not null default now(),

  constraint document_chunks_document_fk
    foreign key (document_id, user_id) references second_brain.documents (id, user_id)
    on delete cascade,

  constraint document_chunks_ordinal_check
    check (ordinal >= 0),

  constraint document_chunks_token_count_check
    check (token_count >= 0),

  -- A vector with no stamp is unsearchable-by-policy and a stamp with no vector
  -- is a lie. Retrieval treats a missing or mismatched stamp as absent, never as
  -- approximately correct, so both halves of that rule are enforced here rather
  -- than by a code comment.
  constraint document_chunks_embedding_model_consistency_check
    check ((embedding is null) = (embedding_model is null)),

  -- Makes chunking idempotent: a re-chunk upserts by position instead of
  -- duplicating the document's chunks, and `ordinal` is what reconstructs a
  -- coherent reading order after a similarity search returns them out of
  -- sequence.
  constraint document_chunks_document_ordinal_key unique (document_id, ordinal),

  -- Composite-FK target for `memory_sources.chunk_id`. Redundant against the
  -- primary key in isolation, and required anyway: `memory_sources` references
  -- (id, user_id) so that a citation can never point at another user's chunk, and
  -- Postgres requires a matching unique constraint on the referenced columns.
  -- Every other user-owned table carries the same `(id, user_id)` constraint for
  -- the same reason; `document_chunks` was the one that had been missed.
  constraint document_chunks_id_user_id_key unique (id, user_id)
);

alter table second_brain.document_chunks enable row level security;
alter table second_brain.document_chunks force row level security;

create policy document_chunks_select_own
  on second_brain.document_chunks
  for select
  to authenticated
  using (user_id = auth.uid());

-- Normally reached through the document cascade rather than by a client naming a
-- chunk, but the policy exists so that a purge of chunk rows is not silently
-- blocked by RLS in a path that is otherwise correct.
create policy document_chunks_delete_own
  on second_brain.document_chunks
  for delete
  to authenticated
  using (user_id = auth.uid());

-- No INSERT policy and no UPDATE policy: writing text, embeddings, or a
-- re-chunk is a services/processing operation under the service role.
--
-- No guard trigger: with no client write path other than delete, there is no
-- column a client could tamper with. No `updated_at` column, so no
-- `set_updated_at` trigger.


-- ===========================================================================
-- 5. topics
--    Specified by: docs/DATABASE_SCHEMA.md#topics
--    Depends on:   auth.users; topics itself (self-referencing composite FK)
-- ===========================================================================

create table if not exists second_brain.topics (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,

  slug             text        not null
    constraint topics_slug_format_check
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  label            text        not null,
  description      text,

  -- Self-referencing composite FK: a topic hierarchy. The column list on
  -- `set null` is required for the same reason as `documents.device_fk` — the
  -- bare form would also null `user_id`, which is NOT NULL, and deleting a
  -- parent topic would fail instead of re-parenting its children.
  parent_id        uuid,
  constraint topics_parent_fk
    foreign key (parent_id, user_id) references second_brain.topics (id, user_id)
    on delete set null (parent_id),

  keywords         text[]      not null default '{}',

  -- The coarse bucket from CATEGORIES in @second-brain/shared. The default is the
  -- *value* of DEFAULT_CATEGORY_SLUG ('unclassified') from
  -- packages/shared/src/constants/categories.ts — a migration cannot reference a
  -- TypeScript constant, so the literal is duplicated here and a change to the
  -- constant is a migration in this repository, not an edit to it.
  category_slug    text        not null default 'unclassified',

  -- Denormalised, maintained by the processing service from `document_topics` and
  -- from active memories. They exist so the topic tree renders without an
  -- aggregate per node.
  document_count   integer     not null default 0,
  memory_count     integer     not null default 0,

  -- Mean embedding of the topic's chunks, for nearest-centroid assignment. No
  -- index: tens of rows, read in full (ADR-016).
  centroid         extensions.vector(1024),
  centroid_model   text,

  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),

  -- Composite-FK target for document_topics and for the self-reference above.
  -- See the file header for why it is created here.
  constraint topics_id_user_id_key unique (id, user_id),

  -- Topic identity per user. This is what makes `TopicSuggestion` idempotent —
  -- proposing an existing slug is an update, not a second topic — and it is what
  -- the signup taxonomy insert conflicts against (20260916096000).
  constraint topics_user_slug_key unique (user_id, slug),

  constraint topics_slug_len_check
    check (char_length(slug) between 2 and 64),

  constraint topics_label_len_check
    check (char_length(label) between 1 and 96),

  -- The valid set lives in CATEGORIES in shared code. A `check` enumerating it
  -- would need a migration every time the taxonomy changes, so only
  -- non-emptiness is enforced — a deliberate relaxation of the enum-as-check
  -- convention, stated so it is not mistaken for an oversight.
  constraint topics_category_slug_check
    check (category_slug <> ''),

  constraint topics_not_self_parent_check
    check (parent_id is null or parent_id <> id),

  constraint topics_counts_check
    check (document_count >= 0 and memory_count >= 0),

  constraint topics_centroid_model_consistency_check
    check ((centroid is null) = (centroid_model is null))
);

-- `topics_parent_depth_check` is deliberately absent: cycles in `parent_id` are
-- possible and are not caught here. Preventing them needs a recursive check on
-- every write; the specification records it as an open question rather than
-- leaving it silently unhandled (docs/DATABASE_SCHEMA.md#open-schema-questions).

alter table second_brain.topics enable row level security;
alter table second_brain.topics force row level security;

create policy topics_select_own
  on second_brain.topics
  for select
  to authenticated
  using (user_id = auth.uid());

-- A user may create a topic by hand, which is why this table — unlike the other
-- seven — has an insert policy.
create policy topics_insert_own
  on second_brain.topics
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Renaming, re-keywording, moving. The derived counters are guarded by the
-- trigger below.
create policy topics_update_own
  on second_brain.topics
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Cascades to `document_topics`. Memories keep their denormalised `topic_ids`,
-- which is exactly why that array is not a foreign key.
create policy topics_delete_own
  on second_brain.topics
  for delete
  to authenticated
  using (user_id = auth.uid());

create or replace function second_brain.topics_guard_counters()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.document_count is distinct from old.document_count
      or new.memory_count   is distinct from old.memory_count
      or new.centroid       is distinct from old.centroid
      or new.centroid_model is distinct from old.centroid_model
      or new.first_seen_at  is distinct from old.first_seen_at
      or new.last_seen_at   is distinct from old.last_seen_at
    then
      raise exception
        'topics: document_count, memory_count, centroid, centroid_model, first_seen_at and last_seen_at are derived'
        using errcode = '42501',  -- insufficient_privilege
              hint = 'These are computed from document_topics and from embedded chunks.';
    end if;
  end if;
  return new;
end;
$$;

-- A client that could write the counters could desynchronise the topic tree from
-- the assignments that justify it, and one that could write `centroid` could
-- hijack nearest-centroid routing for every future document.
create trigger topics_guard_counters
  before update on second_brain.topics
  for each row execute function second_brain.topics_guard_counters();

-- No `set_updated_at` trigger: this table has no `updated_at` column. Its recency
-- columns are `first_seen_at` and `last_seen_at`, both guarded above.


-- ===========================================================================
-- 6. memories
--    Specified by: docs/DATABASE_SCHEMA.md#memories
--    Depends on:   auth.users; memories itself (self-referencing composite FK)
-- ===========================================================================

create table if not exists second_brain.memories (
  id                            uuid        primary key default gen_random_uuid(),
  user_id                       uuid        not null references auth.users (id) on delete cascade,

  kind                          text        not null
    constraint memories_kind_check
    check (kind in ('fact','preference','decision','project','entity','insight','task','reference')),

  -- One self-contained proposition, written so it makes sense with no
  -- surrounding document. That is the field that gets embedded.
  statement                     text        not null,

  status                        text        not null default 'candidate'
    constraint memories_status_check
    check (status in ('candidate','active','superseded','archived','rejected')),

  -- Distinct from `importance` and never collapsed with it: a confident
  -- statement about something trivial and a speculative statement about
  -- something crucial are different things.
  confidence                    real        not null default 0.5,
  importance                    real        not null default 0,

  -- Denormalised for filter-by-topic without a join.
  topic_ids                     uuid[]      not null default '{}',

  -- Denormalised for cheap display and because these arrays survive a cascade
  -- that removes `memory_sources`. That table is the authoritative link,
  -- carrying `similarity` and a frozen `excerpt`.
  source_chunk_ids              uuid[]      not null default '{}',
  source_document_ids           uuid[]      not null default '{}',

  embedding                     extensions.vector(1024),
  embedding_model               text,

  -- When the statement became true, as distinct from when it was extracted.
  -- Backdated values are legitimate and no constraint forbids them.
  valid_from                    timestamptz not null default now(),
  valid_to                      timestamptz,

  -- The replacement. Composite so that a supersede link cannot cross users —
  -- the same structural claim ADR-003 makes for every other child row, and it
  -- costs nothing because `memories_id_user_id_key` exists for `memory_sources`
  -- in any case.
  superseded_by                 uuid,
  constraint memories_superseded_by_fk
    foreign key (superseded_by, user_id) references second_brain.memories (id, user_id)
    on delete no action,

  access_count                  integer     not null default 0,
  last_accessed_at              timestamptz,

  -- Provenance: which prompt and which model produced this statement, so a
  -- targeted re-distill is a `where` clause.
  distillation_prompt_version   text,
  distillation_model            text,

  fts                           tsvector generated always as (to_tsvector('english', statement)) stored,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  -- Composite-FK target for memory_sources and for the self-reference above.
  -- See the file header for why it is created here.
  constraint memories_id_user_id_key unique (id, user_id),

  constraint memories_confidence_check
    check (confidence >= 0 and confidence <= 1),

  constraint memories_importance_check
    check (importance >= 0 and importance <= 1),

  -- A memory is one sentence. 512 characters is generous for a statement and
  -- hostile to a paragraph, which is the point.
  constraint memories_statement_len_check
    check (char_length(statement) between 8 and 512),

  -- The temporal invariant: a superseded row must have a closed window and a
  -- named replacement. This is what makes "the belief at time t" a well-formed
  -- query, and it is also why `superseded_by` cannot be `on delete set null` —
  -- nulling it on a superseded row would violate this check.
  constraint memories_supersede_consistency_check
    check (status <> 'superseded' or (valid_to is not null and superseded_by is not null)),

  constraint memories_supersede_window_check
    check (valid_to is null or valid_to >= valid_from),

  -- A self-loop would make chain traversal non-terminating.
  constraint memories_not_self_superseding_check
    check (superseded_by is null or superseded_by <> id),

  constraint memories_embedding_model_consistency_check
    check ((embedding is null) = (embedding_model is null)),

  constraint memories_access_count_check
    check (access_count >= 0)
);

-- `superseded_by` is `on delete no action`, which is a decision the specification
-- leaves open, taken deliberately:
--   * `set null` is impossible — it would violate memories_supersede_consistency_check
--     above on exactly the rows that have a supersede link.
--   * `cascade` would make a user's "forget this" on the current belief also
--     delete every memory it superseded, silently removing history the temporal
--     queries and the citation-integrity story depend on (ADR-008).
--   * `no action` refuses that delete loudly instead, and the whole chain can
--     still be removed oldest-first by a caller that means it.
-- Account deletion is unaffected: the `auth.users` cascade removes every memory
-- in the same statement, and `no action` is checked at the end of it.

alter table second_brain.memories enable row level security;
alter table second_brain.memories force row level security;

-- Includes superseded, archived, and rejected rows: the user may see their own
-- history. Retrieval filters to `status = 'active'` in the query, not here.
create policy memories_select_own
  on second_brain.memories
  for select
  to authenticated
  using (user_id = auth.uid());

-- A user may write a memory by hand, and a hand-written memory is immediately
-- active rather than a candidate. The trigger below is update-only, so this
-- insert policy is where a client's column surface is bounded on the way in.
create policy memories_insert_own
  on second_brain.memories
  for insert
  to authenticated
  with check (user_id = auth.uid() and status = 'active');

-- Correcting a statement, changing `kind`, archiving, or rejecting.
create policy memories_update_own
  on second_brain.memories
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- "Forget this", a real delete.
create policy memories_delete_own
  on second_brain.memories
  for delete
  to authenticated
  using (user_id = auth.uid());

create or replace function second_brain.memories_guard_supersede_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.valid_from                     is distinct from old.valid_from
      or new.valid_to                     is distinct from old.valid_to
      or new.superseded_by                is distinct from old.superseded_by
      or new.embedding                    is distinct from old.embedding
      or new.embedding_model              is distinct from old.embedding_model
      or new.confidence                   is distinct from old.confidence
      or new.distillation_prompt_version  is distinct from old.distillation_prompt_version
      or new.distillation_model           is distinct from old.distillation_model
    then
      raise exception
        'memories: valid_from, valid_to, superseded_by, embedding, embedding_model, confidence and the distillation stamps are server-owned'
        using errcode = '42501',  -- insufficient_privilege
              hint = 'Superseding is a two-row service-side transaction (ADR-008).';
    end if;
  end if;
  return new;
end;
$$;

-- A user editing a statement must not be able to forge a validity window or a
-- supersede link: those columns are what citations and temporal queries depend
-- on, and re-opening a closed window would rewrite history (ADR-008).
create trigger memories_guard_supersede_columns
  before update on second_brain.memories
  for each row execute function second_brain.memories_guard_supersede_columns();

create trigger memories_set_updated_at
  before update on second_brain.memories
  for each row execute function second_brain.set_updated_at();


-- ===========================================================================
-- 7. document_topics
--    Specified by: docs/DATABASE_SCHEMA.md#document_topics
--    Depends on:   documents, topics (both composite FKs)
-- ===========================================================================

create table if not exists second_brain.document_topics (
  document_id             uuid        not null,
  topic_id                uuid        not null,

  -- Carried explicitly so RLS on this table is a single-column predicate, and so
  -- the composite foreign keys below can guarantee that both parents belong to
  -- the same user. No independent FK to `auth.users`: both composite FKs already
  -- require it, transitively.
  user_id                 uuid        not null,

  confidence              real        not null,
  is_primary              boolean     not null default false,

  -- Which classifier produced the assignment. The `where` clause of a
  -- re-classification.
  classification_version  text,

  assigned_at             timestamptz not null default now(),

  -- A surrogate id was considered and rejected: an assignment is identified by
  -- the pair, which makes reassignment an upsert and makes the link idempotent.
  constraint document_topics_pk primary key (document_id, topic_id),

  constraint document_topics_document_fk
    foreign key (document_id, user_id) references second_brain.documents (id, user_id)
    on delete cascade,

  constraint document_topics_topic_fk
    foreign key (topic_id, user_id) references second_brain.topics (id, user_id)
    on delete cascade,

  constraint document_topics_confidence_check
    check (confidence >= 0 and confidence <= 1)
);

-- The one-primary-per-document invariant is a partial unique index
-- (`document_topics_one_primary_idx`, where is_primary), so it belongs to the
-- index migration rather than here.

alter table second_brain.document_topics enable row level security;
alter table second_brain.document_topics force row level security;

create policy document_topics_select_own
  on second_brain.document_topics
  for select
  to authenticated
  using (user_id = auth.uid());

-- No write policy of any kind. Assignments are produced by
-- services/processing; the user's way to change one is to edit the topic or use
-- the review UI, both of which write through a service-role path. Absence of a
-- policy is the denial.


-- ===========================================================================
-- 8. memory_sources
--    Specified by: docs/DATABASE_SCHEMA.md#memory_sources
--    Depends on:   memories, document_chunks, documents (all composite FKs)
-- ===========================================================================

create table if not exists second_brain.memory_sources (
  memory_id     uuid        not null,
  chunk_id      uuid        not null,

  -- RLS predicate support and composite FK participation. No independent FK to
  -- `auth.users`: every composite FK below already requires this value to match
  -- a row owned by the same user.
  user_id       uuid        not null,

  -- Denormalised from the chunk so "which memories came from this document" is a
  -- single-column read rather than a join.
  document_id   uuid        not null,

  -- Nullable because a hand-written memory has no candidate-embedding comparison
  -- behind it.
  similarity    real,

  -- The span supporting the statement, frozen at write time. This is what makes
  -- a citation stable across a re-chunk, and why it is stored rather than
  -- resolved back to `document_chunks.text`.
  excerpt       text        not null,

  created_at    timestamptz not null default now(),

  -- The composite key, not a surrogate id: a memory cites a given chunk at most
  -- once, which makes the whole link idempotent across a retried distillation.
  constraint memory_sources_pk primary key (memory_id, chunk_id),

  constraint memory_sources_memory_fk
    foreign key (memory_id, user_id) references second_brain.memories (id, user_id)
    on delete cascade,

  constraint memory_sources_chunk_fk
    foreign key (chunk_id, user_id) references second_brain.document_chunks (id, user_id)
    on delete cascade,

  constraint memory_sources_document_fk
    foreign key (document_id, user_id) references second_brain.documents (id, user_id)
    on delete cascade,

  -- Cosine similarity's actual range. A value outside it is a bug, not data.
  constraint memory_sources_similarity_check
    check (similarity is null or (similarity >= -1 and similarity <= 1)),

  -- An excerpt is a span, not the document, and it must be non-empty because a
  -- citation with no quoted text is unverifiable.
  constraint memory_sources_excerpt_len_check
    check (char_length(excerpt) between 1 and 2000)
);

-- All three foreign keys cascade. Deleting a document removes its chunks, which
-- removes the `memory_sources` rows that cited them, while the memory itself
-- survives: nothing cascades into `memories`, and its `source_chunk_ids` /
-- `source_document_ids` arrays are denormalised, so the provenance pointer
-- outlives the quoted span. See
-- docs/DATABASE_SCHEMA.md#what-happens-to-the-evidence-when-the-source-is-deleted.

alter table second_brain.memory_sources enable row level security;
alter table second_brain.memory_sources force row level security;

create policy memory_sources_select_own
  on second_brain.memory_sources
  for select
  to authenticated
  using (user_id = auth.uid());

-- No write policy: the table is written by the distillation persistence
-- transaction, which runs as the service role.
--
-- No guard trigger and no `updated_at` column: the row is written once and never
-- edited, which is what "frozen excerpt" means in practice.
