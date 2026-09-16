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
export const GEMINI_LLM_DEFAULTS = {
  model: 'gemini-1.5-flash',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  envKey: 'GEMINI_API_KEY',
  contextWindowTokens: 1_000_000,
  openAiCompatible: false,
} as const satisfies LlmProviderDefaults;

/**
 * Google Gemini — **bespoke REST shape, not OpenAI-compatible.** This is the
 * adapter that needs care; nothing about it can be reused from the
 * OpenAI-shaped ones.
 *
 * Endpoints: `POST {baseUrl}/models/{model}:generateContent` and
 * `POST {baseUrl}/models/{model}:streamGenerateContent?alt=sse`. Credential is
 * `GEMINI_API_KEY` in the `x-goog-api-key` header (or `?key=`), never
 * `Authorization: Bearer`.
 *
 * Request translation, in full:
 * - `messages` become `contents: [{ role: 'user' | 'model', parts: [{ text }] }]`
 *   — Gemini has no `assistant` role, so `assistant` maps to `model`.
 * - The system prompt does not live in `contents`. It goes in the top-level
 *   `systemInstruction: { parts: [{ text }] }`.
 * - `temperature`, `maxTokens` and `stop` move into
 *   `generationConfig: { temperature, maxOutputTokens, stopSequences }`.
 *
 * Response: `{ candidates: [{ content: { parts: [{ text }] }, finishReason }],
 * usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount } }`.
 * Streaming arrives as SSE frames each holding a partial `candidates[0]`.
 *
 * Structured output is available as `generationConfig.responseMimeType:
 * 'application/json'` plus `responseSchema` (an OpenAPI-subset schema, not
 * JSON Schema), but this scaffold does not rely on it — see
 * `isStructuredTaskSafe` in `./factory`.
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly id: LlmProviderId = 'gemini';
  readonly model: string;

  /** Resolved key, base URL, timeout and retry budget. */
  protected readonly config: ProviderConfig;

  /** Prefer `createLlmProvider('gemini')`, which applies defaults and overrides. */
  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.model;
  }

  /**
   * One non-streaming completion, translating the request and response shapes
   * described above. `finishReason: 'MAX_TOKENS'` maps to `'length'`.
   */
  async complete(_request: CompletionRequest): Promise<CompletionResult> {
    // TODO(phase-2): POST `${this.config.baseUrl}/models/${this.model}:generateContent`,
    // build `contents` / `systemInstruction` / `generationConfig`, honour the
    // timeout/retry contract, and map `usageMetadata` into `ProviderUsage`.
    throw new Error('Not implemented: GeminiLlmProvider.complete');
  }

  /**
   * Streams `:streamGenerateContent?alt=sse`, concatenating the `parts[0].text`
   * of each frame. Aborting `signal` must cancel the response body.
   */
  stream(_request: CompletionRequest, _signal?: AbortSignal): AsyncIterable<CompletionDelta> {
    // TODO(phase-2): POST with `alt=sse`, parse the SSE frames, yield
    // `{ text, done: false }` per frame and one `{ text: '', done: true }` at the
    // end, wiring the caller's `signal` into the fetch abort.
    throw new Error('Not implemented: GeminiLlmProvider.stream');
  }

  /**
   * Validates with the supplied schema and re-asks on a violation. `responseSchema`
   * and local validation are alternatives here: the scaffold validates locally so
   * the other providers behave identically.
   */
  async completeJson<T>(_request: JsonCompletionRequest<T>): Promise<T> {
    // TODO(phase-2): call `complete` with JSON output requested, parse the
    // response text, validate with `schema.safeParse`, and retry up to
    // `request.retries` on failure.
    throw new Error('Not implemented: GeminiLlmProvider.completeJson');
  }

  /** Times a one-token `generateContent` call. Never throws; failures surface as `ok: false`. */
  async health(): Promise<ProviderHealth> {
    // TODO(phase-2): measure latency of a minimal completion and report
    // `{ ok, latencyMs, model, checkedAt, error }`.
    throw new Error('Not implemented: GeminiLlmProvider.health');
  }
}
