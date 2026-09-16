/**
 * Text utilities.
 *
 * Pure functions with no platform dependency, safe to run in the extension's
 * content script, in the browser, on the server, and in Deno.
 */

/** Average adult reading speed, used to derive reading time from word count. */
export const WORDS_PER_MINUTE = 238;

/**
 * Rough characters-per-token ratio for English prose.
 *
 * Token counts here are estimates used for budgeting and chunk sizing, never
 * for billing. Anything that needs exact counts must call the provider's
 * tokenizer instead.
 */
export const CHARS_PER_TOKEN = 4;

/** Query parameters that identify a referrer or a campaign and never distinguish content. */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'mkt_tok',
  'yclid',
  '_hsenc',
  '_hsmi',
  'vero_id',
  'oly_anon_id',
  'oly_enc_id',
  'spm',
  'scm',
]);

/** True for `utm_*` and similar prefixed tracking parameters. */
function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    TRACKING_PARAMS.has(lower) ||
    lower.startsWith('utm_') ||
    lower.startsWith('pk_') ||
    lower.startsWith('mtm_')
  );
}

/** Collapse all whitespace runs to a single space and trim the result. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize to NFC and remove zero-width characters that break equality
 * comparisons and produce confusing substring matches.
 */
export function normalizeUnicode(text: string): string {
  return text.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/** Truncate to `maxLength` characters, appending an ellipsis when truncated. */
export function truncate(text: string, maxLength: number, ellipsis = '…'): string {
  if (maxLength <= 0) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - ellipsis.length))}${ellipsis}`;
}

/** Count whitespace-delimited words. Cheap, and good enough for sizing decisions. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** Estimate token count from character count. Never use for cost accounting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Derive an estimated reading time in seconds from a word count. */
export function readingTimeSeconds(words: number): number {
  return Math.round((words / WORDS_PER_MINUTE) * 60);
}

/**
 * Registrable-ish domain for display and grouping.
 *
 * Strips a leading `www.` and lowercases. It does not consult a public suffix
 * list, so `example.co.uk` is returned whole but a two-level suffix is not
 * resolved — acceptable because this value is only used for grouping and the
 * domain-novelty signal.
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * Normalize a URL for deduplication.
 *
 * Rules, in order: assume `https://` when no scheme is present; lowercase the
 * scheme and host; drop a default port; drop the fragment; remove tracking
 * parameters; sort the surviving parameters for stability; drop a trailing
 * slash from a non-root path.
 *
 * Returns `null` for anything that does not parse, so callers can distinguish
 * "no canonical form" from "the empty string".
 */
export function canonicalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  const candidate = url.trim();
  if (candidate.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }
  parsed.hash = '';

  const kept: Array<[string, string]> = [];
  for (const [name, value] of parsed.searchParams.entries()) {
    if (!isTrackingParam(name)) kept.push([name, value]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  parsed.search = '';
  for (const [name, value] of kept) parsed.searchParams.append(name, value);

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString();
}

/**
 * Remove HTML tags and decode the handful of entities that actually show up.
 *
 * This is a text-cleanup helper, not a sanitizer — never use it to make HTML
 * safe for rendering.
 */
export function stripHtmlTags(html: string): string {
  const withoutBlocks = html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n\n');

  return normalizeUnicode(
    withoutBlocks
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'"),
  );
}

/** Convert arbitrary text into a URL-safe slug suitable for a topic identifier. */
export function slugify(text: string): string {
  return normalizeUnicode(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
