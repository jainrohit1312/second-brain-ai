/**
 * Category routing.
 *
 * Topics are learned and unbounded; categories are fixed and small (`CATEGORIES` in
 * `@second-brain/shared`). Routing a document into a category is a separate, cheaper
 * decision than classifying it: it is a deterministic mapping from evidence the pipeline
 * already has — the host, the assigned topics, words in the summary — onto a bounded target.
 *
 * ## Why a rule table and not a model
 *
 * A category is a dashboard bucket, so an occasional wrong answer costs a user nothing,
 * while a model call per document costs money and cannot be explained. The rules here are
 * readable, orderable and testable; the model is reserved for the step where being wrong has
 * consequences (topics, and distillation).
 *
 * ## The fallback contract
 *
 * Routing must always return something. When no rule clears `CATEGORY_CONFIDENCE_THRESHOLD`,
 * the document is routed to `DEFAULT_CATEGORY_SLUG` (`unclassified`) with
 * `matchedBy: 'fallback'`, and it can be re-routed later when the taxonomy catches up.
 * Guessing a low-confidence category is worse than admitting the gap: a document in the
 * wrong bucket is invisible in the right one, while an unclassified document is visibly
 * waiting.
 */
import type {
  CategoryAssignment,
  CategorySlug,
  DocumentSource,
  TopicAssignment,
  TopicSlug,
} from '@second-brain/shared';

/**
 * The document evidence routing is allowed to use.
 *
 * Narrower than `Document`: the full body is deliberately absent, because a router that reads
 * the body is a classifier wearing a hat.
 */
export interface RoutableDocument {
  id: string;
  title: string;
  url: string | null;
  siteName: string | null;
  /** The upstream summary, if one exists. Omitted from a fast route on host alone. */
  summary: string | null;
  source: DocumentSource;
  language: string | null;
}

/**
 * One routing rule.
 *
 * A rule matches on any of its signals; the highest-confidence match across all rules wins,
 * and ties are broken by table order, so the table is also a priority list. Every
 * `categorySlug` referenced here must exist in the shared `CATEGORIES` taxonomy — a rule
 * pointing at a category that does not exist would produce a dashboard bucket with no label.
 */
export interface CategoryRoutingRule {
  categorySlug: CategorySlug;
  /** Host suffixes that route straight here, matched against the canonical URL's host. */
  hostSuffixes: readonly string[];
  /** Topic slugs that route here when classification already assigned one. */
  topicSlugs: readonly TopicSlug[];
  /** Lowercase terms matched against title and summary, as a last resort before the fallback. */
  keywords: readonly string[];
  /** Confidence assigned when this rule matches. Must clear `CATEGORY_CONFIDENCE_THRESHOLD` to win. */
  confidence: number;
}

/**
 * The default rule table.
 *
 * Host rules carry the highest confidence because a domain is an unambiguous statement of
 * what kind of content lives there — nobody lands on arXiv by accident. Topic rules follow,
 * because they reflect a decision the classifier already made. Keyword rules are weakest and
 * exist so that a document with no host and no topics is not immediately unclassified.
 */
export const DEFAULT_ROUTING_RULES: readonly CategoryRoutingRule[] = [
  {
    categorySlug: 'research',
    hostSuffixes: [
      'arxiv.org',
      'acm.org',
      'ieee.org',
      'nature.com',
      'sciencedirect.com',
      'pubmed.ncbi.nlm.nih.gov',
    ],
    topicSlugs: ['research-methods', 'literature-review'],
    keywords: ['et al', 'abstract', 'methodology', 'sample size'],
    confidence: 0.8,
  },
  {
    categorySlug: 'engineering',
    hostSuffixes: [
      'github.com',
      'gitlab.com',
      'news.ycombinator.com',
      'developer.mozilla.org',
      'stackoverflow.com',
    ],
    topicSlugs: ['software-engineering', 'distributed-systems', 'databases', 'infrastructure'],
    keywords: ['api', 'refactor', 'architecture', 'postgres', 'kubernetes', 'typescript', 'sql'],
    confidence: 0.75,
  },
  {
    categorySlug: 'ai',
    hostSuffixes: ['huggingface.co', 'paperswithcode.com', 'openai.com', 'anthropic.com'],
    topicSlugs: [
      'machine-learning',
      'language-models',
      'retrieval-augmented-generation',
      'embeddings',
    ],
    keywords: [
      'llm',
      'embedding',
      'transformer',
      'fine-tuning',
      'inference',
      'prompt',
      'vector search',
    ],
    confidence: 0.75,
  },
  {
    categorySlug: 'learning',
    hostSuffixes: ['coursera.org', 'udemy.com', 'educative.io', 'leetcode.com', 'khanacademy.org'],
    topicSlugs: ['courses', 'tutorials'],
    keywords: ['tutorial', 'course', 'lesson', 'walkthrough', 'exercises', 'chapter'],
    confidence: 0.6,
  },
  {
    categorySlug: 'writing',
    hostSuffixes: ['substack.com', 'medium.com', 'ghost.io'],
    topicSlugs: ['writing-craft', 'newsletters'],
    keywords: ['essay', 'draft', 'editing', 'newsletter', 'outline', 'prose'],
    confidence: 0.55,
  },
  {
    categorySlug: 'business',
    hostSuffixes: ['bloomberg.com', 'ft.com', 'wsj.com', 'hbr.org', 'stratechery.com'],
    topicSlugs: ['strategy', 'markets', 'operations'],
    keywords: ['revenue', 'pricing', 'competitor', 'market', 'strategy', 'hiring', 'acquisition'],
    confidence: 0.65,
  },
  {
    categorySlug: 'product',
    hostSuffixes: ['producthunt.com', 'linear.app', 'notion.so'],
    topicSlugs: ['product-management', 'user-experience'],
    keywords: ['roadmap', 'user research', 'design system', 'feature spec', 'onboarding'],
    confidence: 0.6,
  },
  {
    categorySlug: 'finance',
    hostSuffixes: ['fidelity.com', 'vanguard.com', 'investopedia.com', 'morningstar.com'],
    topicSlugs: ['personal-finance', 'investing'],
    keywords: ['portfolio', 'budget', 'tax', 'retirement', 'interest rate', 'insurance'],
    confidence: 0.65,
  },
  {
    categorySlug: 'health',
    hostSuffixes: ['who.int', 'mayoclinic.org', 'strava.com', 'nih.gov'],
    topicSlugs: ['fitness', 'nutrition', 'mental-health'],
    keywords: ['training plan', 'nutrition', 'sleep', 'symptom', 'therapy', 'workout'],
    confidence: 0.65,
  },
  {
    categorySlug: 'personal',
    hostSuffixes: ['nytimes.com', 'allrecipes.com', 'tripadvisor.com', 'booking.com'],
    topicSlugs: ['travel', 'recipes', 'hobbies', 'home-admin'],
    keywords: ['recipe', 'itinerary', 'holiday', 'flight', 'gift', 'appointment'],
    confidence: 0.5,
  },
];

/**
 * Routes a document into the fixed category taxonomy.
 *
 * Pure: no I/O, no model call, same inputs produce the same assignment. Called after
 * classification and after distillation, so a document's category can be revisited without
 * re-running the expensive stages.
 *
 * Contract:
 * - Always returns an assignment; the fallback is `DEFAULT_CATEGORY_SLUG` with
 *   `matchedBy: 'fallback'` and the confidence of the best failing candidate.
 * - `matchedBy` names the signal that won (`host:arxiv.org`, `topic:research-methods`,
 *   `keyword:kubernetes`), which is what makes a mis-route diagnosable instead of mysterious.
 * - A rule below `CATEGORY_CONFIDENCE_THRESHOLD` never wins, even when it is the only match.
 *
 * @param document - Host, title, summary and source. See `RoutableDocument`.
 * @param topics - Topics assigned by classification; may be empty.
 */
export function routeToCategory(
  _document: RoutableDocument,
  _topics: readonly TopicAssignment[],
): CategoryAssignment {
  // TODO(phase-1): evaluate the rules in order, keep the highest-confidence match, and fall
  // back to `DEFAULT_CATEGORY_SLUG` below `CATEGORY_CONFIDENCE_THRESHOLD`.
  throw new Error('Not implemented: routeToCategory');
}
