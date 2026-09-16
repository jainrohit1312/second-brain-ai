/**
 * Full-text search over the `tsvector` indexes.
 *
 * ## `ts_rank` versus `ts_rank_cd`
 *
 * Both score a `tsvector` against a `tsquery`, and they answer different questions:
 *
 * - **`ts_rank`** — weighted term frequency. Each matching lexeme contributes in proportion
 *   to how often it appears and to its weight (`A`–`D`). It ignores where the matches are
 *   relative to each other.
 * - **`ts_rank_cd`** — cover density. It looks at *covers*: groups of query lexemes that
 *   appear close together, and rewards matches that are adjacent and in query order. Two
 *   occurrences of a two-word phrase score higher than two scattered single words.
 *
 * **This module uses `ts_rank_cd`** (`TS_RANK_FUNCTION`), because retrieval here is
 * passage-level: a chunk is roughly 200 tokens, and within a passage that short, whether the
 * query's terms appear together is a much better relevance signal than how often each term
 * repeats. Term frequency would also reward a chunk that happens to repeat one common word.
 * For whole-document ranking `ts_rank` would be the more conventional choice; that is not the
 * level retrieval operates at.
 *
 * `ts_rank_cd` is more expensive per row, which is acceptable because the candidate set is
 * already bounded by the query's `topK` and by the metadata filters pushed into the query.
 *
 * ## Why `websearch_to_tsquery`
 *
 * It is the only tsquery constructor that accepts untrusted text: it parses `"quoted
 * phrases"`, `or` and `-exclusions` the way a search box does, and it never raises a syntax
 * error on malformed input. `to_tsquery` would reject half of what a person types, and
 * `plainto_tsquery` discards the phrase operators that make an exact-quote search useful.
 */
import { clamp01, normalizeWhitespace } from '@second-brain/shared';

import type { FtsQuery, RetrievalDeps, ScoredChunk } from '../types';

/**
 * Rank function used for every text query. See the comparison in the module header.
 *
 * Kept as a constant rather than duplicated at each call site so the choice is reviewable in
 * one place, and so the RPC's SQL and the documentation cannot drift.
 */
export const TS_RANK_FUNCTION = 'ts_rank_cd';

/**
 * Normalization flag passed to the rank function.
 *
 * `32` divides the rank by itself plus one, mapping the unbounded rank onto `[0, 1)`. That is
 * what makes scores from different queries roughly comparable, and it is why
 * `tsRankToScore` only has to handle the residual within-query variation.
 */
export const TS_RANK_NORMALIZATION = 32;

/**
 * Maximum length of a tsquery string, in characters.
 *
 * A bound, not a quality measure: it caps the work Postgres does parsing a pathological
 * paste, and it keeps a query parameter within a size the RPC can safely plan for.
 */
export const MAX_TSQUERY_LENGTH = 512;

/**
 * Converts user text into a tsquery string for `websearch_to_tsquery`.
 *
 * Pure. Control characters are replaced with spaces (a paste can carry them, and they break
 * lexeme parsing), whitespace is collapsed through the shared helper, and the result is
 * bounded by `MAX_TSQUERY_LENGTH`.
 *
 * The web-search operators are deliberately **kept**: quotes, `or` and `-` are what make a
 * phrase search work, and `websearch_to_tsquery` treats its input as text rather than as
 * syntax, so there is nothing to escape. Truncation can split a quoted phrase, which
 * `websearch_to_tsquery` tolerates by ignoring the unbalanced quote.
 *
 * @param userText - Raw question text, exactly as the user typed it.
 */
export function buildTsQuery(userText: string): string {
  // Matching control characters is the point of this expression, not an oversight.
  // eslint-disable-next-line no-control-regex
  const withoutControlCharacters = userText.replace(/[\u0000-\u001F\u007F]/g, ' ');
  const collapsed = normalizeWhitespace(withoutControlCharacters);

  return collapsed.length > MAX_TSQUERY_LENGTH
    ? collapsed.slice(0, MAX_TSQUERY_LENGTH).trim()
    : collapsed;
}

/**
 * Normalizes a raw text rank onto `[0, 1]`.
 *
 * Pure. Ranks are not comparable across queries — the same chunk scores differently against a
 * one-word query and a ten-word one — so they are normalized against the best hit *within the
 * result set*, which is the only comparison fusion and the debug view actually need. A
 * non-positive or missing ceiling returns `0` rather than dividing by zero.
 *
 * @param rank - Raw `ts_rank_cd` value for this row.
 * @param bestRank - Highest raw rank in the same result set.
 */
export function tsRankToScore(rank: number, bestRank: number): number {
  if (!Number.isFinite(rank) || !Number.isFinite(bestRank) || bestRank <= 0) return 0;
  return clamp01(rank / bestRank);
}

/**
 * Runs a full-text query.
 *
 * Contract:
 * - `query.tsQuery` must already be sanitized by `buildTsQuery`; this function does not accept
 *   raw user text, so there is no path where unsanitized input reaches the query.
 * - Filters are applied inside the query, never after it.
 * - `includeActivity` adds the activity-event index, which is the only path that can answer a
 *   question with no document behind it ("what did I do for Northwind last Tuesday").
 * - Results are ordered by descending rank and carry both `ftsScore` and `score` populated,
 *   with `vectorScore: null`.
 * - An empty result is a valid answer, not an error.
 *
 * @param query - Sanitized tsquery, bounds, filters and target indexes. See `FtsQuery`.
 * @param deps - Data-layer port and providers.
 */
export async function ftsSearch(_query: FtsQuery, _deps: RetrievalDeps): Promise<ScoredChunk[]> {
  // TODO(phase-2): call `deps.db.searchChunks` / `searchMemories` (plus `searchActivity` when
  // requested), pass `TS_RANK_FUNCTION` and `TS_RANK_NORMALIZATION`, and normalize each row's
  // rank against the best rank in its own result set.
  throw new Error('Not implemented: ftsSearch');
}
