/**
 * Merge decisions and statement rewriting.
 *
 * Once deduplication has decided that a candidate relates to an existing memory, one of four
 * things happens. Three of them change the store, and the difference between them is the
 * product's memory semantics rather than an implementation detail.
 *
 * ## `merge` versus `supersede`
 *
 * - **Merge** — the candidate *adds* to the existing statement without contradicting it:
 *   "Mara is migrating the retrieval service to Postgres" plus "…and pinned pgvector 0.7".
 *   The two statements are rewritten into one, and the existing memory keeps its identity,
 *   its `validFrom`, and its provenance.
 * - **Supersede** — the candidate *cannot both be true* with the existing statement, or is a
 *   change over time: "the migration was scheduled for Q3" then "the migration slipped to
 *   Q1". The existing memory is closed and a new one is inserted.
 *
 * ## The temporal rule
 *
 * A superseded memory is **never deleted**. It gets `validTo` set to the moment it stopped
 * being believed and `supersededBy` pointing at its replacement, which forms a forward-only
 * revision chain. This is what makes "what did I believe in March?" answerable, and it is why
 * `MemoryStatus` has a `superseded` member at all. Deleting the old row would answer that
 * question with the current belief and a confident tone, which is the worst possible answer.
 *
 * Nothing in this module writes to the database. `decideMerge` is pure and `mergeStatements`
 * only rewrites text; applying the decision is the data layer's job, and the two writes it
 * needs already exist as `MemoriesQueries.supersede(oldId, newId, validTo)` and
 * `MemoriesQueries.mergeStatements(id, statement)` in `@second-brain/database`. That layer also
 * requires the rewritten `statement_hash` to be recomputed in the same write, or the next
 * distillation pass will not recognise the merged statement as a duplicate of itself.
 */
import { assertNever, type MemoryCandidate, type MemoryMergeDecision } from '@second-brain/shared';

import type { DuplicateMatch } from './dedup';
import type { LlmProvider } from '@second-brain/providers';

/** Maximum length of a rewritten statement, matching the extraction bound. */
export const MAX_MERGED_STATEMENT_LENGTH = 500;

/**
 * Decides what to do with a candidate given the deduplication verdict.
 *
 * Pure and synchronous: no I/O, no clock, no model. The mapping is a function of the match
 * alone, which is what makes the merge policy reviewable in one place instead of scattered
 * across the extraction path.
 *
 * `mergedStatement` is always `null` here. `decideMerge` cannot rewrite text (that needs a
 * model and is therefore not pure), so when it returns `merge` the caller must call
 * `mergeStatements` and fill the field before persisting. Returning `null` on a `merge` is
 * deliberate: it is a signal that the decision is incomplete, not a complete decision with an
 * empty string.
 *
 * @param candidate - The distilled candidate being admitted.
 * @param match - The deduplication verdict, or `null` when nothing was close enough.
 */
export function decideMerge(
  candidate: MemoryCandidate,
  match: DuplicateMatch | null,
): MemoryMergeDecision {
  if (match === null) {
    return {
      action: 'insert',
      targetMemoryId: null,
      reason: `No related memory found for this ${candidate.kind}; stored as new.`,
      mergedStatement: null,
    };
  }

  const similarity = match.similarity.toFixed(3);

  switch (match.relation) {
    case 'duplicate':
      return {
        action: 'reject',
        targetMemoryId: match.memoryId,
        reason: `Already known: ${match.kind} match at similarity ${similarity} ("${match.targetStatement}").`,
        mergedStatement: null,
      };

    case 'complementary':
      return {
        action: 'merge',
        targetMemoryId: match.memoryId,
        reason: `Complementary detail at similarity ${similarity}; rewrite with mergeStatements before persisting.`,
        mergedStatement: null,
      };

    case 'contradictory':
      return {
        action: 'supersede',
        targetMemoryId: match.memoryId,
        reason: `Contradicts or supersedes the existing memory at similarity ${similarity}; close it with validTo and point supersededBy at the replacement.`,
        mergedStatement: null,
      };

    case 'unrelated':
      return {
        action: 'insert',
        targetMemoryId: null,
        reason: `Nearest neighbour at similarity ${similarity} is unrelated; stored as new.`,
        mergedStatement: null,
      };

    default:
      return assertNever(match.relation, 'Unhandled memory relation');
  }
}

/**
 * Rewrites two statements into one.
 *
 * Contract:
 * - The result is a single self-contained statement, no longer than
 *   `MAX_MERGED_STATEMENT_LENGTH`, in the same third-person, de-contextualised voice as the
 *   extractor produces. A merge that produces two sentences joined by "and also" has failed
 *   and should have been an insert.
 * - The existing statement's meaning must survive: dropping a qualifier that made the
 *   original true is a silent corruption of the user's record.
 * - Runs at `temperature: 0`, so re-merging the same pair is idempotent.
 *
 * @param baseStatement - The existing memory's statement, which keeps its identity.
 * @param incomingStatement - The candidate's statement, which normally contributes a qualifier.
 * @param llm - Provider used for the rewrite.
 */
export async function mergeStatements(
  _baseStatement: string,
  _incomingStatement: string,
  _llm: LlmProvider,
): Promise<string> {
  // TODO(phase-2): prompt for one rewritten statement at `temperature: 0`, validate it is
  // non-empty and within `MAX_MERGED_STATEMENT_LENGTH`, and fall back to the base statement
  // on a schema violation rather than dropping both.
  throw new Error('Not implemented: mergeStatements');
}
