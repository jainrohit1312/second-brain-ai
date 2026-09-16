/**
 * Semantic chunking — phase 2, not yet available.
 *
 * ## The approach
 *
 * Instead of splitting on structural boundaries, split where the *meaning* changes:
 *
 * 1. Split the document into sentences.
 * 2. Embed consecutive sentences (and small windows of them) in one batched call.
 * 3. Compute the cosine similarity between adjacent sentences.
 * 4. Cut at local minima — points lower than both neighbours and below
 *    `SEMANTIC_SIMILARITY_THRESHOLD`. Those are the topic shifts.
 * 5. Merge the resulting spans up to `CHUNK_SIZE`, preserving reading order.
 *
 * ## Why it is deferred
 *
 * It needs a round trip to the embedding provider for every document, which makes it the
 * only chunker that is not pure. That has three consequences: it cannot run on the client,
 * it cannot be tested without a provider, and it makes re-chunking a cost decision rather
 * than a computation. The recursive chunker is the default until measurements show that
 * semantic boundaries actually improve retrieval — a plausible but unmeasured claim.
 *
 * It is also the *only* chunker whose output changes when the embedding model changes, which
 * means switching to it ties chunk identity to `EMBEDDING_MODEL` and triggers a re-chunk
 * (and therefore a re-embed) whenever that is pinned differently.
 */
import type { Chunker, ChunkingOptions, TextChunk } from '../types';
import type { EmbeddingProvider } from '@second-brain/providers';
import type { ChunkingStrategy } from '@second-brain/shared';

/**
 * Adjacent-sentence cosine similarity below which a boundary is a candidate cut.
 *
 * 0.72 is a starting guess, not a measured value: it must be calibrated per embedding model,
 * because cosine similarity is not comparable across models. Treat it as a knob to tune
 * against a labelled fixture set, not as a constant to trust.
 */
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.72;

/**
 * Splits at topic shifts rather than at structural boundaries.
 *
 * Holds its embedding provider as a public field so the pipeline can pass one instance in
 * and tests can substitute a deterministic double. Nothing in the constructor is optional:
 * a semantic chunker without a provider has no meaningful behaviour, and failing at
 * construction is better than failing per document.
 */
export class SemanticChunker implements Chunker {
  /** Strategy name persisted onto every `DocumentChunk` this chunker produces. */
  readonly strategy: ChunkingStrategy = 'semantic';

  /** Provider used to embed sentences before measuring adjacent similarity. */
  constructor(readonly embeddings: EmbeddingProvider) {}

  /**
   * @param text - Cleaned document body.
   * @param opts - Size and overlap overrides, applied after the semantic boundaries are
   *   resolved. `separators` is accepted for interface compatibility and ignored: this
   *   chunker does not use structural separators.
   * @returns Chunks in reading order with contiguous `ordinal` values from `0`.
   */
  chunk(_text: string, _opts: ChunkingOptions = {}): TextChunk[] {
    // TODO(phase-2): sentence split → batched `embeddings.embed` → adjacent cosine →
    // local minima below `SEMANTIC_SIMILARITY_THRESHOLD` → merge to `chunkSize`. Record the
    // provider's `model` on the run, because a different model means different boundaries.
    throw new Error('Not implemented: SemanticChunker.chunk');
  }
}
