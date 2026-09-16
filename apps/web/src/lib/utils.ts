import { clsx, type ClassValue } from 'clsx';
import { format, isSameDay, isYesterday, parseISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class names and resolves Tailwind conflicts (last writer wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Formats a duration given in **seconds** as `1h 05m` / `12m 30s` / `45s`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  return `${rest}s`;
}

/**
 * Formats an ISO-8601 timestamp as a day label relative to `now`: `Today`, `Yesterday`, or an
 * absolute date. Returns an em dash for unparseable input.
 */
export function formatRelativeDay(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === 'string' ? parseISO(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  if (isSameDay(date, now)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'd MMM yyyy');
}

/**
 * Formats a 0..1 ratio as a percentage string. `formatPercent(0.417, 1)` → `'41.7%'`.
 * Values outside 0..1 are clamped; non-finite input returns an em dash.
 */
export function formatPercent(ratio: number, fractionDigits = 0): string {
  if (!Number.isFinite(ratio)) return '—';
  const clamped = Math.min(1, Math.max(0, ratio));
  return `${(clamped * 100).toFixed(fractionDigits)}%`;
}
