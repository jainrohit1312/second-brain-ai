/**
 * Provider-neutral primitives shared by the embedding and LLM adapters.
 *
 * Nothing in this module depends on a vendor SDK: every adapter speaks HTTP
 * through `fetch`, so swapping a provider never changes a consumer's dependency
 * graph.
 */

/**
 * Embedding backend identifier. Stable, because it travels with the vectors it
 * produced via `embedding_model` provenance.
 */
export type EmbeddingProviderId = 'nvidia' | 'openai' | 'gemini' | 'local';

/** Chat/completion backend identifier. */
export type LlmProviderId = 'deepseek' | 'openai' | 'gemini' | 'claude' | 'qwen' | 'local';

/**
 * Fully resolved configuration for one provider instance. Assembled by the
 * factories from the provider defaults table plus caller overrides — never
 * built by hand at a call site.
 */
export interface ProviderConfig {
  /** Credential sent as `Authorization: Bearer`. `null` for local providers that need none. */
  apiKey: string | null;
  /** Root URL without a trailing slash. Each adapter appends its own path. */
  baseUrl: string;
  /** Model name sent to the provider and persisted as provenance for its output. */
  model: string;
  /** Output width, embeddings only. Resolved from the provider defaults table. */
  dimensions?: number;
  /** Budget for one attempt, in milliseconds. */
  timeoutMs: number;
  /** Retries after the first failed attempt; `0` disables retrying. */
  maxRetries: number;
}

/** Caller overrides merged over `*_PROVIDER_DEFAULTS` by the factories. */
export type ProviderOverrides = Partial<ProviderConfig>;

/**
 * Read-only view of a process environment (`process.env`, or a filtered
 * `Deno.env` in a Supabase edge function). Unset keys are absent rather than
 * empty, so `env.FOO === undefined` and `env.FOO === ''` stay distinguishable:
 * the latter is a set-but-blank value the factories reject.
 */
export type ProviderEnv = Readonly<Record<string, string | undefined>>;

/** Token accounting for one provider call. `costUsd` is `null` for unpriced models. */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

/** Result of a cheap liveness probe. `checkedAt` is an ISO-8601 UTC timestamp. */
export interface ProviderHealth {
  ok: boolean;
  latencyMs: number;
  model: string;
  checkedAt: string;
  error: string | null;
}

/** Constructor options for {@link ProviderError}. */
export interface ProviderErrorOptions {
  /** Provider id (`'nvidia'`, `'deepseek'`, …) or the subsystem raising the error. */
  provider: string;
  /** HTTP status of the failed response, or `null` when no response arrived. */
  statusCode?: number | null;
  /** Overrides the value derived from `statusCode`; see the retry contract below. */
  retryable?: boolean;
  /** The original error, preserved for logging. */
  cause?: unknown;
}

/**
 * Retry contract for the whole package.
 *
 * - `retryable` is `true` for a transport failure or timeout (no response at
 *   all), HTTP 408, HTTP 429, and any 5xx.
 * - `retryable` is `false` for every other 4xx, including 400, 401 and 403.
 *   Retrying a malformed request or an auth failure cannot succeed; it only
 *   delays the error the caller must surface anyway, and it spends the retry
 *   budget the next genuinely transient failure would need.
 */
export function isRetryableStatus(statusCode: number | null): boolean {
  if (statusCode === null) return true;
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

/**
 * The single error type thrown by every adapter, so a caller can branch on
 * `provider` and `retryable` without knowing which backend answered.
 */
export class ProviderError extends Error {
  /** Provider id or subsystem that raised the error. */
  readonly provider: string;
  /** HTTP status of the failed response, or `null` when none arrived. */
  readonly statusCode: number | null;
  /** Whether the same call may be attempted again; see `isRetryableStatus`. */
  readonly retryable: boolean;

  constructor(message: string, options: ProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.provider = options.provider;
    this.statusCode = options.statusCode ?? null;
    this.retryable = options.retryable ?? isRetryableStatus(this.statusCode);
  }
}

/** Default budget for one attempt at a provider call, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Default number of retries after the first failed attempt. */
export const DEFAULT_MAX_RETRIES = 3;

/** Base of the exponential backoff between retries, in milliseconds. */
export const RETRY_BASE_DELAY_MS = 500;
