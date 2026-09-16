-- ---------------------------------------------------------------------------
-- 20260916099000_upsert_document_captures.sql
--
-- Adds `second_brain.upsert_document_captures(uuid, uuid, jsonb)`: the batch
-- document write used by the `process-activity` edge function.
--
-- Depends on:
--   * 20260916091000_init_core_tables.sql            (second_brain.documents)
--   * 20260916098000_add_last_seen_at_to_documents.sql (documents.last_seen_at)
--
-- WHY THIS IS A FUNCTION AND NOT A POSTGREST UPSERT
--   The contract for this write names three columns:
--
--     ON CONFLICT (user_id, content_hash) DO UPDATE
--       SET last_seen_at = EXCLUDED.last_seen_at,
--           title        = EXCLUDED.title,
--           url          = EXCLUDED.url
--
--   PostgREST cannot express that set. Its upsert is
--   `Prefer: resolution=merge-duplicates`, which emits
--   `DO UPDATE SET <every column in the payload> = EXCLUDED.<col>`, and there is no
--   option that narrows it. The payload has to carry `captured_at` — otherwise a
--   first capture records the sync time instead of the client's own timestamp —
--   so a merge-duplicates upsert would rewrite `captured_at` on every re-capture.
--   `captured_at` is the sort key of `documents_user_captured_id_idx`, so that
--   would silently reorder the user's document list. Writing the statement in SQL
--   is what keeps the update set to the three columns the contract names.
--
-- CALLER OBLIGATIONS — this function does not re-check any of them
--   1. `p_user_id` MUST be derived from the verified caller JWT, never read from a
--      request body. It is not a value the caller is trusted about; it is a value
--      the caller is trusted to have derived correctly.
--   2. Rows in `p_documents` MUST be distinct on `content_hash`. Two rows with the
--      same hash in one statement raise `21000` — "ON CONFLICT DO UPDATE command
--      cannot affect row a second time" — and fail the entire batch. The edge
--      function collapses them before it calls.
--   3. `source`, the text bounds, `word_count`, and the ISO-8601 shape of
--      `captured_at` are validated by the edge function first. This function is the
--      write, not the validator: a bad value that reaches it fails on the
--      constraint's own error, which surfaces as a 500 rather than as a rejected
--      document.
--
-- WHY `security invoker`
--   The caller is the service role, which already bypasses RLS. Invoker rights mean
--   the function can never do more than its caller could, which is the property
--   that makes restricting EXECUTE to `service_role` below sufficient.
--
-- WHAT THIS FUNCTION DELIBERATELY DOES NOT DO
--   It does not resurrect a soft-deleted document. A re-capture whose content hash
--   matches a row with `deleted_at` set refreshes `last_seen_at`, `title` and `url`
--   on that row and leaves `deleted_at` alone, because "the user deleted this" is
--   the user's decision and not something a background sync may reverse. The row
--   stays invisible to every read path that filters `deleted_at is null`.
-- ---------------------------------------------------------------------------

create or replace function second_brain.upsert_document_captures(
  p_user_id   uuid,
  p_device_id uuid,
  p_documents jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with upserted as (
    insert into second_brain.documents (
      user_id,
      device_id,
      source,
      url,
      title,
      language,
      word_count,
      content_hash,
      extracted_text,
      extraction_status,
      captured_at,
      last_seen_at
    )
    select
      p_user_id,
      p_device_id,
      document.source,
      document.url,
      document.title,
      document.language,
      document.word_count,
      document.content_hash,
      document.extracted_text,
      -- The client already ran the extraction, so the row is born succeeded rather
      -- than pending. `documents_extraction_consistency_check` ties this value to
      -- `extracted_text` being non-null, which the recordset above guarantees.
      'succeeded',
      -- Both stamps start at the client's capture time, so a first capture has
      -- `last_seen_at = captured_at`. The DO UPDATE is what moves `last_seen_at`
      -- forward on a re-capture; `captured_at` stays where it was put.
      document.captured_at,
      document.captured_at
    from jsonb_to_recordset(p_documents) as document (
      source         text,
      url            text,
      title          text,
      language       text,
      word_count     integer,
      content_hash   text,
      extracted_text text,
      captured_at    timestamptz
    )
    on conflict (user_id, content_hash) do update
      set last_seen_at = excluded.last_seen_at,
          title        = excluded.title,
          url          = excluded.url
    returning 1
  )
  select count(*)::integer from upserted;
$$;

comment on function second_brain.upsert_document_captures(uuid, uuid, jsonb) is
  'Batch upsert of captured document bodies, idempotent on (user_id, content_hash): '
  'a re-capture refreshes last_seen_at, title and url on the existing row and inserts '
  'nothing. Returns the number of documents accepted, counting both inserts and '
  'refreshes. Caller obligations, none of which this function re-checks: p_documents '
  'rows must be distinct on content_hash (duplicates in one statement raise 21000), '
  'and p_user_id must be derived from the verified caller JWT, never from a request '
  'body. The caller is also responsible for validating source, word_count, the text '
  'bounds and the timestamp shape. Does not resurrect a soft-deleted document: a '
  're-capture refreshes such a row and leaves deleted_at set.';

-- EXECUTE belongs to the service role alone. `create function` grants EXECUTE to
-- PUBLIC by default, which on an exposed schema publishes the function as an RPC.
-- An `authenticated` caller would then reach the INSERT, be refused by the absent
-- INSERT policy (42501), and log an error for a request that should never have been
-- routable. Revoking is what keeps the write path to `service_role`, per ADR-018.
revoke all on function second_brain.upsert_document_captures(uuid, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function second_brain.upsert_document_captures(uuid, uuid, jsonb)
  to service_role;
