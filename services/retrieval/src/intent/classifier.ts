/**
 * Query intent classification.
 *
 * Intent decides which retrievers run and with what weight, so getting it wrong is expensive
 * in a specific way: an activity question ("what did I work on last Tuesday") answered by
 * semantic search over documents returns plausible, irrelevant articles, while the same
 * question answered through the event index returns the actual answer.
 *
 * ## Two paths, cheapest first
 *
 * 1. **A rule path** over lexical features — temporal cues, activity verbs, question words,
 *    query length, and the presence of a capitalised or quoted named thing. It is pure, runs
 *    in microseconds, is trivially explainable, and is right for the overwhelming majority of
 *    real queries. It is the path implemented in this file.
 * 2. **An LLM fallback**, only for queries the rules score as low-confidence. This is the
 *    expensive path: a model call on the interactive latency path of every search box
 *    keystroke is both wasteful and slow, and it is non-deterministic, which is worse for a
 *    component whose output changes which retrievers run.
 *
 * The rule path therefore has to *know when it does not know*. `classifyIntent` must fall
 * back rather than guess `mixed` — a silently wrong intent is not recoverable downstream,
 * because the retrievers that would have answered correctly never ran.
 */
import { normalizeWhitespace, type QueryIntent } from '@second-brain/shared';

import type { LlmProvider } from '@second-brain/providers';

/**
 * Phrases that indicate a time-bounded question.
 *
 * Matched as substrings of the normalized query, not as whole tokens, so `"last week's"` and
 * `"last week"` both hit. Kept deliberately concrete: relative phrases the corpus can resolve
 * without asking the user to clarify, because "recently" is answerable and "eventually" is not.
 */
export const TEMPORAL_CUES: readonly string[] = [
  'yesterday',
  'today',
  'tomorrow',
  'this morning',
  'this afternoon',
  'tonight',
  'last night',
  'last week',
  'last month',
  'last year',
  'last quarter',
  'this week',
  'this month',
  'this year',
  'this quarter',
  'past few days',
  'past week',
  'past month',
  'a few weeks ago',
  'the other day',
  'recently',
  'latest',
  'first saw',
  'when did i',
];

/**
 * Verbs and verb phrases that indicate a question about the user's behaviour rather than
 * about content.
 *
 * Activity questions are answered from the event stream — dwell time, app sessions, domains —
 * and no document contains the answer. Missing one of these cues sends the question to
 * document retrieval, which will return something plausible and wrong.
 */
export const ACTIVITY_VERBS: readonly string[] = [
  'worked on',
  'working on',
  'did i work',
  'spent time',
  'spend time',
  'how long did',
  'read',
  'reading',
  'watch',
  'watched',
  'studied',
  'researched',
  'looked at',
  'looked into',
  'opened',
  'downloaded',
  'bookmarked',
  'searched for',
  'searched',
  'learned about',
  'learned',
  'did i do',
  'was i doing',
  'my time',
  'time on',
];

/** Words that indicate an interrogative rather than a keyword lookup. */
export const QUESTION_WORDS: readonly string[] = [
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
  'which',
  'whose',
  'did',
  'do',
  'does',
  'is',
  'are',
  'was',
  'were',
];

/** Word count at or below which a query is treated as short. */
export const SHORT_QUERY_WORD_LIMIT = 3;

/**
 * Confidence below which the rule path declines to answer and the LLM fallback runs.
 *
 * Expressed as a fraction of the rule path's own evidence score rather than as a calibrated
 * probability: the rules have no meaningful probability to report, and inventing one would
 * make the threshold impossible to reason about.
 */
export const RULE_CONFIDENCE_THRESHOLD = 0.6;

/**
 * The lexical features the rule path extracts.
 *
 * Every field is a boolean so that a rule can be a small, readable table over them, and so
 * that a misclassification can be diagnosed by printing one object.
 */
export interface IntentSignals {
  /** A `TEMPORAL_CUES` phrase is present. Strongest single indicator of `temporal`. */
  hasTemporalCue: boolean;
  /** A capitalised mid-sentence token, a quoted phrase, or an identifier-shaped token. */
  hasEntityReference: boolean;
  /** An `ACTIVITY_VERBS` phrase is present. Strongest single indicator of `activity`. */
  hasActivityVerb: boolean;
  /** A `QUESTION_WORDS` token is present. Suggests `semantic`, and nothing else. */
  hasQuestionWord: boolean;
  /** At most `SHORT_QUERY_WORD_LIMIT` words, which usually means a keyword lookup. */
  isShortQuery: boolean;
}

/**
 * Extracts the rule-path features from a query.
 *
 * Pure and case-aware: matching is done on a lowercased copy, while the entity check runs
 * against the original, because capitalisation is the signal it is looking for. An empty or
 * whitespace-only query yields all-false rather than throwing.
 *
 * @param query - Raw query text, exactly as the user typed it.
 */
export function detectIntentSignals(query: string): IntentSignals {
  const normalized = normalizeWhitespace(query).toLowerCase();
  const words = normalized.length === 0 ? [] : normalized.split(' ');

  return {
    hasTemporalCue: TEMPORAL_CUES.some((cue) => normalized.includes(cue)),
    hasActivityVerb: ACTIVITY_VERBS.some((verb) => normalized.includes(verb)),
    hasQuestionWord: QUESTION_WORDS.some((word) => words.includes(word)),
    isShortQuery: words.length > 0 && words.length <= SHORT_QUERY_WORD_LIMIT,
    hasEntityReference: hasEntityReference(query),
  };
}

/**
 * True when the query names something specific.
 *
 * Four heuristics, in order of how much they mean: a quoted phrase ("the 'second brain'
 * doc"), an identifier-shaped token (contains a digit, an underscore, a dot or a slash —
 * `ADR-004`, `v2.1`, `retrieval/engine`), a capitalised word that is not the first word of the
 * sentence, or a long lowercase token, which in practice is either a compound technical term
 * or a URL. All four name something specific, which is the population lexical search handles
 * better than an embedding does.
 */
function hasEntityReference(query: string): boolean {
  if (/["\u201C][^"\u201D]{1,80}["\u201D]/.test(query)) return true;

  const words = normalizeWhitespace(query).split(' ');
  return words.some(
    (word, index) =>
      index > 0 && (/^[A-Z][A-Za-z0-9]*$/.test(word) || /[0-9_./-]/.test(word) || word.length > 12),
  );
}

/**
 * Classifies a query into a retrieval intent.
 *
 * Contract:
 * - Deterministic for a fixed query. The same question must always run the same retrievers,
 *   or two runs of the same search produce different answers and neither can be debugged.
 * - The rule path runs first and settles high-confidence cases without any I/O.
 * - The LLM fallback runs only when the rules are below `RULE_CONFIDENCE_THRESHOLD`, and its
 *   answer is validated against the `QueryIntent` union — an unrecognised reply falls back to
 *   `mixed`, which is the safe composition rather than an error the user sees.
 * - When `llm` is absent, a low-confidence query resolves to `mixed` rather than throwing:
 *   retrieval must degrade, not fail (success criterion S6 in `docs/PROJECT_OVERVIEW.md`).
 * - A caller that already knows the intent (`RetrievalQuery.intent`) must not call this at
 *   all; the engine checks that first.
 *
 * @param query - Raw query text, never rewritten before classification.
 * @param llm - Optional provider for the fallback path.
 */
export async function classifyIntent(_query: string, _llm?: LlmProvider): Promise<QueryIntent> {
  // TODO(phase-2): score the rule path from `detectIntentSignals`, map the confident cases
  // (temporal cue -> `temporal`, activity verb -> `activity`, entity + short -> `entity`),
  // and only then call the LLM with a constrained response schema.
  throw new Error('Not implemented: classifyIntent');
}
