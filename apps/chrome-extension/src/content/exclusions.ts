/**
 * Which pages are never captured.
 *
 * Purpose: hold the origin rules that both the page-view tracker and the selection
 * observer have to apply *before* an event object exists — the exclusion check is an
 * invariant of capture, not a filter on the way out, so an excluded page produces no
 * event, no payload, and no queue row (ADR-018's rule, applied on the client).
 *
 * Phase 1a scope: two hardcoded lists plus whatever the user has stored under
 * `sb:excluded-domains`. The shipped exclusions are the minimum that makes the extension
 * safe to run at all — loopback origins, and the small set of hosts where a page view is
 * most likely to be something the user would never want recorded. Real, list-driven
 * exclusions arrive with `user_settings`; until then this is deliberately short and
 * obvious, because an exclusion list nobody can read is an exclusion list nobody trusts.
 */
import { SETTING_KEYS, readExcludedDomains } from '@/lib/settings';

/**
 * Origins the extension never captures. Loopback hosts cover local development: their
 * pages are frequently full of tokens, fixtures, and other people's data.
 */
export const BUILT_IN_EXCLUDED_DOMAINS: readonly string[] = ['localhost', '127.0.0.1', '0.0.0.0'];

/**
 * Hosts where a visit is treated as sensitive: banking, medical records, and password
 * managers. Capture is skipped entirely rather than redacted — a row that records "the
 * user was on their bank for four minutes" is already information worth not holding.
 *
 * Matching is by registrable host suffix, so `secure.chase.com` matches `chase.com`.
 */
export const SENSITIVE_DOMAINS: readonly string[] = [
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'citibank.com',
  'capitalone.com',
  'hsbc.com',
  'barclays.co.uk',
  'paypal.com',
  'stripe.com',
  'coinbase.com',
  'binance.com',
  '1password.com',
  'lastpass.com',
  'bitwarden.com',
  'dashlane.com',
  'keeper.com',
  'mychart.com',
  'mychart.org',
  'kaiserpermanente.org',
  'patientslikeme.com',
  'webmd.com',
];

/**
 * User exclusions, refreshed from `chrome.storage.local`. Module state is acceptable here
 * and only here: a content script lives for the lifetime of one document, so this is a
 * cache of a setting, not durable state that has to outlive anything.
 */
let userExcludedDomains: readonly string[] = [];

/** Lowercased hostname of `url`, or null when it does not parse. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True when `hostname` is one of `domains` or a subdomain of one. */
function matchesDomain(hostname: string, domains: readonly string[]): boolean {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * True when this URL must not produce an event at all.
 *
 * Non-http(s) schemes are excluded too. The manifest only injects into http/https, so this
 * is the guard for the cases the manifest cannot express — a frame that inherited a
 * different scheme, or a future injection rule.
 */
export function isExcludedOrigin(url: string): boolean {
  const hostname = hostnameOf(url);
  if (hostname === null) {
    return true;
  }
  return (
    matchesDomain(hostname, BUILT_IN_EXCLUDED_DOMAINS) ||
    matchesDomain(hostname, SENSITIVE_DOMAINS) ||
    matchesDomain(hostname, userExcludedDomains)
  );
}

/** True when the host is on the sensitive list; used to explain a skip, not to decide it. */
export function isSensitiveHost(url: string): boolean {
  const hostname = hostnameOf(url);
  return hostname !== null && matchesDomain(hostname, SENSITIVE_DOMAINS);
}

/** Reloads the user's exclusion list from storage into the in-memory cache. */
export async function refreshExcludedDomains(): Promise<void> {
  try {
    userExcludedDomains = await readExcludedDomains();
  } catch (error) {
    console.warn('[second-brain] cannot read the exclusion list', error);
  }
}

/** The storage key whose changes should trigger {@link refreshExcludedDomains}. */
export const EXCLUDED_DOMAINS_SETTING = SETTING_KEYS.excludedDomains;
