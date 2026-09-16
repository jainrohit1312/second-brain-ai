/**
 * Rank fusion.
 *
 * ## Why reciprocal rank fusion, and not score interpolation
 *
 * The obvious approach — normalize both sub-scores onto `[0, 1]` and take a weighted average —
 * does not work here, and the reason is worth stating precisely because the failure is silent.
 *
 * Vector cosine similarity and `ts_rank_cd` are **not on a comparable scale, and no
 * normalization fixes that**:
 *
 * - Cosine similarity has a meaningful absolute range. `0.82` means genuinely close in the
 *   embedding space; `0.45` means unrelated. The number is interpretable on its own.
 * - A text rank has no such anchor. `ts_rank_cd` returns `0.05` for a single-word match in a
 *   long document and `0.9` for a rare phrase in a short one — and which of those is "better"
 *   depends on the query length, the corpus, and the normalization flag. The value at the top
 *   of the list varies by an order of magnitude between queries.
 *
 * Min-max normalizing within a result set partially papers over the second problem but
 * introduces a worse one: the best hit in each list is forced to `1.0`, so a list of
 * uniformly terrible matches produces a top row that outscores the best row of a list of
 * excellent ones. Interpolating on that scale makes retrieval confidently wrong, which is the
 * failure mode the whole system exists to avoid.
 *
 * **Rank positions are the only trustworthy common denominator.** The number one hit of the
 * vector search and the number one hit of the text search are each "the best answer that
 * retriever could produce", and that statement is true regardless of the units their scores
 * are in. RRF (Cormack et al., 2009) formalizes it: each list contributes
 * `weight / (k + rank)` per item, with `k` damping the advantage of the very top positions so
 * that a single retriever cannot dominate the fused list outright.
 *
 * The cost of the choice is that fusion discards score *magnitude* — a vector hit that is
 * almost identical to the query fuses the same as a merely good one. That information is not
 * lost: both sub-scores are retained on `ScoredChunk` and surfaced on `RankedChunk`, and the
 * reranker sees the actual text rather than the fused number. Reranking is where magnitude is
 * recovered, on a scale a cross-encoder can judge.
 *
 * The fused score is therefore comparable only **within one fused result set**. It is not a
 * confidence, it is not a probability, and it must not be shown to a user as one.
 */

import type { FusedItem, FusedResult, FusedRank, RankedList, RetrieverKind } from '../types';

/**
 * RRF damping constant.
 *
 * `k = 60` is the value from the original paper and the de-facto default. Its effect: rank 1
 * scores `1/61` and rank 2 scores `1/62`, so the top three positions contribute within 5% of
 * each other and a list cannot win by having one great row. A small `k` would make fusion
 * behave like "trust whichever retriever's number one I saw first".
 */
export const RERANK_CONSTANT = 60;

/**
 * Weight applied to the vector retriever's list when fusing.
 *
 * Sourced from `HYBRID_VECTOR_WEIGHT` (0.6). Vectors carry the bulk of the weight because
 * most real questions are paraphrases that share no tokens with the passage that answers
 * them — the failure mode keyword search was chosen against in the first place. Defaults
 * mirror `.env.example`; the composition root reads the environment and passes the resolved
 * value down, so these constants are the fallback and the documented default.
 */
export const HYBRID_VECTOR_WEIGHT = 0.6;

/**
 * Weight applied to the full-text retriever's list when fusing.
 *
 * Sourced from `HYBRID_FTS_WEIGHT` (0.4). Not zero, and this is the point: lexical search is
 * the only retriever that gets proper nouns, identifiers, error codes and quoted strings
 * exactly right, and those are exactly the queries where embeddings are weakest. The two
 * weights are meant to sum to 1, but nothing breaks if they do not — RRF's output is a
 * ranking, not a probability.
 */
export const HYBRID_FTS_WEIGHT = 0.4;

/**
 * Fuses two or more ranked lists into one.
 *
 * Placeholder: the arithmetic is deliberately not written yet, because the failure modes of
 * RRF are all in the details that need a fixture set to settle — how to treat an item that
 * appears twice in one list, whether a `metadata` list (which is a *filter*, not a ranker)
 * should contribute at all or only gate, and whether a per-list weight multiplies the
 * `1 / (k + rank)` term or the final score. Each choice changes the ordering on real data, so
 * each needs a measured answer rather than a plausible one.
 *
 * Contract, which the implementation must satisfy:
 * - An item present in several lists accumulates a contribution from each, so agreement
 *   between retrievers is what lifts an item — this is the property that makes hybrid
 *   retrieval better than either retriever alone.
 * - `ranks` records every list that held the item and the 1-based rank in each, so a fused
 *   position is always explainable.
 * - List order and item order are consumed as given and never resorted.
 * - An empty input returns an empty result rather than throwing: a query that matched nothing
 *   is a valid answer.
 *
 * @param resultSets - Ranked lists to fuse, in the order their weights were resolved.
 * @param k - RRF damping constant. Defaults to `RERANK_CONSTANT`.
 */
export function reciprocalRankFusion<T>(
  _resultSets: readonly RankedList<T>[],
  _k: number = RERANK_CONSTANT,
): FusedResult<T> {
  // TODO(phase-2): accumulate `weight / (k + rank)` per item identity, sum across lists,
  // sort by descending fused score with a stable tie-break, and record each list's `ranks`.
  throw new Error('Not implemented: reciprocalRankFusion');
}

/**
 * Min-max normalizes a set of scores onto `[0, 1]`.
 *
 * Placeholder, and **not** used by fusion — see the module header for why interpolation
 * between the two retrievers is not sound. This exists for the debug view, which displays
 * the raw sub-scores of a fused result so a user can see that a bad answer came from the
 * vector list rather than from fusion. When every score is equal it must return all zeros
 * rather than dividing by a zero range.
 *
 * @param scores - Raw scores from one retriever.
 */
export function normalizeScores(_scores: readonly number[]): number[] {
  // TODO(phase-2): min-max with a zero-range guard, order preserved.
  throw new Error('Not implemented: normalizeScores');
}

/** Re-exported so consumers can name a fused item without a deep import. */
export type { FusedItem, FusedRank, RetrieverKind };
