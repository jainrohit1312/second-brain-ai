import { canonicalizeUrl, normalizeUnicode, normalizeWhitespace } from './text';

import type { ActivityEventType } from '../types/activity';

/**
 * Hashing and deduplication identity.
 *
 * Two algorithms are offered for two different jobs:
 *
 * - `contentHash` / `dedupeKey` use **FNV-1a 64-bit**, which is synchronous,
 *   dependency-free, and byte-identical in every runtime this codebase targets.
 *   That matters because both the extension and the Android app must produce
 *   the same key for the same activity *before* anything reaches the server.
 *   It is deliberately non-cryptographic: 64 bits is ample for deduplicating
 *   within one user's corpus.
 * - `sha256Hex` is asynchronous WebCrypto, for the cases that need a real
 *   digest — content integrity and anything that could be attacker-influenced.
 */

/** Identifies which algorithm produced a hash. Prefixed onto every digest. */
export const HASH_ALGORITHM = 'fnv1a64';

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * FNV-1a 64-bit hash, rendered as 16 lowercase hex characters.
 *
 * Synchronous and allocation-light, which is what lets the client-side pre-filter
 * compute a dedupe key inside a scroll handler without awaiting anything.
 */
export function fnv1a64Hex(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Stable content identity for a document body or a chunk of text.
 *
 * Whitespace and Unicode are normalized first so that cosmetic differences —
 * reflowed paragraphs, non-breaking spaces, zero-width joiners — do not produce
 * two documents for the same article. Case is preserved: it is meaningful.
 *
 * The returned value is prefixed with the algorithm so a future change to
 * SHA-256 is detectable in stored rows rather than silently mixing schemes.
 */
export function contentHash(text: string): string {
  const normalized = normalizeWhitespace(normalizeUnicode(text));
  return `${HASH_ALGORITHM}:${fnv1a64Hex(normalized)}`;
}

/**
 * Window within which two otherwise-identical events are considered the same.
 *
 * Capturing the same page view twice — once on visibility change, once on
 * navigation — is normal, and the two emissions can differ by seconds. Bucketing
 * the timestamp collapses them without needing any state.
 */
export const DEDUPE_TIME_BUCKET_MS = 60_000;

export interface DedupeKeyInput {
  type: ActivityEventType;
  /** ISO-8601 UTC. Bucketed to the minute, so sub-minute jitter is ignored. */
  occurredAt: string;
  /** Preferred identity when present; canonicalized before hashing. */
  url?: string | null;
  /** Fallback identity for events with no URL, e.g. a YouTube video id or a package name. */
  discriminator?: string | null;
}

/**
 * Build the deduplication key for an activity event.
 *
 * Uniqueness is enforced server-side on `(deviceId, dedupeKey)`, so the device
 * is *not* part of the key — the pair is what identifies an event.
 *
 * Contract: two events of the same type, from the same device, within the same
 * minute, referring to the same resource must produce the same key. Different
 * types never collide, even for the same URL, because a view and a bookmark are
 * genuinely different facts.
 */
export function dedupeKey(input: DedupeKeyInput): string {
  const parsed = Date.parse(input.occurredAt);
  const bucket = Number.isNaN(parsed) ? 0 : Math.floor(parsed / DEDUPE_TIME_BUCKET_MS);

  const identity =
    canonicalizeUrl(input.url) ?? normalizeWhitespace(input.discriminator ?? '') ?? '';

  return `${input.type}:${bucket}:${fnv1a64Hex(identity)}`;
}

interface SubtleCryptoLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

/**
 * SHA-256 as lowercase hex.
 *
 * Requires `crypto.subtle`, which is only available in a secure context. That
 * is true for extension pages, `https://` origins, worklets, and Node 20+ — but
 * it is **not** true for a plain-`http://` page, so this must not be called from
 * a content script that may run on an insecure origin.
 *
 * @throws Error when WebCrypto is unavailable.
 */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleCryptoLike } }).crypto
    ?.subtle;

  if (!subtle) {
    throw new Error(
      'sha256Hex requires WebCrypto (crypto.subtle), which is unavailable in this context',
    );
  }

  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
