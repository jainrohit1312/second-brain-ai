import type { EmbeddingProviderId, ProviderConfig, ProviderHealth } from '../types';
import type {
  EmbedOptions,
  EmbeddingProvider,
  EmbeddingProviderDefaults,
  EmbeddingResult,
} from './interface';

/** Defaults for this provider; composed into `EMBEDDING_PROVIDER_DEFAULTS` in `./factory`. */
export const NVIDIA_EMBEDDING_DEFAULTS = {
  model: 'nvidia/nv-embedqa-e5-v5',
  dimensions: 1024,
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  envKey: 'NVIDIA_API_KEY',
} as const satisfies EmbeddingProviderDefaults;

/**
 * NVIDIA NIM embeddings — the default embedding provider (`.env.example` ships
 * `EMBEDDING_PROVIDER=nvidia`).
 *
 * Request: `POST {baseUrl}/embeddings` with an OpenAI-compatible body
 * (`{ model, input: string[] }`) plus NVIDIA's extra `input_type` field, which
 * this model family *requires* on every call: `'passage'` for text being
 * stored, `'query'` for search text. Asymmetric retrieval is the whole point of
 * the model, and omitting the field degrades results instead of failing.
 *
 * Response: `{ data: [{ embedding: number[] }], usage: { prompt_tokens, total_tokens } }`.
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
   * `input_type` and must not be defaulted here.
   */
  async embed(_texts: string[], _opts?: EmbedOptions): Promise<EmbeddingResult> {
    // TODO(phase-2): POST `${this.config.baseUrl}/embeddings` with
    // `{ model, input: texts, input_type }`, reject a call without
    // `opts.inputType`, honour `config.timeoutMs` via AbortSignal, retry while
    // `config.maxRetries` remains and `ProviderError.retryable` is true, and map
    // the response into `EmbeddingResult` with usage from `prompt_tokens`.
    throw new Error('Not implemented: NvidiaEmbeddingProvider.embed');
  }

  /** Embeds one text. Intended for interactive queries only; see the interface. */
  async embedOne(_text: string, _opts?: EmbedOptions): Promise<number[]> {
    // TODO(phase-2): single-item wrapper over `embed`.
    throw new Error('Not implemented: NvidiaEmbeddingProvider.embedOne');
  }

  /** Times a one-token `/embeddings` call. Reports failure as `ok: false`, never throws. */
  async health(): Promise<ProviderHealth> {
    // TODO(phase-2): measure latency of a minimal embed call and report
    // `{ ok, latencyMs, model, checkedAt, error }`.
    throw new Error('Not implemented: NvidiaEmbeddingProvider.health');
  }
}
