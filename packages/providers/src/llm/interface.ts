import type { LlmProviderId, ProviderHealth, ProviderUsage } from '../types';
import type { ZodType } from 'zod';

/** One turn of a chat. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * A completion request in provider-neutral terms.
 *
 * `system` is the preferred way to carry instructions. A `system` message is
 * also accepted, but adapters for APIs that model the system prompt as a
 * top-level field (Claude, Gemini) must hoist it out of the message list, and
 * only one of the two forms is used per request.
 */
export interface CompletionRequest {
  messages: ChatMessage[];
  /**
   * Sampling temperature. Every structured task — classification, distillation,
   * importance scoring — must pass `0`: determinism is what makes re-running
   * distillation over the same chunks idempotent and its output comparable.
   * Conversational synthesis is the only caller allowed to raise it.
   */
  temperature?: number;
  /** Upper bound on generated tokens. Adapters apply a per-provider default. */
  maxTokens?: number;
  /** Sequences that end generation. */
  stop?: string[];
  /** System prompt; see the note above on which of the two forms to use. */
  system?: string;
}

/** A finished completion. `latencyMs` is measured around the whole call. */
export interface CompletionResult {
  content: string;
  finishReason: 'stop' | 'length' | 'error';
  usage: ProviderUsage;
  model: string;
  latencyMs: number;
}

/** One streamed chunk. The terminal delta has `done: true` and usually empty `text`. */
export interface CompletionDelta {
  text: string;
  done: boolean;
}

/** A completion whose output must satisfy `schema`. */
export interface JsonCompletionRequest<T> extends CompletionRequest {
  /** Schema the parsed response is validated against before it is returned. */
  schema: ZodType<T>;
  /** Extra attempts after a schema violation; defaults to the config's retry budget. */
  retries?: number;
}

/**
 * A chat/completion backend.
 *
 * Adapters are thin: they own request/response translation, the timeout, and
 * the retry decision. They own no prompts — prompt construction belongs to the
 * caller in `services/processing`, which is also where a provider-specific quirk
 * should not leak.
 */
export interface LlmProvider {
  /** Stable identifier of the backend. */
  readonly id: LlmProviderId;
  /** Model name sent to the provider and recorded with everything it produced. */
  readonly model: string;

  /** Runs one request and returns the complete answer with its usage and latency. */
  complete(request: CompletionRequest): Promise<CompletionResult>;

  /**
   * Streams a completion. Backs the chat UI, so it must stop generating when
   * `signal` aborts — including mid-response, where the adapter has to cancel
   * the underlying `fetch` body reader and not merely stop yielding.
   */
  stream(request: CompletionRequest, signal?: AbortSignal): AsyncIterable<CompletionDelta>;

  /**
   * The workhorse for classification and distillation: completes, extracts JSON
   * from the response, and validates it against `request.schema`.
   *
   * A schema violation is retried (up to `request.retries`) rather than thrown,
   * because a model that emits one malformed field usually succeeds on a
   * re-ask. Validation is local on purpose: native JSON modes vary by provider,
   * by model within a provider, and by server build for the local one, so the
   * schema — not the provider's promise — is what the caller can rely on.
   *
   * Exhausting the retries rejects with `ProviderError` (`retryable: false`): a
   * response that never satisfied the schema is a prompt or model problem, not a
   * transient one, so it must not be re-tried at the queue level.
   */
  completeJson<T>(request: JsonCompletionRequest<T>): Promise<T>;

  /**
   * Probes the backend with a minimal request. Implementations report failure
   * through `ProviderHealth.ok` rather than throwing.
   */
  health(): Promise<ProviderHealth>;
}

/**
 * The per-provider entry of `LLM_PROVIDER_DEFAULTS`: everything the factory needs
 * to build a provider with no overrides, plus the facts the README matrix and
 * `isStructuredTaskSafe` are derived from.
 */
export interface LlmProviderDefaults {
  /**
   * Default model name. An empty string means the provider has no usable
   * default (a local server's model list is machine-specific) and the model
   * must come from the environment or an explicit override.
   */
  model: string;
  /** Root URL of the API; adapters append their own path. */
  baseUrl: string;
  /** Env var holding the credential, or `null` for a local server. */
  envKey: string | null;
  /**
   * Context window in tokens as documented by the provider at the time of
   * writing. Used for budget estimation, not enforcement — verify before
   * relying on it.
   */
  contextWindowTokens: number;
  /** Whether `{baseUrl}/chat/completions` follows the OpenAI request/response shape. */
  openAiCompatible: boolean;
}
