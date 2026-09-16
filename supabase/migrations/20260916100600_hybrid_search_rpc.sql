-- ============================================================================
-- search_documents_hybrid — document-level fusion of the vector and text legs
-- ============================================================================
--
--   search_documents_hybrid(user_id uuid,
--                           query_text text,
--                           query_embedding extensions.vector(1024),
--                           match_count integer,
--                           min_rank double precision default 0)
--     returns table (id, url, title, word_count, captured_at,
--                    extraction_status, rank, excerpt)
--
-- Why this exists, and how it differs from `hybrid_search`
-- --------------------------------------------------------
-- `20260916095000_retrieval_functions.sql` already ships `hybrid_search`, which fuses the
-- chunk-vector and memory/FTS surfaces into chunk-level rows with a `source` discriminator.
-- That shape is what the phase-4 retrieval engine consumes. It is NOT what the web app's
-- search box and chat route need: both call `search_documents` and render one row per
-- *document* (title, url, word count, a leading excerpt), because a user searching for an
-- article wants the article, not three of its chunks.
--
-- So this function is the document-level counterpart of `hybrid_search`, and it returns the
-- exact column set `search_documents` returns — same names, same order, same nullability —
-- so the web layer can map both RPCs through one row shape. `search_documents` is left
-- untouched and keeps serving the keyword path and the degraded mode.
--
-- Reciprocal rank fusion, k = 60
-- -------------------------------
-- ADR-006: cosine distance and `ts_rank_cd` share no unit, so the two legs are merged by
-- *rank* rather than by score. Each list contributes `1 / (60 + rank_in_list)` per document
-- and the fused score is the sum. The constant is the TREC value carried unchanged (the same
-- 60 `services/retrieval/src/hybrid/fusion.ts` uses as `RERANK_CONSTANT`), written out here
-- because this function's signature — like `hybrid_search`'s — has no parameter for it.
--
-- `rank` is therefore on the RRF scale (a few hundredths), NOT a probability and NOT
-- comparable across result sets. `min_rank` filters on that same scale, which is why its
-- default is 0: a caller that wants "either leg found it" passes 0, and a caller that wants
-- "both legs agreed" passes a value above `1/61`.
--
-- The vector leg ranks *documents*, not chunks
-- --------------------------------------------
-- A `distinct on (document_id)` keeps each document's nearest chunk and only then assigns
-- `vector_rank`. Ranking raw chunks would let one long article — which has more chunks, and
-- therefore more chances to place several of them in the top `3 * match_count` — collect
-- several RRF contributions and swamp a shorter, more relevant document. That is a
-- chunk-count artefact, not a relevance signal.
--
-- Degraded mode
-- -------------
-- With `query_embedding` null (or no chunk yet embedded) the vector list is empty and the
-- fusion degenerates to the full-text ranking without changing shape, matching
-- `hybrid_search`'s documented behaviour. The web layer additionally falls back to
-- `search_documents` when *its* embedding call fails, so a provider outage costs recall, not
-- availability.
--
-- Security model
-- --------------
-- `security invoker` and NOT `security definer`: the body reads `document_chunks` and
-- `documents`, both `enable` + `force row level security`, and running as the caller is what
-- makes their policies apply. A `security definer` version would run as the migration role
-- and turn a caller-supplied `user_id` into a way to read another user's corpus, because the
-- explicit `user_id` predicate is defence in depth and RLS is the boundary.
--
-- `set search_path = ''` (empty) forces every object to be schema-qualified. `pg_catalog` is
-- still searched implicitly, so `websearch_to_tsquery`, `ts_rank_cd`, `row_number`, `left`
-- and `greatest` resolve; `extensions.vector` and `operator(extensions.<=>)` are spelled out
-- because `extensions` is NOT on an empty search path.
--
-- Parameter references are qualified with the function name (`search_documents_hybrid.user_id`)
-- for the reason the retrieval-functions header gives: an unqualified name that could be
-- either a column or a parameter resolves by precedence, and the losing reading of
-- `d.user_id = user_id` is a tautology that returns every tenant on the service-role path.
--
-- The excerpt is truncated in SQL for the same reason `search_documents` truncates it:
-- `extracted_text` is the largest column in the schema.
-- ============================================================================

create or replace function second_brain.search_documents_hybrid(
  user_id         uuid,
  query_text      text,
  query_embedding extensions.vector(1024),
  match_count     integer,
  min_rank        double precision default 0
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
  with ts_query as (
    select websearch_to_tsquery('english', search_documents_hybrid.query_text) as tsquery
  ),

  -- One row per document: its nearest chunk and that chunk's cosine distance. `distinct on`
  -- with the ordered distance is the "best chunk per document" reduction; see the header.
  vector_candidates as (
    select distinct on (c.document_id)
      c.document_id as document_id,
      c.embedding operator(extensions.<=>) search_documents_hybrid.query_embedding as distance
    from second_brain.document_chunks as c
    join second_brain.documents as d
      on d.id = c.document_id
     and d.user_id = c.user_id
    where c.user_id = search_documents_hybrid.user_id
      and c.embedding is not null
      and d.deleted_at is null
      and search_documents_hybrid.query_embedding is not null
    order by c.document_id, distance
  ),

  -- The vector list, nearest first. `3 *` is the per-leg candidate depth all fusion functions
  -- in this schema use: deep enough that a document ranked well by the text leg can still be
  -- reached by the vector leg, shallow enough that the fused list is not dominated by noise.
  vector_hits as (
    select
      vc.document_id as document_id,
      row_number() over (order by vc.distance) as vector_rank
    from vector_candidates as vc
    order by vc.distance
    limit (greatest(coalesce(search_documents_hybrid.match_count, 0), 0) * 3)
  ),

  -- The text list, best match first. `ts_rank_cd` and normalization 32 match
  -- `search_documents` and `services/retrieval/src/hybrid/fts-search.ts`, so the fused order
  -- does not depend on which leg produced a row.
  fts_hits as (
    select
      d.id as document_id,
      row_number() over (order by ts_rank_cd(d.fts, q.tsquery, 32) desc) as fts_rank
    from second_brain.documents as d
    cross join ts_query as q
    where d.user_id = search_documents_hybrid.user_id
      and d.deleted_at is null
      and d.fts @@ q.tsquery
    order by ts_rank_cd(d.fts, q.tsquery, 32) desc, d.id
    limit (greatest(coalesce(search_documents_hybrid.match_count, 0), 0) * 3)
  ),

  -- Reciprocal rank fusion. A `full outer join` is what lets a document appear in exactly one
  -- list and still be scored; with one leg empty this is the other list's ranking unchanged.
  fused as (
    select
      coalesce(v.document_id, f.document_id) as document_id,
      coalesce(1.0 / (60 + v.vector_rank), 0)
        + coalesce(1.0 / (60 + f.fts_rank), 0) as score
    from vector_hits as v
    full outer join fts_hits as f on f.document_id = v.document_id
  )

  select
    d.id                                      as id,
    d.url                                     as url,
    d.title                                   as title,
    d.word_count                              as word_count,
    d.captured_at                             as captured_at,
    d.extraction_status                       as extraction_status,
    fused.score::real                         as rank,
    left(d.extracted_text, 4000)              as excerpt
  from fused
  join second_brain.documents as d
    on d.id = fused.document_id
   and d.user_id = search_documents_hybrid.user_id
  where d.deleted_at is null
    and fused.score >= coalesce(search_documents_hybrid.min_rank, 0)
  -- Ordered on the expression rather than the output name: `rank` is the window function's
  -- name, and `id` breaks ties so the order is total and reproducible.
  order by fused.score desc, d.captured_at desc, d.id
  limit greatest(coalesce(search_documents_hybrid.match_count, 0), 0);
$$;

comment on function second_brain.search_documents_hybrid(uuid, text, extensions.vector, integer, double precision) is
  'Document-level hybrid retrieval: cosine nearest chunk per document fused with '
  'ts_rank_cd full-text ranking by reciprocal rank fusion (k = 60, ADR-006). Returns the '
  'same column set as search_documents so both RPCs map through one row shape. Pass a null '
  'query_embedding to run the text leg alone. Soft-deleted documents are excluded. See the '
  'header of 20260916100600_hybrid_search_rpc.sql for the contract and the security model.';

-- EXECUTE belongs to signed-in callers and the service role, never to anonymous traffic or
-- the implicit PUBLIC grant `create function` installs. The migration-1 default privileges
-- already grant `authenticated`, `service_role`, and this pair makes the reachability a fact
-- stated in this file rather than an inference about migration ordering.
revoke all on function second_brain.search_documents_hybrid(uuid, text, extensions.vector, integer, double precision)
  from public, anon;
grant execute on function second_brain.search_documents_hybrid(uuid, text, extensions.vector, integer, double precision)
  to authenticated, service_role;
