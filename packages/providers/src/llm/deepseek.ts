import {
  ProviderError,
  RETRY_BASE_DELAY_MS,
  type LlmProviderId,
  type ProviderConfig,
  type ProviderHealth,
} from '../types';

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
   *
   * Transport failure, timeout, 408, 429 and 5xx are retried up to
   * `config.maxRetries` times with exponential backoff; every other 4xx throws
   * on the first attempt, because a malformed request or a bad key cannot start
   * working by being sent again. `latencyMs` measures the whole call, retries
   * and backoff included, since that is what the caller waited.
   */
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const startedAt = Date.now();
    const body = this.buildRequestBody(request);
    let lastError: ProviderError | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      if (attempt > 0) await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));

      try {
        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.apiKey ?? ''}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });

        if (!response.ok) {
          throw new ProviderError(`DeepSeek returned ${response.status} ${response.statusText}.`, {
            provider: this.id,
            statusCode: response.status,
          });
        }

        return this.toCompletionResult((await response.json()) as DeepSeekChatResponse, startedAt);
      } catch (error) {
        lastError = asProviderError(error, this.id);
        if (!lastError.retryable) throw lastError;
      }
    }

    throw lastError ?? new ProviderError('DeepSeek completion failed.', { provider: this.id });
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

  /**
   * Serializes a request into DeepSeek's wire shape.
   *
   * `system` is hoisted into a leading `system` message rather than kept beside the list: the
   * compatibility surface has no top-level system field, and a `system` message inside `messages` is
   * how the OpenAI shape carries it. Absent optional fields are omitted rather than sent as `null` —
   * DeepSeek validates types, and an explicit `null` temperature is a 400.
   */
  private buildRequestBody(request: CompletionRequest): DeepSeekChatRequest {
    const messages: DeepSeekChatMessage[] =
      request.system === undefined
        ? request.messages.map((message) => ({ role: message.role, content: message.content }))
        : [
            { role: 'system', content: request.system },
            ...request.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          ];

    return {
      model: this.model,
      messages,
      stream: false,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
      ...(request.stop === undefined ? {} : { stop: request.stop }),
    };
  }

  /**
   * Maps one response body onto {@link CompletionResult}.
   *
   * A body with no `choices[0].message.content` is a provider-side failure, and it is reported as
   * **not** retryable: a re-ask produces the same shape, so retrying only delays the error.
   */
  private toCompletionResult(payload: DeepSeekChatResponse, startedAt: number): CompletionResult {
    const choice = payload.choices?.[0];
    const content = choice?.message?.content;

    if (typeof content !== 'string') {
      throw new ProviderError('DeepSeek response contained no message content.', {
        provider: this.id,
        retryable: false,
      });
    }

    const inputTokens = readTokenCount(payload.usage?.prompt_tokens);
    const outputTokens = readTokenCount(payload.usage?.completion_tokens);

    return {
      content,
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: {
        inputTokens,
        outputTokens,
        // Read rather than summed when the provider reports it, so a cached-prompt discount
        // (which lowers `total_tokens` below the sum) is not silently discarded.
        totalTokens: readTokenCount(payload.usage?.total_tokens) || inputTokens + outputTokens,
        // DeepSeek bills in its own units; pricing is not modelled in this scaffold.
        costUsd: null,
      },
      model: this.model,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** One message in DeepSeek's chat shape. */
interface DeepSeekChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Request body for `POST {baseUrl}/chat/completions` with streaming off. */
interface DeepSeekChatRequest {
  model: string;
  messages: DeepSeekChatMessage[];
  stream: false;
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
}

/**
 * The subset of the response body this adapter reads. Every field is optional: the body is
 * untrusted input, and the checks that make it safe live in `toCompletionResult` rather than in a
 * type assertion.
 */
interface DeepSeekChatResponse {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

/** Maps DeepSeek's `finish_reason` onto the provider-neutral set. */
function mapFinishReason(reason: unknown): CompletionResult['finishReason'] {
  if (reason === 'stop') return 'stop';
  if (reason === 'length') return 'length';
  return 'error';
}

/** Reads a token count, treating anything that is not a finite number as zero. */
function readTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Normalizes anything thrown by `fetch` into a {@link ProviderError}.
 *
 * An already-`ProviderError` passes through untouched, so the status code — and therefore the
 * retry decision — survives. Everything else is a transport failure or a timeout, both of which
 * carry no status and are retryable by the package's contract.
 */
function asProviderError(error: unknown, provider: string): ProviderError {
  if (error instanceof ProviderError) return error;

  const detail = error instanceof Error ? error.message : String(error);
  return new ProviderError(`DeepSeek request failed: ${detail}`, { provider, cause: error });
}

/** Waits `ms` milliseconds. Used for the backoff between retry attempts. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
