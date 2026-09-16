import { describe, expect, it } from 'vitest';

import { parseContentScriptCommandValue, parseRuntimeMessage } from './messages';

/**
 * Protocol-level tests for the validator the router trusts.
 *
 * Every message that reaches the service worker comes from a page the extension does not
 * control, so this validator is the only thing between that page and the durable queue.
 * The test asserts both directions: the messages the extension's own contexts send are
 * accepted, and anything malformed is refused rather than coerced.
 */

describe('parseRuntimeMessage', () => {
  it('accepts the messages the popup sends', () => {
    const messages: unknown[] = [
      { type: 'GET_STATUS' },
      { type: 'SYNC_STATUS' },
      { type: 'SYNC_NOW', force: true },
      { type: 'FLUSH_QUEUE', reason: 'manual' },
      { type: 'SET_CAPTURE_ENABLED', enabled: false },
      {
        type: 'AUTH_STATE_CHANGED',
        auth: { status: 'signed-in', userId: 'u1', email: 'a@b.c', expiresAt: null },
      },
    ];

    for (const message of messages) {
      expect(parseRuntimeMessage(message), JSON.stringify(message)).not.toBeNull();
    }
  });

  it('refuses an unknown discriminant', () => {
    expect(parseRuntimeMessage({ type: 'DELETE_EVERYTHING' })).toBeNull();
  });

  it('refuses a non-object', () => {
    expect(parseRuntimeMessage('SYNC_NOW')).toBeNull();
    expect(parseRuntimeMessage(null)).toBeNull();
    expect(parseRuntimeMessage(undefined)).toBeNull();
  });

  it('refuses a flush reason outside the union', () => {
    expect(parseRuntimeMessage({ type: 'FLUSH_QUEUE', reason: 'whenever' })).toBeNull();
  });

  it('refuses an event type outside the shared list', () => {
    const draft = {
      type: 'mind_read',
      occurredAt: '2026-09-16T09:15:30.000Z',
      url: null,
      title: null,
      metadata: {},
    };

    expect(parseRuntimeMessage({ type: 'EVENT_CAPTURED', draft })).toBeNull();
  });

  it('refuses a page_view draft that is missing a variant field', () => {
    const draft = {
      type: 'page_view',
      occurredAt: '2026-09-16T09:15:30.000Z',
      url: 'https://example.com',
      title: null,
      metadata: {},
      durationMs: 1_000,
      scrollDepthPct: 10,
    };

    expect(parseRuntimeMessage({ type: 'EVENT_CAPTURED', draft })).toBeNull();
  });

  it('refuses a capture with no timestamp', () => {
    const draft = {
      type: 'page_view',
      occurredAt: 'yesterday',
      url: 'https://example.com',
      title: null,
      metadata: {},
      domain: 'example.com',
      durationMs: 1_000,
      scrollDepthPct: 10,
    };

    expect(parseRuntimeMessage({ type: 'EVENT_CAPTURED', draft })).toBeNull();
  });

  it('accepts a document body from the content script', () => {
    const document = {
      url: 'https://example.com/ai-memory',
      title: 'How recall systems are actually built',
      content: 'Rank fusion is preferred to score interpolation.',
      language: 'en',
      source: 'web',
      wordCount: 8,
      occurredAt: '2026-09-16T09:14:02.000Z',
    };

    expect(parseRuntimeMessage({ type: 'DOCUMENT_CAPTURED', document })).not.toBeNull();
  });

  it('refuses a document whose source is not one this client can produce', () => {
    // `'chrome'` is the value that reads as obvious and that `documents_source_check` rejects;
    // the schema refuses it here rather than letting the server fail the whole batch for it.
    const document = {
      url: 'https://example.com/a',
      title: '',
      content: 'x',
      language: null,
      source: 'chrome',
      wordCount: 1,
      occurredAt: '2026-09-16T09:14:02.000Z',
    };

    expect(parseRuntimeMessage({ type: 'DOCUMENT_CAPTURED', document })).toBeNull();
  });

  it('refuses a document with no content', () => {
    const document = {
      url: 'https://example.com/a',
      title: '',
      language: null,
      source: 'web',
      wordCount: 1,
      occurredAt: '2026-09-16T09:14:02.000Z',
    };

    expect(parseRuntimeMessage({ type: 'DOCUMENT_CAPTURED', document })).toBeNull();
  });
});

describe('parseContentScriptCommandValue', () => {
  it('accepts every command in the union', () => {
    const commands: unknown[] = [
      { command: 'PING' },
      { command: 'SET_CAPTURE_ENABLED', enabled: true },
      { command: 'EXTRACT_DOCUMENT' },
      { command: 'CAPTURE_SELECTION_NOW' },
      { command: 'FLUSH_WATCH_PROGRESS' },
      { command: 'RESYNC_SETTINGS' },
    ];

    for (const command of commands) {
      expect(parseContentScriptCommandValue(command), JSON.stringify(command)).not.toBeNull();
    }
  });

  it('refuses an unknown command', () => {
    expect(parseContentScriptCommandValue({ command: 'REBOOT' })).toBeNull();
  });

  it('refuses a runtime message, which is not a command', () => {
    expect(parseContentScriptCommandValue({ type: 'GET_STATUS' })).toBeNull();
  });
});
