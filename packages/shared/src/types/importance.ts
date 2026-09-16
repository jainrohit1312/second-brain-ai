/**
 * Importance scoring.
 *
 * Importance answers one question: *is this worth remembering?* It is computed
 * twice — cheaply on the client to keep noise out of the sync queue, and
 * authoritatively on the server, because the client lacks history and cannot
 * be trusted. The engine is a weighted sum over a fixed signal set, with every
 * contribution recorded so a score can always be explained.
 */

/**
 * Coarse bucket derived from the numeric score.
 *
 * - `noise`    — discarded before persistence; nothing below this is kept.
 * - `low`      — stored, but never surfaced unless explicitly asked for.
 * - `normal`   — stored, eligible for retrieval and distillation.
 * - `high`     — prioritized everywhere; a candidate for immediate distillation.
 * - `critical` — reserved for explicit user intent (bookmark, long deliberate read).
 */
export type ImportanceBand = 'noise' | 'low' | 'normal' | 'high' | 'critical';

/**
 * The complete input vector for scoring. Every field has a defined range and is
 * available at scoring time; fields that need history say so explicitly.
 */
export interface ImportanceSignals {
  /** Active dwell time on the page, in seconds. Scroll-and-leave scores near zero. */
  dwellSeconds: number;
  /** 0–100. Maximum depth reached. */
  scrollDepthPct: number;
  /** True when this is the user's first visit to the domain. Needs history. */
  isUniqueDomain: boolean;
  /** Prior views of the same canonical URL. Needs history. */
  revisitCount: number;
  /** Length of the extracted readable content. Long-form is usually deliberate. */
  wordCount: number;
  /** A passaged was highlighted. A weak intent signal. */
  hasSelection: boolean;
  /** A passage was copied. A stronger intent signal than selection. */
  hasCopy: boolean;
  /** The page was bookmarked. Explicit intent. */
  isBookmarked: boolean;
  /** The file was downloaded. Explicit intent. */
  isDownloaded: boolean;
  /** 0–1. Fraction of a video watched. Meaningless for non-video content. */
  youtubeWatchedPct: number;
  /** True when the app is on the exclusion list. Forces the score to zero. */
  appIsExcluded: boolean;
  /** True when capture happened during the user's configured working hours. */
  isWorkingHours: boolean;
  /** 0–1. How dissimilar this is from everything already known. Needs history. */
  topicNovelty: number;
}

/** One signal's contribution to the final score, kept for explainability. */
export interface ImportanceContribution {
  signal: keyof ImportanceSignals;
  /** The rule weight, after overrides were applied. */
  weight: number;
  /** The normalized signal value in `[0, 1]`. */
  value: number;
}

/**
 * A scoring result.
 *
 * `version` stamps the engine version that produced the score. Because scores
 * are persisted, a version bump is what makes "re-score everything" an
 * auditable operation rather than a silent rewrite.
 */
export interface ImportanceScore {
  /** Final weighted sum clamped to `[0, 1]`. */
  value: number;
  band: ImportanceBand;
  /** Every signal that contributed, in rule order. Sums to `value`. */
  contributions: ImportanceContribution[];
  /** ISO-8601 UTC. */
  scoredAt: string;
  /** Engine version, e.g. `importance-v1`. */
  version: string;
}

/** A configurable weighting rule. The tunable surface exposed in Settings. */
export interface ImportanceRule {
  id: string;
  description: string;
  /** Which signals this rule reads. A rule may combine more than one. */
  signals: Array<keyof ImportanceSignals>;
  /** Contribution to the weighted sum. Weights across enabled rules should sum to ~1. */
  weight: number;
  enabled: boolean;
}
