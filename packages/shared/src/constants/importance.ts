import type { ImportanceBand } from '../types/importance';

/**
 * Importance banding.
 *
 * Thresholds are *lower bounds*: a score belongs to the highest band whose
 * threshold it meets or exceeds. `IMPORTANCE_MIN_THRESHOLD` in `.env.example`
 * mirrors `low`, because anything below it is dropped before persistence.
 */
export const IMPORTANCE_BAND_THRESHOLDS: Record<ImportanceBand, number> = {
  noise: 0,
  low: 0.25,
  normal: 0.45,
  high: 0.7,
  critical: 0.9,
};

/** Bands in ascending order. Used to walk thresholds without hardcoding them. */
export const IMPORTANCE_BANDS: readonly ImportanceBand[] = [
  'noise',
  'low',
  'normal',
  'high',
  'critical',
];

/** Display labels for the dashboard's importance chips. */
export const IMPORTANCE_BAND_LABELS: Record<ImportanceBand, string> = {
  noise: 'Noise',
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};

/** The default engine version stamped onto every `ImportanceScore`. */
export const IMPORTANCE_ENGINE_VERSION = 'importance-v1';

/**
 * Bands at or above which a document becomes eligible for distillation.
 * Below this, content is captured and searchable but never turned into memories,
 * which keeps the memory store from filling with trivia.
 */
export const DISTILLATION_MIN_BAND: ImportanceBand = 'normal';

/** Sort rank for a band, higher being more important. `noise` is 0. */
export function importanceBandRank(band: ImportanceBand): number {
  return IMPORTANCE_BANDS.indexOf(band);
}
