import type { CategorySlug } from '../types/topic';

/**
 * The fixed top-level category taxonomy.
 *
 * This is deliberately small and stable. It exists so the dashboard has
 * consistent buckets and so the router has a bounded target, while the
 * *topics* underneath it grow freely. Categories are never learned; topics are.
 */

export interface CategoryDefinition {
  slug: CategorySlug;
  label: string;
  /** One-line scope. Used verbatim in the category-router prompt. */
  description: string;
  /** Seed terms that route cheaply, before any model call. */
  keywords: string[];
}

/** Categories in display order. */
export const CATEGORIES: readonly CategoryDefinition[] = [
  {
    slug: 'engineering',
    label: 'Engineering',
    description: 'Software design, implementation, tooling, and infrastructure.',
    keywords: [
      'software',
      'architecture',
      'typescript',
      'python',
      'database',
      'postgres',
      'kubernetes',
      'api',
      'testing',
      'performance',
      'refactoring',
      'distributed systems',
    ],
  },
  {
    slug: 'ai',
    label: 'AI & ML',
    description: 'Machine learning, language models, and applied AI systems.',
    keywords: [
      'llm',
      'embedding',
      'transformer',
      'rag',
      'fine-tuning',
      'inference',
      'prompt',
      'vector search',
      'evaluation',
    ],
  },
  {
    slug: 'research',
    label: 'Research',
    description: 'Papers, literature reviews, and investigative reading.',
    keywords: ['paper', 'arxiv', 'study', 'survey', 'literature', 'benchmark', 'methodology'],
  },
  {
    slug: 'product',
    label: 'Product',
    description: 'Product design, requirements, and user experience.',
    keywords: ['product', 'roadmap', 'user', 'feature', 'ux', 'design system', 'spec', 'persona'],
  },
  {
    slug: 'business',
    label: 'Business',
    description: 'Strategy, markets, operations, and organizational topics.',
    keywords: ['strategy', 'market', 'revenue', 'pricing', 'customer', 'hiring', 'competitor'],
  },
  {
    slug: 'learning',
    label: 'Learning',
    description: 'Courses, tutorials, and deliberate skill development.',
    keywords: ['course', 'tutorial', 'lesson', 'guide', 'how-to', 'textbook', 'exercise'],
  },
  {
    slug: 'writing',
    label: 'Writing',
    description: 'Drafting, editing, and publishing.',
    keywords: ['draft', 'essay', 'blog', 'editing', 'outline', 'newsletter', 'prose'],
  },
  {
    slug: 'health',
    label: 'Health',
    description: 'Physical and mental health, fitness, and wellbeing.',
    keywords: ['health', 'fitness', 'sleep', 'nutrition', 'medical', 'exercise', 'therapy'],
  },
  {
    slug: 'finance',
    label: 'Finance',
    description: 'Personal finance, investing, and financial planning.',
    keywords: ['finance', 'investing', 'budget', 'tax', 'portfolio', 'retirement', 'insurance'],
  },
  {
    slug: 'personal',
    label: 'Personal',
    description: 'Personal logistics, travel, hobbies, and life administration.',
    keywords: ['travel', 'recipe', 'hobby', 'family', 'home', 'event', 'booking'],
  },
  {
    slug: 'unclassified',
    label: 'Unclassified',
    description: 'Content that could not be routed with sufficient confidence.',
    keywords: [],
  },
];

/** Category slug per label, derived once for O(1) lookups. */
export const CATEGORY_LABELS: Record<CategorySlug, string> = Object.fromEntries(
  CATEGORIES.map((category) => [category.slug, category.label]),
);

/**
 * Fallback category. The router must always return something, and an explicit
 * "unclassified" bucket is far more useful than dropping the document or
 * guessing at a category with low confidence.
 */
export const DEFAULT_CATEGORY_SLUG: CategorySlug = 'unclassified';

/**
 * Minimum confidence for the router to accept a non-default category. Below
 * this, the document lands in `unclassified` and can be re-routed later.
 */
export const CATEGORY_CONFIDENCE_THRESHOLD = 0.55;

/** Look up a category definition by slug, or `undefined` if it is not in the taxonomy. */
export function findCategory(slug: CategorySlug): CategoryDefinition | undefined {
  return CATEGORIES.find((category) => category.slug === slug);
}
