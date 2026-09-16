/**
 * Chunker selection.
 *
 * The strategy is a property of the *document*, recorded on every chunk row
 * (`DocumentChunk.strategy`), because changing chunking strategy is a re-chunk migration and
 * the stored value is how a future re-processing pass knows which chunks are stale.
 */
import type { Chunker } from '../types';
import type { EmbeddingProvider } from '@second-brain/providers';
import type { ChunkingStrategy } from '@second-brain/shared';

/**
 * Builds the chunker for a strategy.
 *
 * Contract:
 * - `'recursive'` and `'fixed'` need no dependencies and are constructible anywhere,
 *   including on the client. `'fixed'` is the degenerate strategy kept for benchmarking:
 *   splitting at a character offset is measurably worse and exists only as a control.
 * - `'semantic'` requires `embeddings` and must fail loudly at construction when it is
 *   absent, rather than silently degrading to the recursive chunker — a silent downgrade
 *   would be recorded as `strategy: 'semantic'` on rows that were never semantic.
 *
 * @param strategy - Strategy recorded on the produced chunks.
 * @param embeddings - Required for `'semantic'`; ignored by the other strategies.
 */
export function createChunker(
  _strategy: ChunkingStrategy,
  _embeddings?: EmbeddingProvider,
): Chunker {
  // TODO(phase-2): exhaustive switch over `ChunkingStrategy` with `assertNever` in the
  // default branch, so adding a strategy is a compile error here.
  throw new Error('Not implemented: createChunker');
}

export { CHUNK_OVERLAP, CHUNK_SIZE, DEFAULT_SEPARATORS, RecursiveChunker } from './recursive';
export { SEMANTIC_SIMILARITY_THRESHOLD, SemanticChunker } from './semantic';
export type { Chunker, ChunkingOptions, TextChunk } from '../types';
