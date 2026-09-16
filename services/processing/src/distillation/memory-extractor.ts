/**
 * Memory distillation — the heart of the product.
 *
 * ## What qualifies as a memory
 *
 * A memory is a **durable, self-contained, de-contextualised statement about the user or
 * their work**. It is not a summary of the document it came from. The test is whether the
 * statement still means something with the document deleted.
 *
 * | Source | Not a memory | Is a memory |
 * | --- | --- | --- |
 * | A blog post about vector index tuning | "An article explaining HNSW versus IVFFlat." | "Mara is evaluating vector index options for a Postgres-backed retrieval service and is leaning toward HNSW for its incremental-write behaviour." |
 * | A meeting-notes page | A summary of the four agenda items. | "The Northwind migration was deferred to Q1 because the client's legal review slipped." |
 *
 * Three properties have to hold, and dropping any one of them is what produces the archive
 * of summaries this product exists to avoid:
 *
 * 1. **Durable** — still true in a month, or explicitly time-bounded.
 * 2. **Self-contained** — no pronouns pointing at a document, no "this article".
 * 3. **About the user or their work** — a fact the *user* now holds, not a fact the internet
 *    holds. "Postgres has a pgvector extension" is not a memory; it is common knowledge.
 *
 * ## Zero or one, never forced
 *
 * A document typically yields **zero or one** memory. A recipe, a sports score, a login
 * screen, a meme: the correct output is an empty array, and the extractor must be able to
 * say so cheaply. **Forcing one memory per document is a known anti-pattern** — it fills the
 * store with restatements of titles, which then compete with real memories in retrieval and
 * make every answer worse. See `docs/DECISIONS.md`, ADR-007.
 *
 * ## Why it runs after classification
 *
 * `MemoryCandidate.topicIds` comes from the topics already assigned to the document, so
 * distillation inherits the taxonomy instead of inventing a second one. Topics also bias the
 * prompt: a document about a client project should yield a project statement rather than a
 * generic fact.
 */
import { z } from 'zod';

import type { DistillationInput } from '../types';
import type { LlmProvider } from '@second-brain/providers';
import type { MemoryCandidate } from '@second-brain/shared';

/**
 * Version of the distillation prompt and response contract.
 *
 * Stored with every memory it produced. Without it, "this memory came from prompt v1 and
 * that one from v3" is unknowable after the fact, and a prompt regression cannot be
 * attributed or rolled back.
 */
export const DISTILLATION_PROMPT_VERSION = 'distill-v1';

/**
 * Hard ceiling on memories per document.
 *
 * Not a target. It exists to bound the cost of a runaway response and to make "this document
 * wants to say twenty things" a visible failure rather than an unbounded insert. The expected
 * count is zero or one.
 */
export const MAX_MEMORIES_PER_DOCUMENT = 3;

/** Maximum length of a statement, in characters. Long statements are summaries in disguise. */
export const MAX_STATEMENT_LENGTH = 500;

/**
 * The response contract for distillation, validated locally by `LlmProvider.completeJson`.
 *
 * `kind` is listed as literals rather than imported, because zod needs a runtime list; the
 * inferred type is assignable to the shared `MemoryKind`, so adding a kind in shared without
 * adding it here is a compile error at the point where a candidate is constructed.
 *
 * Chunks are referenced by ordinal, not by id: the model sees the document as an ordered
 * list and cannot be trusted to echo a uuid. The mapping back to `sourceChunkIds` happens in
 * code, and a candidate whose ordinals resolve to nothing is discarded — an unsupported
 * memory is not a memory.
 */
export const distilledMemoriesSchema = z.object({
  memories: z
    .array(
      z.object({
        kind: z.enum([
          'fact',
          'preference',
          'decision',
          'project',
          'entity',
          'insight',
          'task',
          'reference',
        ]),
        statement: z.string().min(1).max(MAX_STATEMENT_LENGTH),
        confidence: z.number().min(0).max(1),
        importance: z.number().min(0).max(1),
        /** Ordinals of the chunks that support this statement. Never empty for a kept candidate. */
        sourceChunkOrdinals: z.array(z.number().int().min(0)).max(5),
      }),
    )
    .max(MAX_MEMORIES_PER_DOCUMENT),
});

/**
 * Distils a document's chunks into memory candidates.
 *
 * Contract:
 * - Runs at `temperature: 0`, so re-distilling the same document with the same prompt version
 *   is idempotent — which is what makes the pipeline safe to re-run. See success criterion S5
 *   in `docs/PROJECT_OVERVIEW.md`.
 * - Returns `[]` rather than a filler statement when nothing durable is present. This is the
 *   expected outcome for most documents and must not be treated as a failure by the caller.
 * - Every returned candidate cites at least one `sourceChunkId` that exists in the input.
 *   Candidates citing nothing are dropped, because provenance is what makes a memory
 *   verifiable and a memory that cannot be verified cannot be corrected.
 * - `topicIds` is inherited from `input.topics`; the model does not propose topics here.
 *
 * @param input - Title, chunks and inherited topics. See `DistillationInput`.
 * @param llm - Provider used for the distillation call.
 */
export async function extractMemories(
  _input: DistillationInput,
  _llm: LlmProvider,
): Promise<MemoryCandidate[]> {
  // TODO(phase-2): build the prompt from `DISTILLATION_PROMPT_VERSION`, call
  // `llm.completeJson({ schema: distilledMemoriesSchema, temperature: 0 })`, resolve chunk
  // ordinals to ids, drop unsupported candidates, and inherit `input.topics` as `topicIds`.
  throw new Error('Not implemented: extractMemories');
}
