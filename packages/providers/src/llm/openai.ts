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
export const OPENAI_LLM_DEFAULTS = {
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
  envKey: 'OPENAI_API_KEY',
  contextWindowTokens: 128_000,
  openAiCompatible: true,
} as const satisfies LlmProviderDefaults;

/**
 * OpenAI chat completions (`gpt-4o-mini` by default) — the reference shape the
 * other OpenAI-compatible adapters follow.
 *
 * Request: `POST {baseUrl}/chat/completions` with
 * `{ model, messages, temperature, max_tokens, stop, stream }`; credential is
 * `OPENAI_API_KEY` as `Authorization: Bearer`.
 * Response: `{ choices: [{ message: { content }, finish_reason }], usage: {
 * prompt_tokens, completion_tokens, total_tokens } }`.
 * Streaming: SSE frames `data: {...}` terminated by `data: [DONE]`, each chunk
 * carrying `choices[0].delta.content`.
 *
 * Newer reasoning models reject `max_tokens` in favour of
 * `max_completion_tokens` and refuse non-default temperatures; the adapter must
 * translate rather than pass the caller's field straight through.
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly id: LlmProviderId = 'openai';
  readonly model: string;

  /** Resolved key, base URL, timeout and retry budget. */
  protected readonly config: ProviderConfig;

  /** Prefer `createLlmProvider('openai')`, which applies defaults and overrides. */
  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.model;
  }

  /**
   * One non-streaming completion. `finish_reason: 'length'` must survive as
   * `'length'` so callers can tell a truncated answer from a complete one.
   */
  async complete(_request: CompletionRequest): Promise<CompletionResult> {
    // TODO(phase-2): POST `${this.config.baseUrl}/chat/completions`, honour
    // `config.timeoutMs` via AbortSignal, retry while `config.maxRetries`
    // remains and `ProviderError.retryable` is true, and map the response into
    // `CompletionResult` including measured `latencyMs`.
    throw new Error('Not implemented: OpenAiLlmProvider.complete');
  }

  /**
   * Streams SSE `delta.content` frames and stops at `[DONE]`. Aborting `signal`
   * must cancel the response body, not just the loop.
   */
  stream(_request: CompletionRequest, _signal?: AbortSignal): AsyncIterable<CompletionDelta> {
    // TODO(phase-2): POST with `stream: true`, parse `data:` frames, yield
    // `{ text, done: false }` per delta and one `{ text: '', done: true }` at the
    // end, wiring the caller's `signal` into the fetch abort.
    throw new Error('Not implemented: OpenAiLlmProvider.stream');
  }

  /**
   * Uses `response_format` (`json_schema` where the model supports it,
   * `json_object` otherwise), then parses and validates against
   * `request.schema`, re-asking on a violation.
   */
  async completeJson<T>(_request: JsonCompletionRequest<T>): Promise<T> {
    // TODO(phase-2): derive a `response_format` from `request.schema`, call
    // `complete`, parse the returned JSON, validate with `schema.safeParse`, and
    // retry up to `request.retries` on failure.
    throw new Error('Not implemented: OpenAiLlmProvider.completeJson');
  }

  /** Times a one-token completion on `gpt-4o-mini`. Never throws; failures surface as `ok: false`. */
  async health(): Promise<ProviderHealth> {
    // TODO(phase-2): measure latency of a minimal completion and report
    // `{ ok, latencyMs, model, checkedAt, error }`.
    throw new Error('Not implemented: OpenAiLlmProvider.health');
  }
}
