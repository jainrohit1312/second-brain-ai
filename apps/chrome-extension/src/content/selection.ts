import { normalizeWhitespace } from '@second-brain/shared';

import { isExcludedOrigin } from './exclusions';

import type { SelectionCapturePayload } from '@/types/events';

/**
 * Selection capture.
 *
 * Privacy rule: selection text is captured only when it is longer than
 * {@link MIN_SELECTION_CHARS} and the current origin is not on the user's exclusion list.
 * Selections are the most sensitive and the most frequent thing a page produces, so the
 * length floor applies before any text is read out of the DOM and the exclusion check
 * applies before the payload is ever built. Nothing is captured from a page the user
 * excluded, including the surrounding context.
 *
 * Phase 1a scope: both functions are implemented and unit-testable, but the page-view
 * tracker does not start the observer yet. Wiring selections in is Phase 2, where the
 * `selection` and `copy` event paths land together.
 */

/** Shorter selections are almost always UI noise: a mis-click, a label, a single word. */
export const MIN_SELECTION_CHARS = 40;

/** Quiet period after the last selection change before a capture is emitted. */
export const SELECTION_DEBOUNCE_MS = 400;

/** Characters of surrounding text stored on each side of a selection, for context. */
export const CONTEXT_WINDOW_CHARS = 200;

/** Editable hosts whose contents are the user typing, not the user reading. */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

/** True when `node` sits inside a form control or a contenteditable region. */
function isInsideEditable(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element !== null && element.closest(EDITABLE_SELECTOR) !== null;
}

/** Context on each side of `range`, taken from its containing element and clamped. */
function readContext(range: Range): { before: string; after: string } {
  const container =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;

  if (container === null) {
    return { before: '', after: '' };
  }

  try {
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);

    const after = document.createRange();
    after.selectNodeContents(container);
    after.setStart(range.endContainer, range.endOffset);

    return {
      before: normalizeWhitespace(before.toString()).slice(-CONTEXT_WINDOW_CHARS),
      after: normalizeWhitespace(after.toString()).slice(0, CONTEXT_WINDOW_CHARS),
    };
  } catch {
    // A range can refuse an offset when the DOM changed under it, which is normal on a
    // live page. Context is a nice-to-have; the selection itself is the payload.
    return { before: '', after: '' };
  }
}

/**
 * Reads the current selection, or null when there is none, when it is shorter than
 * {@link MIN_SELECTION_CHARS}, or when the page is not eligible.
 */
export function getCurrentSelection(): SelectionCapturePayload | null {
  if (isExcludedOrigin(location.href)) {
    return null;
  }

  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const anchor = selection.anchorNode;
  if (anchor !== null && isInsideEditable(anchor)) {
    return null;
  }

  const text = normalizeWhitespace(selection.toString());
  if (text.length < MIN_SELECTION_CHARS) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const context = readContext(range);

  return {
    text,
    contextBefore: context.before,
    contextAfter: context.after,
    url: location.href,
    title: document.title.length > 0 ? document.title : null,
  };
}

/**
 * Watches for selection changes and calls `handler` once per settled selection, debounced
 * by {@link SELECTION_DEBOUNCE_MS}. Resolves with an unsubscribe function; the handler is
 * never called for an origin on the exclusion list.
 *
 * `mouseup` is listened for as well as `selectionchange`, because a click-drag that ends
 * outside the text still produces a settled selection, and `selectionchange` alone fires
 * mid-drag.
 */
export function createSelectionObserver(
  handler: (payload: SelectionCapturePayload) => void,
): () => void {
  let timer: number | undefined;

  const schedule = (): void => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = undefined;
      const payload = getCurrentSelection();
      if (payload !== null) {
        handler(payload);
      }
    }, SELECTION_DEBOUNCE_MS);
  };

  document.addEventListener('selectionchange', schedule);
  document.addEventListener('mouseup', schedule, true);

  return () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    document.removeEventListener('selectionchange', schedule);
    document.removeEventListener('mouseup', schedule, true);
  };
}
