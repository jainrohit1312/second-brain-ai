/**
 * Memories: the distilled, durable layer.
 *
 * A memory is a self-contained statement about the user or their work, extracted
 * from captured documents. It is *not* a summary of an article. The difference
 * matters: "Kubernetes pod disruption budgets need an explicit maxUnavailable"
 * is a memory; "This article explains pod disruption budgets" is not.
 *
 * Memories are temporal. When new information contradicts an old memory, the
 * old one is superseded — `validTo` is set and `supersededBy` points forward —
 * never deleted. The history of what the user believed and when is itself useful.
 */

/**
 * The kinds of memory worth keeping.
 *
 * - `fact`       — a durable fact the user now knows.
 * - `preference` — how the user likes things done.
 * - `decision`   — a choice that was made, with enough context to be actionable later.
 * - `project`    — an ongoing initiative, its state, and its participants.
 * - `entity`     — a person, org, tool, or place the user has a relationship with.
 * - `insight`    — a non-obvious conclusion the user reached.
 * - `task`       — a commitment the user took on, explicit enough to act on.
 * - `reference`  — a pointer worth keeping (a doc, a repo, a dashboard).
 */
export type MemoryKind =
  'fact' | 'preference' | 'decision' | 'project' | 'entity' | 'insight' | 'task' | 'reference';

/**
 * Lifecycle of a memory.
 *
 * `candidate` is the default for freshly extracted memories: low confidence
 * extractions stay here until corroborated, and only `active` memories are
 * retrieved by default. `rejected` records a deduplication or adjudication
 * decision so the same candidate is not re-proposed on the next pass.
 */
export type MemoryStatus = 'candidate' | 'active' | 'superseded' | 'archived' | 'rejected';

export interface Memory {
  id: string;
  userId: string;
  kind: MemoryKind;
  /**
   * The statement itself, written in the third person and de-contextualised:
   * it must make sense with no surrounding document. This is the field that
   * gets embedded and shown to the user, so its phrasing is the product.
   */
  statement: string;
  status: MemoryStatus;
  /** Extraction confidence in `[0, 1]`. Set by the model, adjusted by corroboration. */
  confidence: number;
  /** Retrieval priority in `[0, 1]`. Distinct from `confidence`. */
  importance: number;
  topicIds: string[];
  /** Provenance: the chunks this was distilled from. Never empty for an extracted memory. */
  sourceChunkIds: string[];
  sourceDocumentIds: string[];
  embedding: number[] | null;
  embeddingModel: string | null;
  /** ISO-8601 UTC. Start of the period this statement was true. */
  validFrom: string;
  /**
   * ISO-8601 UTC, or `null` while the statement is still believed.
   * A non-null `validTo` means the memory is history, not current belief.
   */
  validTo: string | null;
  /** The memory that replaced this one, if any. Forms a forward-only revision chain. */
  supersededBy: string | null;
  /** How often retrieval has surfaced this memory. Feeds the recency/utility signal. */
  accessCount: number;
  /** ISO-8601 UTC of the last retrieval. `null` if never retrieved. */
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A proposed memory, before deduplication and merging against what already exists.
 *
 * Candidates are deliberately not `Memory` objects: they have no identity yet,
 * and most of the pipeline exists to decide whether they earn one.
 */
export interface MemoryCandidate {
  kind: MemoryKind;
  statement: string;
  confidence: number;
  importance: number;
  /** The chunks that support this statement. An unsupported candidate is discarded. */
  sourceChunkIds: string[];
  topicIds: string[];
}

/**
 * The deduplication verdict for a candidate against the existing memory set.
 *
 * - `insert`    — genuinely new; create a row.
 * - `merge`     — complementary detail; fold into `targetMemoryId`'s statement.
 * - `supersede` — contradicts or replaces `targetMemoryId`; close its validity and insert.
 * - `reject`    — already known, or not durable enough to keep.
 */
export interface MemoryMergeDecision {
  action: 'insert' | 'merge' | 'supersede' | 'reject';
  /** `null` only when `action` is `insert`. */
  targetMemoryId: string | null;
  /** Why this verdict was reached. Persisted for auditability of the dedup step. */
  reason: string;
  /** The rewritten statement when merging. `null` otherwise. */
  mergedStatement: string | null;
}

/** Provenance link between a memory and one of its supporting chunks. */
export interface MemorySourceLink {
  memoryId: string;
  chunkId: string;
  documentId: string;
  /** Cosine similarity between the candidate and this chunk, when available. */
  similarity: number | null;
}

/**
 * Configuration for the recency decay applied when ranking memories.
 *
 * Retrieval is not pure similarity: a memory retrieved last week and one from a
 * year ago are not equally useful, and a never-retrieved memory should not be
 * buried permanently.
 */
export interface MemoryDecayConfig {
  /** Half-life in days. A memory's recency weight halves over this period. */
  halfLifeDays: number;
  /** Floor so an old but important memory never decays to zero. */
  minWeight: number;
  /** Boost applied per prior retrieval, before decay. */
  accessBoost: number;
}
