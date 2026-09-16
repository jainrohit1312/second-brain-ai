import { ACTIVITY_EVENT_TYPES } from '../constants/event-types';

import { ISO_8601_PATTERN } from './date';

import type { ActivityEventType } from '../types/activity';

/**
 * Validation primitives.
 *
 * These are the small guards that every boundary in the system reaches for. The
 * heavy validation — the full shape of an event or a batch — lives in
 * `services/ingestion/src/validation/schemas.ts` as zod schemas. These helpers
 * exist to avoid pulling zod into the browser bundle for a single `typeof` check.
 */

/** True for a string with at least one non-whitespace character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when the value parses as an absolute `http` or `https` URL. */
export function isValidUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * True when the value is an ISO-8601 UTC timestamp that also parses.
 *
 * The regex is a shape check and `Date.parse` is a real check; both are needed,
 * because `Date.parse` accepts a great deal that is not ISO-8601.
 */
export function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' && ISO_8601_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
  );
}

/** True when the value is a member of the `ActivityEventType` union. */
export function isActivityEventType(value: unknown): value is ActivityEventType {
  return typeof value === 'string' && (ACTIVITY_EVENT_TYPES as readonly string[]).includes(value);
}

/** Constrain a number to `[min, max]`. Non-finite input returns `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Constrain a number to `[0, 1]`.
 *
 * This is the normalization applied to every importance signal, so it is called
 * constantly; it is kept tiny and branch-only for that reason.
 */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Exhaustiveness guard for discriminated unions.
 *
 * Place in the `default` branch of a `switch` over a union. Because the
 * parameter is typed `never`, adding a union member without handling it turns
 * into a compile error rather than a runtime surprise.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Parse JSON without throwing.
 *
 * Used at every boundary that receives serialized data from a device we do not
 * control: a malformed payload must be a rejected batch, not a crashed worker.
 */
export function parseJsonSafe<T>(raw: string): ParseResult<T> {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
}

/**
 * Parse an integer within bounds, returning `null` rather than a coerced value.
 *
 * Written for query parameters, where the failure mode of `parseInt` — silently
 * accepting `"12abc"` as `12` — is exactly the wrong behaviour.
 */
export function parseBoundedInt(
  value: unknown,
  bounds: { min: number; max: number },
): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < bounds.min || parsed > bounds.max) return null;
  return parsed;
}
