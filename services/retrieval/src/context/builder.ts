/**
 * Context assembly: turning ranked chunks into a prompt an answer model can cite.
 *
 * ## The two invariants
 *
 * 1. **Citations are numbered in the order their sources appear in the assembled context.**
 *    Not in retrieval order, not in score order — in the order the model will read them,
 *    starting at 1. The model is told to cite `[n]`, and `[n]` must mean one thing and one
 *    thing only.
 * 2. **Every retrieved chunk that made it into the prompt has a citation index.** Every one.
 *    There is no such thing as a passage the model may use but not cite.
 *
 * The failure mode these prevent is the one that makes a RAG system untrustworthy rather than
 * merely wrong: an answer that is grounded in the retrieved text but carries no resolvable
 * marker, so the user cannot check it. An uncited claim in the answer is a bug, not a rounding
 * error, and the web app verifies the correspondence in both directions before rendering
 * (`Answer.citations` in `@second-brain/shared`).
 *
 * ## What this module decides, and what it does not
 *
 * It decides *what evidence fits*: how much of the retrieved set can be included within the
 * token budget, and in what order. It does not decide *what the model should do* — that
 * instruction arrives as `BuildContextOptions.systemPrompt`, owned by the caller. Prompt
 * engineering is not this module's job, and mixing the two is how a context builder becomes
 * impossible to test.
 *
 * ## Truncation is reported, never hidden
 *
 * `BuiltContext.truncated` is true whenever candidates were dropped to fit the budget. A
 * silently truncated context produces an answer that looks complete and is not, which is worse
 * than an answer that admits its scope — and there is a second reason to track it: a corpus
 * where truncation is routine is a corpus whose chunks are too large.
 */
import { estimateTokens } from '@second-brain/shared';

import type { BuildContextOptions, BuiltContext } from '../types';
import type { ChatMessage } from '@second-brain/providers';
import type { Citation, RankedChunk, RetrievalResult } from '@second-brain/shared';

/**
 * Default total token budget for the assembled context.
 *
 * Sized to leave room in a 128k-context model for a multi-turn conversation and a long answer,
 * and to bound the cost of a chat turn: at `RERANK_TOP_K` candidates this is roughly four times
 * the evidence the reranker would normally produce, so the budget is a ceiling rather than a
 * target.
 */
export const CONTEXT_TOKEN_BUDGET = 6000;

/**
 * Characters of a chunk reproduced in its citation snippet.
 *
 * Enough to recognise the passage and to verify the claim without re-opening the document,
 * short enough that the citation list does not itself become the context.
 */
export const CITATION_SNIPPET_CHARS = 240;

/**
 * Estimates the token cost of a message list.
 *
 * Pure. Uses the shared `estimateTokens` (characters divided by a constant ratio), which is
 * deliberately an estimate: exact counting needs the provider's tokenizer, and a budget that is
 * off by a few percent is fine as long as it is consistently off. `reservedTokens` is added
 * afterwards for the answer itself, which is not part of the input but does consume the window.
 *
 * @param messages - Messages that will be sent.
 * @param reservedTokens - Tokens to hold back for the model's own output.
 */
export function estimateBudget(messages: readonly ChatMessage[], reservedTokens = 0): number {
  const messageTokens = messages.reduce(
    (total, message) => total + estimateTokens(message.content),
    0,
  );
  return messageTokens + Math.max(0, reservedTokens);
}

/**
 * Assembles the prompt-ready context.
 *
 * Contract:
 * - Selects evidence in retrieval order, best first, until the budget is exhausted. Retrieval
 *   order is preserved rather than reordered for diversity: the reranker already judged
 *   relevance, and second-guessing it here would make its output unaccountable.
 * - Never splits a chunk. A half-passage cannot be cited honestly, so a chunk that does not fit
 *   is dropped whole and the next one is considered.
 * - Assigns citation indices in the order the sources appear in the assembled context, from 1.
 * - Sets `truncated` whenever anything was dropped.
 * - Returns a context with zero citations rather than throwing when nothing fits. An empty
 *   context is a legitimate answer ("I have nothing on that"), and the caller renders it as one.
 *
 * @param result - The retrieval result being answered from.
 * @param opts - Budget, system prompt and conversation history. See `BuildContextOptions`.
 */
export function buildContext(
  _result: RetrievalResult,
  _opts: BuildContextOptions = {},
): BuiltContext {
  // TODO(phase-3): fill the system prompt, reserve tokens for the answer, call
  // `selectWithinBudget`, then `assignCitationIndexes` over exactly the selected chunks.
  throw new Error('Not implemented: buildContext');
}

/**
 * Takes the prefix of chunks that fits the budget.
 *
 * Pure with respect to its inputs. Order is preserved exactly; nothing is summarised, merged or
 * reordered. Returning an empty array is a correct outcome when the first chunk alone exceeds
 * the budget — the alternative, truncating the chunk, breaks the citation invariant.
 *
 * @param chunks - Candidates in retrieval order, best first.
 * @param maxTokens - Token budget available for the evidence block.
 */
export function selectWithinBudget(
  _chunks: readonly RankedChunk[],
  _maxTokens: number,
): RankedChunk[] {
  // TODO(phase-3): walk in order, accumulate `estimateTokens(chunk.text)`, stop before the
  // first chunk that would exceed the remaining budget, and never split a chunk.
  throw new Error('Not implemented: selectWithinBudget');
}

/**
 * Builds the citation list for the chunks that made it into the context.
 *
 * Pure. Indices are 1-based and follow the given order, so calling this with the *selected*
 * chunks (never the full retrieved set) is what makes the numbering match the prompt.
 *
 * A chunk's `source` decides which id is populated: `document` chunks set `documentId` from
 * `documentId`, `memory` and `activity` rows set `memoryId`, and exactly one of the two is
 * non-null on every citation. `snippet` is the chunk text truncated to
 * `CITATION_SNIPPET_CHARS` — the model relied on the passage, and the user must be able to see
 * the passage rather than a title.
 *
 * @param chunks - The chunks included in the context, in context order.
 */
export function assignCitationIndexes(_chunks: readonly RankedChunk[]): Citation[] {
  // TODO(phase-3): map each chunk to a `Citation` with `index = position + 1`, resolving the
  // provenance id from `source`, and truncating the snippet with the shared `truncate`.
  throw new Error('Not implemented: assignCitationIndexes');
}
