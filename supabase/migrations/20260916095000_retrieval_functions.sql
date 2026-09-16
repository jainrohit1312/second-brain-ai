-- ---------------------------------------------------------------------------
-- 20260916095000_retrieval_functions.sql
--
-- Creates the three retrieval RPCs in `second_brain`:
--
--   match_chunks    — cosine nearest neighbours over one user's `document_chunks`
--   match_memories  — the same over that user's *active* `memories` (ADR-008)
--   hybrid_search   — both surfaces fused into one ranked list by reciprocal rank
--                     fusion (ADR-006), with a `source` discriminator of
--                     'document' | 'memory'
--
-- Depends on: 20260916085500_init_schema.sql
--               the schema, and the `alter default privileges in schema
--               second_brain grant execute on functions to authenticated,
--               service_role` line. That line is why this file adds no grants:
--               a per-function `grant execute` here would be redundant, and a
--               redundant grant is a second place the privilege story lives.
--             20260916090000_init_extensions.sql
--               pgvector, installed into the `extensions` schema. That schema
--               qualification is load-bearing below: the functions run with
--               `search_path = ''`, so both the argument type
--               (`extensions.vector(1024)`) and the distance operator
--               (`operator(extensions.<=>)`) must be spelled out or they cannot
--               be resolved at all.
--             20260916091000_init_core_tables.sql
--               `documents`, `document_chunks`, `memories` and the
--               check-constraint enums (`memory_kind`, `memory_status`) this
--               file reads and types its arguments against.
--             20260916094000_init_vector_indexes.sql
--               the two HNSW indexes the vector legs are ordered by. Without
--               them nothing here fails: the same rows come back, from a
--               sequential scan, on a query that looks identical in `explain
--               analyze` output to anyone who is not reading the plan.
-- Specified by: packages/database/src/types/database.ts — the
--               `second_brain.Functions` block, which declares these three
--               signatures field for field — and ADR-006 (reciprocal rank
--               fusion), ADR-008 (a superseded memory is never retrieved) and
--               ADR-016 (`<=>` with `vector_cosine_ops`) in docs/DECISIONS.md.
--
-- PROVENANCE GAP — READ THIS BEFORE EDITING THE FILE OR THE DOC
--   This file has no corresponding section in docs/DATABASE_SCHEMA.md, and that
--   is a gap in the document rather than in this file. That document specifies
--   the eight tables, their indexes, constraints and policies in detail and
--   stops, deliberately or not, at the index level: its "The two search
--   surfaces" section (line 718) says which column is the vector surface and
--   which is the full-text surface for each table, and its "Which rows are in
--   which surface" table (line 748) says `memories` is "yes (partial on
--   `active`)", but no section, table or code block describes the functions that
--   read those surfaces. So the authoritative specification for what is written
--   here is:
--
--     * packages/database/src/types/database.ts, `second_brain.Functions`. It is
--       the generated-types placeholder — i.e. what `pnpm db:types` (supabase gen
--       types typescript --local) is expected to emit once this migration lands.
--       Every argument name and type, every returned column and its nullability,
--       and which arguments are optional, is copied from it. A divergence here
--       does not fail this migration: it fails later, when the regenerated file
--       no longer matches the hand-written placeholder and the call sites
--       (`MatchChunksArgs`, `MatchMemoriesArgs`, every `.rpc(...)` in
--       packages/database/src/queries/) stop compiling.
--     * decisions 006, 008 and 016 in docs/DECISIONS.md, for the fusion
--       algorithm, the active-only predicate, and the distance operator.
--
--   docs/DATABASE_SCHEMA.md should gain a matching "Retrieval functions" section,
--   and the seven questions at the end of this file are the list of things it
--   has to answer. Until it exists, this file is the specification of record.
--
-- THE SECURITY MODEL OF THESE FUNCTIONS, IN ONE PLACE
--   `security invoker` (the default, stated explicitly because it is the whole
--   argument): the body executes with the *caller's* identity and privileges, so
--   the RLS policies on `document_chunks`, `documents` and `memories` are
--   evaluated against the user who made the request. All three functions are
--   `security invoker` and none may be changed to `security definer`:
--
--     * A `security definer` function runs as its owner, and every table in this
--       schema is owned by the migration role. `force row level security` exists
--       in this schema precisely because plain `enable` does not bind the owner,
--       so under `definer` the policies keep working only for as long as `auth.uid()`
--       happens to still be readable from the request JWT — and stop applying
--       entirely on any table where `force` was forgotten.
--     * The failure is silent and it is a cross-tenant read. These RPCs are
--       reachable over PostgREST, with a client-supplied vector and a
--       client-supplied `user_id`, which is exactly the shape of call where a
--       missing boundary is not noticed.
--     * Nothing needs it. Every row these functions read belongs to the caller.
--
--   `set search_path = ''` on all three, and every reference in every body is
--   schema-qualified: `second_brain.<table>`, `extensions.vector`,
--   `operator(extensions.<=>)`, `pg_catalog.<function>`. Two reasons, both
--   concrete. First, these functions take a client-supplied vector, so the
--   bodies are the most attacker-adjacent SQL in the repository; an empty search
--   path removes the temp-schema and non-`pg_catalog` shadowing class of attack
--   outright, and it makes the qualification requirement a property of the file
--   rather than of who happens to be connected. Second, `search_path` is session
--   state: an unqualified name resolves differently depending on the connection,
--   which is what ADR-020 rejects for `second_brain` itself.
--
--   `user_id` is an explicit argument, and the predicate `c.user_id =
--   match_chunks.user_id` is written in addition to RLS rather than instead of
--   it. Both, because they are different mechanisms answering different
--   questions: RLS is the boundary (it is what stops a *different* user's rows
--   from being visible at all, and it is the only thing standing between the
--   anon key and the tables), while the explicit predicate is what makes the
--   scoping (a) readable — a reviewer can see the tenant filter without reading
--   the policies — and (b) plannable, since `memories_user_kind_status_idx`,
--   `documents_active_idx` and the composite index on
--   `document_chunks (user_id, document_id, ordinal)` all lead with `user_id`.
--   It is also the *only* scoping that exists on the service-role path, where
--   `memories.ts` states plainly that "the user is identified by the argument,
--   not by the session".
--
--   Note that every parameter reference is qualified with the function name
--   (`match_chunks.user_id`, `hybrid_search.match_count`). That is not
--   decoration. Postgres resolves a bare name that could be either a parameter
--   or a column by a precedence rule, and in a function whose parameter names
--   were chosen by the client-facing API (`user_id` is required to be `user_id`)
--   the losing side of that rule produces a predicate that still parses and still
--   runs. `where c.user_id = user_id` spells `c.user_id = c.user_id` if the
--   column wins: a tautology, no error, and on the service-role path every
--   tenant's chunks. Qualifying with the function name is the documented way to
--   say *the parameter* and is unambiguous under either reading of the rule.
--
-- WHAT IS DELIBERATELY ABSENT
--   No grants. `alter default privileges … grant execute on functions` in
--   migration 1 already covers these three by name in its comment.
--   No `security definer`. See above.
--   No `volatile`. These functions only read; `volatile` would force a new
--   snapshot per call and would tell the planner the function cannot be inlined.
--   No `parallel safe` marking. The default (`unsafe`) is correct: a function
--   that is the top-level statement of a PostgREST request is never executed in
--   a parallel worker, so the marking would widen what is permitted without
--   buying anything.
--   No `begin;` / `commit;`. The Supabase CLI wraps each migration file in a
--   transaction already.
--   No tables, indexes, policies, triggers or seed data.
--
-- IDEMPOTENT. `create or replace function` makes a replay of *this* definition
-- harmless. It does not make a signature change safe: `create or replace` cannot
-- alter the argument list or the result type — Postgres creates an overload
-- instead, and the old signature keeps its old body. Changing a parameter, a
-- returned column or a name therefore needs an explicit `drop function` (with the
-- old signature) in a new migration, and this file must not be edited in place.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- match_chunks — pgvector nearest neighbours over one user's chunks
--
--   match_chunks(user_id uuid,
--                query_embedding extensions.vector(1024),
--                match_count integer,
--                match_threshold double precision default 0)
--     returns table (chunk_id, document_id, heading_path, ordinal, similarity, text)
--
-- The unit of retrieval in this system is the chunk, not the document
-- (DATABASE_SCHEMA.md#documents — "There is no `embedding` column on this
-- table"), so this is the primary vector surface, and it is the RPC
-- `ChunksQueries.matchChunks` calls.
--
-- `language sql`, and this is the right choice rather than a style preference:
-- the body is exactly one query, so there is nothing a procedural language would
-- express better — but there is something it would cost. A `language sql`
-- function with no procedural body is a candidate for inlining, which lets the
-- caller's own predicates and `limit` combine with this query's index scan. The
-- plan this depends on is `order by embedding operator(extensions.<=>) $2 limit
-- $3` served by `document_chunks_embedding_hnsw_idx`; anything that puts a
-- materialisation boundary in front of that turns the HNSW scan into a
-- sequential scan of the user's chunks with a sort on top.
--
-- COSINE, NOT L2 OR INNER PRODUCT. The operator is `<=>` (cosine distance), which
-- is the one `document_chunks_embedding_hnsw_idx` was built around
-- (`vector_cosine_ops`, ADR-016). The three pgvector operators are all valid SQL
-- and all raise nothing: `<->` is L2, `<#>` is negative inner product, `<=>` is
-- cosine distance. Querying a `vector_cosine_ops` index with `<->` does not
-- error — Postgres still returns *neighbours*, just the neighbours under a
-- different metric, with plausible-looking distances. That is a silent-correctness
-- bug, so the operator is stated once per reference and is never inferred.
-- Ordering is ascending: cosine *distance* is smallest for the nearest
-- neighbour.
--
-- The returned `similarity` is the distance inverted, `1 - distance`, in a column
-- named `similarity` because that is the name the generated types declare.
-- Deliberately NOT clamped here: `similarityToScore` in
-- services/retrieval/src/hybrid/vector-search.ts owns the `[0, 1]` clamp and the
-- "exactly once" conversion, and clamping in two places means the policy has two
-- homes and can drift. Cosine distance reaches 2 for antiparallel vectors, so an
-- unclamped similarity floors at -1; any meaningful `match_threshold` excludes
-- those rows anyway.
--
-- The join to `documents` is not for the projection — this function returns no
-- document metadata. It is there for `deleted_at is null`, which has to be
-- enforced in the query: DATABASE_SCHEMA.md#"Soft delete vs supersede" says
-- "`deleted_at` hides a document from every read path immediately", and this
-- return shape gives a caller no column to filter on, so a caller *cannot*
-- perform that check for itself. A soft-deleted document whose chunks stayed
-- retrievable is a recall leak with no error attached: the answer cites a
-- document the user believes they deleted.
-- ---------------------------------------------------------------------------

create or replace function second_brain.match_chunks(
  user_id         uuid,
  query_embedding extensions.vector(1024),
  match_count     integer,
  match_threshold double precision default 0
)
returns table (
  chunk_id     uuid,
  document_id  uuid,
  heading_path text[],
  ordinal      integer,
  similarity   double precision,
  text         text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id as chunk_id,
    c.document_id as document_id,
    c.heading_path as heading_path,
    c.ordinal as ordinal,
    1 - (c.embedding operator(extensions.<=>) match_chunks.query_embedding) as similarity,
    c.text as text
  from second_brain.document_chunks as c
  join second_brain.documents as d
    on d.id = c.document_id
   and d.user_id = c.user_id
  where c.user_id = match_chunks.user_id
    and c.embedding is not null
    and d.deleted_at is null
    and 1 - (c.embedding operator(extensions.<=>) match_chunks.query_embedding)
          >= coalesce(match_chunks.match_threshold, 0)
  order by c.embedding operator(extensions.<=>) match_chunks.query_embedding
  limit greatest(coalesce(match_chunks.match_count, 0), 0);
$$;

comment on function second_brain.match_chunks(uuid, extensions.vector, integer, double precision) is
  'Cosine nearest neighbours over one user''s document_chunks, nearest first. '
  'Specified by second_brain.Functions.match_chunks in '
  'packages/database/src/types/database.ts; see the header of '
  '20260916095000_retrieval_functions.sql for the contract and the security model.';

-- ---------------------------------------------------------------------------
-- match_memories — pgvector nearest neighbours over one user's active memories
--
--   match_memories(user_id uuid,
--                  query_embedding extensions.vector(1024),
--                  match_count integer,
--                  match_threshold double precision default 0,
--                  kind_filter text[] default null)
--     returns table (memory_id, statement, kind, confidence, similarity)
--
-- The input to the merge decision: `MemoriesQueries.findSimilar` calls this to
-- find the active memories a freshly distilled candidate might duplicate or
-- contradict, and a `merge` / `supersede` action needs the target id it returns.
--
-- `language sql`, for the same reason as `match_chunks`: one query, and the plan
-- that matters is the HNSW scan on `memories_embedding_hnsw_idx`. `<=>` again,
-- matching `vector_cosine_ops`, for the same silent-wrong-neighbours reason.
--
-- `status = 'active'` IS THE POINT OF THIS FUNCTION, NOT A FILTER ON TOP OF IT.
-- ADR-008: a memory is superseded, never deleted, so the table retains
-- superseded, archived and rejected rows indefinitely — and `memories_select_own`
-- deliberately lets their owner see all of them, because it is their history.
-- An unpredicated vector query therefore returns *superseded beliefs as current*:
-- no error, no empty result, plausible neighbours, and an answer built on a
-- statement the system has stopped believing. Two things make that failure not
-- happen here, and they are independent on purpose — this predicate, and the
-- fact that `memories_embedding_hnsw_idx` is partial on `where status = 'active'`
-- (ADR-008, ADR-016), which makes the correct query the indexed one and the
-- incorrect query the visibly expensive one.
--
-- `kind_filter` is optional and is applied inside the query rather than after it
-- (a fact about every filter in this file): filtering after retrieval collapses
-- recall, because the nearest `match_count` rows globally are mostly rows the
-- caller then throws away. A null filter means "every kind", which is what makes
-- the omitted case and the explicit-`null` case behave identically.
--
-- `confidence` is returned because the adjudicator weighs it, and it is
-- deliberately not folded into `similarity`: how sure the extractor is about a
-- statement and how close the statement is to the candidate are different
-- quantities, and collapsing them is the mistake DATABASE_SCHEMA.md#memories
-- names under `confidence`.
-- ---------------------------------------------------------------------------

create or replace function second_brain.match_memories(
  user_id         uuid,
  query_embedding extensions.vector(1024),
  match_count     integer,
  match_threshold double precision default 0,
  kind_filter     text[] default null
)
returns table (
  memory_id  uuid,
  statement  text,
  kind       text,
  confidence real,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.id as memory_id,
    m.statement as statement,
    m.kind as kind,
    m.confidence as confidence,
    1 - (m.embedding operator(extensions.<=>) match_memories.query_embedding) as similarity
  from second_brain.memories as m
  where m.user_id = match_memories.user_id
    and m.status = 'active'
    and m.embedding is not null
    and (match_memories.kind_filter is null or m.kind = any (match_memories.kind_filter))
    and 1 - (m.embedding operator(extensions.<=>) match_memories.query_embedding)
          >= coalesce(match_memories.match_threshold, 0)
  order by m.embedding operator(extensions.<=>) match_memories.query_embedding
  limit greatest(coalesce(match_memories.match_count, 0), 0);
$$;

comment on function second_brain.match_memories(uuid, extensions.vector, integer, double precision, text[]) is
  'Cosine nearest neighbours over one user''s active memories, nearest first. '
  'Superseded, archived and rejected rows are history and are never returned '
  '(ADR-008). Specified by second_brain.Functions.match_memories in '
  'packages/database/src/types/database.ts; see the header of '
  '20260916095000_retrieval_functions.sql for the contract and the security model.';

-- ---------------------------------------------------------------------------
-- hybrid_search — the fused surface, across chunks and memories
--
--   hybrid_search(user_id uuid,
--                 query_embedding extensions.vector(1024),
--                 query_text text,
--                 match_count integer,
--                 vector_weight double precision,
--                 fts_weight double precision,
--                 include_documents boolean default true,
--                 include_memories boolean default true,
--                 kind_filter text[] default null,
--                 topic_filter uuid[] default null)
--     returns table (id, source, document_id, text, title, url, occurred_at,
--                    vector_score, fts_score, score)
--
-- One ranked list across the two retrieval surfaces: the chunk vector/FTS pair
-- ('document') and the memory vector/FTS pair ('memory'). It exists because the
-- two signals fail in opposite directions — dense retrieval is bad at exact
-- tokens (error codes, function names, ticket ids, quoted strings) and lexical
-- retrieval is bad at paraphrase — so a query is answered by both and the results
-- are merged (DATABASE_SCHEMA.md#"Why both, and not one", ADR-006).
--
-- RECIPROCAL RANK FUSION, WITH `k = 60`, DRIVEN BY RANK AND NOT BY SCORE.
-- ADR-006 rejects interpolating the two scores, and the reason decides the shape
-- of the query below: cosine distance and `ts_rank_cd` are both `float8` and
-- neither is a probability, so there is no common unit. `0.6 * vector +
-- 0.4 * fts` silently asserts that there is one, and — worse — it makes the
-- configured weights meaningless, because each signal's effective weight then
-- depends on its score *distribution* rather than on the constant. Rank position
-- is the common denominator: the first hit of the vector search and the first hit
-- of the text search are each "the best answer that retriever could produce",
-- and that is true whatever units their scores are in. So each list contributes
--
--     weight_list / (k + rank_list)
--
-- and the fused score is the sum. `k = 60` is the value from the original TREC
-- work, carried unchanged and deliberately untuned (ADR-006, `RERANK_CONSTANT` in
-- services/retrieval/src/hybrid/fusion.ts).
--
--   * `k` IS A LITERAL HERE AND THE WEIGHTS ARE ARGUMENTS, and both halves of
--     that are decisions. The weights are arguments because the generated types
--     declare them as required ones, and because the composition root resolves
--     them from `HYBRID_VECTOR_WEIGHT` (0.6) / `HYBRID_FTS_WEIGHT` (0.4) at
--     startup and passes them down (services/retrieval/src/types/index.ts,
--     `RetrievalConfig`). Hard-coding `0.6` / `0.4` in SQL would create a third
--     home for a number that ADR-006 promises is authoritative ("the configured
--     ratio is the actual ratio") and would make the promise false the moment the
--     environment changed. `k` cannot be an argument — the declared signature has
--     no parameter for it — so it is written out twice, once per contribution
--     below, and it now has two homes (here and `RERANK_CONSTANT`) which must
--     change together. That duplication is a known cost of the fixed signature,
--     and it is called out in the header's list of open questions.
--   * TWO LISTS, NOT FOUR. The vector list is chunks *and* memories ranked
--     together by cosine distance; the full-text list is the same two surfaces
--     ranked together by `ts_rank_cd`; and `vector_weight` / `fts_weight` is each
--     list's weight. Ranking the two surfaces as four separately weighted lists
--     would apply the vector weight twice and the text weight twice, which does
--     not cancel: it doubles whichever weight the configured ratio was meant to
--     express and makes `0.6` / `0.4` describe nothing. ADR-006 says "per-list
--     `weight_list` is where `HYBRID_VECTOR_WEIGHT` … apply", ARCHITECTURE.md step
--     8 numbers the lists as the two legs, and `RankedList.source` in
--     services/retrieval/src/types/index.ts is typed `RetrieverKind`
--     ('vector' | 'fts' | 'metadata') with `kind` — not `source` — carrying
--     document/memory. Two lists is what the rest of the system is written
--     against.
--   * With one leg empty — a query with no lexical match, or a caller that sends
--     a null `query_embedding` — RRF degenerates to a single-list ranking without
--     changing shape. ARCHITECTURE.md's degraded-mode table states that as the
--     intended behaviour, so it is not special-cased here.
--
-- `vector_score` and `fts_score` are per-row provenance, not inputs to the
-- ranking: `score` is the fused RRF sum and the two sub-scores are kept so a bad
-- ranking can be attributed to the vector leg or the text leg rather than
-- guessed at (`RankedChunk` in @second-brain/shared keeps the same three).
-- `vector_score` is `1 - distance` for rows the vector leg found and null for
-- rows only the text leg found; `fts_score` is the raw `ts_rank_cd` for rows the
-- text leg found and null otherwise. Raw rather than normalised, because
-- `tsRankToScore` in services/retrieval/src/hybrid/fts-search.ts normalises
-- against the best rank in the caller's own result set, and a value normalised
-- here would be normalised against a different set.
--
-- `score` IS NOT A PROBABILITY AND MUST NOT BE SHOWN AS ONE. It is a sum of
-- `1/61`-ish terms on a scale comparable only within one fused result set
-- (ADR-006). The column is named `score` because the generated types name it
-- that; it is documented here so it is not mistaken for a confidence.
--
-- `language sql`, and here that is a decision rather than an obvious default.
-- The function has four candidate legs, optional filters and two `include_*`
-- flags, which reads like a case for plpgsql — but none of that is statement-level
-- branching. Every flag is a predicate, so the whole function is one statement
-- with CTEs, and the thing that matters most about it is that each of the four
-- `order by … limit` clauses stays attached to its own index scan. A `return
-- query` in plpgsql would work and would be *materialised* into a set, which is
-- exactly the kind of boundary that separates the `limit` from the plan it was
-- written for.
--
-- HOW PER-LEG CANDIDATE DEPTH WORKS, AND WHY THE LIMIT IS REPEATED FOUR TIMES.
-- `match_count` is used twice over and that is deliberate: each leg fetches its
-- own top `match_count` rows from its own index, and the fused list returned at
-- the end is truncated to the same number. Taking the top `k` of a union is
-- exactly contained in the union of the per-table top `k`s, so this is exact —
-- re-ranking `k`-from-each can never drop a row that belongs in the global top
-- `k` — and it is also the only version that lets both HNSW indexes and both GIN
-- indexes do their own ordering. The alternative, one union window-functioned and
-- then ranked, computes a distance for *every* row the user owns and sorts the
-- lot, which is what the HNSW indexes exist to avoid. The bound is written out at
-- each leg rather than hoisted into a CTE because `limit` is evaluated per query
-- and each leg needs its own; the repetition is the cost of pinning the ordering
-- to the index.
--
-- FILTERS ARE APPLIED INSIDE THE QUERY, ON BOTH LEGS OF BOTH SURFACES.
-- `topic_filter` is array overlap (`&&`) against the denormalised `topic_ids`
-- column — `documents_user_topic_ids_gin_idx` / `memories_user_topic_ids_gin_idx`
-- exist for exactly that predicate — and for a chunk it is the *owning
-- document's* topics, which is why the document legs join `documents` (the join
-- is also where `deleted_at is null` is enforced, for the reason given at
-- `match_chunks`). `kind_filter` is a memory concept and applies to the two
-- memory legs only, so a `kind_filter` with `include_documents = true` narrows
-- the memory half of the list and leaves the document half alone — which is the
-- honest reading of a memory-only filter and is what `memories_user_kind_status_idx`
-- serves. Both are applied to the strict legs identically; a filter on one leg
-- only would fuse a filtered list against an unfiltered one and the ranked output
-- would contain the rows the caller asked to exclude, with the fusion to blame
-- for it.
--
--   * `topic_filter` is typed `uuid[]`, not `text[]`, even though the generated
--     types render it `string[]` either way. A malformed topic id then fails the
--     call with `invalid input syntax for type uuid` instead of silently
--     overlapping nothing — and "filtered to nothing" being indistinguishable
--     from "unfiltered" is the failure `FilterClause.matchesNothing` in
--     services/retrieval/src/types/index.ts is written to prevent by construction.
--   * There is no similarity floor on the fused list: the signature has no
--     `match_threshold`, and a threshold applied to one leg before fusion would
--     bias the fusion rather than filter it. A caller that wants a floor filters
--     on the returned `vector_score`.
--
-- `occurred_at` IS THE TEMPORAL KEY, AND IT IS A DIFFERENT COLUMN PER SURFACE.
-- For a chunk it is the owning document's `captured_at` — "When the user
-- encountered it. The temporal ordering key for documents" — rather than
-- `published_at`, which is metadata about the world and not about the user's
-- reading. For a memory it is `valid_from`, "when the statement became true",
-- which is the column `memories_user_valid_from_idx` exists for and the one a
-- "what did I believe in March" query means.
--
-- `title` IS NEVER NULL, AND A MEMORY HAS NO TITLE COLUMN. The generated types
-- declare `title: string` — not `string | null` — so returning null for a memory
-- would be a contract violation that only shows up in the regenerated types. A
-- memory's statement is its identity: it is what the distiller produced, what the
-- citation quotes, and the only user-meaningful string on the row. So the
-- statement is returned as the title as well as the text. The alternative — a
-- synthetic label like 'memory' or the bare `kind` — would put a string in a
-- citation header that appears nowhere in the user's own data.
-- ---------------------------------------------------------------------------

create or replace function second_brain.hybrid_search(
  user_id           uuid,
  query_embedding   extensions.vector(1024),
  query_text        text,
  match_count       integer,
  vector_weight     double precision,
  fts_weight        double precision,
  include_documents boolean default true,
  include_memories  boolean default true,
  kind_filter       text[] default null,
  topic_filter      uuid[] default null
)
returns table (
  id           uuid,
  source       text,
  document_id  uuid,
  text         text,
  title        text,
  url          text,
  occurred_at  timestamptz,
  vector_score double precision,
  fts_score    double precision,
  score        double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
with
  -- The tsquery is parsed once and shared by both text legs. `websearch_to_tsquery`
  -- is the only tsquery constructor that accepts untrusted text: it understands
  -- "quoted phrases", `or` and `-exclusions`, and it never raises a syntax error
  -- on malformed input, which matters because `query_text` arrives straight from a
  -- user. The configuration 'english' is spelled out to match the generated
  -- columns (`to_tsvector('english', …)` on both `document_chunks.fts` and
  -- `memories.fts`) — a query built with a different configuration does not match
  -- the stored lexemes and the GIN index cannot be used, and the symptom is an
  -- empty result rather than an error. A null or blank `query_text` yields an
  -- empty tsquery, which matches nothing, which is the correct answer.
  search_query as (
    select pg_catalog.websearch_to_tsquery(
             'english',
             coalesce(hybrid_search.query_text, '')
           ) as tsq
  ),

  -- -------------------------------------------------------------------------
  -- Vector list: chunks and memories ranked together by cosine distance
  -- -------------------------------------------------------------------------

  vector_documents as (
    select
      c.id                                    as id,
      'document'::text                        as source,
      c.document_id                           as document_id,
      c.text                                  as text,
      d.title                                 as title,
      d.url                                   as url,
      d.captured_at                           as occurred_at,
      c.embedding operator(extensions.<=>) hybrid_search.query_embedding as distance
    from second_brain.document_chunks as c
    join second_brain.documents as d
      on d.id = c.document_id
     and d.user_id = c.user_id
    where c.user_id = hybrid_search.user_id
      and c.embedding is not null
      and d.deleted_at is null
      and hybrid_search.query_embedding is not null
      and coalesce(hybrid_search.include_documents, true)
      and (hybrid_search.topic_filter is null
           or d.topic_ids && hybrid_search.topic_filter)
    order by c.embedding operator(extensions.<=>) hybrid_search.query_embedding
    limit greatest(coalesce(hybrid_search.match_count, 0), 0)
  ),

  vector_memories as (
    select
      m.id                                    as id,
      'memory'::text                          as source,
      null::uuid                              as document_id,
      m.statement                             as text,
      m.statement                             as title,
      null::text                              as url,
      m.valid_from                            as occurred_at,
      m.embedding operator(extensions.<=>) hybrid_search.query_embedding as distance
    from second_brain.memories as m
    where m.user_id = hybrid_search.user_id
      and m.status = 'active'
      and m.embedding is not null
      and hybrid_search.query_embedding is not null
      and coalesce(hybrid_search.include_memories, true)
      and (hybrid_search.kind_filter is null
           or m.kind = any (hybrid_search.kind_filter))
      and (hybrid_search.topic_filter is null
           or m.topic_ids && hybrid_search.topic_filter)
    order by m.embedding operator(extensions.<=>) hybrid_search.query_embedding
    limit greatest(coalesce(hybrid_search.match_count, 0), 0)
  ),

  -- Rank the union of the two vector legs. Ties are broken by `id`, and this is
  -- not decoration: a distance tie (two identical vectors, or a corpus with very
  -- few rows) would otherwise order arbitrarily, and RRF consumes the *position*
  -- — so an unstable tie makes the fused output non-reproducible, which ADR-006
  -- names as the easy bug in this algorithm. `id` rather than `document_id`
  -- because several chunks of one document can sit at the same distance and would
  -- still tie on document_id.
  vector_list as (
    select
      v.id,
      v.source,
      v.document_id,
      v.text,
      v.title,
      v.url,
      v.occurred_at,
      1 - v.distance                                    as vector_score,
      pg_catalog.row_number() over (
        order by v.distance asc, v.id asc
      )                                                 as rank
    from (
      select * from vector_documents
      union all
      select * from vector_memories
    ) as v
  ),

  vector_top as (
    select * from vector_list
    where rank <= greatest(coalesce(hybrid_search.match_count, 0), 0)
  ),

  -- -------------------------------------------------------------------------
  -- Full-text list: the same two surfaces ranked together by ts_rank_cd
  -- -------------------------------------------------------------------------

  -- `ts_rank_cd` (cover density) rather than `ts_rank` (weighted term frequency),
  -- matching TS_RANK_FUNCTION in services/retrieval/src/hybrid/fts-search.ts:
  -- retrieval here is passage-level, and within a ~200-token passage whether the
  -- query's terms appear *together* is a better relevance signal than how often
  -- each repeats — which additionally punishes a chunk that happens to repeat one
  -- common word. The value is cast to `double precision` to match the declared
  -- return type of the column (`ts_rank_cd` returns `real`).
  fts_documents as (
    select
      c.id                                    as id,
      'document'::text                        as source,
      c.document_id                           as document_id,
      c.text                                  as text,
      d.title                                 as title,
      d.url                                   as url,
      d.captured_at                           as occurred_at,
      pg_catalog.ts_rank_cd(c.fts, q.tsq)::double precision as fts_score
    from second_brain.document_chunks as c
    join second_brain.documents as d
      on d.id = c.document_id
     and d.user_id = c.user_id
    cross join search_query as q
    where c.user_id = hybrid_search.user_id
      and d.deleted_at is null
      and coalesce(hybrid_search.include_documents, true)
      and (hybrid_search.topic_filter is null
           or d.topic_ids && hybrid_search.topic_filter)
      and c.fts @@ q.tsq
    order by fts_score desc, c.id asc
    limit greatest(coalesce(hybrid_search.match_count, 0), 0)
  ),

  fts_memories as (
    select
      m.id                                    as id,
      'memory'::text                          as source,
      null::uuid                              as document_id,
      m.statement                             as text,
      m.statement                             as title,
      null::text                              as url,
      m.valid_from                            as occurred_at,
      pg_catalog.ts_rank_cd(m.fts, q.tsq)::double precision as fts_score
    from second_brain.memories as m
    cross join search_query as q
    where m.user_id = hybrid_search.user_id
      and m.status = 'active'
      and coalesce(hybrid_search.include_memories, true)
      and (hybrid_search.kind_filter is null
           or m.kind = any (hybrid_search.kind_filter))
      and (hybrid_search.topic_filter is null
           or m.topic_ids && hybrid_search.topic_filter)
      and m.fts @@ q.tsq
    order by fts_score desc, m.id asc
    limit greatest(coalesce(hybrid_search.match_count, 0), 0)
  ),

  -- Same tie-break reasoning as `vector_list`. Note that a GIN index cannot
  -- return rows in rank order, so this leg sorts its matches — that is expected
  -- and is bounded by the GIN index's candidate set, unlike the vector legs where
  -- an unindexed sort would mean computing a distance per row.
  fts_list as (
    select
      t.id,
      t.source,
      t.document_id,
      t.text,
      t.title,
      t.url,
      t.occurred_at,
      t.fts_score,
      pg_catalog.row_number() over (
        order by t.fts_score desc, t.id asc
      )                                       as rank
    from (
      select * from fts_documents
      union all
      select * from fts_memories
    ) as t
  ),

  fts_top as (
    select * from fts_list
    where rank <= greatest(coalesce(hybrid_search.match_count, 0), 0)
  ),

  -- -------------------------------------------------------------------------
  -- Fusion: rrf_score = Σ weight_list / (60 + rank_list)
  -- -------------------------------------------------------------------------

  -- THE FUSION ITSELF, and the join is the algorithm. `full outer join` on `id`
  -- is exactly the union of the two lists: a candidate found by only one leg has
  -- one null side, `coalesce(…, 0)` makes the list that does not contain it
  -- contribute nothing — which is what RRF says, a missing list is a zero term and
  -- not a penalty — and a candidate found by both legs gets both terms added. So
  -- agreement between the retrievers is what lifts a row, and its magnitude (how
  -- *much* the vector search preferred it) is deliberately discarded.
  --
  -- `id` is the candidate's identity and the reason the sum is well defined: a
  -- chunk id and a memory id are both UUIDs drawn from the same space, so an id
  -- identifies one row of one surface and a document can never be fused with a
  -- memory. Both lists contain a given candidate at most once, which is why one
  -- row per candidate comes out of this join and no aggregation is needed — and
  -- why the identity columns are not thrown into a `group by` with an aggregate
  -- invented to satisfy it.
  --
  -- Adding a third list later (a recency ranking, an entity-match list) is one
  -- more join and one more `coalesce(weight / (60 + rank), 0)` term, which is the
  -- composability ADR-006 relies on.
  fused as (
    select
      coalesce(v.id, t.id)                                   as id,
      coalesce(v.source, t.source)                           as source,
      coalesce(v.document_id, t.document_id)                 as document_id,
      coalesce(v.text, t.text)                               as text,
      coalesce(v.title, t.title)                             as title,
      coalesce(v.url, t.url)                                 as url,
      coalesce(v.occurred_at, t.occurred_at)                 as occurred_at,
      v.vector_score                                         as vector_score,
      t.fts_score                                            as fts_score,
      coalesce(hybrid_search.vector_weight / (60 + v.rank), 0)
        + coalesce(hybrid_search.fts_weight / (60 + t.rank), 0) as score
    from vector_top as v
    full outer join fts_top as t
      on t.id = v.id
  )

select
  f.id,
  f.source,
  f.document_id,
  f.text,
  f.title,
  f.url,
  f.occurred_at,
  f.vector_score,
  f.fts_score,
  f.score
from fused as f
order by f.score desc, f.id asc
limit greatest(coalesce(hybrid_search.match_count, 0), 0);
$$;

comment on function second_brain.hybrid_search(uuid, extensions.vector, text, integer, double precision, double precision, boolean, boolean, text[], uuid[]) is
  'Fuses pgvector cosine similarity with full-text rank by reciprocal rank fusion '
  '(k = 60, ADR-006) and returns one ranked list across document chunks and '
  'active memories. `score` is an RRF sum, comparable only within one result set '
  'and never a probability. Specified by second_brain.Functions.hybrid_search in '
  'packages/database/src/types/database.ts; see the header of '
  '20260916095000_retrieval_functions.sql for the contract and the security model.';

-- ---------------------------------------------------------------------------
-- QUESTIONS THIS FILE HAD TO ANSWER BECAUSE docs/DATABASE_SCHEMA.md DOES NOT.
-- Each of these is a decision the missing "Retrieval functions" section should
-- absorb, and each is written the way it is because of a documented source
-- somewhere else in the repository. They are listed here so the doc can be
-- written from them rather than from a reading of this file.
--
--   1. SIMILARITY OR DISTANCE? The generated types name the returned column
--      `similarity`, so these functions return `1 - distance`. But
--      `MatchedRow.distance` in services/retrieval/src/types/index.ts is
--      documented as "Cosine distance from the vector RPC", and the header of
--      hybrid/vector-search.ts says the conversion "happens exactly once, here",
--      in the pipeline. Those three statements cannot all be true. This file
--      follows the generated types, because they are the contract the call sites
--      compile against; the signal also happens to be invertible, so a caller
--      that wants a distance can take `1 - similarity` — but the doc must say
--      which layer owns the conversion, or the layer that owns it will be
--      whichever one a reader looks at first.
--
--   2. RAW OR NORMALISED `fts_score`? This file returns raw `ts_rank_cd`.
--      `tsRankToScore` normalises against the best rank in *the caller's own*
--      result set, so a value normalised here would be normalised against a
--      different set and the caller would then normalise a second time. The
--      alternative reading is that `fts_score` should be the display score
--      because `vector_score` is a `[0, 1]` similarity — in which case the
--      normalisation is the RPC's job and `tsRankToScore` becomes a no-op.
--      Undecided in the documents; decided here as "raw, the caller normalises".
--
--   3. `k = 60` HAS TWO HOMES. It cannot be a parameter, because the declared
--      signature has no argument for it, so the literal appears twice in
--      `hybrid_search` and once as `RERANK_CONSTANT` in
--      services/retrieval/src/hybrid/fusion.ts. ADR-006 says `k` is "a config
--      constant, not a parameter to fit" — the doc section should either record
--      the duplication as accepted or say whether the signature is expected to
--      grow a `k` parameter.
--
--   4. THE STALE-MODEL DROP CANNOT BE DONE HERE. hybrid/vector-search.ts requires
--      that "a row whose `embedding_model` does not match the query model must be
--      dropped rather than scored", and that the caller mark the result
--      `degraded`. These RPCs accept no model argument and return no
--      `embedding_model` column, so no caller can implement that rule from their
--      output. Either the two `match_*` functions and `hybrid_search` need an
--      `embedding_model` argument and a returned stamp, or the rule belongs to a
--      different layer — but as the contract stands it is unimplementable, and
--      the failure mode it guards (plausible neighbours from a different model)
--      is silent.
--
--   5. METADATA FILTERS ARE ONLY HALF-REACHABLE. Both the retrieval port and
--      hybrid/vector-search.ts require filters to be applied *inside* the query,
--      because filtering afterwards collapses recall. `hybrid_search` can express
--      `topic_filter` and `kind_filter`, but has no `from`/`to` (date),
--      `sourceTypes` or `deviceIds` filter and no similarity floor, while
--      `match_chunks` and `match_memories` have no filters at all beyond the
--      threshold. So a `semantic` or `temporal` query that carries filters cannot
--      push them into the vector leg through the declared signatures. The doc
--      section should state whether the signatures are expected to grow, or
--      whether those intents are meant to route through `hybrid_search` alone.
--
--   6. `match_count` DOES TWO JOBS IN `hybrid_search`, AND THE CALLER HAS TO KNOW
--      WHICH NUMBER TO PASS. There is one count in the signature and the fusion
--      needs two — the depth each leg retrieves at (`RETRIEVAL_TOP_K`, 40) and the
--      length of the fused list (`RERANK_TOP_K`, 8, applied by the caller after
--      fusion). This file uses the argument for both, so the caller must pass the
--      *candidate depth* and truncate the result itself. Passing 8 here would be
--      the plausible mistake, and it degrades recall quietly: each leg would
--      retrieve 8 and RRF would have almost nothing to disagree about. The doc
--      should record the calling convention, or the signature should grow a
--      second count.
--
--   7. TWO MAPPINGS FOR A MEMORY THAT NO SOURCE STATES. `title` is declared
--      non-null in the generated types and `memories` has no title column, so the
--      statement is returned as the title; and `occurred_at` is the owning
--      document's `captured_at` for a chunk and the memory's `valid_from` for a
--      memory. Both are reasoned in the `hybrid_search` banner and both are
--      choices rather than quotations.
--
--   Additionally recorded here because it is a decision this file made and
--   nothing else states: the soft-delete predicate (`documents.deleted_at is
--   null`) is enforced *inside* these functions, on every document leg, because
--   the returned shapes give a caller nothing to filter on. That makes these RPCs
--   the read paths that DATABASE_SCHEMA.md's "`deleted_at` is filtered in the
--   query, not in RLS" rule is describing.
-- ---------------------------------------------------------------------------
