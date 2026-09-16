import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  ProviderError,
  type LlmProviderId,
  type ProviderConfig,
  type ProviderEnv,
  type ProviderOverrides,
} from '../types';

import { ClaudeLlmProvider, CLAUDE_LLM_DEFAULTS } from './claude';
import { DeepSeekLlmProvider, DEEPSEEK_LLM_DEFAULTS } from './deepseek';
import { GeminiLlmProvider, GEMINI_LLM_DEFAULTS } from './gemini';
import { LocalLlmProvider, LOCAL_LLM_DEFAULTS } from './local';
import { OpenAiLlmProvider, OPENAI_LLM_DEFAULTS } from './openai';
import { QwenLlmProvider, QWEN_LLM_DEFAULTS } from './qwen';

import type { LlmProvider, LlmProviderDefaults } from './interface';

/**
 * The single source of truth for "which model, against which URL, with which env
 * key". Each entry is the defaults constant exported by its adapter file, so this
 * table cannot drift from the adapter it describes, and the README matrix is
 * generated from it.
 */
export const LLM_PROVIDER_DEFAULTS: Record<LlmProviderId, LlmProviderDefaults> = {
  deepseek: DEEPSEEK_LLM_DEFAULTS,
  openai: OPENAI_LLM_DEFAULTS,
  gemini: GEMINI_LLM_DEFAULTS,
  claude: CLAUDE_LLM_DEFAULTS,
  qwen: QWEN_LLM_DEFAULTS,
  local: LOCAL_LLM_DEFAULTS,
};

/** Every known provider id, in table order; used to validate `LLM_PROVIDER`. */
const LLM_PROVIDER_IDS: readonly LlmProviderId[] = [
  'deepseek',
  'openai',
  'gemini',
  'claude',
  'qwen',
  'local',
];

/** Provider id used when `LLM_PROVIDER` is unset — the env template's default. */
const DEFAULT_LLM_PROVIDER_ID: LlmProviderId = 'deepseek';

/**
 * Whether `completeJson` may lean on the provider's native structured-output
 * mode (JSON mode, `responseSchema`, or a forced tool call) for a given backend.
 *
 * This is a capability hint for callers choosing where to run classification and
 * distillation — it is **not** a correctness dependency.
 * `completeJson` validates every response against the caller's schema locally
 * and retries on a violation regardless of this flag, because support for JSON
 * mode varies by provider, by model inside a provider, and by build for a local
 * server, and because several of them can still return prose, an empty body, or
 * a truncated object.
 *
 * `false` for `claude` (no JSON mode at all — prompting or tool-use only),
 * `gemini` (`responseSchema` exists but requires a schema dialect this scaffold
 * does not translate), and `local` (depends entirely on the server build).
 */
const STRUCTURED_TASK_SAFE: Record<LlmProviderId, boolean> = {
  deepseek: true,
  openai: true,
  qwen: true,
  gemini: false,
  claude: false,
  local: false,
};

/** Env var selecting the active provider. */
const PROVIDER_ENV_KEY = 'LLM_PROVIDER';

/** Env var overriding the model for whichever provider is active. */
const MODEL_ENV_KEY = 'LLM_MODEL';

/**
 * Extra model env keys, consulted only when `LLM_MODEL` is unset. Needed because
 * the local entry has no default model and its own variable (`LOCAL_LLM_MODEL`).
 */
const MODEL_ENV_KEYS: Partial<Record<LlmProviderId, string>> = {
  local: 'LOCAL_LLM_MODEL',
};

/** Env vars consulted to override a provider's base URL; see `.env.example`. */
const BASE_URL_ENV_KEYS: Partial<Record<LlmProviderId, string>> = {
  deepseek: 'DEEPSEEK_BASE_URL',
  openai: 'OPENAI_BASE_URL',
  qwen: 'QWEN_BASE_URL',
  local: 'LOCAL_LLM_BASE_URL',
};

/** Constructs a provider from an already-resolved config. Exhaustive by type. */
const LLM_PROVIDER_CONSTRUCTORS: Record<LlmProviderId, (config: ProviderConfig) => LlmProvider> = {
  deepseek: (config) => new DeepSeekLlmProvider(config),
  openai: (config) => new OpenAiLlmProvider(config),
  gemini: (config) => new GeminiLlmProvider(config),
  claude: (config) => new ClaudeLlmProvider(config),
  qwen: (config) => new QwenLlmProvider(config),
  local: (config) => new LocalLlmProvider(config),
};

/**
 * Builds a provider from the defaults table plus `overrides`.
 *
 * Reads no environment and validates no credential: pass the key in `overrides`
 * or use `llmProviderFromEnv`. The returned instance is ready to use but every
 * method still throws until phase 2.
 */
export function createLlmProvider(
  id: LlmProviderId,
  overrides: ProviderOverrides = {},
): LlmProvider {
  return LLM_PROVIDER_CONSTRUCTORS[id](resolveLlmConfig(id, overrides));
}

/**
 * Builds the provider named by the environment.
 *
 * Reads `LLM_PROVIDER` (default `deepseek`), `LLM_MODEL`, the provider's
 * credential key from `LLM_PROVIDER_DEFAULTS`, its base-URL override key, and
 * `LOCAL_LLM_MODEL` when the model is still unresolved. Throws
 * {@link ProviderError} with `retryable: false` on an unknown provider id, a
 * missing credential, or an unresolved model — a misconfigured process should
 * fail at startup rather than mid-run.
 */
export function llmProviderFromEnv(env: ProviderEnv): LlmProvider {
  const id = readLlmProviderId(env[PROVIDER_ENV_KEY]);
  const defaults = LLM_PROVIDER_DEFAULTS[id];

  const apiKey = readApiKey(id, env, defaults.envKey);
  const baseUrlKey = BASE_URL_ENV_KEYS[id];
  const baseUrl = readRequiredUrl(
    (baseUrlKey ? env[baseUrlKey] : undefined) ?? defaults.baseUrl,
    id,
  );

  return createLlmProvider(id, {
    apiKey,
    baseUrl,
    model: resolveModel(id, env, defaults.model),
  });
}

/**
 * Reports whether a provider's native structured-output mode can be trusted for
 * a structured task. Accepts a built provider or a bare id, so a caller can ask
 * before constructing one. See `STRUCTURED_TASK_SAFE` for what the flag means.
 */
export function isStructuredTaskSafe(provider: LlmProvider | LlmProviderId): boolean {
  return STRUCTURED_TASK_SAFE[typeof provider === 'string' ? provider : provider.id];
}

/** Resolves defaults + overrides into the complete config a provider class expects. */
function resolveLlmConfig(id: LlmProviderId, overrides: ProviderOverrides): ProviderConfig {
  const defaults = LLM_PROVIDER_DEFAULTS[id];
  return {
    apiKey: overrides.apiKey ?? null,
    baseUrl: overrides.baseUrl ?? defaults.baseUrl,
    model: overrides.model ?? defaults.model,
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? DEFAULT_MAX_RETRIES,
  };
}

/** Validates `LLM_PROVIDER`, falling back to the documented default. */
function readLlmProviderId(raw: string | undefined): LlmProviderId {
  const value = readNonEmpty(raw);
  if (value === undefined) return DEFAULT_LLM_PROVIDER_ID;

  const candidate = value.toLowerCase();
  const match = LLM_PROVIDER_IDS.find((id) => id === candidate);
  if (match === undefined) {
    throw new ProviderError(
      `Unknown ${PROVIDER_ENV_KEY} "${raw}". Known providers: ${LLM_PROVIDER_IDS.join(', ')}.`,
      { provider: 'llm', retryable: false },
    );
  }
  return match;
}

/** Resolves `LLM_MODEL`, then the provider's extra key, then its default, then fails. */
function resolveModel(id: LlmProviderId, env: ProviderEnv, fallback: string): string {
  const modelKey = MODEL_ENV_KEYS[id];
  const model =
    readNonEmpty(env[MODEL_ENV_KEY]) ?? (modelKey ? readNonEmpty(env[modelKey]) : undefined);
  if (model !== undefined) return model;

  const resolved = readNonEmpty(fallback);
  if (resolved === undefined) {
    const hint = modelKey ? ` or ${modelKey}` : '';
    throw new ProviderError(
      `No model configured for LLM provider "${id}". Set ${MODEL_ENV_KEY}${hint} — this provider has no default model.`,
      { provider: id, retryable: false },
    );
  }
  return resolved;
}

/** Reads and validates the credential for a provider that requires one. */
function readApiKey(id: LlmProviderId, env: ProviderEnv, envKey: string | null): string | null {
  if (envKey === null) return null;
  const apiKey = readNonEmpty(env[envKey]);
  if (apiKey === undefined) {
    throw new ProviderError(`Missing ${envKey} for LLM provider "${id}".`, {
      provider: id,
      retryable: false,
    });
  }
  return apiKey;
}

/** Rejects a blank base URL so a typo fails at startup instead of at request time. */
function readRequiredUrl(raw: string, id: LlmProviderId): string {
  const url = readNonEmpty(raw);
  if (url === undefined) {
    throw new ProviderError(`Empty base URL for LLM provider "${id}".`, {
      provider: id,
      retryable: false,
    });
  }
  return url;
}

/** Trims a value and treats whitespace-only strings as unset. */
function readNonEmpty(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}
