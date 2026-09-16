# @second-brain/providers

Embedding and LLM adapters behind two interfaces, so a provider can be swapped without touching the services that use it.

## Status

**Scaffold.** The interfaces, the defaults tables, and the factories are real code;
every adapter method is a `// TODO(phase-2)` stub that throws
`Not implemented: <Class>.<method>`. Nothing here performs an HTTP request yet, and
the package has no tests — `vitest run --passWithNoTests` is expected to pass
vacuously.

Implemented today: config resolution, the `{ model, dimensions, baseUrl, envKey }`
defaults tables, environment reading and validation, `ProviderError`, and the
dimension guard. Not implemented: request building, response mapping, retries,
timeouts, streaming, and health probes.

## Layout

```
packages/providers/
├── src/
│   ├── embedding/
│   │   ├── interface.ts   EmbeddingProvider, EmbedOptions, EmbeddingResult, defaults shape
│   │   ├── nvidia.ts      NvidiaEmbeddingProvider (default) + NVIDIA_EMBEDDING_DEFAULTS
│   │   ├── openai.ts      OpenAiEmbeddingProvider      + OPENAI_EMBEDDING_DEFAULTS
│   │   ├── gemini.ts      GeminiEmbeddingProvider      + GEMINI_EMBEDDING_DEFAULTS
│   │   ├── local.ts       LocalEmbeddingProvider       + LOCAL_EMBEDDING_DEFAULTS
│   │   └── factory.ts     createEmbeddingProvider, embeddingProviderFromEnv,
│   │                      EMBEDDING_PROVIDER_DEFAULTS, assertDimensionsMatch
│   ├── llm/
│   │   ├── interface.ts   LlmProvider, Completion*, JsonCompletionRequest, defaults shape
│   │   ├── deepseek.ts    DeepSeekLlmProvider (default) + DEEPSEEK_LLM_DEFAULTS
│   │   ├── openai.ts      OpenAiLlmProvider             + OPENAI_LLM_DEFAULTS
│   │   ├── gemini.ts      GeminiLlmProvider             + GEMINI_LLM_DEFAULTS
│   │   ├── claude.ts      ClaudeLlmProvider             + CLAUDE_LLM_DEFAULTS
│   │   ├── qwen.ts        QwenLlmProvider               + QWEN_LLM_DEFAULTS
│   │   ├── local.ts       LocalLlmProvider              + LOCAL_LLM_DEFAULTS
│   │   └── factory.ts     createLlmProvider, llmProviderFromEnv, LLM_PROVIDER_DEFAULTS,
│   │                      isStructuredTaskSafe
│   ├── types/index.ts     ProviderConfig, ProviderUsage, ProviderHealth, ProviderError, constants
│   └── index.ts           barrel — the only public entry point
├── package.json
├── tsconfig.json
└── README.md
```

The concrete adapter classes are deliberately **not** exported from the barrel. Build
instances with `createEmbeddingProvider(id, overrides?)` /
`createLlmProvider(id, overrides?)`, or from the environment with
`embeddingProviderFromEnv` / `llmProviderFromEnv`.

## Scripts

| Script      | Command                                        | Purpose                                      |
| ----------- | ---------------------------------------------- | -------------------------------------------- |
| `build`     | `tsup src/index.ts --format esm --dts`         | ESM bundle plus type declarations in `dist/` |
| `dev`       | `tsup src/index.ts --format esm --dts --watch` | Rebuild on change                            |
| `typecheck` | `tsc --noEmit`                                 | Types only                                   |
| `lint`      | `eslint src --ext .ts`                         | Repo ESLint config                           |
| `test`      | `vitest run --passWithNoTests`                 | Test suite (none yet)                        |
| `clean`     | `rimraf dist .turbo`                           | Remove build output and Turbo cache          |

## Provider matrix

Embeddings. `Dimensions` is the width written into `document_chunks.embedding` and
`memories.embedding` — see the swap checklist below before changing it.

| Id                   | Default model                | Dimensions                          | Base URL                                           | Env key                                            | OpenAI-compatible                                                                    |
| -------------------- | ---------------------------- | ----------------------------------- | -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `nvidia` _(default)_ | `nv-embedqa-e5-v5`           | 1024                                | `https://integrate.api.nvidia.com/v1`              | `NVIDIA_API_KEY` (override URL: `NVIDIA_BASE_URL`) | Yes, plus a **required** `input_type` (`query` / `passage`)                          |
| `openai`             | `text-embedding-3-small`     | 1536 (truncatable via `dimensions`) | `https://api.openai.com/v1`                        | `OPENAI_API_KEY` (override URL: `OPENAI_BASE_URL`) | Yes                                                                                  |
| `gemini`             | `text-embedding-004`         | 768                                 | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY`                                   | **No** — `:embedContent` / `:batchEmbedContents`, `taskType` instead of `input_type` |
| `local`              | `nomic-embed-text` (assumed) | 768                                 | `http://127.0.0.1:11434/v1`                        | none (override URL: `LOCAL_LLM_BASE_URL`)          | Yes                                                                                  |

Selected with `EMBEDDING_PROVIDER`; `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS`
override the model and width for whichever provider is active.

LLMs. `Context` is the documented window in tokens, used for budgeting only.

| Id                     | Default model                       | Context      | Base URL                                            | Env key                                                | OpenAI-compatible                                                                                 |
| ---------------------- | ----------------------------------- | ------------ | --------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `deepseek` _(default)_ | `deepseek-chat`                     | 64k          | `https://api.deepseek.com/v1`                       | `DEEPSEEK_API_KEY` (override URL: `DEEPSEEK_BASE_URL`) | Yes                                                                                               |
| `openai`               | `gpt-4o-mini`                       | 128k         | `https://api.openai.com/v1`                         | `OPENAI_API_KEY` (override URL: `OPENAI_BASE_URL`)     | Yes (reference shape)                                                                             |
| `gemini`               | `gemini-1.5-flash`                  | 1M           | `https://generativelanguage.googleapis.com/v1beta`  | `GEMINI_API_KEY`                                       | **No** — `contents` + top-level `systemInstruction` + `generationConfig`; `x-goog-api-key` header |
| `claude`               | `claude-3-5-sonnet-latest`          | 200k         | `https://api.anthropic.com`                         | `ANTHROPIC_API_KEY`                                    | **No** — `/v1/messages`, top-level `system`, **required** `max_tokens`                            |
| `qwen`                 | `qwen-plus`                         | 131,072      | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` (override URL: `QWEN_BASE_URL`)    | Yes, compatible-mode surface only                                                                 |
| `local`                | _must be set via `LOCAL_LLM_MODEL`_ | 8k (assumed) | `http://127.0.0.1:11434/v1`                         | none (override URL: `LOCAL_LLM_BASE_URL`)              | Yes (Ollama `/v1/chat/completions`)                                                               |

Selected with `LLM_PROVIDER`; `LLM_MODEL` overrides the model. `gemini` and `claude`
are the two adapters that need real care: their request shapes differ from the OpenAI
one in ways that fail loudly (a rejected `system` message, a missing `anthropic-version`
header, a missing `max_tokens`).

`isStructuredTaskSafe(provider)` reports whether a backend's native structured-output
mode is trustworthy for `completeJson`: `true` for `deepseek`, `openai`, `qwen`;
`false` for `gemini`, `claude`, `local`. It is a routing hint, not a guarantee —
`completeJson` validates against the caller's schema locally in every case.

## Swapping a provider

Embeddings — **a data migration, not a config change.** Vectors from different models
are not comparable, and nothing raises an error when they are mixed; similarity just
becomes meaningless.

1. Check the new width against what is stored (`assertDimensionsMatch(stored, provider.dimensions)`).
   A different width also needs a migration: the `vector(n)` column type is fixed when
   the migration lands.
2. Re-embed every row that has a vector — `document_chunks.embedding` and
   `memories.embedding` — and update `embedding_model` on each so provenance follows
   the vector.
3. Re-embed in batches, largest tables first, and keep the old vectors until the new
   pass completes; a half-migrated column is worse than an unmigrated one.
4. Update the env keys (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`
   and the provider credential) and restart the services that hold a provider instance.
5. At query time, embed searches with the same model **and** `inputType: 'query'`;
   asymmetric models get materially worse, not just slightly worse, when the query is
   embedded as a document.
6. Record the decision in `docs/DECISIONS.md` (ADR-004 is the existing precedent) —
   the model name alone is not enough to reconstruct why the switch happened.

LLMs — **a config change with a reproducibility cost.** No stored data becomes invalid,
but distillation and classification are not reproducible across models: the same chunk
can yield a different memory, and prompts tuned for one provider rarely transfer
unchanged.

1. Confirm the new provider is safe for structured tasks (`isStructuredTaskSafe`), and
   expect a higher retry rate on the one that is not. Prompt changes count as
   behaviour changes and belong in the migration notes.
2. Check the context window before anything assumes the old budget: the gap between a
   64k and a 1M window changes how much context retrieval may assemble.
3. Re-running distillation over existing chunks is optional and, unlike the embedding
   case, never required — but if it is done, it should be a deliberate backfill, not a
   side effect of a deploy.
4. Update `LLM_PROVIDER`, `LLM_MODEL`, and the provider credential; `services/retrieval`
   builds its provider at startup, so it needs a restart.

## Retry and error contract

Every adapter rejects with `ProviderError`, which carries `provider`, `statusCode`,
`retryable` and the original `cause`:

| Condition                                  | `statusCode` | `retryable` |
| ------------------------------------------ | ------------ | ----------- |
| Transport failure or timeout (no response) | `null`       | `true`      |
| HTTP 408, 429, 5xx                         | the status   | `true`      |
| HTTP 400, 401, 403, and every other 4xx    | the status   | `false`     |

Retrying a 401 or a 400 cannot succeed; it only delays the error the caller has to
surface and spends the retry budget a genuinely transient failure would need. Backoff
is exponential with a base of `RETRY_BASE_DELAY_MS` (500 ms). Defaults:
`DEFAULT_TIMEOUT_MS` (30 s per attempt) and `DEFAULT_MAX_RETRIES` (3 attempts after the
first failure); both are settable per instance through `ProviderConfig`.

Environment and configuration errors (unknown provider id, missing credential,
non-numeric dimensions) also arrive as `ProviderError` with `retryable: false`, so a
misconfigured process fails at startup rather than on the first batch.

`health()` is the exception to "throws on failure": it reports `ok: false` with an
error string instead, because a status page asking whether a provider is reachable
should not itself need a try/catch.

## Batching

`embed` and `embedMany`-style callers pass arrays on purpose: per-call overhead
dominates, and chunk-level embedding of one article is thousands of round trips when
issued one text at a time.

- Batch target is the low hundreds of texts. `EmbedOptions.batchSize` overrides it
  per call; Gemini's `:batchEmbedContents` hard-caps at 100 requests per call, which is
  where that option earns its keep.
- The ceiling is often tokens, not text count — OpenAI measures the request that way —
  so an oversized batch fails on a `400` and is not retryable. Prefer slightly smaller
  batches over the theoretical maximum.
- Input order is preserved: `vectors[i]` belongs to `texts[i]`. Persist the pairing
  immediately; reordering after the fact is not recoverable from the vectors.
- A local server serialises work, so a large batch there is slower, not faster. Batch
  to amortise overhead, and cap concurrency when several batches run at once — a
  provider-level 429 is the cheap failure mode, a throttled account is the expensive one.
- `embedOne` exists for interactive query embedding only. Ingestion paths must use
  `embed`.

## Configuration

Read from the process environment by `embeddingProviderFromEnv` / `llmProviderFromEnv`;
see `.env.example` for the full template and comments.

| Variable                                                                                                           | Used by     | Notes                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------- |
| `EMBEDDING_PROVIDER`                                                                                               | embeddings  | One of `nvidia`, `openai`, `gemini`, `local`; defaults to `nvidia`                       |
| `EMBEDDING_MODEL`                                                                                                  | embeddings  | Overrides the model for the active provider                                              |
| `EMBEDDING_DIMENSIONS`                                                                                             | embeddings  | Must match stored vectors; a change means re-embedding                                   |
| `LLM_PROVIDER`                                                                                                     | LLMs        | One of `deepseek`, `openai`, `gemini`, `claude`, `qwen`, `local`; defaults to `deepseek` |
| `LLM_MODEL`                                                                                                        | LLMs        | Overrides the model for the active provider                                              |
| `NVIDIA_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `DASHSCOPE_API_KEY` | credentials | Required only for the provider in use; a blank value is treated as missing               |
| `NVIDIA_BASE_URL`, `OPENAI_BASE_URL`, `DEEPSEEK_BASE_URL`, `QWEN_BASE_URL`, `LOCAL_LLM_BASE_URL`                   | base URLs   | Optional overrides for proxies, gateways and regional hosts                              |
| `LOCAL_LLM_MODEL`                                                                                                  | local LLM   | The only way to name a local model; the `local` entry has no default                     |

## Related docs

- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — where providers sit in the pipeline
- [`docs/DECISIONS.md`](../../docs/DECISIONS.md) — ADR-004: provider choice and the re-embed rule
- [`docs/RESEARCH_NOTES.md`](../../docs/RESEARCH_NOTES.md) — model benchmarks and spikes
- [`../../.env.example`](../../.env.example) — the environment template these readers expect
- [`../shared`](../shared) — domain types the services pass through providers
