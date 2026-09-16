import { describe, expect, it } from 'vitest';

import { parseRuntimeMessage } from '../lib/messages';

import { MIN_SELECTION_CHARS } from './selection';
import { buildCopyDraft, buildSelectionDraft } from './selection-draft';

import type { CopyDraftInput } from './selection-draft';
import type { CapturedEventDraft, SelectionCapturePayload } from '@/types/events';

/**
 * The same fragile seam `page-view.test.ts` covers, for the other capture path that
 * crosses it.
 *
 * The content script builds a draft and the worker validates it against
 * `runtimeMessageSchema` before anything reaches the queue. If those two disagree, every
 * selection is rejected, the queue stays empty, and nothing surfaces in a log — the
 * extension simply looks like it is not capturing. So the real builder is run through the
 * real validator here rather than trusting that the two were written consistently.
 */

const SELECTION: SelectionCapturePayload = {
  text: 'rank fusion is preferred to score interpolation because the two signals are not commensurable',
  contextBefore: 'In our design,',
  contextAfter: 'which means the weights are real weights.',
  url: 'https://example.com/ai-memory',
  title: 'How recall systems are actually built',
};

const OCCURRED_AT = '2026-09-16T09:13:41.000Z';

/** Validates a draft as the worker would, and narrows it to the selection variant. */
function parseAsSelection(
  payload: SelectionCapturePayload,
): Extract<CapturedEventDraft, { type: 'selection' }> {
  const message = { type: 'EVENT_CAPTURED', draft: buildSelectionDraft(payload, OCCURRED_AT) };
  const parsed = parseRuntimeMessage(message);

  expect(parsed).not.toBeNull();
  if (parsed?.type !== 'EVENT_CAPTURED' || parsed.draft.type !== 'selection') {
    throw new Error('expected an EVENT_CAPTURED message carrying a selection draft');
  }
  return parsed.draft;
}

describe('buildSelectionDraft', () => {
  it('produces a draft the worker accepts', () => {
    const message = { type: 'EVENT_CAPTURED', draft: buildSelectionDraft(SELECTION, OCCURRED_AT) };

    expect(parseRuntimeMessage(message)).not.toBeNull();
  });

  it('round-trips the payload through the validator unchanged', () => {
    const draft = parseAsSelection(SELECTION);

    expect(draft.occurredAt).toBe(OCCURRED_AT);
    expect(draft.url).toBe(SELECTION.url);
    expect(draft.title).toBe(SELECTION.title);
    expect(draft.text).toBe(SELECTION.text);
    expect(draft.selectionLength).toBe(SELECTION.text.length);
    expect(draft.metadata).toEqual({});
  });

  it('carries the context on both sides, which is what makes a selection interpretable', () => {
    const draft = parseAsSelection(SELECTION);

    expect(draft.contextBefore).toBe(SELECTION.contextBefore);
    expect(draft.contextAfter).toBe(SELECTION.contextAfter);
  });

  it('derives selectionLength from the text rather than from the payload', () => {
    // A payload whose text is shorter than a caller-supplied length would otherwise store
    // a length that disagrees with the text the row carries.
    const draft = parseAsSelection({ ...SELECTION, text: 'short' });

    expect(draft.selectionLength).toBe(5);
  });

  it('measures length in UTF-16 code units, matching String.length', () => {
    // `selectionLength` is documented as a character count, and the whole pipeline uses
    // `String.length`. An astral character therefore counts as two; pinned here so a later
    // switch to code points is a deliberate change rather than a silent one.
    const draft = parseAsSelection({ ...SELECTION, text: '\u{1F600}ab' });

    expect(draft.selectionLength).toBe(4);
  });

  it('carries a null title, which is normal for a page with no <title>', () => {
    expect(parseAsSelection({ ...SELECTION, title: null }).title).toBeNull();
  });

  it('keeps the url, which the worker needs for the dedupe key', () => {
    expect(parseAsSelection(SELECTION).url).toBe('https://example.com/ai-memory');
  });
});

const COPY: CopyDraftInput = {
  text: 'rank fusion is preferred to score interpolation because the two signals are not commensurable',
  url: 'https://example.com/ai-memory',
  title: 'How recall systems are actually built',
  occurredAt: '2026-09-16T09:13:52.000Z',
};

/** Validates a draft as the worker would, and narrows it to the copy variant. */
function parseAsCopy(input: CopyDraftInput): Extract<CapturedEventDraft, { type: 'copy' }> {
  const draft = buildCopyDraft(input);
  if (draft === null) {
    throw new Error('expected buildCopyDraft to produce a draft');
  }

  const parsed = parseRuntimeMessage({ type: 'EVENT_CAPTURED', draft });
  expect(parsed).not.toBeNull();
  if (parsed?.type !== 'EVENT_CAPTURED' || parsed.draft.type !== 'copy') {
    throw new Error('expected an EVENT_CAPTURED message carrying a copy draft');
  }
  return parsed.draft;
}

describe('buildCopyDraft', () => {
  it('produces a draft the worker accepts', () => {
    const draft = parseAsCopy(COPY);

    expect(draft.type).toBe('copy');
    expect(draft.text).toBe(COPY.text);
    expect(draft.occurredAt).toBe(COPY.occurredAt);
    expect(draft.metadata).toEqual({});
  });

  it('returns null when the copied text is shorter than MIN_SELECTION_CHARS', () => {
    expect(buildCopyDraft({ ...COPY, text: 'too short' })).toBeNull();
    expect(buildCopyDraft({ ...COPY, text: 'x'.repeat(MIN_SELECTION_CHARS - 1) })).toBeNull();
  });

  it('accepts a copy exactly at the floor, since the floor is a minimum and not an exclusion', () => {
    const draft = parseAsCopy({ ...COPY, text: 'x'.repeat(MIN_SELECTION_CHARS) });

    expect(draft.selectionLength).toBe(MIN_SELECTION_CHARS);
  });

  it('carries the url and a null title, which is normal for a page with no <title>', () => {
    const draft = parseAsCopy({ ...COPY, title: null });

    expect(draft.url).toBe('https://example.com/ai-memory');
    expect(draft.title).toBeNull();
  });
});
