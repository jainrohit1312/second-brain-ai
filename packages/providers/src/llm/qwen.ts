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
export const QWEN_LLM_DEFAULTS = {
  model: 'qwen-plus',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  envKey: 'DASHSCOPE_API_KEY',
  contextWindowTokens: 131_072,
  openAiCompatible: true,
} as const satisfies LlmProviderDefaults;

/**
 * Alibaba Qwen through DashScope's OpenAI-compatible mode.
 *
 * Base URL is `https://dashscope.aliyuncs.com/compatible-mode/v1` — the
 * `/compatible-mode/v1` segment is what makes this an OpenAI-shaped adapter.
 * DashScope's native mode uses a different endpoint and payload (`input`/`parameters`
 * instead of `messages`) and is deliberately not used here, so
 * `openAiCompatible: true` for this provider means "the compatible surface only".
 *
 * Request/response: identical to OpenAI — `POST {baseUrl}/chat/completions`,
 * `{ model, messages, temperature, max_tokens, stop, stream }`, and
 * `{ choices: [{ message: { content }, finish_reason }], usage: { prompt_tokens,
 * completion_tokens, total_tokens } }`. Credential: `DASHSCOPE_API_KEY` as
 * `Authorization: Bearer`. JSON mode is `response_format: { type: 'json_object' }`.
 *
 * Region matters: `dashscope-intl.aliyuncs.com` is the international host and
 * uses the same path, so it is an override of `QWEN_BASE_URL`, not a new provider.
 */
export class QwenLlmProvider implements LlmProvider {
  readonly id: LlmProviderId = 'qwen';
  readonly model: string;

  /** Resolved key, base URL, timeout and retry budget. */
  protected readonly config: ProviderConfig;

  /** Prefer `createLlmProvider('qwen')`, which applies defaults and overrides. */
  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.model;
  }

  /**
   * One non-streaming completion. Maps `system` onto a leading system message
   * and `finish_reason` onto `'stop' | 'length' | 'error'`.
   */
  async complete(_request: CompletionRequest): Promise<CompletionResult> {
    // TODO(phase-2): POST `${this.config.baseUrl}/chat/completions`, honour
    // `config.timeoutMs` via AbortSignal, retry while `config.maxRetries`
    // remains and `ProviderError.retryable` is true, and map the response into
    // `CompletionResult` including measured `latencyMs`.
    throw new Error('Not implemented: QwenLlmProvider.complete');
  }

  /**
   * Streams `delta.content` frames and stops at `[DONE]`. Aborting `signal` must
   * cancel the response body, not just the loop.
   */
  stream(_request: CompletionRequest, _signal?: AbortSignal): AsyncIterable<CompletionDelta> {
    // TODO(phase-2): POST with `stream: true`, parse the SSE frames, yield
    // `{ text, done: false }` per delta and one `{ text: '', done: true }` at the
    // end, wiring the caller's `signal` into the fetch abort.
    throw new Error('Not implemented: QwenLlmProvider.stream');
  }

  /**
   * Completes with JSON mode, then parses and validates against
   * `request.schema`, re-asking on a violation.
   */
  async completeJson<T>(_request: JsonCompletionRequest<T>): Promise<T> {
    // TODO(phase-2): call `complete` with `response_format: { type: 'json_object' }`,
    // extract the JSON object from the response, validate with
    // `schema.safeParse`, and retry up to `request.retries` on failure.
    throw new Error('Not implemented: QwenLlmProvider.completeJson');
  }

  /** Times a one-token completion on `qwen-plus`. Never throws; failures surface as `ok: false`. */
  async health(): Promise<ProviderHealth> {
    // TODO(phase-2): measure latency of a minimal completion and report
    // `{ ok, latencyMs, model, checkedAt, error }`.
    throw new Error('Not implemented: QwenLlmProvider.health');
  }
}
