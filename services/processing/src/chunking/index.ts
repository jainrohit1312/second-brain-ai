/**
 * Chunker selection.
 *
 * The strategy is a property of the *document*, recorded on every chunk row
 * (`DocumentChunk.strategy`), because changing chunking strategy is a re-chunk migration and
 * the stored value is how a future re-processing pass knows which chunks are stale.
 */
import { assertNever } from '@second-brain/shared';

import { FixedChunker, RecursiveChunker } from './recursive';
import { SemanticChunker } from './semantic';

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
 * `SemanticChunker.chunk` is still unimplemented (phase 7); constructing one succeeds so the
 * failure is a named "not implemented" at the call site rather than a strategy mismatch here.
 *
 * @param strategy - Strategy recorded on the produced chunks.
 * @param embeddings - Required for `'semantic'`; ignored by the other strategies.
 */
export function createChunker(
  strategy: ChunkingStrategy,
  embeddings?: EmbeddingProvider,
): Chunker {
  switch (strategy) {
    case 'recursive':
      return new RecursiveChunker();
    case 'fixed':
      return new FixedChunker();
    case 'semantic':
      if (embeddings === undefined) {
        throw new Error(
          "createChunker('semantic') requires an EmbeddingProvider: semantic chunking cuts on " +
            'adjacent-sentence similarity, so it cannot run without one, and falling back to ' +
            "the recursive chunker would record rows as 'semantic' that never were.",
        );
      }
      return new SemanticChunker(embeddings);
    default:
      return assertNever(strategy, `Unknown chunking strategy: ${String(strategy)}`);
  }
}

export {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  DEFAULT_SEPARATORS,
  FixedChunker,
  MIN_CHUNK_SIZE,
  RecursiveChunker,
} from './recursive';
export { SEMANTIC_SIMILARITY_THRESHOLD, SemanticChunker } from './semantic';
export type { Chunker, ChunkingOptions, TextChunk } from '../types';
