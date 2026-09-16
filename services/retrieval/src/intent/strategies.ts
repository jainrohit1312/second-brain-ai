/**
 * Retrieval strategies, one per query intent.
 *
 * A strategy is a **composition declaration**, not an algorithm. It says which sub-retrievers
 * run for this intent and how much each counts; the engine runs them and fuses the result.
 * That separation is deliberate: "temporal questions must filter on time" belongs in a
 * readable table that a reviewer can check against the intent taxonomy, not inside a
 * conditional in a retriever.
 *
 * ## The `metadata` component is not a ranker
 *
 * `metadata` appears as a component of `temporal`, `activity`, `entity` and `mixed`, and it
 * is **mandatory** for `temporal` and `activity`. It does not produce a ranked list to fuse —
 * it produces the predicates that go *inside* the other retrievers' SQL (see
 * `hybrid/metadata-filter.ts`) plus the ordering those intents need: `temporal` sorts on
 * `occurred_at`, `activity` aggregates on it. Its `weight` is therefore not used in the fused
 * sum, which is why it is declared as `1` everywhere it appears.
 *
 * ## Why the weights differ
 *
 * The global defaults (`HYBRID_VECTOR_WEIGHT` 0.6, `HYBRID_FTS_WEIGHT` 0.4) answer "which
 * retriever is generally better". A strategy weight answers "better for *this kind of
 * question*": an `entity` question is about a named thing, so lexical search — which matches
 * the name exactly — outranks the embedding that merely puts it in the right neighbourhood,
 * while a `semantic` question is the reverse.
 */
import type { RetrievalStrategy, StrategyComponent } from '../types';
import type { QueryIntent } from '@second-brain/shared';

/**
 * Builds a strategy from its declaration.
 *
 * All five strategies share one `retrieve`, because the difference between them is entirely
 * data: which components, in which order, with which weights. Duplicating the body five times
 * would create five places for the same composition bug to hide.
 */
function defineStrategy(
  intent: QueryIntent,
  weight: number,
  components: readonly StrategyComponent[],
): RetrievalStrategy {
  return {
    intent,
    weight,
    components,
    retrieve(_query, _deps) {
      // TODO(phase-2): run the declared `vector` and `fts` components in parallel with the
      // metadata predicates pushed into their queries, return one ranked list per component
      // in declaration order, and drop the `metadata` component from the fused contribution.
      throw new Error(`Not implemented: ${intent} strategy`);
    },
  };
}

/**
 * Conceptual questions with no time component: "what do I know about vector index tuning".
 *
 * Both retrievers run at full global weight, because this is the case hybrid retrieval was
 * designed for — the paraphrase problem that makes lexical search fail and the identifier
 * problem that makes vector search fail are both live here.
 */
export const semanticStrategy: RetrievalStrategy = defineStrategy('semantic', 1, [
  { retriever: 'vector', weight: 1 },
  { retriever: 'fts', weight: 1 },
]);

/**
 * Time-bounded questions: "what was I reading last week".
 *
 * The metadata filter is mandatory: without an `occurred_at` bound, the nearest neighbours
 * are whatever is most similar, and the time range in the question is silently ignored — the
 * single most common way a retrieval system appears to work while answering a different
 * question. Fused weight then leans slightly towards the vector list, because a time-bounded
 * question is usually still a paraphrase.
 */
export const temporalStrategy: RetrievalStrategy = defineStrategy('temporal', 1, [
  { retriever: 'metadata', weight: 1 },
  { retriever: 'vector', weight: 1 },
  { retriever: 'fts', weight: 0.8 },
]);

/**
 * Behavioural questions: "what did I work on for Northwind last Tuesday".
 *
 * No document answers this. The candidates are activity events — dwell time, app sessions,
 * domains, searches — reached through the text index over events, which is why `fts` carries
 * the weight here and `vector` is absent: embedding a `page_view` row would mean embedding a
 * title and a domain, which adds noise to a list that is already answerable exactly.
 *
 * The metadata filter is mandatory for the same reason as `temporal`, and more sharply: this
 * intent exists to answer *about a period*, so a missing bound is not a degraded answer, it is
 * the wrong answer.
 */
export const activityStrategy: RetrievalStrategy = defineStrategy('activity', 1, [
  { retriever: 'metadata', weight: 1 },
  { retriever: 'fts', weight: 1 },
]);

/**
 * Questions about a named thing: "everything involving Acme", "the pgvector migration doc".
 *
 * Lexical search is weighted above the vector retriever on purpose. A name is a token, and
 * embeddings notoriously place a rare proper noun near its neighbours rather than on it —
 * whereas the text index either contains the token or does not. The vector list still runs,
 * at reduced weight, for the case where the user half-remembers the name.
 */
export const entityStrategy: RetrievalStrategy = defineStrategy('entity', 1, [
  { retriever: 'metadata', weight: 1 },
  { retriever: 'fts', weight: 1.5 },
  { retriever: 'vector', weight: 1 },
]);

/**
 * Weighted blend — the safe default when classification is unsure.
 *
 * Every retriever participates at its global weight, so this strategy cannot be badly wrong:
 * it is the composition that degrades gracefully when the intent is misjudged, which is why
 * both the low-confidence rule path and a missing LLM fall back to it.
 */
export const mixedStrategy: RetrievalStrategy = defineStrategy('mixed', 1, [
  { retriever: 'metadata', weight: 1 },
  { retriever: 'vector', weight: 1 },
  { retriever: 'fts', weight: 1 },
]);
