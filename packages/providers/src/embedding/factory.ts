import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  ProviderError,
  type EmbeddingProviderId,
  type ProviderConfig,
  type ProviderEnv,
  type ProviderOverrides,
} from '../types';

import { GeminiEmbeddingProvider, GEMINI_EMBEDDING_DEFAULTS } from './gemini';
import { LocalEmbeddingProvider, LOCAL_EMBEDDING_DEFAULTS } from './local';
import { NvidiaEmbeddingProvider, NVIDIA_EMBEDDING_DEFAULTS } from './nvidia';
import { OpenAiEmbeddingProvider, OPENAI_EMBEDDING_DEFAULTS } from './openai';

import type { EmbeddingProvider, EmbeddingProviderDefaults } from './interface';

/**
 * The single source of truth for "which model, how wide, against which URL, with
 * which env key". Each entry is the defaults constant exported by its adapter
 * file, so this table cannot drift from the adapter it describes.
 */
export const EMBEDDING_PROVIDER_DEFAULTS: Record<EmbeddingProviderId, EmbeddingProviderDefaults> = {
  nvidia: NVIDIA_EMBEDDING_DEFAULTS,
  openai: OPENAI_EMBEDDING_DEFAULTS,
  gemini: GEMINI_EMBEDDING_DEFAULTS,
  local: LOCAL_EMBEDDING_DEFAULTS,
};

/** Every known provider id, in table order; used to validate `EMBEDDING_PROVIDER`. */
const EMBEDDING_PROVIDER_IDS: readonly EmbeddingProviderId[] = [
  'nvidia',
  'openai',
  'gemini',
  'local',
];

/** Provider id used when `EMBEDDING_PROVIDER` is unset — the env template's default. */
const DEFAULT_EMBEDDING_PROVIDER_ID: EmbeddingProviderId = 'nvidia';

/** Env var selecting the active provider. */
const PROVIDER_ENV_KEY = 'EMBEDDING_PROVIDER';

/** Env var overriding the model for whichever provider is active. */
const MODEL_ENV_KEY = 'EMBEDDING_MODEL';

/** Env var overriding the stored vector width; must match the existing rows or be re-embedded. */
const DIMENSIONS_ENV_KEY = 'EMBEDDING_DIMENSIONS';

/**
 * Env vars consulted to override a provider's base URL. Kept here rather than in
 * the defaults table so that the table stays exactly `{ model, dimensions,
 * baseUrl, envKey }`, matching the documented shape.
 */
const BASE_URL_ENV_KEYS: Partial<Record<EmbeddingProviderId, string>> = {
  nvidia: 'NVIDIA_BASE_URL',
  openai: 'OPENAI_BASE_URL',
  local: 'LOCAL_LLM_BASE_URL',
};

/** Constructs a provider from an already-resolved config. Exhaustive by type. */
const EMBEDDING_PROVIDER_CONSTRUCTORS: Record<
  EmbeddingProviderId,
  (config: ProviderConfig) => EmbeddingProvider
> = {
  nvidia: (config) => new NvidiaEmbeddingProvider(config),
  openai: (config) => new OpenAiEmbeddingProvider(config),
  gemini: (config) => new GeminiEmbeddingProvider(config),
  local: (config) => new LocalEmbeddingProvider(config),
};

/**
 * Builds a provider from the defaults table plus `overrides`.
 *
 * Reads no environment and validates no credential: pass the key in `overrides`
 * or use `embeddingProviderFromEnv`, which reads the variables this factory
 * declares. The returned instance is ready to use but every method still throws
 * until phase 2.
 */
export function createEmbeddingProvider(
  id: EmbeddingProviderId,
  overrides: ProviderOverrides = {},
): EmbeddingProvider {
  return EMBEDDING_PROVIDER_CONSTRUCTORS[id](resolveEmbeddingConfig(id, overrides));
}

/**
 * Builds the provider named by the environment — the entry point for
 * `services/processing` and the ingestion edge function.
 *
 * Reads `EMBEDDING_PROVIDER` (default `nvidia`), `EMBEDDING_MODEL`,
 * `EMBEDDING_DIMENSIONS`, the provider's credential key from
 * `EMBEDDING_PROVIDER_DEFAULTS`, and the provider's base-URL override key.
 * Throws {@link ProviderError} with `retryable: false` on an unknown provider id,
 * a missing credential, or a non-numeric dimension: a misconfigured process
 * should fail at startup, not on the first batch.
 */
export function embeddingProviderFromEnv(env: ProviderEnv): EmbeddingProvider {
  const id = readEmbeddingProviderId(env[PROVIDER_ENV_KEY]);
  const defaults = EMBEDDING_PROVIDER_DEFAULTS[id];

  const apiKey = readApiKey(id, env, defaults.envKey);
  const baseUrlKey = BASE_URL_ENV_KEYS[id];
  const baseUrl = readRequiredUrl(
    (baseUrlKey ? env[baseUrlKey] : undefined) ?? defaults.baseUrl,
    id,
  );

  return createEmbeddingProvider(id, {
    apiKey,
    baseUrl,
    model: readNonEmpty(env[MODEL_ENV_KEY]) ?? defaults.model,
    dimensions: readDimensions(env[DIMENSIONS_ENV_KEY]) ?? defaults.dimensions,
  });
}

/**
 * Guards a provider swap at startup: throws unless the provider's output width
 * equals the width of the vectors already in the database.
 *
 * Called with the stored width (for example `document_chunks.embedding`
 * metadata) before an ingestion run, because a mismatch would otherwise surface
 * as nonsense search results rather than an error. See `docs/DECISIONS.md`
 * (ADR-004).
 */
export function assertDimensionsMatch(expected: number, actual: number): void {
  if (expected !== actual) {
    throw new ProviderError(
      `Embedding dimension mismatch: stored vectors are ${expected}-dimensional but the provider ` +
        `returns ${actual}. Switching width or model requires a re-embed migration, not a config change.`,
      { provider: 'embedding', retryable: false },
    );
  }
}

/** Resolves defaults + overrides into the complete config a provider class expects. */
function resolveEmbeddingConfig(
  id: EmbeddingProviderId,
  overrides: ProviderOverrides,
): ProviderConfig {
  const defaults = EMBEDDING_PROVIDER_DEFAULTS[id];
  return {
    apiKey: overrides.apiKey ?? null,
    baseUrl: overrides.baseUrl ?? defaults.baseUrl,
    model: overrides.model ?? defaults.model,
    dimensions: overrides.dimensions ?? defaults.dimensions,
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? DEFAULT_MAX_RETRIES,
  };
}

/** Validates `EMBEDDING_PROVIDER`, falling back to the documented default. */
function readEmbeddingProviderId(raw: string | undefined): EmbeddingProviderId {
  const value = readNonEmpty(raw);
  if (value === undefined) return DEFAULT_EMBEDDING_PROVIDER_ID;

  const candidate = value.toLowerCase();
  const match = EMBEDDING_PROVIDER_IDS.find((id) => id === candidate);
  if (match === undefined) {
    throw new ProviderError(
      `Unknown ${PROVIDER_ENV_KEY} "${raw}". Known providers: ${EMBEDDING_PROVIDER_IDS.join(', ')}.`,
      { provider: 'embedding', retryable: false },
    );
  }
  return match;
}

/** Reads and validates the credential for a provider that requires one. */
function readApiKey(
  id: EmbeddingProviderId,
  env: ProviderEnv,
  envKey: string | null,
): string | null {
  if (envKey === null) return null;
  const apiKey = readNonEmpty(env[envKey]);
  if (apiKey === undefined) {
    throw new ProviderError(`Missing ${envKey} for embedding provider "${id}".`, {
      provider: id,
      retryable: false,
    });
  }
  return apiKey;
}

/** Rejects a blank base URL so a typo fails at startup instead of at request time. */
function readRequiredUrl(raw: string, id: EmbeddingProviderId): string {
  const url = readNonEmpty(raw);
  if (url === undefined) {
    throw new ProviderError(`Empty base URL for embedding provider "${id}".`, {
      provider: id,
      retryable: false,
    });
  }
  return url;
}

/** Parses `EMBEDDING_DIMENSIONS`; rejects quiet coercion of a non-numeric value. */
function readDimensions(raw: string | undefined): number | undefined {
  const value = readNonEmpty(raw);
  if (value === undefined) return undefined;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ProviderError(`${DIMENSIONS_ENV_KEY} must be a positive integer, got "${raw}".`, {
      provider: 'embedding',
      retryable: false,
    });
  }
  return parsed;
}

/** Trims a value and treats whitespace-only strings as unset. */
function readNonEmpty(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}
