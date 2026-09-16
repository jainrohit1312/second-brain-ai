-- ---------------------------------------------------------------------------
-- 20260916098000_add_last_seen_at_to_documents.sql
--
-- Adds `second_brain.documents.last_seen_at`: when this document was most
-- recently captured again.
--
-- Depends on: 20260916091000_init_core_tables.sql (second_brain.documents)
--
-- WHY THIS MIGRATION EXISTS
--   The `process-activity` edge function's Phase 1b-1 document upsert is
--   `INSERT ... ON CONFLICT (user_id, content_hash) DO UPDATE SET last_seen_at =
--   EXCLUDED.last_seen_at, title = ..., url = ...`. No `documents` column can
--   satisfy that assignment today, so the statement would fail with
--   `42703 undefined_column` and take every document batch down with it.
--
-- WHY A NEW COLUMN RATHER THAN AN EXISTING ONE
--   Both plausible substitutes are already spoken for, and using either would
--   quietly change what a value means:
--
--     * `captured_at` is "when the user first captured it" (docs/DATABASE_SCHEMA.md
--       #documents), it is listed in `documents_guard_immutable_columns` as
--       server-owned, and `documents_user_captured_id_idx` orders the document
--       list on it. Overwriting it on a re-capture would silently reorder the
--       user's history.
--     * `updated_at` is bumped by `documents_set_updated_at` on *any* update,
--       including the title edit a user makes in the UI. It therefore answers
--       "did this row change", not "was this read again", and the two facts have
--       to stay apart: a document the user renamed last week and has not opened
--       since must not look freshly seen.
--
-- NO BACKFILL STATEMENT
--   The column is `not null default now()`, so a table that holds rows gets a
--   value for each of them from the ALTER itself. This is written down because
--   20260916097000 carries an explicit backfill for the same situation: it had
--   to, because it added its column with a placeholder default and then dropped
--   it. No placeholder is involved here. The table is in any case empty — nothing
--   has ever written a `documents` row (Phase 1b-1 is the first writer), which is
--   why the value an existing row would receive is not worth debating.
--
-- NO INDEX, DELIBERATELY
--   Nothing reads or orders by `last_seen_at` yet. `20260916093000_init_indexes.sql`
--   adds indexes alongside the read paths that want them, so the index arrives
--   with the first query that filters or sorts on this column rather than ahead
--   of it.
-- ---------------------------------------------------------------------------

alter table second_brain.documents
  add column if not exists last_seen_at timestamptz not null default now();

comment on column second_brain.documents.last_seen_at is
  'When this document was most recently captured again. Written by the '
  'process-activity edge function''s upsert (ON CONFLICT (user_id, content_hash) '
  'DO UPDATE), so re-capturing an existing document refreshes this value instead '
  'of inserting a second row. Distinct from captured_at (first capture, '
  'server-owned and immutable) and from updated_at (bumped by any update, '
  'including a user edit to title).';
