import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderError } from '../types';

import {
  NVIDIA_EMBEDDING_DEFAULTS,
  NVIDIA_NATIVE_DIMENSIONS,
  NvidiaEmbeddingProvider,
  l2Normalize,
  sliceAndNormalize,
} from './nvidia';

import type { ProviderConfig } from '../types';

/**
 * Contract tests for the NVIDIA embedding adapter.
 *
 * What matters is the wire contract, not the HTTP plumbing: `input_type` must travel and must be
 * `'passage'` for stored text, the request must ask for the model's native width (the endpoint
 * rejects any other `dimensions`), a 2048-wide response must come back as a *re-normalized*
 * 1024-wide vector, and an auth failure must be non-retryable so a caller does not spend its
 * retry budget on a key that will never work.
 */

const API_KEY = 'nvapi-unit-test-key';

/** Builds a provider with no retries and a short timeout, so a failure test never waits. */
function provider(overrides: Partial<ProviderConfig> = {}): NvidiaEmbeddingProvider {
  return new NvidiaEmbeddingProvider({
    apiKey: API_KEY,
    baseUrl: NVIDIA_EMBEDDING_DEFAULTS.baseUrl,
    model: NVIDIA_EMBEDDING_DEFAULTS.model,
    dimensions: NVIDIA_EMBEDDING_DEFAULTS.dimensions,
    timeoutMs: 1_000,
    maxRetries: 0,
    ...overrides,
  });
}

/** A well-formed vector at the configured width (1024), already unit-norm in shape. */
function vector(): number[] {
  return new Array<number>(NVIDIA_EMBEDDING_DEFAULTS.dimensions).fill(0.1);
}

/** Euclidean norm, for asserting the re-normalization actually happened. */
function norm(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

/**
 * A 2048-wide vector whose first 1024 elements have norm 96 (each element is 3), so a correct
 * slice-and-normalize is exactly 3/96 per element — a value a "just slice it" bug cannot produce.
 */
function nativeVector(): number[] {
  return [...new Array<number>(1024).fill(3), ...new Array<number>(1024).fill(0)];
}

/** A successful `/embeddings` response carrying the given vectors, in order. */
function okResponseWith(embeddings: number[][], promptTokens = 4): Response {
  return new Response(
    JSON.stringify({
      data: embeddings.map((embedding, index) => ({ index, embedding })),
      usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** A successful `/embeddings` response for the given number of inputs. */
function okResponse(count: number, promptTokens = 4): Response {
  return new Response(
    JSON.stringify({
      data: Array.from({ length: count }, (_, index) => ({ index, embedding: vector() })),
      usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Reads the JSON body of the first call the mock recorded. */
function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NvidiaEmbeddingProvider.embed', () => {
  it('returns one vector per input, at the pinned width and order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(2));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().embed(['alpha', 'beta'], { inputType: 'document' });

    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toHaveLength(1024);
    expect(result.vectors[1]).toHaveLength(1024);
    expect(result.dimensions).toBe(1024);
    expect(result.model).toBe(NVIDIA_EMBEDDING_DEFAULTS.model);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends `input_type: passage` for stored text and `query` for search text', async () => {
    // A Response body can only be read once, so each call needs its own.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse(1)));
    vi.stubGlobal('fetch', fetchMock);

    await provider().embed(['stored'], { inputType: 'document' });
    expect(bodyOf(fetchMock).input_type).toBe('passage');

    fetchMock.mockClear();
    await provider().embedOne('searched', { inputType: 'query' });
    expect(bodyOf(fetchMock).input_type).toBe('query');
  });

  it('never places the credential in the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(1));
    vi.stubGlobal('fetch', fetchMock);

    await provider().embed(['alpha'], { inputType: 'query' });

    expect(JSON.stringify(bodyOf(fetchMock))).not.toContain(API_KEY);
  });

  it('rejects a call without `inputType` instead of defaulting it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(provider().embed(['alpha'], {})).rejects.toMatchObject({
      name: 'ProviderError',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a 401 as a non-retryable ProviderError carrying the status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const failure = await provider()
      .embed(['alpha'], { inputType: 'query' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({ statusCode: 401, retryable: false });
  });

  it('classifies a 5xx as retryable so a caller knows the budget is worth spending', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(provider().embed(['alpha'], { inputType: 'query' })).rejects.toMatchObject({
      statusCode: 503,
      retryable: true,
    });
  });

  it('rejects a vector narrower than the pinned dimensions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(provider().embed(['alpha'], { inputType: 'query' })).rejects.toMatchObject({
      name: 'ProviderError',
      retryable: false,
    });
  });

  it('resolves an empty input to an empty result without a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().embed([], { inputType: 'document' });

    expect(result.vectors).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for the model native width, never the reduced one the endpoint rejects', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse(1)));
    vi.stubGlobal('fetch', fetchMock);

    await provider().embed(['alpha'], { inputType: 'query' });

    // Measured: `dimensions: 1024` and `: 512` both return
    // 400 {"message":"dimensions must be one of 2048"}, so the reduction cannot be requested.
    expect(bodyOf(fetchMock).dimensions).toBe(NVIDIA_NATIVE_DIMENSIONS);
    expect(bodyOf(fetchMock).dimensions).not.toBe(NVIDIA_EMBEDDING_DEFAULTS.dimensions);
  });
});

describe('Matryoshka reduction', () => {
  it('slices a 2048-wide response to 1024 and re-normalizes it', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(okResponseWith([nativeVector()])));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().embed(['alpha'], { inputType: 'document' });

    const [returned] = result.vectors;
    expect(returned).toHaveLength(1024);
    expect(returned).toHaveLength(NVIDIA_EMBEDDING_DEFAULTS.dimensions);
    // The slice of a unit vector is not itself unit-norm (measured 0.691 for the real model), so
    // this is the assertion that separates "sliced" from "sliced and re-normalized".
    expect(norm(returned ?? [])).toBeCloseTo(1, 10);
    // 3 / sqrt(1024 * 9) === 3 / 96: the value only a re-normalized slice can produce.
    expect(returned?.[0]).toBeCloseTo(3 / 96, 12);
    expect(returned?.[1]).toBeCloseTo(3 / 96, 12);
  });

  it('applies the same reduction to a query embedding as to a stored one', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(okResponseWith([nativeVector()])));
    vi.stubGlobal('fetch', fetchMock);

    const returned = await provider().embedOne('alpha', { inputType: 'query' });

    expect(returned).toHaveLength(1024);
    expect(norm(returned)).toBeCloseTo(1, 10);
  });

  it('passes a vector already at the configured width through unchanged', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse(1)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().embed(['alpha'], { inputType: 'document' });

    expect(result.vectors[0]).toEqual(vector());
  });

  it('refuses to slice a model that was not trained for Matryoshka reduction', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(okResponseWith([nativeVector()])));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      provider({ model: 'nvidia/some-other-model' }).embed(['alpha'], { inputType: 'query' }),
    ).rejects.toMatchObject({ name: 'ProviderError', retryable: false });
  });
});

describe('l2Normalize / sliceAndNormalize', () => {
  it('scales a vector to unit norm', () => {
    const normalized = l2Normalize([3, 4]);

    expect(normalized).toEqual([0.6, 0.8]);
    expect(norm(normalized)).toBeCloseTo(1, 12);
  });

  it('keeps only the requested leading dimensions', () => {
    const reduced = sliceAndNormalize([1, 1, 1, 1], 2);

    expect(reduced).toHaveLength(2);
    expect(norm(reduced)).toBeCloseTo(1, 12);
  });

  it('refuses a zero-norm vector rather than writing NaN', () => {
    expect(() => l2Normalize([0, 0, 0])).toThrow(ProviderError);
  });
});
