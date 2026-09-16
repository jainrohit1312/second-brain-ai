/**
 * Recursive character chunking — the default strategy.
 *
 * ## Why recursive rather than fixed-size
 *
 * A fixed splitter cuts at a character offset and therefore cuts mid-sentence, mid-code
 * block and mid-heading, producing chunks that embed poorly and cite worse. This chunker
 * tries separators from coarsest to finest — paragraph, line, sentence, word, character —
 * and only descends a level for the pieces that still exceed the target size. The result is
 * that most chunks end at a paragraph boundary and only pathological input (a single
 * 5000-character line) ever falls through to a character split.
 *
 * ## Heading paths
 *
 * Each chunk carries the heading stack it sits under. That is what makes a chunk like "see
 * the table above" retrievable: retrieval prepends `headingPath` to `text` before embedding,
 * so the surrounding structure travels with the fragment.
 *
 * ## Determinism
 *
 * For a fixed input and options this chunker must produce identical output, including
 * `ordinal` values. Chunk `contentHash` is what lets a re-processing run skip re-embedding
 * unchanged chunks, and that optimisation silently breaks if chunking is nondeterministic.
 */
import type { Chunker, ChunkingOptions, TextChunk } from '../types';
import type { ChunkingStrategy } from '@second-brain/shared';

/**
 * Target maximum characters per chunk.
 *
 * 800 characters is roughly 200 tokens — comfortably inside every supported embedding
 * model's per-input limit, and small enough that a chunk retrieved for its first sentence
 * is not diluted by four unrelated ones. Mirrors `CHUNK_SIZE` in `.env.example`; the two must
 * be raised together, and raising the default requires re-embedding.
 */
export const CHUNK_SIZE = 800;

/**
 * Characters of overlap between consecutive chunks.
 *
 * Overlap is insurance against a sentence that straddles a boundary: with 120 characters
 * carried forward, the sentence appears whole in at least one of the two chunks. It must
 * stay well below `CHUNK_SIZE` — an overlap approaching the chunk size turns one document
 * into a quadratic pile of near-duplicates and destroys reranking.
 */
export const CHUNK_OVERLAP = 120;

/**
 * Separators in descending order of granularity.
 *
 * The empty string is not a typo: it is the terminal case that splits by character, reached
 * only for a run of text with no whitespace at all (a base64 blob, a minified script, a
 * Chinese paragraph with no full stop). Without it the recursion would have no base case.
 */
export const DEFAULT_SEPARATORS: readonly string[] = ['\n\n', '\n', '. ', ' ', ''];

/**
 * Splits a document body on structural boundaries before separating by size.
 *
 * Stateless and synchronous by design: chunking is pure string work, and keeping it free of
 * I/O is what makes it trivially testable against fixtures.
 */
export class RecursiveChunker implements Chunker {
  /** Strategy name persisted onto every `DocumentChunk` this chunker produces. */
  readonly strategy: ChunkingStrategy = 'recursive';

  /**
   * @param text - Cleaned document body.
   * @param opts - Size and separator overrides. Defaults to `CHUNK_SIZE`, `CHUNK_OVERLAP` and
   *   `DEFAULT_SEPARATORS`; an explicit `separators` list replaces the default rather than
   *   extending it.
   * @returns Chunks in reading order with contiguous `ordinal` values from `0`, each carrying
   *   the heading path in force where it starts. Empty or whitespace-only input yields `[]`.
   */
  chunk(_text: string, _opts: ChunkingOptions = {}): TextChunk[] {
    // TODO(phase-2): split on the coarsest separator that yields pieces, recurse into any
    // piece still over `chunkSize`, merge leaves back up to the target, carry `overlap`
    // characters forward, and track the ATX/markdown heading stack into `headingPath`.
    throw new Error('Not implemented: RecursiveChunker.chunk');
  }
}
