import type { ActivityEventType } from '../types/activity';

/**
 * Version of the ingestion wire format.
 *
 * Bump this whenever the shape of `ActivityBatch` or any event changes
 * incompatibly. The server rejects unknown versions outright rather than
 * attempting a best-effort parse, because a mis-parsed batch is worse than a
 * rejected one.
 */
export const SCHEMA_VERSION = 1;

/** Every captureable event type, in a stable order for UI and test fixtures. */
export const ACTIVITY_EVENT_TYPES: readonly ActivityEventType[] = [
  'page_view',
  'page_read',
  'selection',
  'copy',
  'youtube_watch',
  'app_session',
  'search',
  'bookmark',
  'download',
];

/** Human-readable labels for the dashboard and the settings rules table. */
export const EVENT_TYPE_LABELS: Record<ActivityEventType, string> = {
  page_view: 'Page view',
  page_read: 'Article read',
  selection: 'Text selected',
  copy: 'Text copied',
  youtube_watch: 'Video watched',
  app_session: 'App session',
  search: 'Search',
  bookmark: 'Bookmark',
  download: 'Download',
};

/**
 * Events produced by simply browsing, with no explicit user action beyond
 * reading. These are the ones that need scoring: most of them are noise, and
 * they arrive in the highest volume.
 */
export const PASSIVE_EVENT_TYPES: readonly ActivityEventType[] = [
  'page_view',
  'page_read',
  'youtube_watch',
  'app_session',
];

/**
 * Events the user deliberately produced. These carry intent by construction and
 * should never be dropped for scoring below the noise threshold.
 */
export const EXPLICIT_INTENT_EVENT_TYPES: readonly ActivityEventType[] = [
  'selection',
  'copy',
  'search',
  'bookmark',
  'download',
];

/** Event types whose payload contains user-authored text and may need redaction. */
export const TEXT_BEARING_EVENT_TYPES: readonly ActivityEventType[] = [
  'selection',
  'copy',
  'search',
];

/** True when the event was produced without an explicit user action. */
export function isPassiveEventType(type: ActivityEventType): boolean {
  return PASSIVE_EVENT_TYPES.includes(type);
}
