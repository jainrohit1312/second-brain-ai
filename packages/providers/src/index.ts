/**
 * `@second-brain/providers` — every embedding and LLM adapter behind two
 * interfaces.
 *
 * Consumers import from this barrel only: the concrete adapter classes are
 * intentionally not exported, so a caller cannot pin itself to a vendor shape
 * that the package is meant to hide. Get an instance from `createEmbeddingProvider`
 * / `createLlmProvider`, or from the `*FromEnv` helpers in a service's bootstrap.
 */

export {
  assertDimensionsMatch,
  createEmbeddingProvider,
  embeddingProviderFromEnv,
  EMBEDDING_PROVIDER_DEFAULTS,
} from './embedding/factory';
export {
  createLlmProvider,
  isStructuredTaskSafe,
  llmProviderFromEnv,
  LLM_PROVIDER_DEFAULTS,
} from './llm/factory';
export {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  isRetryableStatus,
  ProviderError,
  RETRY_BASE_DELAY_MS,
} from './types';

export type {
  EmbedOptions,
  EmbeddingProvider,
  EmbeddingProviderDefaults,
  EmbeddingResult,
} from './embedding/interface';
export type {
  ChatMessage,
  CompletionDelta,
  CompletionRequest,
  CompletionResult,
  JsonCompletionRequest,
  LlmProvider,
  LlmProviderDefaults,
} from './llm/interface';
export type {
  EmbeddingProviderId,
  LlmProviderId,
  ProviderConfig,
  ProviderEnv,
  ProviderErrorOptions,
  ProviderHealth,
  ProviderOverrides,
  ProviderUsage,
} from './types';
