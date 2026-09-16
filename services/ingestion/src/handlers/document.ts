/**
 * Document ingestion for every non-event capture: page reads, YouTube watches, PDFs and
 * manual saves.
 *
 * ## What the client sends
 *
 * Metadata plus a content hash. The body is optional:
 *
 * - a browser or extension that already has the text sends `bodyText` and lets the server
 *   accept it as-is (a manual save, a newsletter, a PDF the client parsed);
 * - a client that only knows the URL sends `bodyText: null` and the server fetches it.
 *
 * The client never sends derived text metrics. `wordCount` and `readingTimeSeconds` are
 * computed server-side from the accepted text (the shared helpers exist for exactly this),
 * so two clients cannot disagree about the same document.
 *
 * ## What this module does NOT do
 *
 * Readable-text extraction, transcript retrieval, cleaning, chunking and summarisation are
 * all owned by `services/processing`. This module records *that a document exists*, stores
 * the best text available, and hands off. Anything that resembles parsing HTML belongs in
 * `services/processing/src/extraction`.
 *
 * ## Known capture failures to record, not to solve
 *
 * Cookie walls, paywalls, login gates and JS-rendered pages are reported by clients as
 * events with an empty or partial body and a `metadata.captureFailure` marker. They are
 * recorded so a later phase can quantify how much of the corpus is truncated; the edge
 * does not attempt to defeat them.
 */
import type { DocumentDraft, IngestionContext } from './activity';
import type { IngestDocumentInput } from '../validation/schemas';

/**
 * How the server will obtain the document body.
 *
 * `accept-client-body` — the client already holds the text and it is stored verbatim.
 * `server-fetch` — the server must retrieve and extract it; `extractedText` stays `null`
 * until `services/processing` has run.
 */
export type CaptureMode = 'accept-client-body' | 'server-fetch';

/**
 * Result of a capture. `duplicate` means a document with the same `contentHash` already
 * exists for this user and the call was a no-op — the desired behaviour when a client
 * retries a flush or the same article is captured from two devices.
 */
export type DocumentOutcome =
  | {
      status: 'accepted';
      documentId: string;
      contentHash: string;
      captureMode: CaptureMode;
      /** True while the body still has to be fetched or extracted before chunks can exist. */
      needsExtraction: boolean;
    }
  | { status: 'duplicate'; documentId: string; contentHash: string }
  | { status: 'rejected'; reason: string };

/**
 * Chooses the capture path for a parsed capture.
 *
 * Pure: the presence of a body is the only input, because a client that has text must not
 * make the server fetch a URL it will then throw away.
 */
export function captureModeFor(input: IngestDocumentInput): CaptureMode {
  return input.bodyText === null ? 'server-fetch' : 'accept-client-body';
}

/**
 * Records a document capture.
 *
 * Contract, in order:
 * 1. Derive the capture mode and normalise the URL with the shared `canonicalizeUrl`.
 * 2. Dedupe on `(userId, contentHash)`. Content hash, not URL: the same article reachable
 *    at two URLs is one document, and the same URL with different text is two. The hash
 *    must be the one the shared `contentHash` helper produces, because that is what makes
 *    a client-side and a server-side hash comparable.
 * 3. Insert a `DocumentDraft` for this user, with `extractedText` set only when the client
 *    supplied a body, and `wordCount` / `readingTimeSeconds` derived through the shared
 *    helpers rather than trusted from the client.
 * 4. Enqueue the document so `services/processing` can extract, chunk, classify and
 *    distil it. Whether the extraction stage runs on capture or on first read is decided
 *    by the shared `isExtractableSource`, not by this module.
 *
 * The capture is accepted even when the body is missing: a page read whose text is
 * unavailable is still a real activity signal, and the fetch can be retried later.
 *
 * @param input - A parsed capture produced by `ingestDocumentSchema`.
 * @param ctx - Request-scoped dependencies.
 */
export async function handleDocumentCapture(
  _input: IngestDocumentInput,
  _ctx: IngestionContext,
): Promise<DocumentOutcome> {
  // TODO(phase-1): canonicalise, dedupe on contentHash, build the DocumentDraft with a
  // server-computed wordCount / readingTimeSeconds, insert, enqueue the new id.
  throw new Error('Not implemented: handleDocumentCapture');
}

/**
 * Builds the persistable draft for a capture. Exported so the mixed-batch path
 * (`handlers/batch.ts`) shares one implementation with the single-capture path.
 *
 * `summary` and `topicIds` are deliberately absent from `DocumentDraft`: they are produced
 * by classification and distillation, long after this call returns.
 *
 * @param input - A parsed capture.
 * @param ctx - Request-scoped dependencies (used for `capturedAt` and the device id).
 */
export function buildDocumentDraft(
  _input: IngestDocumentInput,
  _ctx: IngestionContext,
): DocumentDraft {
  // TODO(phase-1): map the capture onto DocumentDraft, leaving extractedText null on the
  // server-fetch path and setting importance from the capture source's baseline weight.
  throw new Error('Not implemented: buildDocumentDraft');
}
