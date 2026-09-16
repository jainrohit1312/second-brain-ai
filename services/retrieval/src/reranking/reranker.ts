/**
 * Reranking.
 *
 * ## Where this sits, and what it is allowed to do
 *
 * Retrieval is two-stage on purpose. The first stage is cheap and wide: vector and text search
 * return `RETRIEVAL_TOP_K` candidates each, fused into one list. The second stage — this one —
 * reads the actual text of those candidates together with the query and reorders them.
 *
 * The contract that matters, and the reason this file exists at all:
 *
 * > **The reranker sees only the fused candidates, and it must be allowed to DROP them, not
 * > only reorder them.**
 *
 * A reranker that can only permute a fixed list cannot cap a bad retrieval. If all forty fused
 * candidates are mediocre, a reordering reranker still hands the best eight of them to the
 * prompt, and the model then writes a confident answer from eight irrelevant passages. The
 * ability to return *fewer* than `topK` — including none at all — is what lets the pipeline say
 * "this corpus does not answer this question", which is a strictly better outcome than a
 * plausible answer grounded in nothing. Dropping is how a bad retrieval gets capped before it
 * reaches the prompt.
 *
 * The corollary: an empty reranked result is a valid, successful outcome. Callers must render
 * it as "nothing found" rather than as an error, and must never fall back to the unfiltered
 * fused list when the reranker returns nothing.
 *
 * ## Degrading
 *
 * When the configured reranker is unavailable — no credential, provider down, rate limited —
 * the engine uses `NoopReranker` and marks the result `degraded: true` on
 * `RetrievalResult`. It does not fail the query and it does not silently discard candidates:
 * success criterion S6 requires retrieval to degrade rather than fail, and a flagged weaker
 * answer is much better than no answer.
 */
import { z } from 'zod';

import type { RerankerConfig, ScoredChunk } from '../types';

/**
 * Candidates kept after reranking.
 *
 * Sourced from `RERANK_TOP_K` (8). This is the only number that matters for prompt cost: 8
 * passages is roughly 2k tokens of evidence, which leaves room for the system prompt, the
 * conversation and the answer inside a comfortable context window. Raising it rarely improves
 * answers — past a handful of passages the model attends to the first and the last.
 */
export const RERANK_TOP_K = 8;

/**
 * A cross-encoder reranker.
 *
 * Implementations must be able to return fewer candidates than they were given, including
 * zero. They must not mutate the candidates they receive: the fused list is still needed for
 * debugging and for `RetrievalResult.chunks`.
 */
export interface RerankProvider {
  /** Identifier of the implementation, stamped onto the engine for logging. */
  readonly id: RerankerConfig['provider'];

  /**
   * Scores candidates against the query and returns the survivors, best first.
   *
   * @param query - The user's question, verbatim.
   * @param candidates - Fused candidates, best first, at most `RETRIEVAL_TOP_K` of them.
   * @param topK - Maximum survivors. Returning fewer — or none — is allowed and meaningful.
   */
  rerank(query: string, candidates: readonly ScoredChunk[], topK: number): Promise<ScoredChunk[]>;
}

/**
 * The response contract for `LlmReranker`, validated locally by `LlmProvider.completeJson`.
 *
 * Scoring is pointwise by candidate index rather than a ranking: models are markedly more
 * reliable at "is this passage relevant, 0 to 1" than at emitting a faithful permutation of
 * twenty items, and a partial or duplicated permutation would silently drop candidates. An
 * index the model did not mention is treated as a score of zero, which is a decision to drop.
 */
export const rerankScoresSchema = z.object({
  scores: z
    .array(
      z.object({
        /** 0-based index into the candidate list as provided. */
        index: z.number().int().min(0),
        relevance: z.number().min(0).max(1),
      }),
    )
    .max(64),
});

/**
 * Hosted cross-encoder reranker.
 *
 * The strongest of the three when available, and the only one with an external dependency that
 * charges per query.
 *
 * TODO(phase-3): this provider needs a credential that `.env.example` does not yet declare
 * (`COHERE_API_KEY`); adding it — and deciding whether per-query cost is acceptable for an
 * interactive path — is part of enabling the implementation.
 */
export class CohereReranker implements RerankProvider {
  readonly id = 'cohere' as const;

  /** Configuration, including the credential and model name. Never mutated. */
  constructor(readonly config: RerankerConfig) {}

  async rerank(
    _query: string,
    _candidates: readonly ScoredChunk[],
    _topK: number,
  ): Promise<ScoredChunk[]> {
    // TODO(phase-3): call the rerank endpoint with the candidate texts, map its relevance
    // scores onto `rerankScore`, and drop candidates below the provider's own threshold.
    throw new Error('Not implemented: CohereReranker.rerank');
  }
}

/**
 * Model-based reranker over the configured LLM.
 *
 * Weaker than a purpose-built cross-encoder and slower than either alternative, but it needs no
 * new credential, which matters because it is the only option that works on a fresh install
 * with nothing configured but an LLM key. Must run at `temperature: 0` and is again allowed to
 * return fewer than `topK`.
 */
export class LlmReranker implements RerankProvider {
  readonly id = 'llm' as const;

  /** Configuration. `config.llm` is required for this implementation. */
  constructor(readonly config: RerankerConfig) {}

  async rerank(
    _query: string,
    _candidates: readonly ScoredChunk[],
    _topK: number,
  ): Promise<ScoredChunk[]> {
    // TODO(phase-3): batch the candidates into one `completeJson` call against
    // `rerankScoresSchema` at `temperature: 0`, treat unmentioned indexes as zero, and return
    // the survivors with `rerankScore` populated.
    throw new Error('Not implemented: LlmReranker.rerank');
  }
}

/**
 * Keeps the fused order and drops the tail.
 *
 * A real implementation, not a stub: this is the degraded path, and it has to be *correct* —
 * with no reranker the pipeline must still cap the prompt at `topK` candidates rather than
 * passing everything through. It copies the array (so callers cannot be surprised by a shared
 * reference) and shares the items themselves, which are treated as immutable everywhere.
 */
export class NoopReranker implements RerankProvider {
  readonly id = 'none' as const;

  async rerank(
    _query: string,
    candidates: readonly ScoredChunk[],
    topK: number,
  ): Promise<ScoredChunk[]> {
    return candidates.slice(0, Math.max(0, topK));
  }
}

/**
 * Builds the configured reranker.
 *
 * `provider: 'none'` is a supported configuration, not a failure mode, and `'llm'` without a
 * provider instance must fail at construction rather than at the first query.
 *
 * @param config - Provider choice, candidate cap and credentials. See `RerankerConfig`.
 */
export function createReranker(_config: RerankerConfig): RerankProvider {
  // TODO(phase-3): exhaustive switch over `provider` with `assertNever` in the default branch,
  // defaulting `topK` to `RERANK_TOP_K`.
  throw new Error('Not implemented: createReranker');
}
