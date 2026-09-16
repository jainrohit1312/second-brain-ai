import type { EmbeddingProviderId, ProviderHealth, ProviderUsage } from '../types';

/**
 * A source of text vectors.
 *
 * Load-bearing invariant: **vectors from different models are not
 * interchangeable.** Every call reports the `model` and `dimensions` it used,
 * both are persisted next to the vector (`document_chunks.embedding_model`,
 * `memories.embedding_model`), and similarity is only meaningful between
 * vectors produced by the same model at the same width. Mixing models inside
 * one column does not raise an error — it silently returns meaningless nearest
 * neighbours — so changing the embedding provider is a re-embedding migration,
 * not a configuration change. See `assertDimensionsMatch` in `./factory`.
 */
export interface EmbeddingProvider {
  /** Stable identifier of the backend. */
  readonly id: EmbeddingProviderId;
  /** Model name reported by the backend; persisted as provenance for every vector. */
  readonly model: string;
  /** Vector width. Must match the width of the rows already stored. */
  readonly dimensions: number;

  /**
   * Embeds a batch of texts in one round trip, returning vectors in the same
   * order as `texts` (`vectors[i]` belongs to `texts[i]`). An empty input array
   * resolves to an empty result without touching the network.
   *
   * Batched because per-call overhead dominates: chunk-level embedding of a
   * single article is thousands of calls when issued one text at a time.
   */
  embed(texts: string[], opts?: EmbedOptions): Promise<EmbeddingResult>;

  /**
   * Embeds exactly one text and returns its vector. For short interactive paths
   * such as search-box queries; document and chunk ingestion must use `embed`.
   */
  embedOne(text: string, opts?: EmbedOptions): Promise<number[]>;

  /**
   * Probes the backend with a minimal request. Implementations report failure
   * through `ProviderHealth.ok` rather than throwing, so health checks can run
   * from a status page or a startup script.
   */
  health(): Promise<ProviderHealth>;
}

/**
 * Per-call options.
 *
 * `inputType` is not cosmetic. Asymmetric retrieval models — including NVIDIA's
 * `nv-embedqa-*` family — are trained with different projections for stored
 * passages and for the query that searches them, and the provider is told which
 * one it is receiving. An adapter that needs the value must fail loudly when it
 * is omitted instead of guessing: defaulting a query to `'document'` degrades
 * recall quietly, which is the worst kind of bug here.
 */
export interface EmbedOptions {
  /** Whether the text is being stored (`'document'`) or searched with (`'query'`). */
  inputType?: 'query' | 'document';
  /** Texts per provider request. Defaults to the adapter's own limit. */
  batchSize?: number;
}

/** One embedding call's output. `dimensions` is the width of every vector in `vectors`. */
export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dimensions: number;
  usage: ProviderUsage;
}

/**
 * The per-provider entry of `EMBEDDING_PROVIDER_DEFAULTS`: everything the
 * factory needs to build a provider with no overrides. Defined once per adapter
 * file and re-exported by the factory, so the table cannot drift from the
 * adapters it describes.
 */
export interface EmbeddingProviderDefaults {
  /** Model used unless `EMBEDDING_MODEL` or an explicit override says otherwise. */
  model: string;
  /** Width of that model's output. */
  dimensions: number;
  /** Root URL of the REST API. */
  baseUrl: string;
  /** Env var holding the credential, or `null` for a backend that needs none. */
  envKey: string | null;
}
