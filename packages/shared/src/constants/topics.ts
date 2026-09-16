import type { CategorySlug } from '../types/topic';

/**
 * The starter topic taxonomy every new user is created with.
 *
 * This constant is the **source of truth**, and it is deliberately not a literal in
 * the migration that consumes it. The repo's migration conventions state the rule:
 * "`DEFAULT_CATEGORY_SLUG`-style values come from shared constants, not from a
 * migration literal." `supabase/migrations/20260916096000_seed_default_topics_on_signup.sql`
 * mirrors these values inside its trigger function, because SQL cannot import a
 * TypeScript constant — so **changing a value here means changing it there too.**
 * The two are kept honest by review, not by the compiler.
 *
 * These are roots and one level of children. They are a starting point, not a
 * commitment: topics are learned, and a user's own topics grow underneath and
 * beside these. The fixed part of the taxonomy is `CATEGORIES`; this is the
 * mutable part that a user may rename, reparent, or delete.
 *
 * `parentSlug` is a slug rather than an id because ids are generated per row at
 * insert time, so a slug is the only stable way to express the hierarchy in a
 * constant.
 */
export interface DefaultTopicDefinition {
  /** Must satisfy `topics_slug_format_check`: `^[a-z0-9]+(-[a-z0-9]+)*$`, 2–64 chars. */
  slug: string;
  /** Must satisfy `topics_label_len_check`: 1–96 chars. */
  label: string;
  /** One line, used verbatim in the classifier prompt as the topic's scope. */
  description: string;
  /** Slug of the parent topic, or `null` for a root. Must be a slug present in this list. */
  parentSlug: string | null;
  /** Terms that indicate this topic. Feeds the cheap keyword pre-filter before any model call. */
  keywords: string[];
  /** Must be a non-empty slug from `CATEGORIES`. */
  categorySlug: CategorySlug;
}

/** Roots first, then children — the order the trigger inserts them in. */
export const DEFAULT_TOPICS: readonly DefaultTopicDefinition[] = [
  // --- Roots -----------------------------------------------------------------
  {
    slug: 'engineering',
    label: 'Engineering',
    description: 'Software design, implementation, tooling, and infrastructure.',
    parentSlug: null,
    keywords: ['software', 'architecture', 'api', 'testing', 'performance', 'refactoring'],
    categorySlug: 'engineering',
  },
  {
    slug: 'artificial-intelligence',
    label: 'AI & ML',
    description: 'Machine learning, language models, and applied AI systems.',
    parentSlug: null,
    keywords: ['llm', 'model', 'training', 'inference', 'prompt', 'evaluation'],
    categorySlug: 'ai',
  },
  {
    slug: 'research',
    label: 'Research',
    description: 'Papers, literature reviews, and investigative reading.',
    parentSlug: null,
    keywords: ['paper', 'study', 'survey', 'benchmark', 'methodology'],
    categorySlug: 'research',
  },
  {
    slug: 'product',
    label: 'Product',
    description: 'Product design, requirements, and user experience.',
    parentSlug: null,
    keywords: ['product', 'roadmap', 'user', 'feature', 'ux', 'spec'],
    categorySlug: 'product',
  },
  {
    slug: 'learning',
    label: 'Learning',
    description: 'Courses, tutorials, and deliberate skill development.',
    parentSlug: null,
    keywords: ['course', 'tutorial', 'lesson', 'guide', 'how-to', 'exercise'],
    categorySlug: 'learning',
  },

  // --- Children --------------------------------------------------------------
  {
    slug: 'databases',
    label: 'Databases',
    description: 'Storage engines, indexing, query planning, and vector search.',
    parentSlug: 'engineering',
    keywords: ['postgres', 'index', 'query planner', 'pgvector', 'transaction'],
    categorySlug: 'engineering',
  },
  {
    slug: 'software-architecture',
    label: 'Software architecture',
    description: 'Structure, boundaries, coupling, and long-lived design trade-offs.',
    parentSlug: 'engineering',
    keywords: ['architecture', 'modularity', 'coupling', 'boundaries', 'trade-off'],
    categorySlug: 'engineering',
  },
  {
    slug: 'retrieval',
    label: 'Retrieval',
    description: 'Hybrid search, ranking, and evaluating whether recall is actually good.',
    parentSlug: 'artificial-intelligence',
    keywords: ['retrieval', 'ranking', 'reranking', 'recall', 'hybrid search', 'rag'],
    categorySlug: 'ai',
  },
  {
    slug: 'embeddings',
    label: 'Embeddings',
    description: 'Vector representations, their dimensions, and how they are compared.',
    parentSlug: 'artificial-intelligence',
    keywords: ['embedding', 'vector', 'cosine', 'dimension', 'similarity'],
    categorySlug: 'ai',
  },
  {
    slug: 'personal-knowledge-management',
    label: 'Personal knowledge management',
    description: 'Capture, note-taking, and note longevity practices.',
    parentSlug: 'learning',
    keywords: ['pkm', 'notes', 'second brain', 'zettelkasten', 'capture'],
    categorySlug: 'learning',
  },
];

/** Root topics, in declaration order. What the trigger inserts first. */
export const DEFAULT_ROOT_TOPICS: readonly DefaultTopicDefinition[] = DEFAULT_TOPICS.filter(
  (topic) => topic.parentSlug === null,
);

/** Child topics, in declaration order. Inserted second so their parents exist. */
export const DEFAULT_CHILD_TOPICS: readonly DefaultTopicDefinition[] = DEFAULT_TOPICS.filter(
  (topic) => topic.parentSlug !== null,
);
