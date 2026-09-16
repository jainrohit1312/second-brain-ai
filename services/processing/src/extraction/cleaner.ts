/**
 * Content cleaning.
 *
 * Extraction produces something that is *mostly* article text: it still contains navigation
 * remnants, cookie-banner copy, repeated photo captions, advertisement slugs, and the
 * whitespace artefacts of markup removal. Cleaning runs once, between extraction and
 * chunking, and everything downstream — chunk boundaries, embeddings, memories — inherits
 * whatever it lets through. That is why a bad chunk is almost always a cleaning bug.
 *
 * ## Two kinds of cleaner, and which one this is
 *
 * `stripHtmlTags` in `@second-brain/shared` converts markup to text and is the definition of
 * HTML handling across the codebase. This module operates *after* that, on plain text, and
 * is allowed to be opinionated about boilerplate in a way the shared helper is not.
 *
 * ## Why `CleanedText` carries `removedRatio`
 *
 * Cleaning quality is invisible in its output: a cleaner that strips a paragraph of real
 * content looks exactly like one that strips a footer. The ratio is the only cheap,
 * per-document signal that a regression happened, and it is recorded so that a corpus-wide
 * drift shows up in a metric before it shows up in a bad answer.
 */
import type { CleanOptions, CleanedText } from '../types';

/** Occurrences of an identical line above which it is treated as repeating boilerplate. */
export const MIN_REPEATED_LINE_OCCURRENCES = 3;

/** Blank lines kept between paragraphs. Anything beyond this is whitespace artefact. */
export const MAX_CONSECUTIVE_BLANK_LINES = 2;

/**
 * Removes repeated blocks that are structurally boilerplate.
 *
 * Targets the shapes that extraction reliably leaves behind: a "Related articles" block, a
 * newsletter signup repeated in three places, a comment prompt. The contract is deliberately
 * conservative — when in doubt, keep the text. Losing a real paragraph is worse than
 * embedding a decoration, because a decoration is retrieval noise while a missing paragraph
 * is a missing answer.
 *
 * @param text - Plain text from the extraction stage.
 */
export function stripBoilerplate(_text: string): string {
  // TODO(phase-2): remove link-dense trailing blocks, signup prompts and comment widgets by
  // shape (line length, link ratio, repetition), never by hard-coded site selectors.
  throw new Error('Not implemented: stripBoilerplate');
}

/**
 * Collapses whitespace runs while preserving paragraph structure.
 *
 * Distinct from the shared `normalizeWhitespace`, which flattens the text to a single line:
 * paragraph boundaries are load-bearing for `RecursiveChunker`, because `\n\n` is its
 * coarsest separator. Runs of blank lines beyond `MAX_CONSECUTIVE_BLANK_LINES` are collapsed
 * to exactly that many.
 *
 * @param text - Text with whitespace artefacts.
 */
export function collapseWhitespace(_text: string): string {
  // TODO(phase-2): collapse horizontal whitespace per line, then bound consecutive blank
  // lines. Never join two paragraphs.
  throw new Error('Not implemented: collapseWhitespace');
}

/**
 * Removes navigation, header and footer blocks.
 *
 * Runs on extracted text rather than on markup, so it works from link density and position
 * instead of selectors — which is what keeps it working when a site changes its template.
 *
 * @param text - Plain text from the extraction stage.
 */
export function removeNavAndFooter(_text: string): string {
  // TODO(phase-2): drop a leading block that is mostly short link-like lines, and a trailing
  // block of the same shape. Position matters: the same lines in the middle are content.
  throw new Error('Not implemented: removeNavAndFooter');
}

/**
 * Normalizes Unicode, and additionally removes what cleaning must not keep.
 *
 * Delegates to `normalizeUnicode` in `@second-brain/shared` — NFC plus zero-width removal —
 * and then strips the further artefacts that only matter to a stored body: control
 * characters, lone surrogates, and the replacement characters an encoding mismatch leaves
 * behind. It is not a second definition of Unicode normalization: that stays in shared, so
 * the client and the server agree on text identity and therefore on `contentHash`.
 *
 * @param text - Text from any stage.
 */
export function normalizeUnicode(_text: string): string {
  // TODO(phase-2): compose the shared `normalizeUnicode`, then strip C0/C1 control
  // characters (keeping `\n` and `\t`), lone surrogates and `U+FFFD`. Must be idempotent.
  throw new Error('Not implemented: normalizeUnicode');
}

/**
 * Removes lines that repeat verbatim.
 *
 * Photo captions, repeated bylines, "skip to content" twins and pagination stubs all arrive
 * as identical lines. The threshold is `MIN_REPEATED_LINE_OCCURRENCES`, and only the
 * *repeats* are dropped — the first occurrence is kept, because the first occurrence is
 * usually in the right place.
 *
 * @param text - Text after whitespace collapsing.
 * @param maxOccurrences - Occurrences allowed before a line is treated as boilerplate.
 */
export function dedupeRepeatedLines(
  _text: string,
  _maxOccurrences: number = MIN_REPEATED_LINE_OCCURRENCES,
): string {
  // TODO(phase-2): group identical normalized lines, keep the first occurrence of each,
  // drop the rest once the occurrence count exceeds the threshold. Short lines are excluded
  // from the count so that a repeated `--` separator is not treated as boilerplate.
  throw new Error('Not implemented: dedupeRepeatedLines');
}

/**
 * Runs the full cleaning pipeline.
 *
 * Order is part of the contract and is not configurable: normalize → remove nav/footer →
 * strip boilerplate → dedupe repeated lines → collapse whitespace. Normalizing first keeps
 * later comparisons honest (two lines that differ only by a zero-width character must
 * compare equal), and collapsing whitespace last is what makes the output stable enough for
 * `contentHash` to be a document's identity.
 *
 * Pure with respect to `raw`. Returns the cleaned text plus the measurement described on
 * `CleanedText`, so a regression is visible in a metric rather than only in a bad answer.
 *
 * @param raw - Extracted text, at any level of cleanliness.
 * @param opts - Stage toggles and thresholds. Every default is the conservative choice.
 */
export function cleanText(_raw: string, _opts: CleanOptions = {}): CleanedText {
  // TODO(phase-2): run the fixed-order pipeline and compute `removedRatio` as
  // `1 - cleanedLength / originalLength`, guarding the empty-input case.
  throw new Error('Not implemented: cleanText');
}
