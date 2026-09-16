/**
 * Vector search over the pgvector indexes.
 *
 * ## Distance metric: cosine
 *
 * The RPCs use the `<=>` operator, which is cosine **distance**, not similarity. pgvector
 * returns it in `[0, 2]` — `0` for identical direction, `2` for opposite — and the pipeline
 * converts to similarity with `1 - distance` before anything else looks at it. Everything
 * downstream (fusion, reranking, thresholds, the debug view) speaks similarity in `[0, 1]`,
 * so the conversion happens exactly once, here.
 *
 * ## The invariant that makes this work at all
 *
 * **The query embedding must come from the same model that produced the stored vectors.**
 * Vectors from two models are not comparable: the cosine similarity between a
 * `nv-embedqa-e5-v5` query vector and an `text-embedding-3-small` passage vector is a number
 * with no meaning, and the query returns nearest neighbours that are no nearer than random.
 * Nothing raises an error, which is why:
 *
 * - `embedding_model` is pinned on every `document_chunks` and `memories` row;
 * - `EmbeddingProvider.dimensions` is asserted against the stored width at startup
 *   (`assertDimensionsMatch` in `@second-brain/providers`);
 * - changing provider or model is a re-embed migration, not a configuration change (ADR-004).
 *
 * A row whose `embedding_model` does not match the query model must be dropped rather than
 * scored, and that drop is what the `degraded` flag on `RetrievalResult` reports.
 */
import { clamp01 } from '@second-brain/shared';

import type { RetrievalDeps, ScoredChunk, VectorQuery } from '../types';

/**
 * Converts a pgvector cosine distance into a similarity in `[0, 1]`.
 *
 * Pure. `1 - distance`, clamped, because cosine distance reaches `2` for antiparallel
 * vectors and a negative similarity is not a useful input to fusion or reranking. A
 * non-finite or missing distance becomes `0` rather than `NaN`: one malformed row must not
 * poison a ranked list.
 *
 * @param distance - Cosine distance from the `<=>` operator, in `[0, 2]`.
 */
export function similarityToScore(distance: number | null): number {
  if (distance === null || !Number.isFinite(distance)) return 0;
  return clamp01(1 - distance);
}

/**
 * Runs a pgvector nearest-neighbour query.
 *
 * Contract:
 * - Runs `match_chunks` and/or `match_memories` depending on `query.target`, filtered by
 *   `query.filters` **inside** the query. Filtering afterwards is what collapses recall: the
 *   nearest `topK` rows globally are mostly rows the user did not ask about.
 * - Rows below `minSimilarity` are dropped before returning, so an unrelated corpus produces
 *   an empty list rather than a list of the least-bad matches.
 * - Rows whose `embedding_model` differs from the query model are dropped, and the caller must
 *   mark the result `degraded` when that happens.
 * - The returned list is ordered by descending similarity and is never re-sorted by a caller:
 *   fusion consumes position, not score.
 * - An empty result is not an error. It is the correct answer for a query the corpus does not
 *   cover, and `services/retrieval` is expected to degrade rather than fail (success criterion
 *   S6 in `docs/PROJECT_OVERVIEW.md`).
 *
 * @param query - Vector, bounds, filters and target index. See `VectorQuery`.
 * @param deps - Data-layer port and providers.
 */
export async function vectorSearch(
  _query: VectorQuery,
  _deps: RetrievalDeps,
): Promise<ScoredChunk[]> {
  // TODO(phase-2): embed nothing here — the caller already embedded the query, because the
  // intent classifier may have rewritten it. Call `deps.db.matchChunks` / `matchMemories`
  // with the filters applied, map rows through `similarityToScore`, drop stale model rows.
  throw new Error('Not implemented: vectorSearch');
}
