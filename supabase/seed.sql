-- ---------------------------------------------------------------------------
-- Second Brain — LOCAL DEVELOPMENT SEED DATA (optional).
--
--   *** NEVER RUN THIS AGAINST A HOSTED OR PRODUCTION DATABASE. ***
--
-- It exists only to give a developer something to look at after
-- `supabase db reset` on their own machine. Every row below is fabricated.
-- `supabase db reset` applies it automatically; run it by hand from the Studio SQL
-- editor at http://127.0.0.1:55323 (the whole file is one transaction, so paste it
-- as a single script).
--
-- PREREQUISITES
--   1. The schema must exist. Every table lives in the `second_brain` schema — NOT
--      `public` — created by the first migration in supabase/migrations/, which is
--      not written yet; while that directory is empty the inserts below have
--      nothing to target and this file fails. See supabase/README.md → Status.
--      Table names below are schema-qualified on purpose: psql's default
--      search_path is `"$user", public`, and `second_brain` is not on it, so an
--      unqualified `insert into devices` would fail here even after the table
--      exists. Do not "simplify" these back to bare names.
--   2. A user must exist. This file deliberately does NOT insert into
--      `auth.users`: auth rows are owned by GoTrue, and hand-written ones break
--      logins because the password/identity columns are managed there.
--      Create the local user first, either through the Studio auth UI at
--      http://127.0.0.1:55323 (Authentication → Add user) or with the CLI:
--          supabase auth admin create-user --email dev@example.com --password devpass123
--      Then read the generated user id (Studio, or `select id, email from auth.users;`)
--      and replace EVERY occurrence of the placeholder below with it — that single
--      value is the only thing in this file you edit. There are no psql variables
--      here on purpose, so the file stays copy-pasteable into the SQL editor:
--
--          USER_ID -> 00000000-0000-0000-0000-000000000001
--
--      Row ids are fixed constants rather than `gen_random_uuid()` so that this
--      file is idempotent: re-running it re-inserts the same rows and every
--      `on conflict do nothing` swallows them.
--
-- COLUMN NAMES mirror packages/shared/src/types/{device,activity,document,topic,memory}.ts
-- and must be kept in sync with the migrations once those exist.
-- ---------------------------------------------------------------------------

begin;

-- --- Devices ---------------------------------------------------------------
-- Two devices so events can be attributed to more than one capture surface.
-- `activity_events.device_id` and `documents.device_id` reference these.
insert into second_brain.devices (id, user_id, platform, label, app_version, os_version, last_seen_at, created_at)
values
  (
    '1a000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'chrome-extension',
    'Dev laptop — Chrome',
    '0.1.0',
    'Windows 11',
    now() - interval '5 minutes',
    now() - interval '30 days'
  ),
  (
    '1a000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'android',
    'Dev phone — Pixel',
    '0.1.0',
    'Android 14',
    now() - interval '2 hours',
    now() - interval '21 days'
  )
on conflict do nothing;

-- --- Activity events -------------------------------------------------------
-- The promoted columns (`domain`, `duration_seconds`) carry what the read paths
-- and the scoring engine query directly; the variant-specific fields live in
-- `payload`. That split is enforced by `activity_events_promoted_fields_check`,
-- which requires `domain` for page_view/page_read and `duration_seconds` for
-- page_view, youtube_watch and app_session. `metadata` is left empty: in
-- production it holds ingest-derived annotations (`syncLagMs`, `occurredAtClamped`,
-- `confidenceCheck`), none of which a hand-written seed has.
insert into second_brain.activity_events (
  id, user_id, device_id, type, occurred_at, received_at, importance, dedupe_key,
  url, title, domain, duration_seconds, payload, metadata
)
values
  (
    '2a000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '1a000000-0000-4000-8000-000000000001',
    'page_view',
    now() - interval '3 hours',
    now() - interval '3 hours' + interval '2 seconds',
    0.42,
    'seed-page-view-postgres-indexing',
    'https://www.postgresql.org/docs/current/indexes.html',
    'PostgreSQL: Indexes',
    'postgresql.org',
    184,
    '{"durationMs": 184000, "scrollDepthPct": 78}'::jsonb,
    '{}'::jsonb
  ),
  (
    '2a000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '1a000000-0000-4000-8000-000000000001',
    'page_read',
    now() - interval '3 hours' + interval '4 minutes',
    now() - interval '3 hours' + interval '4 minutes' + interval '1 second',
    0.71,
    'seed-page-read-pgvector-hnsw',
    'https://supabase.com/blog/pgvector-performance',
    'pgvector performance: HNSW vs IVFFlat',
    'supabase.com',
    512,
    '{"wordCount": 2140, "readingTimeSeconds": 512, "contentHash": "seed-content-hash-pgvector-performance"}'::jsonb,
    '{}'::jsonb
  ),
  (
    '2a000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    '1a000000-0000-4000-8000-000000000001',
    'selection',
    now() - interval '3 hours' + interval '6 minutes',
    now() - interval '3 hours' + interval '6 minutes' + interval '1 second',
    0.55,
    'seed-selection-hnsw-build-cost',
    'https://supabase.com/blog/pgvector-performance',
    'pgvector performance: HNSW vs IVFFlat',
    'supabase.com',
    null,
    '{"selectionLength": 96, "text": "HNSW indexes build slower than IVFFlat but give better recall at low ef_search values."}'::jsonb,
    '{}'::jsonb
  ),
  (
    '2a000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    '1a000000-0000-4000-8000-000000000002',
    'youtube_watch',
    now() - interval '1 day' - interval '2 hours',
    now() - interval '1 day' - interval '2 hours' + interval '3 seconds',
    0.63,
    'seed-youtube-vector-db-explained',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'Vector databases explained',
    'youtube.com',
    900,
    '{"videoId": "dQw4w9WgXcQ", "channelName": "Dev Channel", "watchedSeconds": 640, "watchedPct": 0.71, "transcriptAvailable": true}'::jsonb,
    '{}'::jsonb
  ),
  (
    '2a000000-0000-4000-8000-000000000005',
    '00000000-0000-0000-0000-000000000001',
    '1a000000-0000-4000-8000-000000000002',
    'app_session',
    now() - interval '1 day' - interval '6 hours',
    now() - interval '1 day' - interval '6 hours' + interval '2 seconds',
    0.38,
    'seed-app-session-notes',
    null,
    'Notes',
    null,
    420,
    '{"packageName": "com.example.notes", "appLabel": "Notes", "isForeground": true}'::jsonb,
    '{}'::jsonb
  )
on conflict do nothing;

-- --- Topics ----------------------------------------------------------------
-- `centroid` is left null: centroids are produced by the topic-classification
-- pipeline, and a fabricated vector here would silently be worse than no vector.
insert into second_brain.topics (
  id, user_id, slug, label, description, parent_id, keywords, category_slug,
  document_count, memory_count, centroid, first_seen_at, last_seen_at
)
values
  (
    '5a000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'databases',
    'Databases',
    'Storage engines, indexing, query planning, and vector search.',
    null,
    array['postgres', 'index', 'hnsw', 'vector', 'query planner'],
    'engineering',
    0,
    0,
    null,
    now() - interval '30 days',
    now() - interval '3 hours'
  ),
  (
    '5a000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'retrieval-quality',
    'Retrieval quality',
    'Hybrid search, reranking, and evaluating whether recall is actually good.',
    null,
    array['retrieval', 'reranking', 'recall', 'hybrid search'],
    'engineering',
    0,
    0,
    null,
    now() - interval '12 days',
    now() - interval '1 day'
  ),
  (
    '5a000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'personal-knowledge-management',
    'Personal knowledge management',
    'Capture, note-taking, and note longevity practices.',
    null,
    array['pkm', 'notes', 'second brain', 'zettelkasten'],
    'learning',
    0,
    0,
    null,
    now() - interval '8 days',
    now() - interval '1 day'
  )
on conflict do nothing;

-- --- Documents -------------------------------------------------------------
-- Topic links are not seeded: they live in the schema's document/topic join
-- table, whose name is set by the migration that does not exist yet. Link them in
-- Studio if you want to exercise topic filters.
insert into second_brain.documents (
  id, user_id, source, url, canonical_url, title, author, site_name, published_at,
  captured_at, word_count, reading_time_seconds, content_hash, extracted_text,
  summary, language, importance, device_id, extraction_status
)
values
  (
    '3a000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'web',
    'https://supabase.com/blog/pgvector-performance',
    'https://supabase.com/blog/pgvector-performance',
    'pgvector performance: HNSW vs IVFFlat',
    'Supabase',
    'supabase.com',
    now() - interval '40 days',
    now() - interval '3 hours',
    2140,
    512,
    'seed-content-hash-pgvector-performance',
    E'HNSW indexes build slower than IVFFlat but give better recall at low ef_search values.\nThe post benchmarks recall against build time for 1M 1536-dimension vectors.',
    'Benchmarks of pgvector index types for large embedding sets, with tuning guidance.',
    'en',
    0.71,
    '1a000000-0000-4000-8000-000000000001',
    'succeeded'
  ),
  (
    '3a000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'youtube',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'Vector databases explained',
    'Dev Channel',
    'youtube.com',
    now() - interval '9 days',
    now() - interval '1 day' - interval '2 hours',
    1180,
    283,
    'seed-content-hash-vector-databases-explained',
    E'Transcript placeholder: an overview of approximate nearest neighbour search and when a dedicated vector database is worth it.',
    'Talk-style overview of vector search trade-offs versus plain Postgres.',
    'en',
    0.63,
    '1a000000-0000-4000-8000-000000000002',
    'succeeded'
  )
on conflict do nothing;

-- --- Document chunks -------------------------------------------------------
-- `embedding` stays null: vectors come from the `embed` edge function, and a seeded
-- fake vector would make similarity search return nonsense that looks plausible.
-- These rows are the natural first input to that function once it exists.
insert into second_brain.document_chunks (
  id, document_id, user_id, ordinal, text, token_count, heading_path, strategy,
  content_hash, embedding, embedding_model
)
values
  (
    '4a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    0,
    'pgvector supports HNSW and IVFFlat indexes. HNSW builds slower but reaches higher recall at low ef_search values.',
    28,
    array['Index types'],
    'recursive',
    'seed-chunk-hash-0001',
    null,
    null
  ),
  (
    '4a000000-0000-4000-8000-000000000002',
    '3a000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    1,
    'IVFFlat is cheaper to build and needs representative data present before the index is created; HNSW does not.',
    23,
    array['Index types', 'Build cost'],
    'recursive',
    'seed-chunk-hash-0002',
    null,
    null
  ),
  (
    '4a000000-0000-4000-8000-000000000003',
    '3a000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    2,
    'Recall is measured against a brute-force scan baseline; m and ef_construction dominate HNSW build time and index size.',
    21,
    array['Benchmarks'],
    'recursive',
    'seed-chunk-hash-0003',
    null,
    null
  ),
  (
    '4a000000-0000-4000-8000-000000000004',
    '3a000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    0,
    'Approximate nearest neighbour search trades a little recall for a large speed-up over exact search.',
    19,
    array['What ANN means'],
    'recursive',
    'seed-chunk-hash-0004',
    null,
    null
  ),
  (
    '4a000000-0000-4000-8000-000000000005',
    '3a000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    1,
    'Postgres with pgvector covers the common case; a dedicated vector store earns its complexity at very large scale or with heavy filtering.',
    24,
    array['Build vs buy'],
    'recursive',
    'seed-chunk-hash-0005',
    null,
    null
  )
on conflict do nothing;

-- --- Memories --------------------------------------------------------------
-- One `active` fact and one `candidate` insight, so the UI has both a decided and
-- an undecided memory to render. `source_chunk_ids` point at the chunks above so
-- citations resolve without any pipeline run. Topic links are omitted for the same
-- reason as documents: they live in a join table.
-- `statement_hash` is NOT NULL with no default once
-- 20260916097000_add_statement_hash_to_memories.sql has run, and it is the
-- uniqueness key on `(user_id, statement_hash)` — so it must be supplied here, and
-- the two values must differ. Each digest below is
--   encode(sha256(btrim(regexp_replace(<statement>, '\s+', ' ', 'g'))::bytea), 'hex')
-- which reproduces `sha256Hex(normalizeWhitespace(statement))` from
-- @second-brain/shared. Verified equal across both implementations; read the digest
-- contract in that migration before recomputing them by hand.
insert into second_brain.memories (
  id, user_id, kind, statement, statement_hash, status, confidence, importance,
  source_chunk_ids, source_document_ids, embedding, embedding_model, valid_from,
  valid_to, superseded_by, access_count, last_accessed_at, created_at, updated_at
)
values
  (
    '6a000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'decision',
    'Use HNSW indexes for pgvector on this project; build cost is acceptable in exchange for recall at low ef_search.',
    'ad1693a8f65bb2976a96073d7bd0f5e7473168aa17a05a1999278b8e908ad92c',
    'active',
    0.82,
    0.78,
    array['4a000000-0000-4000-8000-000000000001'::uuid, '4a000000-0000-4000-8000-000000000002'::uuid],
    array['3a000000-0000-4000-8000-000000000001'::uuid],
    null,
    null,
    now() - interval '3 hours',
    null,
    null,
    4,
    now() - interval '1 hour',
    now() - interval '3 hours',
    now() - interval '1 hour'
  ),
  (
    '6a000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'insight',
    'A dedicated vector store only earns its complexity at very large scale or with heavy metadata filtering.',
    '670081b24bda10cbf8c83dfe2fbb11fc0e8541ab6d5d5dd0b087153c0a3a1a50',
    'candidate',
    0.61,
    0.44,
    array['4a000000-0000-4000-8000-000000000005'::uuid],
    array['3a000000-0000-4000-8000-000000000002'::uuid],
    null,
    null,
    now() - interval '1 day',
    null,
    null,
    0,
    null,
    now() - interval '1 day',
    now() - interval '1 day'
  )
on conflict do nothing;

commit;
