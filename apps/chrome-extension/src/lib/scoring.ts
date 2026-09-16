import { IMPORTANCE_BANDS, IMPORTANCE_BAND_THRESHOLDS, clamp01 } from '@second-brain/shared';

import type { ImportanceBand, ImportanceContribution, ImportanceScore, ImportanceSignals } from '@second-brain/shared';

/**
 * Local importance scoring.
 *
 * This is a coarse pre-filter, not the authority: the server-side engine in
 * `services/processing` recomputes every score and owns the bands that are persisted.
 * Client-side scoring exists for two reasons:
 *
 * 1. The queue must not fill with noise while offline, so events below the threshold are
 *    dropped in the content script and never written to IndexedDB.
 * 2. Importance stays available when there is no network, so the popup can explain why a
 *    page was or was not captured.
 */

/** Stamped into `ImportanceScore.version` so local scores stay distinguishable from server ones. */
export const CLIENT_SCORER_VERSION = 'client-0.1.0';

/** Signal to weight map. Signals left out of the map contribute zero. */
export type ClientWeights = Partial<Record<keyof ImportanceSignals, number>>;

/**
 * Default client weights: a deliberately blunt mirror of the server weights. Positives
 * sum to 1.37 so a strongly signalled event can still reach the `high` band on the client;
 * `appIsExcluded` is negative so an excluded app can never clear the threshold.
 *
 * `dwellSeconds`, `scrollDepthPct` and `topicNovelty` can all clear the capture threshold
 * unaided — dwell at saturation, the other two only at their maximum — so the weights below
 * are tuned against that property, not independently of it. See
 * {@link DWELL_SATURATION_SECONDS}.
 */
export const DEFAULT_CLIENT_WEIGHTS: ClientWeights = {
  dwellSeconds: 0.3,
  scrollDepthPct: 0.15,
  isUniqueDomain: 0.05,
  revisitCount: 0.12,
  wordCount: 0.1,
  hasSelection: 0.1,
  hasCopy: 0.12,
  isBookmarked: 0.08,
  isDownloaded: 0.05,
  youtubeWatchedPct: 0.12,
  appIsExcluded: -1,
  isWorkingHours: 0.03,
  topicNovelty: 0.15,
};

/** Events scoring below this are dropped before they reach the queue. */
export const DEFAULT_CAPTURE_THRESHOLD = 0.15;

/**
 * Dwell time at which the dwell signal saturates: ten seconds of foreground attention is
 * what separates "looked at this page" from "opened it and left".
 *
 * The calibration matters more than it looks. The positive weights sum to 1.37 and the
 * capture threshold is 0.15, so saturated dwell — 0.30, the largest weight — clears the
 * line from 5 s of attention, and `scrollDepthPct` and `topicNovelty` clear it unaided too,
 * at 0.15 apiece and only at their maximum. Saturating dwell at ten minutes instead would
 * push that out to several minutes of reading and the pre-filter would drop every ordinary
 * visit; the finer distinction between a two-minute and a twenty-minute read belongs to the
 * server's scorer.
 */
const DWELL_SATURATION_SECONDS = 10;

/** Revisits at which the revisit signal saturates. */
const REVISIT_SATURATION_COUNT = 5;

/** Word count at which the length signal saturates — a long-form article. */
const WORD_COUNT_SATURATION = 2_000;

/** Maps each signal onto its 0..1 normalized value. Exhaustive by type. */
const SIGNAL_NORMALIZERS: Record<keyof ImportanceSignals, (signals: ImportanceSignals) => number> = {
  dwellSeconds: (signals) => clamp01(signals.dwellSeconds / DWELL_SATURATION_SECONDS),
  scrollDepthPct: (signals) => clamp01(signals.scrollDepthPct / 100),
  isUniqueDomain: (signals) => (signals.isUniqueDomain ? 1 : 0),
  revisitCount: (signals) => clamp01(signals.revisitCount / REVISIT_SATURATION_COUNT),
  wordCount: (signals) => clamp01(signals.wordCount / WORD_COUNT_SATURATION),
  hasSelection: (signals) => (signals.hasSelection ? 1 : 0),
  hasCopy: (signals) => (signals.hasCopy ? 1 : 0),
  isBookmarked: (signals) => (signals.isBookmarked ? 1 : 0),
  isDownloaded: (signals) => (signals.isDownloaded ? 1 : 0),
  youtubeWatchedPct: (signals) => clamp01(signals.youtubeWatchedPct),
  appIsExcluded: (signals) => (signals.appIsExcluded ? 1 : 0),
  isWorkingHours: (signals) => (signals.isWorkingHours ? 1 : 0),
  topicNovelty: (signals) => clamp01(signals.topicNovelty),
};

/** Signal names in rule order, so `contributions` comes out in the same order every time. */
const SIGNAL_ORDER = Object.keys(SIGNAL_NORMALIZERS) as Array<keyof ImportanceSignals>;

/** Highest band whose lower bound the value meets. Thresholds are lower bounds, inclusive. */
function bandFor(value: number): ImportanceBand {
  let band: ImportanceBand = 'noise';
  for (const candidate of IMPORTANCE_BANDS) {
    if (value >= IMPORTANCE_BAND_THRESHOLDS[candidate]) {
      band = candidate;
    }
  }
  return band;
}

/**
 * Scores an event from its signals, mirroring the server's weighting so client and server
 * bands agree closely enough for the pre-filter to be safe. Pure and synchronous: callers
 * run it on the content-script hot path.
 *
 * `contributions` records the signals that moved the score, in rule order. Its sum is the
 * *unclamped* weighted total, and `value` is that total clamped to `[0, 1]` — so a score
 * pinned at 1 by a strong signal set is still explainable.
 *
 * An excluded app wins outright: when `signals.appIsExcluded` is true the result is zero
 * regardless of how strong every other signal looks. The negative weight in
 * {@link DEFAULT_CLIENT_WEIGHTS} would usually achieve the same thing, but "usually" is
 * not good enough for an exclusion — the rule is applied directly as well.
 */
export function scoreLocally(
  signals: ImportanceSignals,
  weights: ClientWeights = DEFAULT_CLIENT_WEIGHTS,
): ImportanceScore {
  const scoredAt = new Date().toISOString();

  if (signals.appIsExcluded) {
    return {
      value: 0,
      band: 'noise',
      contributions: [
        { signal: 'appIsExcluded', weight: weights.appIsExcluded ?? 0, value: 1 },
      ],
      scoredAt,
      version: CLIENT_SCORER_VERSION,
    };
  }

  const contributions: ImportanceContribution[] = [];
  let total = 0;

  for (const signal of SIGNAL_ORDER) {
    const value = SIGNAL_NORMALIZERS[signal](signals);
    const weight = weights[signal] ?? 0;
    // A signal that contributes nothing cannot explain a score, and recording it would
    // only add noise to the contribution list.
    if (value === 0 || weight === 0) {
      continue;
    }
    contributions.push({ signal, weight, value });
    total += weight * value;
  }

  const clamped = clamp01(total);

  return {
    value: clamped,
    band: bandFor(clamped),
    contributions,
    scoredAt,
    version: CLIENT_SCORER_VERSION,
  };
}

/**
 * Whether a score clears the capture threshold. Callers should pass
 * {@link DEFAULT_CAPTURE_THRESHOLD} unless a user-tuned value is stored in settings.
 *
 * `critical` always captures: explicit user intent must not be dropped by a threshold the
 * user tightened, which is the one case the numeric comparison alone would get wrong.
 */
export function shouldCapture(
  score: ImportanceScore,
  threshold: number = DEFAULT_CAPTURE_THRESHOLD,
): boolean {
  if (score.band === 'critical') {
    return true;
  }
  return score.value >= threshold;
}
