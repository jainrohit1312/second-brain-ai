import type { LlmProviderId, ProviderConfig, ProviderHealth } from '../types';
import type {
  CompletionDelta,
  CompletionRequest,
  CompletionResult,
  JsonCompletionRequest,
  LlmProvider,
  LlmProviderDefaults,
} from './interface';

/**
 * Defaults for this provider; composed into `LLM_PROVIDER_DEFAULTS` in `./factory`.
 *
 * `model` is empty on purpose: a local server's model list is machine-specific,
 * so `LOCAL_LLM_MODEL` (or an explicit override) must supply it and
 * `llmProviderFromEnv` throws when it is missing. `envKey` is `null` because
 * Ollama ignores credentials — LM Studio rejects a missing key on some builds,
 * so the adapter sends a placeholder bearer token rather than nothing.
 * `contextWindowTokens` is a conservative assumption; the real window depends on
 * the model and the server's `num_ctx`.
 */
export const LOCAL_LLM_DEFAULTS = {
  model: '',
  baseUrl: 'http://127.0.0.1:11434/v1',
  envKey: null,
  contextWindowTokens: 8_192,
  openAiCompatible: true,
} as const satisfies LlmProviderDefaults;

/**
 * A local inference server — Ollama or vLLM exposing `/v1/chat/completions` on
 * `http://127.0.0.1:11434/v1` by default, overridable with `LOCAL_LLM_BASE_URL`.
 *
 * Same request/response shape as OpenAI. Useful for offline work, for bulk
 * distillation that should not cost per token, and for text whose content must
 * not leave the machine.
 *
 * Quality is the caveat, and it is the caller's decision, not something the
 * adapter hides: a local model is a worse classifier and a worse distiller than
 * the hosted defaults, and its JSON output is unreliable. `isStructuredTaskSafe`
 * therefore reports `false` for this provider, and prompts that assume strict
 * JSON should be validated by `completeJson` and kept on a hosted provider.
 */
export class LocalLlmProvider implements LlmProvider {
  readonly id: LlmProviderId = 'local';
  readonly model: string;

  /** Resolved base URL, timeout and retry budget (`apiKey` is normally `null`). */
  protected readonly config: ProviderConfig;

  /** Prefer `createLlmProvider('local')`, which applies defaults and overrides. */
  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.model;
  }

  /**
   * One non-streaming completion. Serialised by the server, so concurrency here
   * buys nothing and the caller should batch rather than parallelise.
   */
  async complete(_request: CompletionRequest): Promise<CompletionResult> {
    // TODO(phase-2): POST `${this.config.baseUrl}/chat/completions`, strip a
    // trailing slash from the base URL, send a placeholder bearer token when
    // `apiKey` is null, honour the timeout/retry contract, and map the response
    // into `CompletionResult`.
    throw new Error('Not implemented: LocalLlmProvider.complete');
  }

  /**
   * Streams `delta.content` frames and stops at `[DONE]`. Aborting `signal` must
   * cancel the response body so the server can free the model.
   */
  stream(_request: CompletionRequest, _signal?: AbortSignal): AsyncIterable<CompletionDelta> {
    // TODO(phase-2): POST with `stream: true`, parse the SSE frames, yield
    // `{ text, done: false }` per delta and one `{ text: '', done: true }` at the
    // end, wiring the caller's `signal` into the fetch abort.
    throw new Error('Not implemented: LocalLlmProvider.stream');
  }

  /**
   * Parses and validates against `request.schema`, re-asking on a violation.
   * Local servers vary in how faithfully they honour JSON mode, which is why the
   * retry path here is the expected one rather than the exception.
   */
  async completeJson<T>(_request: JsonCompletionRequest<T>): Promise<T> {
    // TODO(phase-2): call `complete` with a JSON instruction (and a JSON-mode
    // flag only if the server build advertises support), extract the object,
    // validate with `schema.safeParse`, and retry up to `request.retries`.
    throw new Error('Not implemented: LocalLlmProvider.completeJson');
  }

  /**
   * Reports `ok: false` when the server is not listening. Never throws: a
   * stopped local server is an expected state, not an exception.
   */
  async health(): Promise<ProviderHealth> {
    // TODO(phase-2): probe `${baseUrl}/models` with a short timeout so a down
    // server fails fast, and report `{ ok, latencyMs, model, checkedAt, error }`.
    throw new Error('Not implemented: LocalLlmProvider.health');
  }
}
