/**
 * YouTube transcript retrieval.
 *
 * A watched video is the one document type whose text arrives as timed caption spans rather
 * than prose, so this stage owns both retrieval and the conversion of those spans into
 * something chunkable.
 *
 * ## Phase-2 decision still open: which transcript source
 *
 * Three options, none of them free:
 *
 * - **`youtube-transcript` (scrapes the public `timedtext` endpoint)** — no credential, no
 *   cost, brittle: it breaks whenever YouTube changes the player response shape, and it can
 *   be refused from datacentre IPs.
 * - **A third-party API (Supadata and similar)** — stable shape, costs money per video, and
 *   sends a list of what the user watched to another party. That last point is a privacy
 *   decision, not an engineering one, and it needs an entry in the ADR log before it ships.
 * - **Self-hosted fetch of the caption track** — the same fragility as the first option with
 *   more code.
 *
 * The decision belongs in `docs/DECISIONS.md`; this module is written so that it is a
 * one-implementation swap behind `fetchTranscript`.
 */
import { normalizeWhitespace } from '@second-brain/shared';

import type { TranscriptChunkOptions, TranscriptFetchOptions, TranscriptSegment } from '../types';

/** Seconds of captions per chunk when grouping transcripts. Matches the audio reading pace of `CHUNK_SIZE`. */
export const TRANSCRIPT_CHUNK_SECONDS = 120;

/**
 * Fetches the caption track for a video.
 *
 * Contract:
 * - Returns `[]` when the video has no captions, rather than throwing: `transcriptAvailable:
 *   false` on the originating event already recorded the fact, and a video without a
 *   transcript still produces an activity row.
 * - Segments are returned in ascending `startSeconds` order, with rolling-caption repeats
 *   collapsed, because a raw YouTube track repeats the previous line in every span and would
 *   otherwise be chunked three times over.
 * - Throws only on an outright transport or provider failure, which the caller records as
 *   `ExtractionStatus: 'failed'` and retries.
 *
 * @param videoId - YouTube video id, as captured on the `youtube_watch` event.
 * @param opts - Language preference order. See `TranscriptFetchOptions`.
 */
export async function fetchTranscript(
  _videoId: string,
  _opts: TranscriptFetchOptions = {},
): Promise<TranscriptSegment[]> {
  // TODO(phase-2): implement against the transcript source chosen in docs/DECISIONS.md,
  // collapsing rolling captions and sorting by `startSeconds`.
  throw new Error('Not implemented: fetchTranscript');
}

/**
 * Groups timed segments into chunks of a bounded duration and length.
 *
 * Grouping is by time, not by token count, because a transcript's natural unit is a spoken
 * passage and a mid-sentence split costs more in retrieval quality than an uneven chunk size
 * does. A single segment longer than `maxChars` is emitted alone rather than truncated: a
 * truncated sentence cannot be cited.
 *
 * @param segments - Segments in ascending time order.
 * @param opts - Duration and character bounds. See `TranscriptChunkOptions`.
 */
export function groupTranscriptIntoChunks(
  _segments: readonly TranscriptSegment[],
  _opts: TranscriptChunkOptions = {},
): TranscriptSegment[] {
  // TODO(phase-2): accumulate segments until either bound is reached, then start a new group
  // and carry `startSeconds` from the group's first segment.
  throw new Error('Not implemented: groupTranscriptIntoChunks');
}

/**
 * Flattens a transcript into plain text.
 *
 * Pure. Segments are joined with a single space and the result is whitespace-normalized
 * through the shared helper, so a transcript that was chunked and reassembled is
 * byte-identical to the same transcript flattened in one pass. Overlapping spans are *not*
 * de-duplicated here — that is `fetchTranscript`'s job, because deduplicating twice would
 * hide a broken track.
 *
 * @param segments - Segments in ascending time order.
 */
export function transcriptToPlainText(segments: readonly TranscriptSegment[]): string {
  return normalizeWhitespace(segments.map((segment) => segment.text).join(' '));
}

/**
 * Reports whether a video has a usable caption track.
 *
 * A cheap probe used to decide whether the video enters the extraction queue at all. It must
 * be conservative in one direction: a false negative means a video that yields no text is
 * never retried, which is acceptable, while a false positive means the pipeline pays for a
 * fetch that returns nothing.
 *
 * @param videoId - YouTube video id.
 */
export async function isTranscriptAvailable(_videoId: string): Promise<boolean> {
  // TODO(phase-2): probe the caption track list without downloading it. The originating
  // `youtube_watch.transcriptAvailable` flag is a hint, not a substitute: the client cannot
  // always tell whether captions are auto-generated.
  throw new Error('Not implemented: isTranscriptAvailable');
}
