import { describe, expect, it } from 'vitest';

import { CLIENT_SCORER_VERSION, DEFAULT_CAPTURE_THRESHOLD, scoreLocally, shouldCapture } from './scoring';

import type { ImportanceScore, ImportanceSignals } from '@second-brain/shared';

/**
 * Contract tests for the client-side pre-filter.
 *
 * The pre-filter is the only thing standing between a browsing session and a queue full of
 * noise, so the two behaviours worth pinning are: nothing without a signal is captured, and
 * an excluded app is never captured no matter how strong everything else looks.
 */

function signals(overrides: Partial<ImportanceSignals> = {}): ImportanceSignals {
  return {
    dwellSeconds: 0,
    scrollDepthPct: 0,
    isUniqueDomain: false,
    revisitCount: 0,
    wordCount: 0,
    hasSelection: false,
    hasCopy: false,
    isBookmarked: false,
    isDownloaded: false,
    youtubeWatchedPct: 0,
    appIsExcluded: false,
    isWorkingHours: false,
    topicNovelty: 0,
    ...overrides,
  };
}

/** The weighted total the contributions add up to, before clamping. */
function contributionTotal(score: ImportanceScore): number {
  return score.contributions.reduce((sum, entry) => sum + entry.weight * entry.value, 0);
}

describe('scoreLocally', () => {
  it('scores an event with no signals at zero and drops it', () => {
    const score = scoreLocally(signals());

    expect(score.value).toBe(0);
    expect(score.band).toBe('noise');
    expect(score.contributions).toEqual([]);
    expect(score.version).toBe(CLIENT_SCORER_VERSION);
    expect(shouldCapture(score)).toBe(false);
  });

  it('captures a deliberate read of a long article', () => {
    const score = scoreLocally(
      signals({
        dwellSeconds: 300,
        scrollDepthPct: 80,
        isUniqueDomain: true,
        wordCount: 1_200,
        isWorkingHours: true,
      }),
    );

    // dwell saturates at 10s: 0.30 + 0.8*0.15 + 0.05 + 0.6*0.1 + 0.03
    expect(score.value).toBeCloseTo(0.56, 5);
    expect(score.band).toBe('normal');
    expect(shouldCapture(score)).toBe(true);
  });

  it('captures a dwell-only visit from 5s and drops one below it', () => {
    const attended = scoreLocally(signals({ dwellSeconds: 10 }));
    const glanced = scoreLocally(signals({ dwellSeconds: 4 }));

    // Dwell saturates at 10s and weighs 0.30 — twice the 0.15 threshold — so dwelling alone
    // clears the line from 5s of attention; 4s scales to 0.12 and falls short.
    expect(attended.value).toBeCloseTo(0.3, 5);
    expect(attended.band).toBe('low');
    expect(shouldCapture(attended)).toBe(true);

    expect(glanced.value).toBeCloseTo(0.12, 5);
    expect(glanced.band).toBe('noise');
    expect(shouldCapture(glanced)).toBe(false);
  });

  it('captures a half-minute visit that was actually scrolled', () => {
    const score = scoreLocally(signals({ dwellSeconds: 30, scrollDepthPct: 100 }));

    // 0.30 + 1.0*0.15
    expect(score.value).toBeCloseTo(0.45, 5);
    expect(shouldCapture(score)).toBe(true);
  });

  it('keeps the contributions equal to the unclamped weighted total', () => {
    const score = scoreLocally(signals({ dwellSeconds: 120, topicNovelty: 0.4 }));

    expect(score.value).toBeCloseTo(contributionTotal(score), 10);
  });

  it('clamps a saturated event to one', () => {
    const score = scoreLocally(
      signals({
        dwellSeconds: 10_000,
        scrollDepthPct: 100,
        isUniqueDomain: true,
        revisitCount: 50,
        wordCount: 10_000,
        hasSelection: true,
        hasCopy: true,
        isBookmarked: true,
        isDownloaded: true,
        youtubeWatchedPct: 1,
        isWorkingHours: true,
        topicNovelty: 1,
      }),
    );

    expect(score.value).toBe(1);
    expect(score.band).toBe('critical');
    expect(contributionTotal(score)).toBeGreaterThan(1);
  });

  it('zeroes an excluded app even when every other signal is maximal', () => {
    const score = scoreLocally(
      signals({
        appIsExcluded: true,
        dwellSeconds: 10_000,
        wordCount: 10_000,
        hasCopy: true,
        topicNovelty: 1,
      }),
    );

    expect(score.value).toBe(0);
    expect(score.band).toBe('noise');
    expect(score.contributions).toEqual([
      { signal: 'appIsExcluded', weight: -1, value: 1 },
    ]);
    expect(shouldCapture(score)).toBe(false);
  });

  it('honours an override weight map', () => {
    const score = scoreLocally(signals({ dwellSeconds: 600 }), { dwellSeconds: 0.5 });

    expect(score.value).toBeCloseTo(0.5, 10);
    expect(score.contributions).toEqual([
      { signal: 'dwellSeconds', weight: 0.5, value: 1 },
    ]);
  });

  it('ignores a signal that is not in the weight map', () => {
    const score = scoreLocally(signals({ topicNovelty: 1 }), { dwellSeconds: 0.5 });

    expect(score.value).toBe(0);
    expect(score.contributions).toEqual([]);
  });
});

describe('shouldCapture', () => {
  it('uses the default threshold when none is given', () => {
    const quiet = scoreLocally(signals({ scrollDepthPct: 20 }));
    const deliberate = scoreLocally(
      signals({ dwellSeconds: 300, scrollDepthPct: 80, wordCount: 1_200, isUniqueDomain: true }),
    );

    expect(quiet.value).toBeLessThan(DEFAULT_CAPTURE_THRESHOLD);
    expect(shouldCapture(quiet)).toBe(false);
    expect(deliberate.value).toBeGreaterThanOrEqual(DEFAULT_CAPTURE_THRESHOLD);
    expect(shouldCapture(deliberate)).toBe(true);
  });

  it('compares against an explicit threshold', () => {
    const score = scoreLocally(signals({ dwellSeconds: 300, wordCount: 1_000 }));

    // dwell saturated: 0.30 + 0.5*0.1
    expect(score.value).toBeCloseTo(0.35, 5);
    expect(shouldCapture(score, 0.25)).toBe(true);
    expect(shouldCapture(score, 0.4)).toBe(false);
  });

  it('always captures a critical score, however tight the threshold', () => {
    const critical: ImportanceScore = {
      ...scoreLocally(signals()),
      value: 0.9,
      band: 'critical',
    };

    expect(shouldCapture(critical, 0.99)).toBe(true);
  });
});
