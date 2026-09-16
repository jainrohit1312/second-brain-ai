/**
 * Topic classification.
 *
 * ## What runs where, and on what
 *
 * Classification runs on the **distilled summary**, never on the full document. This is a
 * cost decision with a quality argument behind it: a classifier that reads 40k characters to
 * pick two labels spends most of the pipeline's token budget on the least valuable step, and
 * a good summary contains the topic words while omitting the ones that only look relevant in
 * context.
 *
 * ## Caching is part of the contract, not an optimisation
 *
 * Classification is the most expensive thing that happens per document, and the answer
 * depends only on `(summary, taxonomy)`. Results must therefore be cached keyed by
 * `contentHash` (plus `CLASSIFIER_PROMPT_VERSION`, since a prompt change invalidates the
 * cache). Without that cache a re-processing run re-pays for every document, which is what
 * makes re-processing something nobody wants to run.
 *
 * ## Slugs in, ids out
 *
 * The model sees slugs and returns slugs: they are stable, human-legible, and cannot be
 * invented into a foreign key. Resolving a slug to a `topicId` happens here, in code, and an
 * assignment whose slug is unknown is dropped rather than guessed at.
 */
import { z } from 'zod';

import type { LlmProvider } from '@second-brain/providers';
import type {
  DocumentSource,
  TopicAssignment,
  TopicSlug,
  TopicSuggestion,
} from '@second-brain/shared';

/**
 * Version of the classification prompt and response contract.
 *
 * Part of the classification cache key. Bump it whenever the prompt, the response schema, or
 * the model family changes, because otherwise a stale cached assignment survives the change
 * and the corpus is silently half-classified by two different prompts.
 */
export const CLASSIFIER_PROMPT_VERSION = 'classify-v1';

/** Maximum topics assigned to one document. More than this means the document is unfocused. */
export const MAX_TOPICS_PER_DOCUMENT = 5;

/** A topic the classifier may assign, as the user's taxonomy currently defines it. */
export interface ClassifiableTopic {
  /** Resolved locally; the model never sees or returns this. */
  id: string;
  slug: TopicSlug;
  label: string;
  /** One-line scope description, passed verbatim into the prompt. */
  description: string | null;
}

/** Everything the classifier is allowed to see. Deliberately small: see the module header. */
export interface ClassificationInput {
  documentId: string;
  title: string;
  /** The summary produced upstream. The full body is never passed here. */
  summary: string;
  /** The user's existing taxonomy. Empty on a fresh account, which routes to `suggestNewTopic`. */
  existingTopics: readonly ClassifiableTopic[];
  source: DocumentSource;
  /** BCP-47 tag, so a non-English document is not classified by an English-only prompt. */
  language: string | null;
}

/**
 * The response contract for classification, validated locally by `LlmProvider.completeJson`.
 *
 * A schema violation is retried by the provider adapter rather than thrown, because models
 * that emit one malformed field usually succeed on a re-ask. `isPrimary` is not trusted to
 * be unique — exactly one primary is enforced here, in code.
 */
export const topicClassificationSchema = z.object({
  assignments: z
    .array(
      z.object({
        topicSlug: z.string().min(1).max(64),
        confidence: z.number().min(0).max(1),
        isPrimary: z.boolean(),
      }),
    )
    .max(MAX_TOPICS_PER_DOCUMENT),
});

/**
 * The response contract for `suggestNewTopic`. `suggestion: null` is a valid, expected answer.
 */
export const newTopicSuggestionSchema = z.object({
  suggestion: z
    .object({
      slug: z.string().min(1).max(64),
      label: z.string().min(1).max(120),
      confidence: z.number().min(0).max(1),
      rationale: z.string().min(1).max(500),
    })
    .nullable(),
});

/**
 * Assigns existing topics to a document.
 *
 * Contract:
 * - Runs at `temperature: 0`: re-classifying the same document with the same taxonomy must
 *   produce the same assignments, or every re-processing run reshuffles the corpus.
 * - Returns `[]` when nothing in the taxonomy fits. An empty assignment is a legitimate
 *   outcome; the document still exists and can be routed by `routeToCategory`.
 * - Exactly one returned assignment has `isPrimary: true` when the result is non-empty.
 * - Assignments whose slug is not in `input.existingTopics` are dropped, never created.
 * - Assignments at or below the model's own uncertainty floor are dropped rather than stored
 *   as a weak link, because a wrong topic is worse for retrieval than a missing one.
 *
 * @param input - Summary, title and taxonomy. See `ClassificationInput`.
 * @param llm - Provider used for the classification call.
 */
export async function classifyDocument(
  _input: ClassificationInput,
  _llm: LlmProvider,
): Promise<TopicAssignment[]> {
  // TODO(phase-2): build the prompt from `CLASSIFIER_PROMPT_VERSION`, call
  // `llm.completeJson({ schema: topicClassificationSchema, temperature: 0 })`, resolve slugs
  // to ids, enforce a single primary, and cache by `contentHash` + prompt version.
  throw new Error('Not implemented: classifyDocument');
}

/**
 * Proposes a topic the taxonomy does not contain yet.
 *
 * Only meaningful when classification found nothing usable, and deliberately conservative: a
 * proposed topic is shown to the user for approval, so a proposal that is really two topics
 * in a trench coat costs the user a decision and earns nothing. Returning `null` — "this is
 * a recipe and you have no recipe topic, and it does not deserve one" — must be a common,
 * cheap outcome, and the caller must treat it as success.
 *
 * @param input - Same input as `classifyDocument`.
 * @param llm - Provider used for the proposal call.
 */
export async function suggestNewTopic(
  _input: ClassificationInput,
  _llm: LlmProvider,
): Promise<TopicSuggestion | null> {
  // TODO(phase-2): ask for one proposal or `null`, validate with
  // `newTopicSuggestionSchema`, and reject a slug that already exists in the taxonomy.
  throw new Error('Not implemented: suggestNewTopic');
}
