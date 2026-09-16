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
 * so the surrounding structure travels with the fragment. The stack is resolved from ATX
 * (`# …`) headings, and a chunk that begins on a heading line is considered to sit *under*
 * that heading rather than beside it.
 *
 * ## The trailing-chunk floor, and why it folds instead of dropping
 *
 * A document's last fragment is often a few words that did not fill a chunk. `minChunkSize`
 * keeps such a fragment from becoming a chunk of its own — a two-sentence embedding is a poor
 * retrieval unit and dilutes reranking. It is folded into its predecessor rather than
 * discarded: a dropped tail is retrievable text silently lost, which is worse than one
 * slightly oversized chunk (the same argument `youtube-transcript.ts` makes about never
 * truncating a caption). A document shorter than the floor still yields exactly one chunk,
 * because a short page that embeds nowhere is invisible.
 *
 * ## Overlap lives inside the size budget, not on top of it
 *
 * `CHUNK_SIZE` is a maximum, so the carried-over prefix counts against it: the body is split
 * at `chunkSize - overlap - 1` and the prefix is prepended, which keeps every emitted chunk
 * at or below `chunkSize` characters. Adding overlap on top would let a chunk reach 920
 * characters against a documented ceiling of 800, which is exactly the budget that keeps a
 * chunk inside the embedding model's per-input limit.
 *
 * ## Determinism
 *
 * For a fixed input and options this chunker must produce identical output, including
 * `ordinal` values. Chunk `content_hash` is what lets a re-processing run skip re-embedding
 * unchanged chunks, and that optimisation silently breaks if chunking is nondeterministic.
 */
import { estimateTokens } from '@second-brain/shared';

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
 * Floor below which a trailing fragment is folded into its predecessor.
 *
 * 400 characters is roughly 100 tokens at the shared `CHARS_PER_TOKEN` ratio — the point
 * below which a chunk's vector is dominated by noise rather than by a claim worth citing.
 */
export const MIN_CHUNK_SIZE = 400;

/**
 * Separators in descending order of granularity.
 *
 * The empty string is not a typo: it is the terminal case that splits by character, reached
 * only for a run of text with no whitespace at all (a base64 blob, a minified script, a
 * Chinese paragraph with no full stop). Without it the recursion would have no base case.
 */
export const DEFAULT_SEPARATORS: readonly string[] = ['\n\n', '\n', '. ', ' ', ''];

/** One ATX heading found in the body, with the offset of the line it starts on. */
interface Heading {
  /** Character offset of the `#` in the source text. */
  offset: number;
  /** 1 for `#`, 6 for `######`. */
  level: number;
  /** Heading text with the marker and surrounding whitespace removed. */
  title: string;
}

/**
 * A slice of the source text plus the offset it came from.
 *
 * `start` is what lets a chunk resolve its own heading path and what keeps overlap from
 * silently shifting the structure a chunk is attributed to.
 */
interface Piece {
  text: string;
  start: number;
}

/** `# …` through `###### …`, anchored to the start of a line. */
const ATX_HEADING = /(^|\n)(#{1,6})[ \t]+([^\n]*)/g;

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
   * @param opts - Size and separator overrides. Defaults to `CHUNK_SIZE`, `CHUNK_OVERLAP`,
   *   `MIN_CHUNK_SIZE` and `DEFAULT_SEPARATORS`; an explicit `separators` list replaces the
   *   default rather than extending it.
   * @returns Chunks in reading order with contiguous `ordinal` values from `0`, each carrying
   *   the heading path in force where it starts. Empty or whitespace-only input yields `[]`.
   */
  chunk(text: string, opts: ChunkingOptions = {}): TextChunk[] {
    if (text.trim().length === 0) return [];

    const chunkSize = positiveOr(opts.chunkSize, CHUNK_SIZE);
    const overlap = clampOverlap(opts.overlap ?? CHUNK_OVERLAP, chunkSize);
    const minChunkSize = positiveOr(opts.minChunkSize, MIN_CHUNK_SIZE);
    const separators = opts.separators ?? DEFAULT_SEPARATORS;
    const bodyMax = bodyBudget(chunkSize, overlap);

    const headings = findHeadings(text);
    const leaves = splitRecursive(text, 0, separators, bodyMax);
    const merged = mergeLeaves(leaves, bodyMax);
    const sized = foldShortTail(merged, minChunkSize);

    return assemble(sized, headings, overlap);
  }
}

/**
 * The degenerate strategy kept for benchmarking.
 *
 * Splits at a character offset and ignores structure entirely, so it produces the
 * mid-sentence cuts the recursive chunker exists to avoid. It is here so that
 * `createChunker('fixed')` is total and a later comparison has a control arm, not because
 * anything should use it in production.
 */
export class FixedChunker implements Chunker {
  /** Strategy name persisted onto every `DocumentChunk` this chunker produces. */
  readonly strategy: ChunkingStrategy = 'fixed';

  /**
   * @param text - Cleaned document body.
   * @param opts - `chunkSize` and `overlap` only; `separators` is ignored, since this chunker
   *   has no notion of structure.
   * @returns Chunks in reading order with contiguous `ordinal` values from `0` and an empty
   *   `headingPath` on every one.
   */
  chunk(text: string, opts: ChunkingOptions = {}): TextChunk[] {
    if (text.trim().length === 0) return [];

    const chunkSize = positiveOr(opts.chunkSize, CHUNK_SIZE);
    const overlap = clampOverlap(opts.overlap ?? CHUNK_OVERLAP, chunkSize);

    return assemble(hardSplit(text, 0, bodyBudget(chunkSize, overlap)), [], overlap);
  }
}

/** Turns the prepared pieces into `TextChunk`s, applying overlap and resolving headings. */
function assemble(pieces: readonly Piece[], headings: readonly Heading[], overlap: number): TextChunk[] {
  const chunks: TextChunk[] = [];
  let previousText: string | undefined;

  for (const piece of pieces) {
    const trimmed = trimPiece(piece);
    if (trimmed.text.length === 0) continue;

    const prefix = previousText === undefined ? '' : overlapTail(previousText, overlap);
    const text = joinOverlap(prefix, trimmed.text);

    chunks.push({
      text,
      ordinal: chunks.length,
      tokenCount: estimateTokens(text),
      headingPath: headingPathAt(headings, trimmed.start),
    });

    // The overlap is taken from the chunk *without* its own prefix, so two chunks never chain
    // an overlap through a third and the carried text stays one hop long.
    previousText = trimmed.text;
  }

  return chunks;
}

/**
 * Splits `text` at the coarsest separator that yields more than one piece, recursing only
 * into the pieces that still exceed `max`; the terminal `''` separator hard-splits by
 * character.
 */
function splitRecursive(
  text: string,
  offset: number,
  separators: readonly string[],
  max: number,
): Piece[] {
  if (text.length <= max) return [{ text, start: offset }];

  const [separator, ...rest] = separators;
  if (separator === undefined || separator === '') return hardSplit(text, offset, max);

  const parts = splitOn(text, offset, separator);
  // The separator does not occur in this text at all: descend a level without splitting.
  if (parts.length <= 1) return splitRecursive(text, offset, rest, max);

  const leaves: Piece[] = [];
  for (const part of parts) {
    if (part.text.length <= max) leaves.push(part);
    else leaves.push(...splitRecursive(part.text, part.start, rest, max));
  }
  return leaves;
}

/** Cuts `text` into `max`-character pieces, the base case for input with no usable separator. */
function hardSplit(text: string, offset: number, max: number): Piece[] {
  const pieces: Piece[] = [];
  for (let cursor = 0; cursor < text.length; cursor += max) {
    pieces.push({ text: text.slice(cursor, cursor + max), start: offset + cursor });
  }
  return pieces.length > 0 ? pieces : [{ text, start: offset }];
}

/**
 * Splits on `separator` with the separator kept at the end of each piece, so the pieces
 * concatenate back to the input byte for byte and every `start` stays exact.
 */
function splitOn(text: string, offset: number, separator: string): Piece[] {
  const parts: Piece[] = [];
  let cursor = 0;

  for (;;) {
    const index = text.indexOf(separator, cursor);
    if (index === -1) {
      parts.push({ text: text.slice(cursor), start: offset + cursor });
      return parts;
    }
    const end = index + separator.length;
    parts.push({ text: text.slice(cursor, end), start: offset + cursor });
    cursor = end;
  }
}

/** Merges adjacent leaves back up to `max` characters, dropping nothing. */
function mergeLeaves(leaves: readonly Piece[], max: number): Piece[] {
  const merged: Piece[] = [];
  let current: Piece | undefined;

  for (const leaf of leaves) {
    if (current === undefined) {
      current = { ...leaf };
      continue;
    }
    if (current.text.length + leaf.text.length <= max) {
      current = { text: current.text + leaf.text, start: current.start };
    } else {
      merged.push(current);
      current = { ...leaf };
    }
  }

  if (current !== undefined) merged.push(current);
  return merged;
}

/**
 * Folds a trailing piece shorter than `min` into its predecessor.
 *
 * Only the final piece is considered, and only when it has a predecessor — a lone short piece
 * is the whole document and must survive. Nothing is discarded, so the union of the returned
 * pieces' text still covers the input.
 */
function foldShortTail(pieces: readonly Piece[], min: number): Piece[] {
  if (pieces.length <= 1 || min <= 0) return [...pieces];

  const last = pieces[pieces.length - 1];
  const previous = pieces[pieces.length - 2];
  if (last === undefined || previous === undefined) return [...pieces];
  if (last.text.trim().length >= min) return [...pieces];

  const folded: Piece = { text: previous.text + last.text, start: previous.start };
  return [...pieces.slice(0, -2), folded];
}

/** Removes a piece's outer whitespace, advancing `start` past whatever it trimmed. */
function trimPiece(piece: Piece): Piece {
  const trimmed = piece.text.trim();
  const leading = piece.text.length - piece.text.trimStart().length;
  return { text: trimmed, start: piece.start + leading };
}

/** Every ATX heading in the body, in reading order. */
function findHeadings(text: string): Heading[] {
  const headings: Heading[] = [];
  ATX_HEADING.lastIndex = 0;

  for (let match = ATX_HEADING.exec(text); match !== null; match = ATX_HEADING.exec(text)) {
    const lead = match[1] ?? '';
    const marker = match[2] ?? '';
    const title = match[3] ?? '';
    headings.push({
      offset: match.index + lead.length,
      level: marker.length,
      title: title.trim(),
    });
  }

  return headings;
}

/**
 * The heading stack in force at `start`, outermost first. A chunk that begins exactly on a
 * heading line is attributed to that heading, so `offset <= start` rather than `<`.
 */
function headingPathAt(headings: readonly Heading[], start: number): string[] {
  const stack: Heading[] = [];

  for (const heading of headings) {
    if (heading.offset > start) break;
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) {
      stack.pop();
    }
    stack.push(heading);
  }

  return stack.map((heading) => heading.title);
}

/**
 * Up to `max` characters from the end of `text`, started after the first whitespace boundary
 * so an overlap never begins mid-word.
 */
function overlapTail(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;

  const slice = text.slice(text.length - max);
  const boundary = slice.search(/\s/);
  return boundary === -1 ? slice : slice.slice(boundary + 1);
}

/** Joins an overlap prefix to a chunk body without welding two words together. */
function joinOverlap(prefix: string, text: string): string {
  if (prefix === '') return text;
  return /\s$/.test(prefix) || /^\s/.test(text) ? prefix + text : `${prefix} ${text}`;
}

/** Uses `value` when it is a positive finite number, otherwise falls back to `fallback`. */
function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/** Keeps overlap strictly below the chunk size so a chunk is never fully covered by its prefix. */
function clampOverlap(overlap: number, chunkSize: number): number {
  if (!Number.isFinite(overlap) || overlap <= 0) return 0;
  return Math.min(Math.floor(overlap), Math.max(0, chunkSize - 1));
}

/**
 * Characters available to a chunk body once the carried-over prefix is accounted for.
 *
 * One character is reserved for the space `joinOverlap` may insert between a prefix and a
 * body, so `prefix + ' ' + body` can never exceed `chunkSize`.
 */
function bodyBudget(chunkSize: number, overlap: number): number {
  if (overlap <= 0) return chunkSize;
  return Math.max(1, chunkSize - overlap - 1);
}
