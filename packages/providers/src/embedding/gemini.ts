import type { EmbeddingProviderId, ProviderConfig, ProviderHealth } from '../types';
import type {
  EmbedOptions,
  EmbeddingProvider,
  EmbeddingProviderDefaults,
  EmbeddingResult,
} from './interface';

/** Defaults for this provider; composed into `EMBEDDING_PROVIDER_DEFAULTS` in `./factory`. */
export const GEMINI_EMBEDDING_DEFAULTS = {
  model: 'text-embedding-004',
  dimensions: 768,
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  envKey: 'GEMINI_API_KEY',
} as const satisfies EmbeddingProviderDefaults;

/**
 * Google Gemini embeddings (`text-embedding-004` by default). Bespoke REST
 * shape, not OpenAI-compatible.
 *
 * Endpoints: `POST {baseUrl}/models/{model}:embedContent` for one text and
 * `POST {baseUrl}/models/{model}:batchEmbedContents` for many. The batch call
 * carries `{ requests: [{ model, content: { parts: [{ text }] }, taskType }] }`
 * and accepts **at most 100 requests per call** — which is exactly what
 * `opts.batchSize` exists to respect. Responses come back as
 * `{ embeddings: [{ values: number[] }] }`.
 *
 * Gemini's `taskType` is the same concept as `EmbedOptions.inputType`:
 * `'RETRIEVAL_DOCUMENT'` for stored text, `'RETRIEVAL_QUERY'` for searches.
 * The credential goes in the `x-goog-api-key` header (or `?key=`), not
 * `Authorization: Bearer`.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly id: EmbeddingProviderId = 'gemini';
  readonly model: string;
  readonly dimensions: number;

  /** Resolved key, base URL, timeout and retry budget. */
  protected readonly config: ProviderConfig;

  /** Prefer `createEmbeddingProvider('gemini')`, which applies defaults and overrides. */
  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.model;
    this.dimensions = config.dimensions ?? GEMINI_EMBEDDING_DEFAULTS.dimensions;
  }

  /**
   * Embeds a batch, preserving input order, via `:batchEmbedContents`. Chunks
   * the input into groups of at most 100 (or `opts.batchSize`, whichever is
   * smaller) and translates `opts.inputType` into `taskType`.
   */
  async embed(_texts: string[], _opts?: EmbedOptions): Promise<EmbeddingResult> {
    // TODO(phase-2): POST `${this.config.baseUrl}/models/${this.model}:batchEmbedContents`
    // with `requests` chunked at 100, map `inputType` to `taskType`, honour the
    // timeout/retry contract, and map the response into `EmbeddingResult`.
    throw new Error('Not implemented: GeminiEmbeddingProvider.embed');
  }

  /** Embeds one text via `:embedContent`. Intended for interactive queries only. */
  async embedOne(_text: string, _opts?: EmbedOptions): Promise<number[]> {
    // TODO(phase-2): POST `:embedContent` with a single `content.parts[0].text`.
    throw new Error('Not implemented: GeminiEmbeddingProvider.embedOne');
  }

  /** Times a one-token `:embedContent` call. Reports failure as `ok: false`, never throws. */
  async health(): Promise<ProviderHealth> {
    // TODO(phase-2): measure latency of a minimal embed call and report
    // `{ ok, latencyMs, model, checkedAt, error }`.
    throw new Error('Not implemented: GeminiEmbeddingProvider.health');
  }
}
