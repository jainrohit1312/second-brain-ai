import { MIN_SELECTION_CHARS } from './selection';

import type { CapturedEventDraft, SelectionCapturePayload } from '@/types/events';

/**
 * Builders for the two drafts the selection capture path produces.
 *
 * Purpose: the same one `page-view.ts` serves — keep the objects that cross the capture
 * boundary in a module with no side effects, so they can be validated against the runtime
 * message schema in a unit test. The schema and these builders drifting apart is the failure
 * that silently stops capture: the validator rejects every draft, the queue stays empty, and
 * nothing appears in a log. So the pairing is asserted rather than assumed.
 *
 * **Neither builder is consulted about a score, and neither can be.** Both `selection` and
 * `copy` are members of `EXPLICIT_INTENT_EVENT_TYPES`, so the worker queues them whatever
 * they would have scored — a deliberate act is the one thing a noise threshold must not
 * overrule. The worker still computes a score (it is stored, and the server re-scores), but
 * it is never the reason one of these drafts is dropped.
 *
 * `occurredAt` is a parameter on both rather than a `new Date()` read here, matching
 * `PageViewDraftInput`. The observer debounces and the copy listener fires on a browser
 * event, so the caller is the only place that knows when the thing happened, and a builder
 * that read the clock could not be held to a fixture.
 */

/**
 * Builds the `selection` draft for a settled selection.
 *
 * No length check: `getCurrentSelection` is the only caller and it has already applied
 * `MIN_SELECTION_CHARS` before this is reached.
 */
export function buildSelectionDraft(
  payload: SelectionCapturePayload,
  occurredAt: string,
): CapturedEventDraft {
  return {
    type: 'selection',
    occurredAt,
    url: payload.url,
    title: payload.title,
    text: payload.text,
    contextBefore: payload.contextBefore,
    contextAfter: payload.contextAfter,
    // Derived rather than taken from the payload: there is no `selectionLength` on
    // `SelectionCapturePayload`, and a length that disagreed with `text` would be a
    // silently wrong number in a row the server trusts.
    selectionLength: payload.text.length,
    metadata: {},
  };
}

/** Everything the copy path contributes. Note the absence of selection context. */
export interface CopyDraftInput {
  text: string;
  url: string;
  title: string | null;
  occurredAt: string;
}

/**
 * Builds the `copy` draft for a copied passage, or `null` when there is nothing worth
 * recording.
 *
 * Null rather than a throw or an empty draft: a copy shorter than
 * {@link MIN_SELECTION_CHARS} is a single word or a stray keystroke, and the caller's job is
 * to drop it. Returning null keeps that decision inside the builder, so a second caller
 * cannot forget it.
 *
 * The `copy` variant declares no `contextBefore`/`contextAfter`, unlike `selection`. That is
 * the type's judgement, not an omission here: a copy is a completed act, so the surrounding
 * text adds nothing to interpreting it.
 *
 * The length floor repeats the one `getCurrentSelection` already applied. That is deliberate
 * defence in depth rather than a dead branch — the manual triggers TASKS.md still anticipates
 * (a keyboard shortcut, a context menu) will not necessarily reach the clipboard through
 * `getCurrentSelection`, and a builder whose contract depends on its caller is one refactor
 * away from storing a single word as a document-grade signal.
 */
export function buildCopyDraft(input: CopyDraftInput): CapturedEventDraft | null {
  if (input.text.length < MIN_SELECTION_CHARS) {
    return null;
  }

  return {
    type: 'copy',
    occurredAt: input.occurredAt,
    url: input.url,
    title: input.title,
    text: input.text,
    selectionLength: input.text.length,
    metadata: {},
  };
}
