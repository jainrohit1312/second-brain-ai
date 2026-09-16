# @second-brain/processing

Turns captured activity and documents into memories: extract readable text, chunk it, score importance, classify topics, and distil durable statements about the user.

## Status

Scaffold only. The folder structure, the interfaces, the rule tables, the prompt-version constants and the type surface are real; **the pipeline does not run**. Every unimplemented function throws `Not implemented: <symbol>` behind a `TODO(phase-N)` marker.

What _is_ implemented, deliberately, because it is pure and deterministic and therefore worth getting right before anything depends on it:

- `normalizeSignal`, `computeScore` and `bandFor` — the scoring arithmetic, with no I/O of any kind.
- `DEFAULT_RULES` and `mergeRules` — the weighting table and the override merge.
- `decideMerge` — the insert / merge / supersede / reject policy, as a pure function of the deduplication verdict.
- `transcriptToPlainText` — pure flattening.
- Every constant: chunk sizes, separators, thresholds, saturation points, prompt versions.

Everything that reads or writes the network, the database, an LLM or a DOM is a placeholder with its contract written out in JSDoc.

## Layout

```
services/processing/
├── src/
│   ├── importance/
│   │   ├── index.ts        the engine: score / scoreBatch, ENGINE_VERSION
│   │   ├── signals.ts      SignalExtractor, one method per ImportanceSignals key
│   │   ├── rules.ts        DEFAULT_RULES, mergeRules, sumScoringWeights
│   │   └── score.ts        normalizeSignal, computeScore, bandFor (pure)
│   ├── extraction/
│   │   ├── readability.ts        @mozilla/readability over jsdom
│   │   ├── youtube-transcript.ts caption retrieval and grouping
│   │   └── cleaner.ts            boilerplate removal, whitespace, removedRatio
│   ├── chunking/
│   │   ├── index.ts        createChunker, ChunkingOptions barrel
│   │   ├── recursive.ts    RecursiveChunker, CHUNK_SIZE, CHUNK_OVERLAP, separators
│   │   └── semantic.ts     SemanticChunker (phase 2 placeholder)
│   ├── classification/
│   │   ├── topic-classifier.ts  classifyDocument, suggestNewTopic, prompt version
│   │   └── category-router.ts   routeToCategory, DEFAULT_ROUTING_RULES
│   ├── distillation/
│   │   ├── memory-extractor.ts  extractMemories, prompt version
│   │   ├── dedup.ts             findDuplicate, three cheapness tiers
│   │   └── merger.ts            decideMerge, mergeStatements, the temporal rule
│   ├── types/index.ts      local pipeline shapes and engine configuration
│   └── index.ts            package barrel
├── package.json
├── tsconfig.json
└── README.md
```

## What this service owns

| Stage            | Owned here                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `extraction`     | HTML → readable text, YouTube → transcript, cleaning, `ReadableResult` metadata              |
| `chunking`       | Split boundaries, overlap, heading paths, chunk identity                                     |
| `embedding`      | _What_ to embed and with which recorded model — the call itself is `@second-brain/providers` |
| `classification` | Topics, new-topic suggestions, category routing                                              |
| `distillation`   | Memory extraction, deduplication, merge/supersede policy                                     |
| `importance`     | Signals, weights, the scoring arithmetic and its version stamp                               |

## What this service explicitly does NOT own

| Not here                                                                        | Owner                                                                                          |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Validating client payloads, deduplicating activity events, storing raw captures | `services/ingestion`                                                                           |
| Retrieval, fusion, reranking, citation assembly, answer synthesis               | `services/retrieval`                                                                           |
| Provider selection, credentials, retry policy, HTTP clients                     | `packages/providers`                                                                           |
| SQL, migrations, RLS, the pgvector RPCs                                         | `packages/database`, `supabase/`                                                               |
| Rendering anything, including the settings UI that edits `DEFAULT_RULES`        | `apps/web`                                                                                     |
| The client-side pre-filter score                                                | `apps/chrome-extension`, `apps/android` — this service re-scores authoritatively on the server |

In short: this service decides _what the captured content means_. It never decides what to search for, and it never talks to a client.

## The importance signals

`ImportanceSignals` is the complete input vector. Every signal has a defined range and a saturation point; `normalizeSignal` maps it to `[0, 1]`.

| Signal              | Meaning                                              | Range                             | Normalized by                                   | Needs history |
| ------------------- | ---------------------------------------------------- | --------------------------------- | ----------------------------------------------- | ------------- |
| `dwellSeconds`      | Active time on the page, from `page_view.durationMs` | `>= 0` seconds                    | saturates at `DWELL_SATURATION_SECONDS` (180 s) | no            |
| `scrollDepthPct`    | Maximum depth reached, not final position            | `0–100`                           | `/ 100`                                         | no            |
| `isUniqueDomain`    | First visit to this domain                           | boolean                           | `0`/`1`                                         | **yes**       |
| `revisitCount`      | Prior views of the same canonical URL                | `>= 0`                            | saturates at `REVISIT_SATURATION_COUNT` (3)     | **yes**       |
| `wordCount`         | Length of the readable body                          | `>= 0` words                      | saturates at `LONG_FORM_WORD_COUNT` (1500)      | no            |
| `hasSelection`      | A passage was highlighted                            | boolean                           | `0`/`1`                                         | no            |
| `hasCopy`           | A passage was copied                                 | boolean                           | `0`/`1`                                         | no            |
| `isBookmarked`      | Explicitly bookmarked                                | boolean                           | `0`/`1`                                         | no            |
| `isDownloaded`      | A file was downloaded                                | boolean                           | `0`/`1`                                         | no            |
| `youtubeWatchedPct` | Fraction of a video watched                          | `0–1` (meaningless for non-video) | clamped                                         | no            |
| `appIsExcluded`     | The app is on the exclusion list                     | boolean                           | `0`/`1`, **veto**                               | no            |
| `isWorkingHours`    | Captured inside the working-hours window             | boolean                           | `0`/`1`                                         | no            |
| `topicNovelty`      | Dissimilarity from everything already known          | `0–1`                             | clamped                                         | **yes**       |

The three history-dependent signals are the concrete reason a client score cannot be trusted: a device has no `seenDomains`, no revisit counts and no topic centroids, so it is scoring from a strictly smaller input vector than the server is.

Weights live in `DEFAULT_RULES` (one rule per signal, 12 positive weights summing to `REQUIRED_WEIGHT_SUM`, plus `rule.app-excluded` at `-1` as an exact veto). The whole table is the surface exposed in the web app's Settings page, and it is applied through `mergeRules(DEFAULT_RULES, overrides)` so a user's edits survive a new default.

## Scripts

| Script      | Command                                        | Notes                                              |
| ----------- | ---------------------------------------------- | -------------------------------------------------- |
| `build`     | `tsup src/index.ts --format esm --dts`         | Emits ESM plus declarations.                       |
| `dev`       | `tsup src/index.ts --format esm --dts --watch` | Watch mode.                                        |
| `lint`      | `eslint src --ext .ts`                         | Repo ESLint config.                                |
| `typecheck` | `tsc --noEmit`                                 | Uses this package's `tsconfig.json`.               |
| `test`      | `vitest run --passWithNoTests`                 | Passing with zero tests is expected until phase 2. |
| `clean`     | `rimraf dist .turbo`                           | Removes build output and Turborepo cache.          |

## Configuration

| Variable                                                                                             | Used for                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CHUNK_SIZE`                                                                                         | Target characters per chunk. Mirrors `CHUNK_SIZE` (800) in `recursive.ts`.                                                      |
| `CHUNK_OVERLAP`                                                                                      | Characters carried between chunks. Mirrors `CHUNK_OVERLAP` (120).                                                               |
| `IMPORTANCE_MIN_THRESHOLD`                                                                           | Floor below which a scored event is dropped rather than persisted.                                                              |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`                                      | The embedding provider used by `SemanticChunker` and by memory embedding. Changing the model is a re-embed migration (ADR-004). |
| `LLM_PROVIDER`, `LLM_MODEL`                                                                          | The model behind classification, distillation and merge rewriting.                                                              |
| `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DASHSCOPE_API_KEY` / `GEMINI_API_KEY` | Credentials for whichever `LLM_PROVIDER` is selected.                                                                           |
| `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`                                                              | Optional local inference for classification and distillation.                                                                   |

Providers are constructed from the environment by `@second-brain/providers` (`embeddingProviderFromEnv`, `llmProviderFromEnv`); this service never reads a credential itself.

## Public exports

From the package root (`@second-brain/processing`):

- **Importance** — `createImportanceEngine`, `ENGINE_VERSION`, `extractSignals`, `defaultSignalExtractor`, `normalizeSignal`, `computeScore`, `bandFor`, `DEFAULT_RULES`, `mergeRules`, `sumScoringWeights`, `APP_EXCLUDED_RULE_ID`, `REQUIRED_WEIGHT_SUM`.
- **Extraction** — `extractReadable`, `MIN_CONTENT_LENGTH`, `fetchTranscript`, `groupTranscriptIntoChunks`, `transcriptToPlainText`, `isTranscriptAvailable`, `TRANSCRIPT_CHUNK_SECONDS`, `cleanText`, `stripBoilerplate`, `removeNavAndFooter`, `collapseWhitespace`, `dedupeRepeatedLines`, `normalizeUnicode`.
- **Chunking** — `createChunker`, `RecursiveChunker`, `SemanticChunker`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `DEFAULT_SEPARATORS`, `SEMANTIC_SIMILARITY_THRESHOLD`.
- **Classification** — `classifyDocument`, `suggestNewTopic`, `routeToCategory`, `topicClassificationSchema`, `newTopicSuggestionSchema`, `DEFAULT_ROUTING_RULES`, `CLASSIFIER_PROMPT_VERSION`, `MAX_TOPICS_PER_DOCUMENT`.
- **Distillation** — `extractMemories`, `findDuplicate`, `decideMerge`, `mergeStatements`, `distilledMemoriesSchema`, `DISTILLATION_PROMPT_VERSION`, `MAX_MEMORIES_PER_DOCUMENT`, `EXACT_MATCH`, `NEAR_DUPLICATE_THRESHOLD`, `CANDIDATE_K`.
- **Types** — `ImportanceEngine`, `ScoringRule`, `RuleCondition`, `ScoreStamp`, `SignalExtractor`, `Chunker`, `ChunkingOptions`, `TextChunk`, `CleanedText`, `ReadableResult`, `TranscriptSegment`, `DistillationInput`, `PersistedChunk`, `ProcessingPipelineStage`, `ProcessingResult`, `ImportanceEngineConfig`, `ImportanceRuleOverride`.

## Related docs

- `docs/PROJECT_OVERVIEW.md` — what a memory is, and why zero memories from a document is a correct outcome.
- `docs/ARCHITECTURE.md` — where the pipeline runs and what triggers each stage.
- `docs/DECISIONS.md` — ADR-004 (embedding model pinning), ADR-007 (memories over summaries), ADR-008 (supersede, never delete).
- `docs/DATABASE_SCHEMA.md` — `document_chunks`, `memories`, `topics`, and the constraint each stage writes against.
- `docs/RESEARCH_NOTES.md` — provider candidates and the experiments that set the thresholds in `chunking/semantic.ts` and `distillation/dedup.ts`.
- `docs/TASKS.md` — the phased build order.
