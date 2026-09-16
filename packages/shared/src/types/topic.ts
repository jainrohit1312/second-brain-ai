/**
 * Topics: the organizing axis for both documents and memories.
 *
 * Topics are learned, not fixed. They start from a small seeded taxonomy and
 * grow as the classifier proposes new ones. Each topic carries a centroid
 * embedding so that a new document can be routed by similarity before the LLM
 * is consulted at all.
 */

/** Slug of a top-level category from the fixed `CATEGORIES` taxonomy. */
export type CategorySlug = string;

/** Slug of a topic, unique per user. Lowercase, hyphenated, stable once created. */
export type TopicSlug = string;

export interface Topic {
  id: string;
  userId: string;
  slug: TopicSlug;
  /** Display name, e.g. "Distributed Systems". */
  label: string;
  /** One-line scope description. Used verbatim in the classifier prompt. */
  description: string | null;
  /** Parent topic for hierarchical rollup, or `null` for a root topic. */
  parentId: string | null;
  /** Terms that strongly indicate this topic. Cheap pre-filter before the LLM call. */
  keywords: string[];
  /** Top-level category this topic rolls up into. */
  categorySlug: string;
  documentCount: number;
  memoryCount: number;
  /**
   * Mean embedding of the topic's documents. Lets routing be a cosine
   * comparison instead of a model call, and lets new topics seed themselves
   * from the documents that clustered together.
   */
  centroid: number[] | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** A topic assigned to a document, with the classifier's confidence. */
export interface TopicAssignment {
  topicId: string;
  topicSlug: TopicSlug;
  /** In `[0, 1]`. */
  confidence: number;
  /** Exactly one assignment per document should be primary. */
  isPrimary: boolean;
}

/** A topic the classifier believes does not exist yet and should be created. */
export interface TopicSuggestion {
  slug: TopicSlug;
  label: string;
  confidence: number;
  /** Why the existing taxonomy was insufficient. Shown to the user for approval. */
  rationale: string;
}

/** Junction row linking a document to a topic. */
export interface DocumentTopicLink {
  documentId: string;
  topicId: string;
  confidence: number;
  isPrimary: boolean;
  /** ISO-8601 UTC. Assignments are kept even after re-classification removed them. */
  assignedAt: string;
}

/** Result of routing a document into the fixed category taxonomy. */
export interface CategoryAssignment {
  categorySlug: CategorySlug;
  confidence: number;
  /** Rule or signal that produced the assignment, for debugging the router. */
  matchedBy: string;
}
