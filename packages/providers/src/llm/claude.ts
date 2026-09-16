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
export const CLAUDE_LLM_DEFAULTS = {
  model: 'claude-3-5-sonnet-latest',
  baseUrl: 'https://api.anthropic.com',
  envKey: 'ANTHROPIC_API_KEY',
  contextWindowTokens: 200_000,
  openAiCompatible: false,
} as const satisfies LlmProviderDefaults;

/**
 * Anthropic Claude — **bespoke Messages shape, not OpenAI-compatible.**
 *
 * Endpoint: `POST {baseUrl}/v1/messages`, with headers `x-api-key:
 * ${ANTHROPIC_API_KEY}` (not `Authorization: Bearer`) and a pinned
 * `anthropic-version: 2023-06-01`. Omitting the version header is a 400.
 *
 * Two translation traps, both called out because they are the parts that
 * actually break:
 * - **`system` is a top-level field, not a message.** `CompletionRequest.system`
 *   maps directly; a `system` entry in `messages` has to be hoisted out of the
 *   array, because the API rejects a `system` role inside `messages`.
 * - **`max_tokens` is required.** There is no server-side default, so the
 *   adapter must supply one when `CompletionRequest.maxTokens` is absent.
 *
 * Request: `{ model, max_tokens, system?, messages, temperature?, stop_sequences? }`.
 * Response: `{ content: [{ type: 'text', text }], stop_reason: 'end_turn' |
 * 'max_tokens', usage: { input_tokens, output_tokens } }`.
 * Streaming (`stream: true`) is SSE with typed events: `content_block_delta`
 * carries `delta.text`, and `message_stop` ends the response.
 *
 * Claude has no JSON mode; structured output is obtained by prompting or by
 * forcing a tool call, so `completeJson` validates locally in every case.
 */
export class ClaudeLlmProvider implements LlmProvider {
  readonly id: LlmProviderId = 'claude';
  readonly model: string;

  /** Resolved key, base URL, timeout and retry budget. */
  protected readonly config: ProviderConfig;

  /** Prefer `createLlmProvider('claude')`, which applies defaults and overrides. */
  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.model;
  }

  /**
   * One non-streaming completion. Hoists the system prompt, applies the
   * required `max_tokens` default, and maps `stop_reason: 'max_tokens'` onto
   * `finishReason: 'length'`.
   */
  async complete(_request: CompletionRequest): Promise<CompletionResult> {
    // TODO(phase-2): POST `${this.config.baseUrl}/v1/messages` with the required
    // headers, hoist `system`, default `max_tokens`, honour the timeout/retry
    // contract, and map `usage` into `ProviderUsage`.
    throw new Error('Not implemented: ClaudeLlmProvider.complete');
  }

  /**
   * Streams SSE event objects, emitting on `content_block_delta` and completing
   * on `message_stop`. Aborting `signal` must cancel the response body.
   */
  stream(_request: CompletionRequest, _signal?: AbortSignal): AsyncIterable<CompletionDelta> {
    // TODO(phase-2): POST with `stream: true`, parse the typed SSE events, yield
    // `{ text, done: false }` per `content_block_delta` and one
    // `{ text: '', done: true }` on `message_stop`, wiring the caller's `signal`
    // into the fetch abort.
    throw new Error('Not implemented: ClaudeLlmProvider.stream');
  }

  /**
   * Prompts for JSON, then parses and validates against `request.schema`,
   * re-asking on a violation. No provider-side JSON mode exists, so local
   * validation is the only guarantee available.
   */
  async completeJson<T>(_request: JsonCompletionRequest<T>): Promise<T> {
    // TODO(phase-2): call `complete` with a JSON instruction, extract the object
    // from the response text, validate with `schema.safeParse`, and retry up to
    // `request.retries` on failure.
    throw new Error('Not implemented: ClaudeLlmProvider.completeJson');
  }

  /** Times a one-token `/v1/messages` call. Never throws; failures surface as `ok: false`. */
  async health(): Promise<ProviderHealth> {
    // TODO(phase-2): measure latency of a minimal completion and report
    // `{ ok, latencyMs, model, checkedAt, error }`.
    throw new Error('Not implemented: ClaudeLlmProvider.health');
  }
}
