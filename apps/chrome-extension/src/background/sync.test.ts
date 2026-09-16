import { describe, expect, it, vi } from 'vitest';

import { INGEST_FUNCTION_NAME, buildActivityBatch, postActivityBatch } from './sync';

import type { QueuedDocument, QueuedEvent } from './queue';
import type { ActivityBatch, ActivityBatchResult } from '@second-brain/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Transport-level tests for {@link postActivityBatch}.
 *
 * Only the call and the failure mapping are asserted here — the batch's own shape is
 * `buildActivityBatch`'s business, and everything on the far side of the wire is the
 * edge function's. What matters is that the one call goes to the right function with
 * the batch as its body, and that a failure reaches the caller carrying whatever the
 * server said about it, because the drain decides what to do from that.
 */

/** The batch under test. Its contents never matter: the transport does not read them. */
const BATCH: ActivityBatch = {
  schemaVersion: 1,
  deviceId: '0b5f0f3a-5c4b-4f0e-9a1e-6b0f6a2c9d31',
  clientSentAt: '2026-09-16T09:15:00.000Z',
  events: [],
};

/** A response the server could plausibly return for a one-event batch. */
const RESULT: ActivityBatchResult = {
  accepted: 1,
  rejected: 0,
  duplicates: 0,
  serverCursor: 'eyJ2IjoxLCJ0Ijoic3luYyJ9',
  rejectedIds: [],
  documentsAccepted: 0,
  documentsRejected: 0,
  rejectedDocumentUrls: [],
};

/**
 * A client whose usable surface is exactly `functions.invoke`. The cast is the point:
 * a real `SupabaseClient` cannot be constructed without a live URL, and anything the
 * function touches beyond `invoke` would fail here rather than silently pass.
 */
function clientAnswering(answer: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  invoke: ReturnType<typeof vi.fn>;
} {
  const invoke = vi.fn().mockResolvedValue(answer);
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke };
}

/**
 * A failed invocation as `functions.invoke` reports it: a message describing the
 * transport, and — for an HTTP error only — the `Response` it came from. A network
 * failure has no response at all, which is the `body === undefined` case.
 */
function invocationError(
  message: string,
  status: number,
  body?: string,
): { message: string; context: Response | undefined } {
  return { message, context: body === undefined ? undefined : new Response(body, { status }) };
}

describe('postActivityBatch', () => {
  it('resolves with the server accounting and invokes the ingestion function once', async () => {
    const { client, invoke } = clientAnswering({ data: RESULT, error: null });

    await expect(postActivityBatch(client, BATCH)).resolves.toEqual(RESULT);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(INGEST_FUNCTION_NAME, { body: BATCH });
  });

  it('rejects with the documented code when the failure carries the error envelope', async () => {
    const { client } = clientAnswering({
      data: null,
      error: invocationError(
        'Edge Function returned a non-2xx status code',
        403,
        JSON.stringify({
          error: { code: 'device_revoked', message: 'revoked', requestId: 'req_01' },
        }),
      ),
    });

    await expect(postActivityBatch(client, BATCH)).rejects.toThrow(/device_revoked/);
  });

  it('rejects without a code when the failure has no response body', async () => {
    const { client } = clientAnswering({
      data: null,
      error: invocationError('Failed to send a request to the Edge Function', 0),
    });

    await expect(postActivityBatch(client, BATCH)).rejects.toThrow(
      'Ingestion failed: Failed to send a request to the Edge Function',
    );
  });

  it('rejects without a code when the body is not the error envelope', async () => {
    const { client } = clientAnswering({
      data: null,
      error: invocationError('Bad Gateway', 502, '<html>502 Bad Gateway</html>'),
    });

    await expect(postActivityBatch(client, BATCH)).rejects.toThrow('Ingestion failed: Bad Gateway');
  });

  it('rejects when the response carries no per-event outcomes', async () => {
    const withoutRejectedIds = {
      accepted: 1,
      rejected: 0,
      duplicates: 0,
      serverCursor: RESULT.serverCursor,
    };
    const { client } = clientAnswering({ data: withoutRejectedIds, error: null });

    await expect(postActivityBatch(client, BATCH)).rejects.toThrow(/not acknowledged/);
  });
});

/** One queued event, for the envelope tests below. */
const EVENT: QueuedEvent = {
  id: '019c4f2e-0837-7421-9c61-3ab4cde5f601',
  queuedAt: '2026-09-16T09:15:00.000Z',
  attempts: 0,
  lastAttemptAt: null,
  event: {
    id: '019c4f2e-0837-7421-9c61-3ab4cde5f601',
    deviceId: '0b5f0f3a-5c4b-4f0e-9a1e-6b0f6a2c9d31',
    type: 'page_view',
    occurredAt: '2026-09-16T09:12:00.000Z',
    importance: 0.41,
    dedupeKey: 'page_view:example.com/ai-memory:2026-09-16T09',
    url: 'https://example.com/ai-memory',
    title: 'How recall systems are actually built',
    metadata: {},
    domain: 'example.com',
    durationMs: 184_000,
    scrollDepthPct: 86,
  },
};

/** One queued document body, for the envelope tests below. */
const DOCUMENT: QueuedDocument = {
  id: 'c'.repeat(64),
  queuedAt: '2026-09-16T09:16:00.000Z',
  attempts: 0,
  lastAttemptAt: null,
  document: {
    url: 'https://example.com/ai-memory',
    title: 'How recall systems are actually built',
    content: 'Rank fusion is preferred to score interpolation.',
    language: 'en',
    source: 'web',
    wordCount: 8,
    occurredAt: '2026-09-16T09:14:02.000Z',
  },
};

const CLOCK = (): Date => new Date('2026-09-16T09:20:00.000Z');
const DEVICE = '0b5f0f3a-5c4b-4f0e-9a1e-6b0f6a2c9d31';

/**
 * The document half of the wire envelope.
 *
 * `buildActivityBatch` is the only place the client decides whether a batch carries documents,
 * and the rule it applies — omit the field rather than send an empty array — is what keeps an
 * events-only batch byte-identical to the one this client sent before documents existed. A
 * regression would not fail loudly anywhere: the server tolerates both shapes, so the only
 * symptom would be a field appearing in requests that no earlier release ever sent.
 */
describe('buildActivityBatch', () => {
  it('carries the events, and omits `documents` entirely when there are none', () => {
    const batch = buildActivityBatch([EVENT], [], DEVICE, CLOCK);

    expect(batch.events).toEqual([EVENT.event]);
    expect('documents' in batch).toBe(false);
  });

  it('omits `documents` when the array is given but empty', () => {
    const batch = buildActivityBatch([], [], DEVICE, CLOCK);

    expect('documents' in batch).toBe(false);
  });

  it('carries the document bodies when there are some, even with no events', () => {
    const batch = buildActivityBatch([], [DOCUMENT], DEVICE, CLOCK);

    expect(batch.events).toEqual([]);
    expect(batch.documents).toEqual([DOCUMENT.document]);
  });

  it('stamps the schema version and the injected clock rather than the wall clock', () => {
    const batch = buildActivityBatch([], [DOCUMENT], DEVICE, CLOCK);

    expect(batch.schemaVersion).toBe(1);
    expect(batch.deviceId).toBe(DEVICE);
    expect(batch.clientSentAt).toBe('2026-09-16T09:20:00.000Z');
  });
});
