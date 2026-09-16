# @second-brain/shared

The cross-cutting contract layer: domain types, constants, and pure utilities that every other workspace depends on.

## Status

**Types and constants are complete. Pure utilities are implemented. Everything else in the repository is still a stub.**

This package is intentionally the most finished part of the scaffold, because it is the one piece the other workspaces are written against. There is no I/O here, so nothing in it needs a database, a network, or a model to be correct — which is why the utilities below are written rather than stubbed. The one exception is called out in the notes.

## Layout

```
src/
├── types/
│   ├── activity.ts      ActivityEvent union (9 event types), ActivityBatch, IngestionOutcome
│   ├── device.ts        Device, DevicePlatform, DeviceSyncState
│   ├── document.ts      Document, DocumentChunk, ExtractionResult
│   ├── memory.ts        Memory, MemoryCandidate, MemoryMergeDecision
│   ├── topic.ts         Topic, TopicAssignment, CategoryAssignment
│   ├── importance.ts    ImportanceSignals, ImportanceScore, ImportanceRule
│   └── retrieval.ts     RetrievalQuery, RankedChunk, Citation, Answer
├── constants/
│   ├── event-types.ts   SCHEMA_VERSION, ACTIVITY_EVENT_TYPES, PASSIVE_EVENT_TYPES
│   ├── sources.ts       SOURCES, EXTRACTABLE_SOURCES, VIDEO_SOURCES
│   ├── categories.ts    CATEGORIES, DEFAULT_CATEGORY_SLUG, CATEGORY_CONFIDENCE_THRESHOLD
│   └── importance.ts    IMPORTANCE_BAND_THRESHOLDS, IMPORTANCE_ENGINE_VERSION
├── utils/
│   ├── hash.ts          fnv1a64Hex, contentHash, dedupeKey, sha256Hex
│   ├── date.ts          nowIso, dayKeyUtc, isWithinWindow, isWorkingHours
│   ├── text.ts          canonicalizeUrl, extractDomain, wordCount, slugify
│   └── validation.ts    isValidUrl, isIsoTimestamp, clamp01, assertNever, parseJsonSafe
└── index.ts             Barrel — the only entry point other workspaces may import
```

## Scripts

| Script      | Command                                | Purpose                        |
| ----------- | -------------------------------------- | ------------------------------ |
| `build`     | `tsup src/index.ts --format esm --dts` | Emit `dist/` with declarations |
| `dev`       | `tsup … --watch`                       | Rebuild on change              |
| `lint`      | `eslint src --ext .ts`                 | Lint this workspace            |
| `typecheck` | `tsc --noEmit`                         | Type-check without emitting    |
| `test`      | `vitest run --passWithNoTests`         | Unit tests                     |
| `clean`     | `rimraf dist .turbo`                   | Remove build output            |

## Configuration

None. This package reads no environment variables, opens no connections, and has **zero runtime dependencies** — that is a hard invariant, not an accident. Both the browser extension bundle and the Android app's mental model of the domain rest on this package, so anything with I/O belongs in `@second-brain/database` or `@second-brain/providers` instead.

## Rules for adding to this package

1. **No I/O, no `node:*` imports, no runtime dependencies.** It must run unchanged in a service worker, a browser tab, Node 20, and Deno.
2. **Types describe the contract, not the implementation.** If a type only exists to serve one service's internals, it belongs in that service's `src/types/`, which is why `services/processing` and `services/retrieval` each have their own.
3. **Changing a type here is a cross-workspace change.** Grep before you rename; the ingestion zod schemas, the `database.ts` row shapes, the Android serialization DTOs, and the edge function payloads all mirror these definitions.
4. **Prefer adding an optional field over changing an existing one.** The extension and the Android app ship on their own release cadence, and an old client will keep sending the old shape.

### Two deliberate implementation choices

- **`contentHash` and `dedupeKey` use FNV-1a 64-bit, not SHA-256.** Both must be computable _synchronously_ and _identically_ inside a Chrome content script, a React Native-less Android app, and Node, before anything reaches the server. WebCrypto is async and unavailable in insecure contexts. 64 bits is more than enough to deduplicate one user's corpus. `sha256Hex` (async, WebCrypto) is exported for the cases that need a real digest, and it documents its own secure-context requirement.
- **All timestamps crossing a boundary are ISO-8601 UTC strings, never `Date` objects.** The same value travels through Postgres `timestamptz`, JSON, IndexedDB, and Room; a string is the only representation that survives all four without a timezone conversation.

## Related docs

- [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) — where these types sit in the data flow
- [DATABASE_SCHEMA.md](../../docs/DATABASE_SCHEMA.md) — the tables these types map onto
- [DECISIONS.md](../../docs/DECISIONS.md) — ADR-004 (pinned embedding dimensions), ADR-009 (the client's score is untrusted), ADR-010 (durable on-device queues)
