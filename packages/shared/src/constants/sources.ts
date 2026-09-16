import type { DocumentSource } from '../types/document';

/** Every document source, in a stable order for UI grouping and test fixtures. */
export const SOURCES: readonly DocumentSource[] = [
  'web',
  'youtube',
  'pdf',
  'gdoc',
  'newsletter',
  'manual',
];

/** Display names for the dashboard's source breakdown. */
export const SOURCE_LABELS: Record<DocumentSource, string> = {
  web: 'Web article',
  youtube: 'YouTube',
  pdf: 'PDF',
  gdoc: 'Google Doc',
  newsletter: 'Newsletter',
  manual: 'Saved manually',
};

/**
 * Sources whose body text must be fetched or extracted rather than being
 * supplied by the client. Drives whether a document enters the extraction queue
 * on capture or on first read.
 */
export const EXTRACTABLE_SOURCES: readonly DocumentSource[] = ['web', 'newsletter', 'gdoc'];

/** Sources that are inherently video and therefore have a transcript instead of prose. */
export const VIDEO_SOURCES: readonly DocumentSource[] = ['youtube'];

/** Sources the browser extension can produce. Used to validate client reports. */
export const EXTENSION_SOURCES: readonly DocumentSource[] = ['web', 'youtube', 'pdf'];

/** Sources the Android app can produce. */
export const ANDROID_SOURCES: readonly DocumentSource[] = ['web', 'manual'];

/** Sources that require an authenticated fetch against a third-party API. */
export const AUTHENTICATED_SOURCES: readonly DocumentSource[] = ['gdoc'];

/** True when the source's body text has to be extracted server-side. */
export function isExtractableSource(source: DocumentSource): boolean {
  return EXTRACTABLE_SOURCES.includes(source);
}
