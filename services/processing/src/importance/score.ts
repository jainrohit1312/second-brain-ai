/**
 * Importance scoring arithmetic.
 *
 * This module is deliberately the only place where a score is calculated, and it is
 * **pure**: no I/O, no clock reads, no randomness, no logging. Everything it needs is a
 * parameter, including the timestamps it stamps onto the result. That is what makes a score
 * reproducible from a stored event plus the rule set that was active, which is the
 * precondition for re-scoring a corpus after a weight change.
 */
import {
  IMPORTANCE_BANDS,
  IMPORTANCE_BAND_THRESHOLDS,
  clamp01,
  type ImportanceBand,
  type ImportanceContribution,
  type ImportanceScore,
  type ImportanceSignals,
} from '@second-brain/shared';

import type { ScoringRule } from './rules';

/**
 * Dwell time, in seconds, at which the `dwellSeconds` signal saturates.
 *
 * Three minutes of *active* attention is a deliberate read for anything short of long-form
 * content; beyond this, more time adds nothing and would let a forgotten open tab outrank a
 * studied paper.
 */
export const DWELL_SATURATION_SECONDS = 180;

/** Word count at which the `wordCount` signal saturates. Roughly a long-form article. */
export const LONG_FORM_WORD_COUNT = 1500;

/** Prior views at which the `revisitCount` signal saturates. */
export const REVISIT_SATURATION_COUNT = 3;

/** Timestamps a score is stamped with, passed in so `computeScore` stays pure. */
export interface ScoreStamp {
  /** ISO-8601 UTC. */
  scoredAt: string;
  /** Engine version stamped onto the score. See `ENGINE_VERSION`. */
  version: string;
}

/**
 * Maps one raw signal value onto `[0, 1]`.
 *
 * Pure. Booleans become `0` or `1`. Saturating signals (dwell, scroll depth, word count,
 * revisits) divide by a documented saturation constant, so the mapping is linear and
 * explainable rather than logistic — a score has to be defensible to the user, and "0.62
 * because 111 of 180 seconds" is. Signals already on `[0, 1]` (`youtubeWatchedPct`,
 * `topicNovelty`) are only clamped.
 *
 * A missing or non-finite value normalizes to `0`, never to `NaN`: one bad signal must
 * degrade a score, not destroy it.
 *
 * @param key - Which signal is being normalized; determines the saturation constant.
 * @param value - Raw signal value, in the units documented on `SignalExtractor`.
 */
export function normalizeSignal(
  key: keyof ImportanceSignals,
  value: ImportanceSignals[keyof ImportanceSignals] | undefined,
): number {
  if (value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;

  switch (key) {
    case 'dwellSeconds':
      return clamp01(numeric / DWELL_SATURATION_SECONDS);
    case 'scrollDepthPct':
      return clamp01(numeric / 100);
    case 'wordCount':
      return clamp01(numeric / LONG_FORM_WORD_COUNT);
    case 'revisitCount':
      return clamp01(numeric / REVISIT_SATURATION_COUNT);
    default:
      // `youtubeWatchedPct` and `topicNovelty` are already fractions.
      return clamp01(numeric);
  }
}

/**
 * Computes the weighted sum of the normalized signals.
 *
 * Pure. Contract:
 * - The result is clamped to `[0, 1]`, so the exclusion veto (weight `-1`) can drive a
 *   score to exactly `0` without going negative.
 * - Disabled rules, rules with no signals, and rules whose `condition` is false are skipped
 *   entirely — they contribute nothing and add no `contributions` entry.
 * - A rule's weight is spread evenly across the signals it reads, so `contributions` holds
 *   exactly one entry per contributing signal and their weighted values sum to the
 *   *unclamped* score. When the raw sum exceeds `1`, `value` is the clamp and is therefore
 *   a lower bound on the sum.
 * - Every rule is evaluated in the given order and the contributions are emitted in that
 *   order, so two runs with the same inputs produce byte-identical output.
 *
 * @param signals - Extracted signal vector. See `extractSignals`.
 * @param rules - Active rule set, normally `mergeRules(DEFAULT_RULES, overrides)`.
 * @param stamp - `scoredAt` and `version` to record on the result.
 */
export function computeScore(
  signals: ImportanceSignals,
  rules: readonly ScoringRule[],
  stamp: ScoreStamp,
): ImportanceScore {
  const contributions: ImportanceContribution[] = [];
  let total = 0;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.signals.length === 0) continue;
    if (rule.condition !== undefined && !rule.condition(signals)) continue;

    const share = rule.weight / rule.signals.length;
    for (const signal of rule.signals) {
      const value = normalizeSignal(signal, signals[signal]);
      total += share * value;
      contributions.push({ signal, weight: share, value });
    }
  }

  const value = clamp01(total);
  return {
    value,
    band: bandFor(value),
    contributions,
    scoredAt: stamp.scoredAt,
    version: stamp.version,
  };
}

/**
 * Buckets a score into an `ImportanceBand`.
 *
 * Pure. Thresholds are lower bounds taken from the shared `IMPORTANCE_BAND_THRESHOLDS`, and
 * they are absolute rather than percentile-derived: `normal` means the same thing on every
 * account, which matters because `IMPORTANCE_MIN_THRESHOLD` and `DISTILLATION_MIN_BAND`
 * are compared against them directly.
 *
 * @param value - Score, clamped to `[0, 1]` before bucketing.
 */
export function bandFor(value: number): ImportanceBand {
  const score = clamp01(value);
  let band: ImportanceBand = 'noise';

  for (const candidate of IMPORTANCE_BANDS) {
    if (score >= IMPORTANCE_BAND_THRESHOLDS[candidate]) band = candidate;
  }

  return band;
}
