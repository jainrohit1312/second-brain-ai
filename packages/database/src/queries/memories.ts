import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types/database';
import type { MemoryKind } from '@second-brain/shared';

/** Row shape of `memories`. */
export type MemoryRow = Database['second_brain']['Tables']['memories']['Row'];

/** Insert shape of `memories`. */
export type MemoryInsert = Database['second_brain']['Tables']['memories']['Insert'];

/** Arguments of the `match_memories` RPC, as declared in the generated types. */
export type MatchMemoriesArgs = Database['second_brain']['Functions']['match_memories']['Args'];

/** One row returned by the `match_memories` RPC. */
export type MatchMemoriesResult =
  Database['second_brain']['Functions']['match_memories']['Returns'][number];

/** Options for {@link MemoriesQueries.findSimilar}. */
export interface FindSimilarMemoriesOptions {
  /** Owner of the memories; also the RPC's scoping argument. */
  userId: string;
  /** Maximum candidates to return. */
  limit: number;
  /** Cosine-similarity floor. Below it a "match" is noise and must not trigger a merge. */
  minSimilarity?: number;
  /** Restrict candidates to these kinds — a `fact` should not merge into a `preference`. */
  kinds?: MemoryKind[];
}

/** Options for {@link MemoriesQueries.listActive}. */
export interface ListActiveMemoriesOptions {
  /** Hard cap on returned rows. */
  limit: number;
  kinds?: MemoryKind[];
  topicIds?: string[];
  minConfidence?: number;
  /** Ranking column; defaults to `importance`, the ordering chat context assembly expects. */
  orderBy?: 'importance' | 'last_accessed_at' | 'created_at';
}

/**
 * Data access for `memories` — the distilled, durable statements the assistant
 * answers from. Written by the distillation pass, read by retrieval, decayed by
 * the maintenance pass.
 *
 * Superseded and archived rows are never deleted: the bi-temporal pair
 * (`valid_from` / `valid_to` plus `superseded_by`) is what makes "what did I
 * believe in March" answerable, and a wrong memory that is deleted cannot be
 * audited.
 */
export interface MemoriesQueries {
  /**
   * Inserts one memory and returns it as stored. `statement_hash` must already
   * be computed by the caller — `sha256Hex` from `@second-brain/shared` over the
   * whitespace-normalized statement. It is the dedup key the merge decision
   * relies on, so a missing or unstable hash silently disables exact-duplicate
   * detection.
   *
   * New rows default to `status: 'candidate'`; only the merge decision promotes
   * a memory to `active`.
   */
  insert(memory: MemoryInsert): Promise<MemoryRow>;

  /**
   * Calls the `match_memories` RPC: existing memories semantically close to a
   * candidate statement, nearest first. This is the input to the merge decision —
   * `action: 'merge' | 'supersede'` requires a target id, and this is where it
   * comes from.
   *
   * `embedding` must use the same model and width as the stored vectors; a
   * mismatch returns plausible-looking but meaningless neighbours.
   */
  findSimilar(
    embedding: number[],
    opts: FindSimilarMemoriesOptions,
  ): Promise<MatchMemoriesResult[]>;

  /**
   * Marks `oldId` superseded by `newId`: sets `status: 'superseded'`,
   * `superseded_by: newId` and `valid_to: validTo` (the instant the old
   * statement stopped being true, which is not necessarily now).
   *
   * The old row stays. Retrieve-side filters exclude it; history keeps it.
   */
  supersede(oldId: string, newId: string, validTo: string): Promise<void>;

  /**
   * Rewrites an existing memory's statement — the `action: 'merge'` outcome —
   * and returns the updated row. `statement_hash` must be recomputed in the same
   * write, or the next distillation pass will not recognize the merged statement
   * as a duplicate.
   */
  mergeStatements(id: string, statement: string): Promise<MemoryRow>;

  /**
   * Active memories for a user, ranked. Expected to use the index on
   * `(user_id, status, importance desc)`; this backs both the memory browser and
   * context assembly, so the limit is required.
   */
  listActive(userId: string, opts: ListActiveMemoriesOptions): Promise<MemoryRow[]>;

  /**
   * Bumps `access_count` and sets `last_accessed_at` for the given ids in one
   * statement. Called whenever memories are used to answer a question.
   *
   * A write on the read path, on purpose: access recency is the signal decay and
   * ranking are computed from. Batch it per response rather than per memory, and
   * never block the response on it.
   */
  recordAccess(ids: string[]): Promise<void>;

  /**
   * Archives — does not delete — active memories neither accessed nor updated
   * since `cutoff`, and returns how many rows moved. This is the decay half of
   * maintenance; the other half is re-confirmation by a later distillation pass,
   * which is what `updated_at` records.
   */
  archiveStale(cutoff: string): Promise<number>;

  /**
   * Exact duplicate check by statement hash, `null` when there is no such memory.
   * Expected to use the unique index on `(user_id, statement_hash)`; call it
   * before embedding a candidate, because it is orders of magnitude cheaper than
   * `findSimilar` and catches the re-run case entirely.
   */
  findExactByStatementHash(userId: string, statementHash: string): Promise<MemoryRow | null>;
}

/**
 * Builds the `memories` repository. Every path here is reachable from the
 * distillation pass, so these methods are expected to be called with a
 * service-role client — the user is identified by the argument, not by the session.
 */
export function createMemoriesQueries(_client: TypedSupabaseClient): MemoriesQueries {
  return {
    async insert(_memory: MemoryInsert): Promise<MemoryRow> {
      // TODO(phase-2): `.insert(memory).select().single()`, surfacing a unique
      // violation on `(user_id, statement_hash)` as an exact duplicate.
      throw new Error('Not implemented: MemoriesQueries.insert');
    },

    async findSimilar(
      _embedding: number[],
      _opts: FindSimilarMemoriesOptions,
    ): Promise<MatchMemoriesResult[]> {
      // TODO(phase-2): `.rpc('match_memories', { query_embedding, user_id, match_count,
      // match_threshold, kind_filter })`.
      throw new Error('Not implemented: MemoriesQueries.findSimilar');
    },

    async supersede(_oldId: string, _newId: string, _validTo: string): Promise<void> {
      // TODO(phase-2): `update({ status: 'superseded', superseded_by: newId,
      // valid_to: validTo }).eq('id', oldId)`.
      throw new Error('Not implemented: MemoriesQueries.supersede');
    },

    async mergeStatements(_id: string, _statement: string): Promise<MemoryRow> {
      // TODO(phase-2): `update({ statement, statement_hash, updated_at }).eq('id', id)`,
      // hashing the new statement the same way `insert` expects it.
      throw new Error('Not implemented: MemoriesQueries.mergeStatements');
    },

    async listActive(_userId: string, _opts: ListActiveMemoriesOptions): Promise<MemoryRow[]> {
      // TODO(phase-2): `.eq('status', 'active')` plus the kind/topic/confidence
      // filters, ordered by `opts.orderBy` and capped at `opts.limit`.
      throw new Error('Not implemented: MemoriesQueries.listActive');
    },

    async recordAccess(_ids: string[]): Promise<void> {
      // TODO(phase-2): one `update` incrementing `access_count` and stamping
      // `last_accessed_at` for all ids in the list.
      throw new Error('Not implemented: MemoriesQueries.recordAccess');
    },

    async archiveStale(_cutoff: string): Promise<number> {
      // TODO(phase-2): `update({ status: 'archived' }).eq('status', 'active').lt(...)`
      // with an exact count, batched to keep the transaction short.
      throw new Error('Not implemented: MemoriesQueries.archiveStale');
    },

    async findExactByStatementHash(
      _userId: string,
      _statementHash: string,
    ): Promise<MemoryRow | null> {
      // TODO(phase-2): `.eq('user_id', userId).eq('statement_hash', hash).maybeSingle()`.
      throw new Error('Not implemented: MemoriesQueries.findExactByStatementHash');
    },
  };
}
