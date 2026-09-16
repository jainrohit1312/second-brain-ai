import type { EmbeddingProviderId, ProviderConfig, ProviderHealth } from '../types';
import type {
  EmbedOptions,
  EmbeddingProvider,
  EmbeddingProviderDefaults,
  EmbeddingResult,
} from './interface';

/** Defaults for this provider; composed into `EMBEDDING_PROVIDER_DEFAULTS` in `./factory`. */
export const OPENAI_EMBEDDING_DEFAULTS = {
  model: 'text-embedding-3-small',
  dimensions: 1536,
  baseUrl: 'https://api.openai.com/v1',
  envKey: 'OPENAI_API_KEY',
} as const satisfies EmbeddingProviderDefaults;

/**
 * OpenAI embeddings (`text-embedding-3-small` by default).
 *
 * Request: `POST {baseUrl}/embeddings` with `{ model, input: string[], dimensions? }`.
 * Response: `{ data: [{ embedding: number[] }], usage: { prompt_tokens, total_tokens } }`.
 *
 * The `text-embedding-3-*` family is Matryoshka-trained, so it accepts a
 * `dimensions` parameter that truncates the vector (1536 → as low as 256, with
 * a small recall loss). The override is forwarded only when it differs from the
 * provider default, and note that it is still a provenance change: the stored
 * width and the persisted `embedding_model` must both move with it.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly id: EmbeddingProviderId = 'openai';
  readonly model: string;
  readonly dimensions: number;

  /** Resolved key, base URL, timeout and retry budget. */
  protected readonly config: ProviderConfig;

  /** Prefer `createEmbeddingProvider('openai')`, which applies defaults and overrides. */
  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.model;
    this.dimensions = config.dimensions ?? OPENAI_EMBEDDING_DEFAULTS.dimensions;
  }

  /**
   * Embeds a batch, preserving input order. OpenAI's batch ceiling is measured
   * in tokens rather than texts, so `opts.batchSize` is a safeguard against
   * oversized requests, not the only limit.
   */
  async embed(_texts: string[], _opts?: EmbedOptions): Promise<EmbeddingResult> {
    // TODO(phase-2): POST `${this.config.baseUrl}/embeddings`, forwarding
    // `dimensions` only when it differs from the provider default, honour the
    // timeout/retry contract, and map the response into `EmbeddingResult`.
    throw new Error('Not implemented: OpenAiEmbeddingProvider.embed');
  }

  /** Embeds one text. Intended for interactive queries only; see the interface. */
  async embedOne(_text: string, _opts?: EmbedOptions): Promise<number[]> {
    // TODO(phase-2): single-item wrapper over `embed`.
    throw new Error('Not implemented: OpenAiEmbeddingProvider.embedOne');
  }

  /** Times a one-token `/embeddings` call. Reports failure as `ok: false`, never throws. */
  async health(): Promise<ProviderHealth> {
    // TODO(phase-2): measure latency of a minimal embed call and report
    // `{ ok, latencyMs, model, checkedAt, error }`.
    throw new Error('Not implemented: OpenAiEmbeddingProvider.health');
  }
}
