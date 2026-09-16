import type { EmbeddingProviderId, ProviderConfig, ProviderHealth } from '../types';
import type {
  EmbedOptions,
  EmbeddingProvider,
  EmbeddingProviderDefaults,
  EmbeddingResult,
} from './interface';

/**
 * Defaults for this provider; composed into `EMBEDDING_PROVIDER_DEFAULTS` in `./factory`.
 * `envKey` is `null`: a local server needs no credential.
 */
export const LOCAL_EMBEDDING_DEFAULTS = {
  model: 'nomic-embed-text',
  dimensions: 768,
  baseUrl: 'http://127.0.0.1:11434/v1',
  envKey: null,
} as const satisfies EmbeddingProviderDefaults;

/**
 * Embeddings from a local server — Ollama or LM Studio exposing an
 * OpenAI-compatible `/v1/embeddings` on `http://127.0.0.1:11434/v1`.
 *
 * The trade-off is real and should not be papered over: text never leaves the
 * machine and there is no per-call cost, but the width and the retrieval
 * quality both differ from the hosted models we default to. Switching to this
 * provider is therefore a **re-embedding migration** — every stored vector must
 * be recomputed and every persisted `embedding_model` updated — not a
 * configuration change. It is the right choice for an offline or
 * privacy-sensitive deployment, and the wrong one for a silent local fallback
 * when a hosted provider fails.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id: EmbeddingProviderId = 'local';
  readonly model: string;
  readonly dimensions: number;

  /** Resolved base URL, timeout and retry budget (`apiKey` is normally `null`). */
  protected readonly config: ProviderConfig;

  /** Prefer `createEmbeddingProvider('local')`, which applies defaults and overrides. */
  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.model;
    this.dimensions = config.dimensions ?? LOCAL_EMBEDDING_DEFAULTS.dimensions;
  }

  /**
   * Embeds a batch, preserving input order. Local servers are single-process and
   * serialise work, so `opts.batchSize` trades throughput against the memory the
   * server needs for one request. `opts.inputType` is accepted and ignored:
   * local embedding models are symmetric.
   */
  async embed(_texts: string[], _opts?: EmbedOptions): Promise<EmbeddingResult> {
    // TODO(phase-2): POST `${this.config.baseUrl}/embeddings` (OpenAI-compatible),
    // strip a trailing slash from the base URL, honour the timeout/retry
    // contract, and map the response into `EmbeddingResult`.
    throw new Error('Not implemented: LocalEmbeddingProvider.embed');
  }

  /** Embeds one text. Intended for interactive queries only; see the interface. */
  async embedOne(_text: string, _opts?: EmbedOptions): Promise<number[]> {
    // TODO(phase-2): single-item wrapper over `embed`.
    throw new Error('Not implemented: LocalEmbeddingProvider.embedOne');
  }

  /**
   * Reports `ok: false` when the server is not listening. Never throws: an
   * unreachable local server is an expected state, not an exception.
   */
  async health(): Promise<ProviderHealth> {
    // TODO(phase-2): probe `${baseUrl}/models` with a short timeout so a
    // down server fails fast instead of waiting for the full request timeout.
    throw new Error('Not implemented: LocalEmbeddingProvider.health');
  }
}
