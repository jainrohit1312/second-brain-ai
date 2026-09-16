import type { LlmProviderId, ProviderConfig, ProviderHealth } from '../types';
import type {
  CompletionDelta,
  CompletionRequest,
  CompletionResult,
  JsonCompletionRequest,
  LlmProvider,
  LlmProviderDefaults,
} from './interface';

/** Defaults for this provider; composed into `LLM_PROVIDER_DEFAULTS` in `./factory`. */
export const DEEPSEEK_LLM_DEFAULTS = {
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1',
  envKey: 'DEEPSEEK_API_KEY',
  contextWindowTokens: 64_000,
  openAiCompatible: true,
} as const satisfies LlmProviderDefaults;

/**
 * DeepSeek — the default LLM provider (`.env.example` ships `LLM_PROVIDER=deepseek`).
 *
 * OpenAI-compatible shape: `POST {baseUrl}/chat/completions` with
 * `{ model, messages, temperature, max_tokens, stop, stream }`, answering with
 * `{ choices: [{ message: { content }, finish_reason }], usage: { prompt_tokens,
 * completion_tokens, total_tokens } }`. The `/v1` suffix in the base URL selects
 * the compatibility surface; DeepSeek's native API lives at the bare host and is
 * not used here. Credential: `DEEPSEEK_API_KEY` as `Authorization: Bearer`.
 *
 * JSON mode exists (`response_format: { type: 'json_object' }`) but DeepSeek
 * documents that it needs the word "json" somewhere in the prompt and that it
 * can still emit an empty body — one more reason `completeJson` validates
 * locally instead of trusting the mode.
 */
export class DeepSeekLlmProvider implements LlmProvider {
  readonly id: LlmProviderId = 'deepseek';
  readonly model: string;

  /** Resolved key, base URL, timeout and retry budget. */
  protected readonly config: ProviderConfig;

  /** Prefer `createLlmProvider('deepseek')`, which applies defaults and overrides. */
  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.model;
  }

  /**
   * One non-streaming completion. Maps `system` onto a leading system message,
   * and `finish_reason` onto `'stop' | 'length' | 'error'`.
   */
  async complete(_request: CompletionRequest): Promise<CompletionResult> {
    // TODO(phase-2): POST `${this.config.baseUrl}/chat/completions`, honour
    // `config.timeoutMs` via AbortSignal, retry while `config.maxRetries`
    // remains and `ProviderError.retryable` is true, and map the response into
    // `CompletionResult` including measured `latencyMs`.
    throw new Error('Not implemented: DeepSeekLlmProvider.complete');
  }

  /**
   * Streams `chat.completion.chunk` frames, translating `delta.content` into
   * `CompletionDelta` and terminating on `[DONE]`. Aborting `signal` must cancel
   * the response body, not just the loop.
   */
  stream(_request: CompletionRequest, _signal?: AbortSignal): AsyncIterable<CompletionDelta> {
    // TODO(phase-2): POST with `stream: true`, parse the SSE frames, yield
    // `{ text, done: false }` per chunk and one `{ text: '', done: true }` at the
    // end, wiring the caller's `signal` into the fetch abort.
    throw new Error('Not implemented: DeepSeekLlmProvider.stream');
  }

  /**
   * Completes with `response_format: { type: 'json_object' }`, stringifies the
   * instruction to answer as JSON, then parses and validates against
   * `request.schema`, re-asking on a violation.
   */
  async completeJson<T>(_request: JsonCompletionRequest<T>): Promise<T> {
    // TODO(phase-2): call `complete` with JSON mode, extract the JSON object from
    // the response (models sometimes wrap it in prose or a fenced block), parse
    // with `schema.safeParse`, and retry up to `request.retries` on failure.
    throw new Error('Not implemented: DeepSeekLlmProvider.completeJson');
  }

  /** Times a one-token completion on `deepseek-chat`. Never throws; failures surface as `ok: false`. */
  async health(): Promise<ProviderHealth> {
    // TODO(phase-2): measure latency of a minimal completion and report
    // `{ ok, latencyMs, model, checkedAt, error }`.
    throw new Error('Not implemented: DeepSeekLlmProvider.health');
  }
}
