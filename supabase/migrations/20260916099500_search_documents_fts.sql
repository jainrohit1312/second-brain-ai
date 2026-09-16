-- ============================================================================
-- search_documents — full-text search over one user's extracted documents
-- ============================================================================
--
--   search_documents(user_id uuid,
--                    query_text text,
--                    match_count integer,
--                    min_rank double precision default 0)
--     returns table (id, url, title, word_count, captured_at,
--                    extraction_status, rank, excerpt)
--
-- Why this exists
-- ---------------
-- Retrieval in this product is hybrid (ADR-006): a vector leg over chunk
-- embeddings and a text leg over the `tsvector` indexes. Phase 1c ships the
-- text leg alone, because no embedding has been produced yet, and the vector
-- leg's entry points (`match_chunks`, `match_memories`, `hybrid_search`) all
-- require a `query_embedding` to run at all.
--
-- The text leg does not need a new index: `documents.fts` is already a stored
-- generated `to_tsvector('english', extracted_text)` column with a GIN index
-- (`documents_fts_gin_idx`, 20260916093000_init_indexes.sql). What it needs is a
-- way to *rank* the matches, which PostgREST cannot express — a filter can ask
-- `fts @@ query`, but no PostgREST operator orders by `ts_rank_cd`. Hence an RPC.
--
-- Why `ts_rank_cd` and normalization 32
-- -------------------------------------
-- Taken from `services/retrieval/src/hybrid/fts-search.ts` (`TS_RANK_FUNCTION`,
-- `TS_RANK_NORMALIZATION`), which owns the reasoning: cover density rewards query
-- terms that appear *together* rather than one term repeated, and dividing the
-- rank by itself plus one maps the unbounded score onto `[0, 1)`. Keeping the
-- function and the flag identical to that module is the point — the vector leg
-- will fuse this leg's scores, and two different rank definitions would make the
-- fused order depend on which leg ran.
--
-- Why `websearch_to_tsquery` and not `plainto_tsquery`
-- ---------------------------------------------------
-- The query string is untrusted user input arriving over HTTP. Of the tsquery
-- constructors, `websearch_to_tsquery` is the only one that parses search-box
-- syntax (quotes, `or`, `-`) *and* never raises on malformed input: `to_tsquery`
-- rejects most of what a person types, and `plainto_tsquery` silently discards
-- the phrase operators that make an exact-quote search useful. It also means an
-- empty or whitespace-only `query_text` yields an empty tsquery, which matches
-- nothing instead of erroring.
--
-- Why `extraction_status` is not in the WHERE clause
-- --------------------------------------------------
-- `documents_extraction_consistency_check` makes
-- `(extraction_status = 'succeeded') = (extracted_text is not null)` a database
-- invariant. A row only matches the tsquery if it has text, so every row this
-- function can return is already a successfully extracted one; adding the status
-- predicate would be a second, weaker copy of a check the schema already owns.
-- The status is still returned, because the caller renders it.
--
-- Why `deleted_at is null` is in the WHERE clause
-- -----------------------------------------------
-- `documents_select_own` deliberately lets a user read their own soft-deleted
-- rows so a delete can be undone, which makes `deleted_at is null` the
-- responsibility of every read path. A soft-deleted document that stayed
-- searchable is a recall leak with no error attached. The partial index
-- `documents_active_idx` (20260916093000_init_indexes.sql) is what keeps this
-- filter cheap, and the GIN index on `fts` is not partial for exactly this
-- reason — see the note on `documents_fts_gin_idx`.
--
-- Security model
-- --------------
-- `security invoker` and NOT `security definer`. Every table in this schema is
-- `enable` + `force row level security`, and a `security definer` function runs
-- as its owner — which would make this function a way to read any user's
-- documents by guessing a uuid. As `security invoker` it runs as the caller, so
-- the policies on `documents` evaluate for them.
--
-- `user_id` is taken as an argument rather than read from `auth.uid()` to match
-- `match_chunks`, `match_memories` and `hybrid_search`, which all take it
-- explicitly. It is defence in depth, not the boundary: the RLS policy is what
-- makes a wrong `user_id` return nothing instead of someone else's rows, because
-- both predicates must hold.
--
-- `set search_path = ''` (empty, so nothing is implicitly resolved) forces every
-- object reference to be schema-qualified. Same reason as the retrieval
-- functions: a caller-controlled `search_path` must never be able to shadow a
-- table or function this body calls.
--
-- The excerpt is truncated in SQL. `extracted_text` is the largest column in the
-- schema, and a result set of 20 documents would otherwise ship tens of
-- megabytes to a caller that renders the first few lines of each.
-- ============================================================================

create or replace function second_brain.search_documents(
  user_id     uuid,
  query_text  text,
  match_count integer,
  min_rank    double precision default 0
)
returns table (
  id                uuid,
  url               text,
  title             text,
  word_count        integer,
  captured_at       timestamptz,
  extraction_status text,
  rank              real,
  excerpt           text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with query as (
    select websearch_to_tsquery('english', search_documents.query_text) as tsquery
  )
  select
    d.id                                      as id,
    d.url                                     as url,
    d.title                                   as title,
    d.word_count                              as word_count,
    d.captured_at                             as captured_at,
    d.extraction_status                       as extraction_status,
    ts_rank_cd(d.fts, query.tsquery, 32)      as rank,
    left(d.extracted_text, 4000)              as excerpt
  from second_brain.documents as d
  cross join query
  where d.user_id = search_documents.user_id
    and d.deleted_at is null
    and d.fts @@ query.tsquery
    and ts_rank_cd(d.fts, query.tsquery, 32) >= coalesce(search_documents.min_rank, 0)
  -- Ordered by the expression rather than by the output column: `rank` is a
  -- non-reserved keyword (the window function's name), and an unqualified
  -- reference in ORDER BY reads as the latter to a human even where the parser
  -- accepts it. `id` breaks ties so the order is total and reproducible.
  order by ts_rank_cd(d.fts, query.tsquery, 32) desc, d.captured_at desc, d.id
  limit greatest(coalesce(search_documents.match_count, 0), 0);
$$;

comment on function second_brain.search_documents(uuid, text, integer, double precision) is
  'Ranked full-text search over one user''s extracted documents, best match first. '
  'Ranks with ts_rank_cd (normalization 32) against websearch_to_tsquery, matching '
  'services/retrieval/src/hybrid/fts-search.ts. Soft-deleted documents are excluded. '
  'See the header of 20260916099500_search_documents_fts.sql for the contract and the security model.';

-- Explicit, even though `alter default privileges in schema second_brain
-- grant execute on functions to authenticated, service_role`
-- (20260916085500_init_schema.sql) should already have covered it. The default
-- privilege is a property of the role that ran it, and this line is what makes
-- the function's reachability a fact stated in its own migration rather than an
-- inference about migration ordering.
grant execute on function second_brain.search_documents(uuid, text, integer, double precision)
  to authenticated, service_role;
