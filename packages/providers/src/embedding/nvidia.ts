import { RETRY_BASE_DELAY_MS, ProviderError } from '../types';

import type { EmbeddingProviderId, ProviderConfig, ProviderHealth, ProviderUsage } from '../types';
import type {
  EmbedOptions,
  EmbeddingProvider,
  EmbeddingProviderDefaults,
  EmbeddingResult,
} from './interface';

/** Defaults for this provider; composed into `EMBEDDING_PROVIDER_DEFAULTS` in `./factory`. */
export const NVIDIA_EMBEDDING_DEFAULTS = {
  model: 'nvidia/nemotron-3-embed-1b',
  dimensions: 1024,
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  envKey: 'NVIDIA_API_KEY',
} as const satisfies EmbeddingProviderDefaults;

/**
 * Native output width of the pinned model, and the only `dimensions` value the endpoint accepts.
 *
 * Measured 2026-09-17: `dimensions: 1024` and `dimensions: 512` are both rejected with
 * `400 {"message":"dimensions must be one of 2048"}`. The width reduction is therefore **not** a
 * server-side parameter — it is a client-side first-k slice plus a re-normalization, which is
 * exactly what the model card describes ("supports retaining the first 1024 or 512 dimensions;
 * sliced vectors must be L2-normalized again before similarity scoring"). Verified empirically:
 * the native vector is unit-norm (1.000000) while its first-1024 slice is not (0.691104), so an
 * un-normalized slice would corrupt every cosine similarity it is used in.
 */
export const NVIDIA_NATIVE_DIMENSIONS = 2048;

/**
 * Models whose native output supports Matryoshka-style first-k slicing.
 *
 * The slice is only meaningful for a model trained that way. Slicing any other model's vector
 * silently discards information while still producing a numerically valid, shorter vector — the
 * same class of failure ADR-004 exists to prevent — so the reduction is gated on this set rather
 * than applied to whatever length comes back. Adding a model here asserts that its first-k slice
 * is a legitimate embedding and needs the same re-normalization.
 *
 * A natively 1024-wide model does *not* belong in this set: it needs no slice at all.
 */
const MATRYOSHKA_MODELS: ReadonlySet<string> = new Set(['nvidia/nemotron-3-embed-1b']);

/**
 * The only `input_type` values this model family accepts.
 *
 * `EmbedOptions.inputType` is the provider-neutral spelling (`'query' | 'document'`); this is
 * the wire spelling NVIDIA expects. The mapping is deliberately explicit rather than a
 * pass-through, because `'document'` on our side is `'passage'` on theirs and a silent
 * mismatch is exactly the asymmetry bug this provider exists to avoid.
 */
type NvidiaInputType = 'query' | 'passage';

/** One element of a successful `/embeddings` response. `index` is optional in the wild. */
interface NvidiaEmbeddingDatum {
  embedding?: number[];
  index?: number;
}

/** Shape of `POST {baseUrl}/embeddings`, narrowed to the fields this adapter reads. */
interface NvidiaEmbeddingResponse {
  data?: NvidiaEmbeddingDatum[];
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

/**
 * NVIDIA NIM embeddings — the default embedding provider (`.env.example` ships
 * `EMBEDDING_PROVIDER=nvidia`).
 *
 * Request: `POST {baseUrl}/embeddings` with an OpenAI-compatible body
 * (`{ model, input: string[], encoding_format: 'float', dimensions }`) plus NVIDIA's extra
 * `input_type` field: `'passage'` for text being stored, `'query'` for search text. The
 * asymmetry is real on this model, and omitting the field is *not* a synonym for `'passage'` —
 * measured 2026-09-17 on `nemotron-3-embed-1b`, passage-vs-query cosine is 0.809 while
 * passage-vs-omitted is 0.232. That is why `embed` refuses a call with no `inputType` rather
 * than defaulting one.
 *
 * Response: `{ data: [{ embedding: number[] }], usage: { prompt_tokens, total_tokens } }`.
 * The model is 2048-wide natively and the endpoint accepts no other `dimensions`, so a vector
 * wider than `this.dimensions` is reduced by a Matryoshka first-k slice and re-normalized (see
 * `NVIDIA_NATIVE_DIMENSIONS`). A vector *narrower* than `this.dimensions`, or one from a model
 * not listed in `MATRYOSHKA_MODELS`, is refused rather than quietly accepted — so a model or
 * width change surfaces here instead of as a `vector(1024)` insert error. See ADR-004 and
 * ADR-024 in docs/DECISIONS.md.
 *
 * Retries follow the package contract in `../types`: a transport failure, a timeout, HTTP
 * 408/429 or any 5xx is retried up to `config.maxRetries` with exponential backoff; every
 * other 4xx is surfaced immediately, because retrying a malformed request or a bad key only
 * delays the error the caller must see. The credential is never logged.
 */
export class NvidiaEmbeddingProvider implements EmbeddingProvider {
  readonly id: EmbeddingProviderId = 'nvidia';
  readonly model: string;
  readonly dimensions: number;

  /** Resolved key, base URL, timeout and retry budget. */
  protected readonly config: ProviderConfig;

  /** Prefer `createEmbeddingProvider('nvidia')`, which applies defaults and overrides. */
  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.model;
    this.dimensions = config.dimensions ?? NVIDIA_EMBEDDING_DEFAULTS.dimensions;
  }

  /**
   * Embeds a batch, preserving input order. Splits on `opts.batchSize` when the
   * caller knows the request-size ceiling; `opts.inputType` becomes
   * `input_type` and is **required** here.
   *
   * @throws ProviderError with `retryable: false` when `inputType` is missing — see the class
   *   note — or when the provider returns a vector of the wrong width.
   */
  async embed(texts: string[], opts: EmbedOptions = {}): Promise<EmbeddingResult> {
    const inputType = resolveInputType(this.id, opts.inputType);

    if (texts.length === 0) {
      return {
        vectors: [],
        model: this.model,
        dimensions: this.dimensions,
        usage: emptyUsage(),
      };
    }

    const batchSize = opts.batchSize && opts.batchSize > 0 ? opts.batchSize : texts.length;
    const vectors: number[][] = [];
    const usage = emptyUsage();

    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const result = await this.requestBatch(batch, inputType);
      vectors.push(...result.vectors);
      usage.inputTokens += result.usage.inputTokens;
      usage.totalTokens += result.usage.totalTokens;
    }

    return { vectors, model: this.model, dimensions: this.dimensions, usage };
  }

  /** Embeds one text. Intended for interactive queries only; see the interface. */
  async embedOne(text: string, opts: EmbedOptions = {}): Promise<number[]> {
    const result = await this.embed([text], opts);
    const [vector] = result.vectors;
    if (vector === undefined) {
      throw new ProviderError('NVIDIA returned no vector for a single-text request.', {
        provider: this.id,
        retryable: false,
      });
    }
    return vector;
  }

  /** Times a one-token `/embeddings` call. Reports failure as `ok: false`, never throws. */
  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();

    try {
      // `'query'` rather than `'passage'`: a probe should read as little like real corpus
      // traffic as possible, and both branches cost the same single token.
      await this.embedOne('health', { inputType: 'query', batchSize: 1 });
      return { ok: true, latencyMs: Date.now() - startedAt, model: this.model, checkedAt, error: null };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        model: this.model,
        checkedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Retries one batch while the failure is retryable and the budget allows. */
  private async requestBatch(
    texts: string[],
    inputType: NvidiaInputType,
  ): Promise<{ vectors: number[][]; usage: ProviderUsage }> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(texts, inputType);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof ProviderError && error.retryable;
        if (!retryable || attempt === this.config.maxRetries) break;
        await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }

    throw lastError instanceof ProviderError
      ? lastError
      : new ProviderError('NVIDIA embeddings request failed.', {
          provider: this.id,
          statusCode: null,
          retryable: true,
          cause: lastError,
        });
  }

  /** One HTTP attempt, bounded by `config.timeoutMs` through an abort signal. */
  private async requestOnce(
    texts: string[],
    inputType: NvidiaInputType,
  ): Promise<{ vectors: number[][]; usage: ProviderUsage }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${trimTrailingSlash(this.config.baseUrl)}/embeddings`, {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify({
          input: texts,
          model: this.model,
          input_type: inputType,
          encoding_format: 'float',
          // The model's native width, and the endpoint's only accepted value (1024 and 512 are
          // both rejected with a 400). Reducing to `this.dimensions` is a client-side slice,
          // not a server-side parameter — see `NVIDIA_NATIVE_DIMENSIONS`.
          dimensions: NVIDIA_NATIVE_DIMENSIONS,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // The body is the provider's own explanation of the failure and is what makes a 4xx
        // actionable; it is safe to include because the credential travels in a header, never
        // in the payload or the URL.
        const body = await readBodySafely(response);
        throw new ProviderError(
          `NVIDIA embeddings request failed with HTTP ${response.status}${body ? `: ${body}` : ''}`,
          { provider: this.id, statusCode: response.status },
        );
      }

      return this.parseResponse((await response.json()) as NvidiaEmbeddingResponse, texts.length);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      // A thrown fetch is a transport failure or the abort above. Both are retryable: no
      // response arrived, which is the `statusCode: null` branch of `isRetryableStatus`.
      throw new ProviderError('NVIDIA embeddings request failed: transport error or timeout.', {
        provider: this.id,
        statusCode: null,
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Headers for one attempt. The key is attached here and nowhere else. */
  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.config.apiKey !== null && this.config.apiKey !== '') {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  /** Maps the provider envelope onto `EmbeddingResult`'s pieces, validating shape and width. */
  private parseResponse(
    payload: NvidiaEmbeddingResponse,
    expectedCount: number,
  ): { vectors: number[][]; usage: ProviderUsage } {
    const data = payload.data;
    if (!Array.isArray(data) || data.length !== expectedCount) {
      throw new ProviderError(
        `NVIDIA returned ${Array.isArray(data) ? data.length : 'no'} embeddings for ` +
          `${expectedCount} input(s).`,
        { provider: this.id, retryable: false },
      );
    }

    // `index` is part of the OpenAI-compatible envelope and NVIDIA sets it. Sorting on it
    // when present keeps `vectors[i]` bound to `texts[i]` even if the provider reorders.
    const ordered =
      data.every((datum) => typeof datum.index === 'number')
        ? [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        : data;

    const vectors = ordered.map((datum, position) => {
      const embedding = datum.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new ProviderError(`NVIDIA returned no vector for input ${position}.`, {
          provider: this.id,
          retryable: false,
        });
      }
      return reduceToDimensions(this.id, this.model, embedding, this.dimensions);
    });

    const inputTokens = payload.usage?.prompt_tokens ?? payload.usage?.total_tokens ?? 0;
    return {
      vectors,
      usage: {
        inputTokens,
        // Embeddings produce no generated tokens; the field exists for the shared usage shape.
        outputTokens: 0,
        totalTokens: payload.usage?.total_tokens ?? inputTokens,
        costUsd: null,
      },
    };
  }
}

/** Resolves the caller's `inputType` onto the wire value, refusing to guess. See the class note. */
function resolveInputType(
  provider: EmbeddingProviderId,
  inputType: EmbedOptions['inputType'],
): NvidiaInputType {
  if (inputType === 'query') return 'query';
  if (inputType === 'document') return 'passage';
  throw new ProviderError(
    "NvidiaEmbeddingProvider.embed requires opts.inputType: 'query' for search text, " +
      "'document' for text being stored. The pinned model is asymmetric — and an omitted " +
      "input_type is a third, different projection, not a synonym for 'passage' — so a " +
      'default would degrade recall silently rather than fail.',
    { provider, retryable: false },
  );
}

/** Strips trailing slashes so `${baseUrl}/embeddings` never doubles a separator. */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * L2-normalizes a vector, so cosine similarity is a plain dot product.
 *
 * @throws ProviderError on a zero (or non-finite) norm, which carries no direction: dividing by
 *   it would produce `NaN`/`Infinity` and poison the column rather than fail.
 */
export function l2Normalize(vector: readonly number[]): number[] {
  let squared = 0;
  for (const value of vector) squared += value * value;

  const norm = Math.sqrt(squared);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new ProviderError(
      'Refusing to normalize an embedding whose norm is zero or non-finite: it carries no ' +
        'direction, so dividing by its norm would write NaN into the vector column.',
      { provider: 'nvidia', retryable: false },
    );
  }
  return vector.map((value) => value / norm);
}

/**
 * Matryoshka reduction: keep the first `targetDims` elements and re-normalize.
 *
 * The re-normalization is not optional. The model returns a unit vector, but its first-k slice
 * is not one — measured 0.691104 for k=1024 of a 2048-wide vector — and a non-unit vector makes
 * cosine similarity disagree with pgvector's `<=>` operator about scale.
 */
export function sliceAndNormalize(vector: readonly number[], targetDims: number): number[] {
  return l2Normalize(vector.slice(0, targetDims));
}

/**
 * Reduces a provider vector to the configured width, and refuses the cases that are not a
 * reduction. The three branches are the policy, not an implementation detail:
 *
 * - **equal width** — returned as-is; there is nothing to do.
 * - **wider, and the model is Matryoshka-trained** — first-k slice, then normalize.
 * - **anything else** — refused. A narrower vector cannot be widened, and slicing a model that
 *   was never trained for it discards information while still producing a numerically valid
 *   vector, which is the silent-corruption case ADR-004 exists to prevent.
 */
function reduceToDimensions(
  provider: EmbeddingProviderId,
  model: string,
  embedding: number[],
  dimensions: number,
): number[] {
  if (embedding.length === dimensions) return embedding;

  if (embedding.length > dimensions && MATRYOSHKA_MODELS.has(model)) {
    const reduced = sliceAndNormalize(embedding, dimensions);
    if (reduced.length !== dimensions) {
      throw new ProviderError(
        `Matryoshka reduction produced ${reduced.length} dimensions, expected ${dimensions}.`,
        { provider, retryable: false },
      );
    }
    return reduced;
  }

  throw new ProviderError(
    `NVIDIA returned a ${embedding.length}-dimensional vector, but ${model} is configured for ` +
      `${dimensions}. Stored vectors would be incomparable; switching width or model is a ` +
      're-embed migration (ADR-004). Reduction is only applied to models trained for it ' +
      '(MATRYOSHKA_MODELS), and a narrower vector cannot be widened.',
    { provider, retryable: false },
  );
}

/** Reads an error body without letting a second failure mask the first. */
async function readBodySafely(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500).trim();
  } catch {
    return '';
  }
}

/** A usage record with nothing counted yet; the result of a call with no inputs. */
function emptyUsage(): ProviderUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: null };
}

/** Backoff helper. Kept local so the retry loop reads as one piece. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
