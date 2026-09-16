/**
 * Importance signal extraction.
 *
 * A signal is one normalized-ish observation about an event or its history. Extraction is
 * separated from weighting (`./rules`) and from the arithmetic (`./score`) so that adding
 * a signal is a localized change and so that the weighting table can be tuned and reasoned
 * about without touching event-shape knowledge.
 *
 * **Client vs server.** Three signals — `isUniqueDomain`, `revisitCount` and
 * `topicNovelty` — require history the device does not have. They are therefore
 * unavailable to the client-side pre-filter entirely, which is the concrete reason the
 * client score is advisory and the server always re-scores.
 *
 * Every extractor is pure with respect to its inputs: same event and same history window,
 * same signal. No I/O, no clock reads, no randomness.
 */
import type { ActivityEvent, ActivityHistoryWindow, ImportanceSignals } from '@second-brain/shared';

/**
 * One method per key of `ImportanceSignals`, so that adding a signal to the shared type is
 * a compile error here until it is extracted.
 *
 * History-dependent signals must degrade to a documented default rather than throwing when
 * the window is empty: a fresh install has no history, and its first events still have to
 * score.
 */
export interface SignalExtractor {
  /** `dwellSeconds` — seconds of *active* dwell, `>= 0`. From `PageViewEvent.durationMs`; `0` for event types that have no dwell concept. */
  extractDwellSeconds(event: ActivityEvent, history: ActivityHistoryWindow): number;
  /** `scrollDepthPct` — maximum depth reached, `0–100`. From `PageViewEvent.scrollDepthPct`; `0` elsewhere. */
  extractScrollDepthPct(event: ActivityEvent, history: ActivityHistoryWindow): number;
  /** `isUniqueDomain` — `true` when the domain is absent from `history.seenDomains`. Needs history; `false` on an empty window. */
  extractIsUniqueDomain(event: ActivityEvent, history: ActivityHistoryWindow): boolean;
  /** `revisitCount` — prior views of the same canonical URL, `>= 0`. Needs history; `0` on an empty window. */
  extractRevisitCount(event: ActivityEvent, history: ActivityHistoryWindow): number;
  /** `wordCount` — length of the readable body, `>= 0`. From `PageReadEvent.wordCount`; `0` for events that carry no body. */
  extractWordCount(event: ActivityEvent, history: ActivityHistoryWindow): number;
  /** `hasSelection` — `true` when a passage was highlighted (`selection`), which is weak intent. */
  extractHasSelection(event: ActivityEvent, history: ActivityHistoryWindow): boolean;
  /** `hasCopy` — `true` when a passage was copied (`copy`), which is stronger intent than a selection. */
  extractHasCopy(event: ActivityEvent, history: ActivityHistoryWindow): boolean;
  /** `isBookmarked` — `true` for an explicit bookmark. Explicit intent, never noise. */
  extractIsBookmarked(event: ActivityEvent, history: ActivityHistoryWindow): boolean;
  /** `isDownloaded` — `true` for a completed download. Explicit intent, never noise. */
  extractIsDownloaded(event: ActivityEvent, history: ActivityHistoryWindow): boolean;
  /** `youtubeWatchedPct` — fraction watched, `0–1`. From `YouTubeWatchEvent.watchedPct`; `0` and meaningless for non-video content. */
  extractYoutubeWatchedPct(event: ActivityEvent, history: ActivityHistoryWindow): number;
  /** `appIsExcluded` — `true` when the app is on the device's exclusion list. Must always be `false` in practice: an excluded app produces no event at all. */
  extractAppIsExcluded(event: ActivityEvent, history: ActivityHistoryWindow): boolean;
  /** `isWorkingHours` — `true` when the capture falls inside the local-time working window, weekday bounds included. */
  extractIsWorkingHours(event: ActivityEvent, history: ActivityHistoryWindow): boolean;
  /** `topicNovelty` — how dissimilar this is from everything already known, `0–1`. Needs history; `0.5` on an empty window. */
  extractTopicNovelty(event: ActivityEvent, history: ActivityHistoryWindow): number;
}

/**
 * The production extractor.
 *
 * Every method throws until phase 1 so that an incomplete engine cannot silently score
 * everything as `noise` — which, with `IMPORTANCE_MIN_THRESHOLD` in place, would drop the
 * entire corpus without an error anywhere.
 */
export const defaultSignalExtractor: SignalExtractor = {
  extractDwellSeconds(_event, _history) {
    // TODO(phase-1): seconds of active dwell from `page_view.durationMs`, saturating at
    // DWELL_SATURATION_SECONDS; `app_session` uses its own duration.
    throw new Error('Not implemented: SignalExtractor.extractDwellSeconds');
  },
  extractScrollDepthPct(_event, _history) {
    // TODO(phase-1): read `page_view.scrollDepthPct`, clamp to `[0, 100]`.
    throw new Error('Not implemented: SignalExtractor.extractScrollDepthPct');
  },
  extractIsUniqueDomain(_event, _history) {
    // TODO(phase-1): compare the event's domain against `history.seenDomains`.
    throw new Error('Not implemented: SignalExtractor.extractIsUniqueDomain');
  },
  extractRevisitCount(_event, _history) {
    // TODO(phase-1): `history.revisitCount`, which the caller resolved per canonical URL.
    throw new Error('Not implemented: SignalExtractor.extractRevisitCount');
  },
  extractWordCount(_event, _history) {
    // TODO(phase-1): `page_read.wordCount`; `0` for every other event type.
    throw new Error('Not implemented: SignalExtractor.extractWordCount');
  },
  extractHasSelection(_event, _history) {
    // TODO(phase-1): narrow on `event.type === 'selection'`.
    throw new Error('Not implemented: SignalExtractor.extractHasSelection');
  },
  extractHasCopy(_event, _history) {
    // TODO(phase-1): narrow on `event.type === 'copy'`.
    throw new Error('Not implemented: SignalExtractor.extractHasCopy');
  },
  extractIsBookmarked(_event, _history) {
    // TODO(phase-1): narrow on `event.type === 'bookmark'`.
    throw new Error('Not implemented: SignalExtractor.extractIsBookmarked');
  },
  extractIsDownloaded(_event, _history) {
    // TODO(phase-1): narrow on `event.type === 'download'`.
    throw new Error('Not implemented: SignalExtractor.extractIsDownloaded');
  },
  extractYoutubeWatchedPct(_event, _history) {
    // TODO(phase-1): `youtube_watch.watchedPct`, clamped; `0` for non-video events.
    throw new Error('Not implemented: SignalExtractor.extractYoutubeWatchedPct');
  },
  extractAppIsExcluded(_event, _history) {
    // TODO(phase-1): consult the device exclusion list. Defensive only — the exclusion
    // invariant means an excluded app never produces an event in the first place.
    throw new Error('Not implemented: SignalExtractor.extractAppIsExcluded');
  },
  extractIsWorkingHours(_event, _history) {
    // TODO(phase-1): wrap the shared `isWorkingHours` over `event.occurredAt`.
    throw new Error('Not implemented: SignalExtractor.extractIsWorkingHours');
  },
  extractTopicNovelty(_event, _history) {
    // TODO(phase-1): cosine distance from the nearest existing topic centroid, using
    // `history.knownTopicSlugs` plus the stored centroids; `0.5` when there is no history.
    throw new Error('Not implemented: SignalExtractor.extractTopicNovelty');
  },
};

/**
 * Extracts every signal for one event.
 *
 * With `defaultSignalExtractor` this throws until phase 1. The composed result must always
 * satisfy the ranges documented on `SignalExtractor`; `computeScore` relies on it and does
 * its own clamping anyway, so a sloppy extractor degrades a score rather than corrupting
 * one.
 *
 * @param event - The event being scored. Must not be mutated.
 * @param history - The trailing window loaded for this event. See `ActivityHistoryWindow`.
 * @param extractor - Override, used by tests and by the client's shared-subset path.
 */
export async function extractSignals(
  _event: ActivityEvent,
  _history: ActivityHistoryWindow,
  _extractor: SignalExtractor = defaultSignalExtractor,
): Promise<ImportanceSignals> {
  // TODO(phase-1): await each extractor method, assemble the 13-field object, and validate
  // the ranges before returning. Sequential rather than parallel because every method is
  // pure and synchronous today.
  throw new Error('Not implemented: extractSignals');
}
