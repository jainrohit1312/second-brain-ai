import { isWorkingHours } from '@second-brain/shared';

import type { CapturedEventDraft } from '@/types/events';
import type { ImportanceSignals } from '@second-brain/shared';

/**
 * The signal vector the client-side pre-score runs on.
 *
 * Lives here rather than beside the worker's scoring call because two contexts now need the
 * same answer for the same draft: the service worker scores a capture before queueing it, and
 * the content script scores a page view to decide whether that page's body is worth
 * extracting. Two copies of this mapping would be two opinions about how important a page
 * view is, and the content script's extraction gate would quietly disagree with the score the
 * worker actually stored.
 *
 * The subset of `ImportanceSignals` this client can actually observe.
 *
 * `isUniqueDomain`, `revisitCount`, and `topicNovelty` all need history the client does not
 * have in Phase 1a — the first two would come from `chrome.history` and the third only from
 * the server's own corpus — so they stay at zero. That makes the pre-filter conservative: it
 * never invents importance it cannot justify, and the server re-scores every accepted event
 * with the full signal vector anyway.
 */
export function deriveSignals(draft: CapturedEventDraft, at: Date): ImportanceSignals {
  return {
    dwellSeconds: draft.type === 'page_view' ? Math.max(0, draft.durationMs / 1_000) : 0,
    scrollDepthPct: draft.type === 'page_view' ? draft.scrollDepthPct : 0,
    isUniqueDomain: false,
    revisitCount: 0,
    wordCount: draft.type === 'page_read' ? draft.wordCount : 0,
    hasSelection: draft.type === 'selection',
    hasCopy: draft.type === 'copy',
    isBookmarked: draft.type === 'bookmark',
    isDownloaded: draft.type === 'download',
    youtubeWatchedPct: draft.type === 'youtube_watch' ? draft.watchedPct : 0,
    // Never set here: an excluded origin never produces a draft at all, because the content
    // script applies the exclusion list before the event object is constructed. This field
    // stays false as a deliberate invariant, not as missing wiring.
    appIsExcluded: false,
    isWorkingHours: isWorkingHours(at),
    topicNovelty: 0,
  };
}
