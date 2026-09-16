-- ============================================================================
-- Auto-embed dispatch — queue a captured document for chunking + embedding
-- ============================================================================
--
-- WHAT THIS DOES
--   On the insert of an extracted document — and on the transition of
--   `extraction_status` to `'succeeded'` — this migration posts the document id to the
--   `embed` edge function through `pg_net`, fire and forget. The edge function chunks the
--   body, embeds every chunk against the configured provider, and upserts
--   `document_chunks`. Nothing in the request path waits on it.
--
-- WHY A TRIGGER AND NOT A CALLER
--   A document is born `extraction_status = 'succeeded'` inside
--   `upsert_document_captures` (20260916099000), which is called by the `process-activity`
--   edge function. A follow-up `fetch()` from that function would couple ingestion
--   availability to embedding availability, and a re-capture
--   (`on conflict … do update`) would need its own hook. A trigger fires on every path that
--   can make a document extracted, including a manual repair by an operator, which is the
--   property that makes "every document gets embedded" true rather than "every document
--   ingested through the one path we remembered to instrument".
--
-- WHY pg_net AND NOT A QUEUE TABLE
--   docs/TASKS.md records the open design question ("Nothing can enqueue the follow-up
--   work… design the queue first"). Until that queue exists, `pg_net` is the smallest thing
--   that satisfies "new documents are embedded within five minutes" without inventing a job
--   table, a claim protocol and a retry/backoff policy in the same change. See the header of
--   20260916100600_hybrid_search_rpc.sql for the retrieval half of this phase.
--
-- WHERE THE SECRETS LIVE — AND WHY NOT IN THIS FILE
--   The function URL and the dispatch token are read at fire time from Supabase Vault, by
--   name. Nothing secret is written by this migration, and the service-role key is
--   deliberately NOT hardcoded here: a credential in a migration is a credential in git
--   history forever, and it would also be wrong against every other environment the file is
--   pushed to. The operator creates the two secrets once, per environment:
--
--     select vault.create_secret(
--       'https://<project-ref>.supabase.co/functions/v1/embed',
--       'embed_function_url',
--       'URL the documents trigger posts new documents to'
--     );
--     select vault.create_secret(
--       '<service-role-key>',
--       'embed_dispatch_token',
--       'Bearer token the trigger presents to the embed function'
--     );
--
--   Until both exist the trigger does nothing but emit a `warning`, deliberately: an
--   ingest must never fail because embedding is not configured yet. The dispatch token is
--   the service-role key because the `embed` function runs with `verify_jwt = true` and its
--   `documentId` mode is a privileged background write — see supabase/functions/embed.
--
-- WHY `security definer` HERE, WHEN EVERY OTHER FUNCTION IN THIS SCHEMA IS `invoker`
--   The inserting role is `service_role` (no client can insert a document — there is no
--   INSERT policy on `documents`), and `service_role` cannot read `vault.decrypted_secrets`.
--   A `security invoker` trigger would therefore fail to resolve the URL and silently stop
--   dispatching. It is safe as `definer` because the function runs no dynamic SQL and
--   interpolates exactly one value, `new.id`, which is a `uuid`. It reads two named secrets
--   and posts them to one URL; there is no user-controlled text anywhere in the body.
--
-- IDEMPOTENT. `create or replace function` plus `drop trigger if exists` makes a replay of
-- this file safe. `create extension if not exists` covers an image that already has pg_net.
-- ============================================================================

-- pg_net installs its functions into its own `net` schema; registering the extension in
-- `extensions` keeps it out of `public` and satisfies the Supabase security advisor.
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- second_brain.documents_dispatch_embedding()
--
-- The trigger function. Fires on INSERT and on UPDATE that mentions `extraction_status`,
-- returns early for anything that is not a newly-succeeded document, and never raises on a
-- dispatch failure.
-- ---------------------------------------------------------------------------
create or replace function second_brain.documents_dispatch_embedding()
returns trigger
language plpgsql

-- See the file header: the inserting role cannot read Vault, and the body interpolates no
-- user-controlled text.
security definer
set search_path = ''

as $$
declare
  function_url   text;
  dispatch_token text;
begin
  -- Only a successfully extracted document has text worth chunking. `pending`, `failed` and
  -- `skipped` rows are not queued, and neither is a document with no body.
  if new.extraction_status <> 'succeeded' or new.extracted_text is null then
    return new;
  end if;

  -- A re-capture refreshes `last_seen_at`, `title` and `url` (upsert_document_captures sets
  -- those three), so it does not mention `extraction_status` and cannot reach this branch.
  -- This guard covers the remaining case: an UPDATE that names the column without changing
  -- the value, which would otherwise re-queue an already-embedded document.
  if tg_op = 'UPDATE' and old.extraction_status is not distinct from new.extraction_status then
    return new;
  end if;

  select secret.decrypted_secret
    into function_url
    from vault.decrypted_secrets as secret
   where secret.name = 'embed_function_url'
   limit 1;

  select secret.decrypted_secret
    into dispatch_token
    from vault.decrypted_secrets as secret
   where secret.name = 'embed_dispatch_token'
   limit 1;

  if function_url is null or dispatch_token is null then
    raise warning
      'documents_dispatch_embedding: vault secrets embed_function_url / embed_dispatch_token are not set; document % was not queued for embedding',
      new.id;
    return new;
  end if;

  begin
    perform net.http_post(
      url := function_url,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || dispatch_token
      ),
      body := pg_catalog.jsonb_build_object('documentId', new.id),
      -- Fire and forget, and bounded: a hung provider must not hold a Postgres worker. The
      -- edge function's own budget is the real limit; this is the caller-side ceiling.
      timeout_milliseconds := 5000
    );
  exception
    -- A dispatch failure is not an ingest failure. `pg_net` being unavailable, the queue
    -- being full or the URL being unreachable must leave the document row written and the
    -- user's capture intact; the document is picked up by the backfill endpoint instead.
    when others then
      raise warning
        'documents_dispatch_embedding: pg_net dispatch failed for document %: %',
        new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function second_brain.documents_dispatch_embedding() is
  'AFTER INSERT/UPDATE trigger on second_brain.documents: posts a newly extracted document '
  'id to the embed edge function via pg_net. Reads the URL and bearer token from Vault '
  'secrets embed_function_url / embed_dispatch_token and no-ops with a warning when they are '
  'absent, so a capture is never blocked by an unconfigured or unavailable embedding path. '
  'Security definer because the inserting role (service_role) cannot read Vault.';

-- `create or replace function` cannot re-create the trigger, and a replay of this file must
-- not fail on an existing one.
drop trigger if exists documents_dispatch_embedding on second_brain.documents;

create trigger documents_dispatch_embedding
  after insert or update of extraction_status on second_brain.documents
  for each row
  execute function second_brain.documents_dispatch_embedding();

-- A trigger function cannot be called directly (it returns `trigger`), but EXECUTE is
-- revoked anyway so the grant surface matches every other function in this schema. Nothing
-- but the table's own trigger may reach it.
revoke all on function second_brain.documents_dispatch_embedding()
  from public, anon, authenticated;
