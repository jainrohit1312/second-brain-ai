/**
 * Readable-content extraction: HTML in, article text out.
 *
 * The implementation is `@mozilla/readability` over `jsdom`, wrapped here so that the rest
 * of the pipeline depends on a `ReadableResult` and not on a DOM library. That indirection
 * is what makes the stage swappable (a different extractor, or a paid extraction API) and
 * what makes it testable against saved fixtures.
 *
 * ## Server-side rendering is a known, recorded failure mode
 *
 * Readability works on markup, not on a rendered page. The pages it fails on are known and
 * are **recorded, not solved**:
 *
 * - **Cookie walls and consent interstitials** — the extracted "article" is the consent
 *   dialog. There is no server-side dismissal of these.
 * - **Paywalls** — a preview or a login prompt is extracted as the body. A paywalled page
 *   yields a memory about a paywall, which is exactly what must not be distilled.
 * - **JS-rendered pages** — an empty `<div id="app">` is all the server ever sees. The
 *   client is the only component that has the rendered DOM, which is why `page_read` events
 *   carry client-extracted text in the first place.
 *
 * Each failure is recorded with its reason (`ExtractionStatus: 'failed'` plus
 * `failureReason`) so the corpus can be measured for truncation. A future phase may add a
 * headless renderer; until then, honesty about coverage is more useful than a partial
 * extraction passed off as a complete one.
 */
import type { ReadableResult } from '../types';

/**
 * Minimum characters of extracted text for the result to count as a success.
 *
 * Below this, extraction is treated as failed: the document keeps `extractedText: null` and
 * is retried or left as metadata. The threshold exists because the failure mode of a bad
 * extraction is not an error — it is a fifty-character consent dialog that looks like a
 * successful read.
 */
export const MIN_CONTENT_LENGTH = 400;

/**
 * Extracts the readable article from a page's HTML.
 *
 * Contract:
 * - Never throws for a *content* failure. A paywall, a cookie wall, or a JS-only page
 *   resolves to a `ReadableResult` whose `textContent` is short or empty, and the caller
 *   decides via `MIN_CONTENT_LENGTH`. Throwing is reserved for a genuine programming error.
 * - `publishedTime` is normalized to an ISO-8601 UTC string or `null`; pages report dates in
 *   too many shapes to pass through raw.
 * - `byline`, `siteName`, `excerpt` and `language` are `null`/absent-safe rather than
 *   empty strings, so "the page did not say" is distinguishable from "the page said nothing".
 * - The input HTML is not modified, and nothing is fetched: `url` is used only for
 *   resolution of relative links inside the document.
 *
 * @param html - Raw response body of the page.
 * @param url - Absolute URL the HTML came from. Required for relative-link resolution.
 */
export async function extractReadable(_html: string, _url: string): Promise<ReadableResult> {
  // TODO(phase-2): `new JSDOM(html, { url })`, run `new Readability(document).parse()`, then
  // map onto `ReadableResult` — normalizing `publishedTime` through `toIso` and detecting a
  // missing language. `jsdom` and `@mozilla/readability` are declared in package.json.
  throw new Error('Not implemented: extractReadable');
}
