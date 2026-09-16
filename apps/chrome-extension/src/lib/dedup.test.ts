import { describe, expect, it } from 'vitest';

import { DEDUPE_KEY_MAX_LENGTH, DEDUPE_KEY_MIN_LENGTH, RecentKeyRing, contentDedupeKey } from './dedup';

import type { ContentDedupeInput } from './dedup';

/**
 * Contract tests for the client-side deduplication layer.
 *
 * What matters is the two properties the queue depends on: the same content must produce
 * the same key (so a retried capture collapses instead of double-writing), different
 * content must not collide (so two articles are not silently merged), and every key must
 * land inside the bounds the ingestion API enforces.
 */

const ARTICLE = 'https://example.com/deep-dive?utm_source=newsletter#section-2';

function input(overrides: Partial<ContentDedupeInput> = {}): ContentDedupeInput {
  return {
    type: 'page_view',
    url: ARTICLE,
    title: 'A Deep Dive',
    text: 'The body of the article, long enough to hash meaningfully.',
    occurredAt: '2026-09-16T09:15:30.000Z',
    ...overrides,
  };
}

describe('contentDedupeKey', () => {
  it('is stable for identical input', () => {
    expect(contentDedupeKey(input())).toBe(contentDedupeKey(input()));
  });

  it('collapses two captures of the same content inside one minute bucket', () => {
    const first = input({ occurredAt: '2026-09-16T09:15:01.000Z' });
    const second = input({ occurredAt: '2026-09-16T09:15:59.000Z' });

    expect(contentDedupeKey(first)).toBe(contentDedupeKey(second));
  });

  it('separates captures of the same page in different minutes', () => {
    const first = input({ occurredAt: '2026-09-16T09:15:59.000Z' });
    const second = input({ occurredAt: '2026-09-16T09:16:01.000Z' });

    expect(contentDedupeKey(first)).not.toBe(contentDedupeKey(second));
  });

  it('separates different content on the same page', () => {
    expect(contentDedupeKey(input({ text: 'first body' }))).not.toBe(
      contentDedupeKey(input({ text: 'a completely different body' })),
    );
  });

  it('separates event types for the same page', () => {
    expect(contentDedupeKey(input({ type: 'page_view' }))).not.toBe(
      contentDedupeKey(input({ type: 'page_read' })),
    );
  });

  it('canonicalizes tracking parameters out of the identity', () => {
    const tracked = input({ url: 'https://example.com/deep-dive?utm_source=newsletter#section-2' });
    const bare = input({ url: 'https://example.com/deep-dive' });

    expect(contentDedupeKey(tracked)).toBe(contentDedupeKey(bare));
  });

  it('stays inside the length bounds the server enforces, for every shape of input', () => {
    const shapes: ContentDedupeInput[] = [
      input(),
      input({ url: null, title: null, text: null }),
      input({ url: null, title: 'Title only', text: null }),
      input({ type: 'youtube_watch', url: 'https://youtube.com/watch?v=abc', text: null }),
      input({ occurredAt: 'not-a-timestamp' }),
    ];

    for (const shape of shapes) {
      const key = contentDedupeKey(shape);
      expect(key.length).toBeGreaterThanOrEqual(DEDUPE_KEY_MIN_LENGTH);
      expect(key.length).toBeLessThanOrEqual(DEDUPE_KEY_MAX_LENGTH);
    }
  });
});

describe('RecentKeyRing', () => {
  it('reports keys it has been given and nothing else', () => {
    const ring = new RecentKeyRing(4);

    ring.add('a');

    expect(ring.has('a')).toBe(true);
    expect(ring.has('b')).toBe(false);
  });

  it('evicts the least recently used key once capacity is exceeded', () => {
    const ring = new RecentKeyRing(2);

    ring.add('a');
    ring.add('b');
    ring.add('c');

    expect(ring.has('a')).toBe(false);
    expect(ring.has('b')).toBe(true);
    expect(ring.has('c')).toBe(true);
    expect(ring.size).toBe(2);
  });

  it('counts a lookup as use, so a re-read key survives eviction', () => {
    const ring = new RecentKeyRing(2);

    ring.add('a');
    ring.add('b');
    expect(ring.has('a')).toBe(true);

    ring.add('c');

    expect(ring.has('a')).toBe(true);
    expect(ring.has('b')).toBe(false);
  });

  it('does not grow when the same key is added repeatedly', () => {
    const ring = new RecentKeyRing(1);

    ring.add('a');
    ring.add('a');
    ring.add('a');

    expect(ring.size).toBe(1);
    expect(ring.has('a')).toBe(true);
  });

  it('holds nothing at capacity zero', () => {
    const ring = new RecentKeyRing(0);

    ring.add('a');

    expect(ring.has('a')).toBe(false);
    expect(ring.size).toBe(0);
  });

  it('empties on clear', () => {
    const ring = new RecentKeyRing(4);
    ring.add('a');
    ring.add('b');

    ring.clear();

    expect(ring.has('a')).toBe(false);
    expect(ring.has('b')).toBe(false);
    expect(ring.size).toBe(0);
  });
});
