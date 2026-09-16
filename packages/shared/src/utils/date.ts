/**
 * Date and time utilities.
 *
 * Everything crossing a boundary is an ISO-8601 UTC string. `Date` objects stay
 * inside function bodies. This is not stylistic: the same value travels through
 * Postgres (`timestamptz`), JSON, IndexedDB, and Room, and a string is the only
 * representation that survives all four without a timezone conversation.
 */

/** Strict-ish ISO-8601 pattern. Accepts `Z` or a numeric offset, with optional milliseconds. */
export const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** Default working-hours window used by the `isWorkingHours` importance signal. */
export const DEFAULT_WORKING_HOURS = { startHour: 9, endHour: 18 } as const;

/** Current time as an ISO-8601 UTC string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Format a `Date` as an ISO-8601 UTC string. */
export function toIso(date: Date): string {
  return date.toISOString();
}

/**
 * `YYYY-MM-DD` key in UTC.
 *
 * Used for grouping and for cache keys, never for user-facing day boundaries —
 * those depend on the user's timezone and must go through the client.
 */
export function dayKeyUtc(iso: string): string {
  return iso.slice(0, 10);
}

/** Local midnight for the given date, or today. The boundary the user actually perceives. */
export function startOfLocalDay(date: Date = new Date()): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/** Whole seconds from `aIso` to `bIso`. Negative when `b` precedes `a`. */
export function secondsBetween(aIso: string, bIso: string): number {
  return Math.round((Date.parse(bIso) - Date.parse(aIso)) / 1000);
}

/** Add days to a date, returning a new `Date`. */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Add milliseconds to an ISO-8601 UTC string, returning a new ISO string. */
export function addMilliseconds(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

/**
 * Half-open window test: `from` inclusive, `to` inclusive, either bound optional.
 * An unparseable input never matches, which fails closed rather than admitting junk.
 */
export function isWithinWindow(
  iso: string,
  window: { from?: string | null; to?: string | null },
): boolean {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return false;

  if (window.from) {
    const from = Date.parse(window.from);
    if (Number.isNaN(from) || value < from) return false;
  }

  if (window.to) {
    const to = Date.parse(window.to);
    if (Number.isNaN(to) || value > to) return false;
  }

  return true;
}

/**
 * True when the timestamp falls inside weekday working hours in the *local*
 * timezone. Feeds the `isWorkingHours` importance signal: work reading and
 * evening reading are not equally likely to be deliberate.
 */
export function isWorkingHours(
  date: Date,
  options: { startHour?: number; endHour?: number; days?: readonly number[] } = {},
): boolean {
  const startHour = options.startHour ?? DEFAULT_WORKING_HOURS.startHour;
  const endHour = options.endHour ?? DEFAULT_WORKING_HOURS.endHour;
  const days = options.days ?? [1, 2, 3, 4, 5];

  const day = date.getDay();
  if (!days.includes(day)) return false;

  const hour = date.getHours();
  return hour >= startHour && hour < endHour;
}

/**
 * Elapsed whole milliseconds between two ISO-8601 UTC strings, clamped at zero.
 * Used for dwell time, where a negative result can only mean clock skew.
 */
export function elapsedMsSince(iso: string, now: string = nowIso()): number {
  const delta = Date.parse(now) - Date.parse(iso);
  return Number.isNaN(delta) || delta < 0 ? 0 : delta;
}
