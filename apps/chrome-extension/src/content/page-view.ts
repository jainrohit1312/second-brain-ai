import { clamp } from '@second-brain/shared';

import type { CapturedEventDraft } from '@/types/events';

/**
 * Builds the `page_view` draft the content script sends to the service worker.
 *
 * Purpose: keep the one object that crosses the capture boundary in a module with no side
 * effects, so it can be validated against the runtime message schema in a unit test. The
 * schema and this builder drifting apart is the failure that silently stops all capture —
 * the validator would reject every draft and the queue would simply stay empty — so the
 * pairing is asserted rather than assumed.
 *
 * Phase 1a scope: `page_view` only.
 */

/** Everything one page visit contributes; the worker supplies the rest. */
export interface PageViewDraftInput {
  url: string;
  title: string | null;
  domain: string;
  dwellMs: number;
  scrollDepthPct: number;
  occurredAt: string;
}

/**
 * Builds the `page_view` draft for one visit.
 *
 * Excluded from the result, by type: `id`, `deviceId`, `dedupeKey`, and `importance`. Those
 * are the worker's to mint — a content script runs on a page the extension does not
 * control, and it should not be able to name a device or claim a score.
 */
export function buildPageViewDraft(input: PageViewDraftInput): CapturedEventDraft {
  return {
    type: 'page_view',
    occurredAt: input.occurredAt,
    url: input.url,
    title: input.title,
    // The server fills this in; the client leaves it empty rather than guessing at a shape
    // only the processing pipeline understands.
    metadata: {},
    domain: input.domain,
    durationMs: Math.round(Math.max(0, input.dwellMs)),
    scrollDepthPct: Math.round(clamp(input.scrollDepthPct, 0, 100)),
  };
}
