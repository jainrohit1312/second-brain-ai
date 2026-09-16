/**
 * Memory deduplication.
 *
 * A corpus that accumulates near-identical memories is worse than one that misses a few:
 * duplicates crowd the top of every retrieval result, inflate the apparent confidence of a
 * claim, and make the memory list unreadable. Deduplication therefore runs on every
 * candidate before it is inserted.
 *
 * ## Three cheapness tiers, in order
 *
 * 1. **Exact statement hash** — `sha256Hex` from `@second-brain/shared` over the
 *   whitespace-normalized statement. No round trip, no model, catches the common case of the
 *   same sentence distilled twice from two documents. Reported as `kind: 'exact'` with
 *   `similarity: EXACT_MATCH`. The digest must be identical to the `statement_hash` the
 *   database layer persists, because that column is the uniqueness key: a hash computed
 *   differently here would silently disable exact-duplicate detection without failing anything.
 * 2. **Embedding cosine over the nearest neighbours** — the candidate is embedded once (with
 *   the *same* model that produced the stored vectors) and compared against the top
 *   `CANDIDATE_K` memories, which the data layer returns from the `match_memories` RPC. This
 *   is what catches paraphrase.
 * 3. **LLM adjudication** — only for the borderline band between
 *   `NEAR_DUPLICATE_THRESHOLD` and certainty. Tier 3 exists because tiers 1 and 2 cannot
 *   distinguish "the same fact, reworded" from "a related but distinct fact", and that
 *   distinction decides merge versus insert.
 *
 * The ordering is not an optimisation detail: it is what keeps the expensive tier off the
 * overwhelming majority of candidates.
 */
import type { EmbeddingProvider, LlmProvider } from '@second-brain/providers';
import type { Memory, MemoryCandidate } from '@second-brain/shared';

/**
 * Similarity reported for an exact statement-hash match.
 *
 * Also the top of the cosine scale, which is why one constant serves both: a hash match is
 * by definition a similarity of 1, and reusing the value keeps the thresholds below expressed
 * on a single scale.
 */
export const EXACT_MATCH = 1;

/**
 * Cosine similarity at or above which two statements are treated as the same memory.
 *
 * 0.9 is conservative on purpose. Two paraphrases of one fact usually land above 0.9 in a
 * good embedding space, while two *related* facts often land at 0.85 — so a lower threshold
 * starts merging distinct statements, and a merged statement is a fact the user never stated.
 * The cost of the conservative choice is a few duplicates, which a later pass can collapse;
 * the cost of the aggressive one is silent corruption.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.9;

/**
 * Nearest neighbours fetched from the vector index per candidate.
 *
 * Small because the tier-2 comparison is a sanity check, not a search, and because the
 * candidates are the user's own memories — the useful matches are always very close.
 */
export const CANDIDATE_K = 5;

/** How a candidate relates to a matched memory. Decides merge versus supersede versus insert. */
export type MemoryRelation =
  /** The same fact, expressed differently. Nothing new to store. */
  | 'duplicate'
  /** Additional detail that belongs in one statement with the match. */
  | 'complementary'
  /** A statement that cannot hold at the same time as the match, or a change over time. */
  | 'contradictory'
  /** Chosen as a nearest neighbour by similarity but judged to be about something else. */
  | 'unrelated';

/**
 * The verdict of the deduplication tiers, when there is one.
 *
 * Carries the target's statement so `decideMerge` can produce a human-readable reason without
 * a second lookup, and `relation` so the merge decision is a pure function of this value.
 */
export interface DuplicateMatch {
  /** Id of the existing memory this candidate matched. */
  memoryId: string;
  /** Which tier produced the match. `exact` means the statement hashes are identical. */
  kind: 'exact' | 'near';
  /** Cosine similarity in `[0, 1]`; `EXACT_MATCH` for a hash match. */
  similarity: number;
  /** How the candidate relates to the match. See `MemoryRelation`. */
  relation: MemoryRelation;
  /** True when `relation` came from LLM adjudication rather than from the threshold alone. */
  adjudicated: boolean;
  /** The matched memory's current statement, for the reason string and for merging. */
  targetStatement: string;
}

/**
 * Everything the deduplication tiers need.
 *
 * Providers are passed in rather than resolved here so that the whole pipeline shares one
 * embedding instance — and therefore one `EMBEDDING_MODEL`, which is the invariant that makes
 * the stored vectors comparable at all.
 */
export interface DedupOptions {
  /** Used to embed the candidate for the tier-2 comparison. */
  embeddings: EmbeddingProvider;
  /** Used for tier-3 adjudication. When absent, the threshold alone decides the relation. */
  llm?: LlmProvider;
  /** Overrides `NEAR_DUPLICATE_THRESHOLD`. */
  nearDuplicateThreshold?: number;
  /** Overrides `CANDIDATE_K`. */
  candidateK?: number;
  /** Set `false` to skip tier 3 entirely. Defaults to `true`. */
  adjudicate?: boolean;
}

/**
 * Finds the existing memory a candidate duplicates or relates to.
 *
 * Contract:
 * - Returns `null` when nothing is close enough, which is the common case and must be cheap:
 *   the tier-1 hash check happens before anything is embedded.
 * - `existing` is the caller's already-narrowed candidate set (same user, usually same
 *   topics). This function does not query the database — the vector query belongs to the data
 *   layer, and keeping it out of here is what makes the tiers testable without a database.
 * - Never mutates the candidate or the existing memories.
 * - A candidate with an empty statement is rejected by the caller, not here.
 *
 * @param candidate - The distilled candidate being admitted.
 * @param existing - Candidate memories to compare against.
 * @param opts - Providers and threshold overrides. See `DedupOptions`.
 */
export async function findDuplicate(
  _candidate: MemoryCandidate,
  _existing: readonly Memory[],
  _opts: DedupOptions,
): Promise<DuplicateMatch | null> {
  // TODO(phase-2): tier 1 hash compare on `contentHash(statement)`; tier 2 embed the
  // candidate once and take the closest of `existing`; tier 3 adjudicate the borderline band
  // via `llm.completeJson` and map the verdict onto `MemoryRelation`.
  throw new Error('Not implemented: findDuplicate');
}
