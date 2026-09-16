-- ---------------------------------------------------------------------------
-- 20260916093000_init_indexes.sql
--
-- Creates every non-vector index on the eight application tables: the
-- keyset-pagination orderings, the GIN indexes (full-text and array containment),
-- the partial indexes, and the one partial *unique* index that is an index rather
-- than a table constraint.
--
-- Depends on: 20260916085500_init_schema.sql      (the schema and its grants)
--             20260916090000_init_extensions.sql  (pgvector; not needed here, but
--                                                  this file follows it in the
--                                                  history and must not be
--                                                  reordered ahead of it)
--             20260916091000_init_core_tables.sql (the eight tables)
-- Specified by: docs/DATABASE_SCHEMA.md, the `### Indexes` subsection of each
--               table; ADR-017 (docs/DECISIONS.md) for the column order of every
--               keyset-pagination index.
--
-- WHY THE INDEXES ARE A SEPARATE MIGRATION FROM THE TABLES
--   "One concern per migration" (docs/DATABASE_SCHEMA.md#migration-conventions).
--   The tables carry their columns, checks, and composite FKs; the indexes are
--   their own concern, and keeping them separate makes it possible to read the
--   index design for the whole schema in one screen without the DDL between.
--   The vector indexes are separated again (20260916094000) because an HNSW
--   build is the one index operation in this schema with a materially different
--   cost profile — it is the operation a large future corpus will make slow, and
--   the file a future re-embed migration has to reason about (ADR-004, ADR-016).
--
-- WHY EVERY KEYSET INDEX ENDS IN `id desc`
--   ADR-017 chooses keyset pagination over offset pagination. The cursor is a
--   row-tuple comparison — `(captured_at, id) < ($ts, $id)` — which the planner
--   can only turn into an index seek if the index's column order is *exactly* the
--   ordering the comparison and the `order by` use. Drop the trailing `id desc`,
--   or move `id` ahead of the timestamp, and the query still returns correct rows
--   and silently degrades to a sort of the whole user's partition: correct
--   results, no index, and no error to notice. `occurred_at` and `captured_at`
--   are not unique (a `selection` and a `copy` in the same second are routine),
--   so the tiebreaker is not decoration.
--
-- WHY EVERY LEADING COLUMN IS `user_id`
--   ADR-003: one shared schema, RLS as the boundary, so every index a user-scoped
--   read can use must lead with `user_id` or be partial. The two exceptions here
--   are deliberate and are named at their index:
--   `activity_events_retention_idx` (a global cross-user sweep) and
--   `memory_sources_memory_idx` / `memory_sources_document_idx` /
--   `document_topics_topic_confidence_idx` / `memory_sources_chunk_idx`
--   (reverse lookups that are only ever reached *from* a row already scoped).
--
-- WHAT IS DELIBERATELY ABSENT
--   No tables, columns, constraints, policies, triggers, grants, or seed data.
--   No vector index — see 20260916094000_init_vector_indexes.sql.
--   No `activity_events_payload_gin_idx`: the specification marks it
--   "Deferred to phase 6" (docs/DATABASE_SCHEMA.md, `activity_events` index
--   table), to be added when a real query filters on a payload key rather than
--   speculatively. Writing it now would add an index write to every ingest — the
--   highest-write table in the schema — for a read path that does not exist.
--   No primary keys and no plain unique constraints: `*_pkey` and `*_key` are
--   created by 20260916091000_init_core_tables.sql alongside the columns they
--   constrain, including every composite-FK target (`(id, user_id)`) and the
--   idempotency/dedup constraints (`(device_id, dedupe_key)`,
--   `(user_id, content_hash)`, `(document_id, ordinal)`). Those are constraints,
--   not indexes, even where the schema document lists them under "Indexes" for
--   completeness of the index inventory.
--
-- NO `begin;` / `commit;`. The Supabase CLI wraps each migration file in a
-- transaction already; an explicit `begin` is ignored and emits a notice.
--
-- IDEMPOTENT. Every statement is `create index if not exists`, so replaying this
-- file against a database that already has the indexes is harmless.
--
-- NOTE ON CONCURRENT BUILDS. These are plain `create index`, which takes an
-- ACCESS EXCLUSIVE lock on the table for the duration. That is correct here
-- because every table this migration runs against is empty at the time it runs.
-- A later migration adding an index to a populated table must use
-- `create index concurrently` in its own migration instead (it cannot run inside
-- the CLI's transaction), which is exactly why ADR-004 puts the re-embed build in
-- a migration of its own.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- devices
-- The settings screen's device list. Ordered by recency, so `created_at desc`.
-- There is deliberately no index on `ingest_secret_hash`: ingest resolves the
-- device by primary key first, so a hash index would only make an unindexed
-- full-table scan in the wrong direction look supported.
-- ---------------------------------------------------------------------------

create index if not exists devices_user_id_created_at_idx
  on second_brain.devices (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- activity_events
-- The highest-write table in the schema, so every index here is paid for on
-- every ingest. Each one is on a documented read path and none is speculative.
-- ---------------------------------------------------------------------------

-- The keyset pagination index for the activity dashboard (ADR-017), and the
-- ordering index for the temporal query intent. `(user_id, occurred_at desc,
-- id desc)` is the exact ordering the cursor's row-tuple comparison uses.
create index if not exists activity_events_user_occurred_id_idx
  on second_brain.activity_events (user_id, occurred_at desc, id desc);

-- Per-type filtering in the dashboard and the `activity` intent's aggregates.
-- No tiebreaker column: this index is a filter-and-order, not a cursor traversal.
create index if not exists activity_events_user_type_occurred_idx
  on second_brain.activity_events (user_id, type, occurred_at desc);

-- Per-site time aggregation. Partial because `app_session` rows have no domain,
-- so `domain is not null` is true for every row this index can serve and the
-- index does not carry the rows it could never match.
create index if not exists activity_events_user_domain_occurred_idx
  on second_brain.activity_events (user_id, domain, occurred_at desc)
  where domain is not null;

-- The retention sweep's driving index (docs/DATABASE_SCHEMA.md#retention-and-ttl).
-- Deliberately does *not* lead with `user_id`, unlike every other index in this
-- file: the sweep is a global cross-user statement
-- (`where importance_band in (…) and occurred_at < now() - interval '…'`) that
-- has no user in its predicate, so a user-led index would not serve it at all.
-- `occurred_at` second and untiebroken because the sweep deletes a range of
-- timestamps rather than paging through a total order.
create index if not exists activity_events_retention_idx
  on second_brain.activity_events (importance_band, occurred_at)
  where importance_band in ('noise', 'low');

-- The per-device filter and the sync-cursor read. `device_id` second, after
-- `user_id`, because the sync cursor is issued per device for a known user.
create index if not exists activity_events_user_device_occurred_idx
  on second_brain.activity_events (user_id, device_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

-- Keyset pagination for the document list (ADR-017). Same total order as the
-- activity list, over `captured_at` rather than `occurred_at`.
create index if not exists documents_user_captured_id_idx
  on second_brain.documents (user_id, captured_at desc, id desc);

-- The `sourceTypes` metadata filter.
create index if not exists documents_user_source_captured_idx
  on second_brain.documents (user_id, source, captured_at desc);

-- The dashboard's "most important recent" view. `importance desc` before
-- `captured_at desc` — the ranking column is the filter, so it must come first
-- for the sort to be served by the index rather than by a sort node.
create index if not exists documents_user_importance_idx
  on second_brain.documents (user_id, importance desc, captured_at desc);

-- The full-text leg of hybrid retrieval (ADR-006). `fts` is a generated *stored*
-- column, which is what makes it indexable with GIN at all — a virtual generated
-- column could not be. The index is not partial: unlike `memories`, a soft-deleted
-- document is filtered by `deleted_at is null` in the query, and the retrieval
-- paths that use this index are the same ones that already filter it.
create index if not exists documents_fts_gin_idx
  on second_brain.documents using gin (fts);

-- The `topicIds` metadata filter, served as `topic_ids && $1` (array overlap)
-- rather than as a join back to `document_topics`. That denormalisation is the
-- reason this GIN index exists; `document_topics` remains the source of truth.
create index if not exists documents_user_topic_ids_gin_idx
  on second_brain.documents using gin (topic_ids);

-- The extraction backlog query. Partial because the backlog is a small fraction
-- of the table: an unqualified index would be mostly rows the query never wants.
create index if not exists documents_pending_extraction_idx
  on second_brain.documents (user_id, captured_at)
  where extraction_status = 'pending';

-- Every user-facing read filters `deleted_at is null`, and that filter is applied
-- in the query rather than in the RLS policy (the policy deliberately lets a user
-- see their own soft-deleted rows so a delete can be undone). Making this the
-- cheap path is what keeps "hide a document" from costing a post-filter over the
-- user's whole document set.
create index if not exists documents_active_idx
  on second_brain.documents (user_id, captured_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- document_chunks
-- The vector index for this table lives in 20260916094000_init_vector_indexes.sql
-- (an HNSW build is separated for the reasons given in that file's header).
-- ---------------------------------------------------------------------------

-- The full-text leg of hybrid retrieval, at chunk granularity. The generated
-- `fts` column is `to_tsvector('english', text)`; the column exists rather than an
-- expression index so the configuration is one named thing that cannot drift
-- between the index and the queries that use it.
create index if not exists document_chunks_fts_gin_idx
  on second_brain.document_chunks using gin (fts);

-- Citation resolution and neighbour context lookups: given a document (and a
-- chunk's ordinal), fetch the surrounding ordinals. `ordinal` is third because
-- it is the ordering within a document, not a filter on its own.
create index if not exists document_chunks_user_document_idx
  on second_brain.document_chunks (user_id, document_id, ordinal);

-- The re-embed backlog query. Partial on `embedding_model is null`, which is the
-- observable form of "has no vector": `document_chunks_embedding_model_consistency_check`
-- in the table migration enforces `(embedding is null) = (embedding_model is null)`,
-- so a null stamp and a missing vector are the same condition and cannot diverge.
create index if not exists document_chunks_reembed_idx
  on second_brain.document_chunks (user_id, document_id)
  where embedding_model is null;

-- ---------------------------------------------------------------------------
-- memories
-- ---------------------------------------------------------------------------

-- Full-text over statements. Partial on `status = 'active'`, and the partiality
-- is load-bearing in the same way as the HNSW index's: retrieval must never
-- surface a superseded belief, and this makes the active-only query the indexed
-- path (ADR-008). The unfiltered query still *returns rows* — it does not error —
-- which is why the fast path being the correct path is the whole safeguard.
create index if not exists memories_fts_gin_idx
  on second_brain.memories using gin (fts)
  where status = 'active';

-- The review queue (`status = 'candidate'`) and the memory list. Not partial,
-- because both `candidate` and `active` are reached through it and the queue is
-- ordered by recency within a status.
create index if not exists memories_user_status_created_idx
  on second_brain.memories (user_id, status, created_at desc);

-- The `kinds` metadata filter.
create index if not exists memories_user_kind_status_idx
  on second_brain.memories (user_id, kind, status);

-- Temporal queries *including closed rows*. Deliberately the non-partial index:
-- `valid_to is not null` rows are exactly the ones a historical query needs, so a
-- partial index on `active` here would make "the belief at time t" unindexed.
-- Ends in `id desc` for the same keyset reason as everywhere else (ADR-017).
create index if not exists memories_user_valid_from_idx
  on second_brain.memories (user_id, valid_from desc, id desc);

-- Supersede-chain traversal, walking `superseded_by` forward one link at a time.
-- Not user-led: every hop is already within one user's chain, so the column that
-- makes the traversal cheap is the link itself. Partial so the many rows with no
-- replacement are not in the index at all.
create index if not exists memories_superseded_by_idx
  on second_brain.memories (superseded_by)
  where superseded_by is not null;

-- Topic filtering, same denormalised-array reasoning as documents.topic_ids.
create index if not exists memories_user_topic_ids_gin_idx
  on second_brain.memories using gin (topic_ids);

-- The re-embed backlog: active memories with no vector. Both predicates are
-- required — a superseded row with no vector is not a backlog item, because
-- retrieval would not read it in either leg.
create index if not exists memories_reembed_idx
  on second_brain.memories (user_id)
  where status = 'active' and embedding_model is null;

-- ---------------------------------------------------------------------------
-- topics
-- No index on `centroid`: it is `vector(1024)` but read in full (tens of rows,
-- nearest-centroid assignment is a sequential scan over a tiny table). ADR-016
-- states this explicitly so the absence is not mistaken for an omission.
-- ---------------------------------------------------------------------------

-- Rendering the topic tree: children of a known parent. `parent_id` is nullable
-- (roots), and this index covers the null-parent lookup too.
create index if not exists topics_user_parent_idx
  on second_brain.topics (user_id, parent_id);

-- The topic list's keyset pagination (ADR-017), with the same trailing `id desc`
-- tiebreaker: `last_seen_at` is bumped on every assignment and is not unique.
create index if not exists topics_user_last_seen_idx
  on second_brain.topics (user_id, last_seen_at desc, id desc);

-- The keyword first pass, served as `keywords && $1` (array overlap).
create index if not exists topics_keywords_gin_idx
  on second_brain.topics using gin (keywords);

-- Grouping the topic view by `CATEGORIES`.
create index if not exists topics_user_category_idx
  on second_brain.topics (user_id, category_slug);

-- ---------------------------------------------------------------------------
-- document_topics
-- ---------------------------------------------------------------------------

-- The one-primary invariant: a document has a single primary topic or none.
-- Written as a *unique index* rather than a table constraint because it is
-- partial (a `unique (document_id) where is_primary` constraint has no syntax),
-- so it is the one uniqueness rule in the schema that belongs to this file rather
-- than to the table migration. `is_primary` as the predicate rather than
-- `is_primary = true` matches the documented definition.
create unique index if not exists document_topics_one_primary_idx
  on second_brain.document_topics (document_id)
  where is_primary;

-- Listing a topic's documents by confidence, and the scan that recomputes
-- `topics.document_count`. Not user-led: it is reached from a topic row, which is
-- already user-scoped, and `topic_id` alone is a globally unique value.
create index if not exists document_topics_topic_confidence_idx
  on second_brain.document_topics (topic_id, confidence desc);

-- RLS predicate support: the policy is `user_id = auth.uid()`, so this is the
-- index that keeps the policy a lookup rather than a scan of every user's
-- assignments.
create index if not exists document_topics_user_idx
  on second_brain.document_topics (user_id);

-- ---------------------------------------------------------------------------
-- memory_sources
-- ---------------------------------------------------------------------------

-- Loading a memory's evidence in support order. `nulls last` is explicit and
-- required: a hand-written memory has no computed `similarity`, and with the
-- default (`nulls first` under `desc`) its unranked evidence would sort *above*
-- the evidence that was actually ranked as the best support for the statement.
create index if not exists memory_sources_memory_idx
  on second_brain.memory_sources (memory_id, similarity desc nulls last);

-- "Which memories cite this chunk" — needed when a document is deleted or a chunk
-- is re-generated, so the UI can show what was affected. Not user-led: reached
-- from a chunk, which is already scoped.
create index if not exists memory_sources_chunk_idx
  on second_brain.memory_sources (chunk_id);

-- The same question at document granularity. Denormalised from the chunk on
-- purpose, so this is a single-column read rather than a join.
create index if not exists memory_sources_document_idx
  on second_brain.memory_sources (document_id);

-- RLS predicate support.
create index if not exists memory_sources_user_idx
  on second_brain.memory_sources (user_id);
