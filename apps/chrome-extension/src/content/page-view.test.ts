import { describe, expect, it } from 'vitest';

import { parseRuntimeMessage } from '../lib/messages';

import { buildPageViewDraft } from './page-view';

import type { PageViewDraftInput } from './page-view';
import type { CapturedEventDraft, RuntimeMessage } from '@/types/events';

/**
 * The capture path's most fragile seam.
 *
 * The content script builds a draft and the worker validates it against
 * `runtimeMessageSchema` before anything reaches the queue. If those two disagree, every
 * capture is rejected, the queue stays empty, and nothing surfaces in a log — the extension
 * simply looks like it is not working. So the real builder is run through the real
 * validator here rather than trusting that the two were written consistently.
 */

const VISIT: PageViewDraftInput = {
  url: 'https://example.com/deep-dive',
  title: 'A Deep Dive',
  domain: 'example.com',
  dwellMs: 42_000,
  scrollDepthPct: 62.4,
  occurredAt: '2026-09-16T09:15:30.000Z',
};

/** Validates a draft as the worker would, and narrows it to the page_view variant. */
function parseAsPageView(input: PageViewDraftInput): Extract<CapturedEventDraft, { type: 'page_view' }> {
  const message: RuntimeMessage = { type: 'EVENT_CAPTURED', draft: buildPageViewDraft(input) };
  const parsed = parseRuntimeMessage(message);

  expect(parsed).not.toBeNull();
  if (parsed?.type !== 'EVENT_CAPTURED' || parsed.draft.type !== 'page_view') {
    throw new Error('expected an EVENT_CAPTURED message carrying a page_view draft');
  }
  return parsed.draft;
}

describe('buildPageViewDraft', () => {
  it('produces a draft the worker accepts', () => {
    const message: RuntimeMessage = { type: 'EVENT_CAPTURED', draft: buildPageViewDraft(VISIT) };

    expect(parseRuntimeMessage(message)).not.toBeNull();
  });

  it('round-trips the visit through the validator unchanged', () => {
    const draft = parseAsPageView(VISIT);

    expect(draft.occurredAt).toBe(VISIT.occurredAt);
    expect(draft.url).toBe(VISIT.url);
    expect(draft.title).toBe(VISIT.title);
    expect(draft.domain).toBe(VISIT.domain);
    expect(draft.durationMs).toBe(42_000);
    expect(draft.metadata).toEqual({});
  });

  it('rounds scroll depth to a whole percent', () => {
    expect(parseAsPageView({ ...VISIT, scrollDepthPct: 62.4 }).scrollDepthPct).toBe(62);
  });

  it('clamps a scroll depth past the end of the page', () => {
    expect(parseAsPageView({ ...VISIT, scrollDepthPct: 143.2 }).scrollDepthPct).toBe(100);
  });

  it('never reports negative dwell time', () => {
    expect(parseAsPageView({ ...VISIT, dwellMs: -500 }).durationMs).toBe(0);
  });

  it('carries a null title, which is normal for a page with no <title>', () => {
    expect(parseAsPageView({ ...VISIT, title: null }).title).toBeNull();
  });
});
