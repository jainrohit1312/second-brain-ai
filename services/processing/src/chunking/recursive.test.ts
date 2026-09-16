import { describe, expect, it } from 'vitest';

import { MIN_CHUNK_SIZE, RecursiveChunker } from './recursive';

import { createChunker } from './index';

import type { TextChunk } from '../types';

/**
 * Contract tests for the recursive chunker.
 *
 * The properties that matter downstream are: chunking is deterministic (chunk `content_hash`
 * is what lets a re-processing run skip unchanged work), a paragraph boundary is preferred
 * over a mid-paragraph cut, consecutive chunks overlap so a straddling sentence survives in
 * one of them, no retrievable text is silently lost, every emitted chunk respects the size
 * ceiling, and every chunk knows which heading it sits under.
 */

/** Reads a chunk that the test has already established exists, without a non-null assertion. */
function at(chunks: readonly TextChunk[], index: number): TextChunk {
  const chunk = chunks[index];
  if (chunk === undefined) throw new Error(`Expected a chunk at index ${index}.`);
  return chunk;
}

/** A paragraph that is long enough to fill most of a default chunk, with no internal breaks. */
function paragraph(label: string, length = 470): string {
  return `${label} ${'x'.repeat(length)}`;
}

describe('RecursiveChunker', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    const chunker = new RecursiveChunker();

    expect(chunker.chunk('')).toEqual([]);
    expect(chunker.chunk('   \n\n\t  ')).toEqual([]);
  });

  it('keeps a document shorter than the floor as exactly one whole chunk', () => {
    const text = 'A short note about vector databases.';

    const chunks = new RecursiveChunker().chunk(text);

    expect(chunks).toHaveLength(1);
    expect(at(chunks, 0).text).toBe(text);
    expect(at(chunks, 0).ordinal).toBe(0);
    expect(at(chunks, 0).tokenCount).toBeGreaterThan(0);
  });

  it('prefers paragraph boundaries, giving each long paragraph its own chunk', () => {
    const labels = ['Paragraph 1.', 'Paragraph 2.', 'Paragraph 3.', 'Paragraph 4.'];
    const text = labels.map((label) => paragraph(label)).join('\n\n');

    const chunks = new RecursiveChunker().chunk(text);

    // Two 484-character paragraphs cannot share an 800-character chunk, so each stands alone.
    expect(chunks).toHaveLength(labels.length);
    chunks.forEach((chunk, index) => {
      expect(chunk.ordinal).toBe(index);
      expect(chunk.text).toContain(labels[index] ?? '');
      for (const other of labels) {
        if (other !== labels[index]) expect(chunk.text).not.toContain(other);
      }
    });
  });

  it('carries overlap from one chunk into the next', () => {
    const text = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ');

    const chunks = new RecursiveChunker().chunk(text, { chunkSize: 200, overlap: 40 });

    expect(chunks.length).toBeGreaterThan(1);

    const first = at(chunks, 0).text;
    const second = at(chunks, 1).text;

    // The tail of the first chunk reappears at the head of the second, so a sentence cut across
    // the boundary survives whole in one of them. The overlap is word-aligned, so the assertion
    // is on whole words rather than on a raw character offset.
    const lastWords = first.split(' ').slice(-3).join(' ');
    expect(second).toContain(lastWords);

    // ...and the carried prefix counts against the ceiling rather than exceeding it.
    expect(second.length).toBeLessThanOrEqual(200);
  });

  it('folds a short trailing fragment into its predecessor instead of dropping it', () => {
    const head = 'a'.repeat(700);
    const tail = 'b'.repeat(200);
    const text = `${head}\n\n${tail}`;

    const chunks = new RecursiveChunker().chunk(text);

    // 200 characters is below MIN_CHUNK_SIZE, so the tail must not become a chunk of its own —
    // and must not be discarded either.
    expect(MIN_CHUNK_SIZE).toBeGreaterThan(tail.length);
    expect(chunks).toHaveLength(1);
    expect(at(chunks, 0).text).toContain(head);
    expect(at(chunks, 0).text).toContain(tail);
  });

  it('attributes each chunk to the heading stack in force where it starts', () => {
    const text = '# Top\n\none two three\n\n## Sub\n\nfour five six';

    const chunks = new RecursiveChunker().chunk(text, {
      chunkSize: 20,
      overlap: 0,
      minChunkSize: 1,
    });

    expect(chunks.map((chunk) => chunk.headingPath)).toEqual([
      ['Top'],
      ['Top'],
      ['Top', 'Sub'],
      ['Top', 'Sub'],
    ]);
  });

  it('is deterministic for a fixed input and options', () => {
    const text = Array.from({ length: 400 }, (_, index) => `token${index}`).join(' ');

    const first = new RecursiveChunker().chunk(text, { chunkSize: 300, overlap: 60 });
    const second = new RecursiveChunker().chunk(text, { chunkSize: 300, overlap: 60 });

    expect(second).toEqual(first);
  });

  it('hard-splits a run of text with no separator, staying inside the ceiling', () => {
    const text = 'z'.repeat(2_500);

    const chunks = new RecursiveChunker().chunk(text, { minChunkSize: 1 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(800);
  });
});

describe('createChunker', () => {
  it('builds a chunker for the dependency-free strategies', () => {
    expect(createChunker('recursive').strategy).toBe('recursive');
    expect(createChunker('fixed').strategy).toBe('fixed');
  });

  it('refuses a semantic chunker without an embedding provider', () => {
    expect(() => createChunker('semantic')).toThrow(/EmbeddingProvider/);
  });
});
