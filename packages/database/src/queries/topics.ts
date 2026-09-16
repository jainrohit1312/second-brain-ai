import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types/database';
import type { TopicAssignment } from '@second-brain/shared';

/** Row shape of `topics`. */
export type TopicRow = Database['second_brain']['Tables']['topics']['Row'];

/** Insert shape of `topics`. */
export type TopicInsert = Database['second_brain']['Tables']['topics']['Insert'];

/** Row shape of `document_topics`. */
export type DocumentTopicRow = Database['second_brain']['Tables']['document_topics']['Row'];

/**
 * Data access for `topics` and `document_topics` — the taxonomy the dashboard
 * groups by and that retrieval filters on.
 *
 * Slugs, not ids, are what classification prompts and memory statements refer
 * to; `upsertBySlug` is therefore the only supported way to obtain a topic id.
 */
export interface TopicsQueries {
  /**
   * Idempotent insert keyed on the natural key `(user_id, slug)`, returning the
   * stored row. The label and description may be refined by a later pass; the
   * slug may not, because it is what already-classified documents and distilled
   * memories are grouped by.
   *
   * Expected to use the unique index on `(user_id, slug)`.
   */
  upsertBySlug(topic: TopicInsert): Promise<TopicRow>;

  /**
   * All of a user's topics with their member counts, busiest first. The counts
   * are maintained by triggers on the join tables, so this is a single-table read
   * rather than an aggregate over every document.
   *
   * Expected to use the index on `(user_id, document_count desc)`.
   */
  listWithCounts(userId: string): Promise<TopicRow[]>;

  /**
   * Assigns topics to a document, inserting into `document_topics` on
   * `(document_id, topic_id)` so re-running classification is idempotent, and
   * marking the highest-confidence assignment as primary.
   *
   * This is the canonical writer for that table. `DocumentQueries.attachTopics`
   * exposes the same write from the document side for call sites that hold a
   * document id; the two must not diverge.
   */
  assignToDocument(documentId: string, assignments: TopicAssignment[]): Promise<void>;

  /**
   * Writes a topic's centroid — the mean of its members' vectors, used to match
   * new documents to existing topics without an LLM call. The centroid lives in
   * the active embedding space, so a provider change invalidates it exactly as it
   * invalidates chunk vectors, and it must be recomputed from re-embedded members.
   */
  updateCentroid(id: string, centroid: number[]): Promise<void>;

  /**
   * Topics whose keyword array contains `keyword`, exact match. Backs the cheap
   * pre-LLM topic match; expected to use the GIN index on `keywords`.
   *
   * Deliberately not a fuzzy search — a near match here would attribute content
   * to the wrong topic, and the LLM path is the one that can reason about
   * ambiguity.
   */
  findByKeyword(userId: string, keyword: string): Promise<TopicRow[]>;

  /**
   * Merges `fromId` into `toId`: repoints its `document_topics` rows and its
   * memories, then deletes the now-empty source topic.
   *
   * Must run in one transaction, which means an RPC rather than a sequence of
   * calls from here — a partial merge leaves documents pointing at a deleted
   * topic. Counts are recomputed as part of the same transaction.
   */
  mergeTopics(fromId: string, toId: string): Promise<void>;
}

/**
 * Builds the `topics` repository. Counters (`document_count`, `memory_count`) are
 * owned by database triggers, never written from here.
 */
export function createTopicsQueries(_client: TypedSupabaseClient): TopicsQueries {
  return {
    async upsertBySlug(_topic: TopicInsert): Promise<TopicRow> {
      // TODO(phase-2): `.upsert(topic, { onConflict: 'user_id,slug' }).select().single()`,
      // refreshing `last_seen_at` on the way through.
      throw new Error('Not implemented: TopicsQueries.upsertBySlug');
    },

    async listWithCounts(_userId: string): Promise<TopicRow[]> {
      // TODO(phase-2): `.eq('user_id', userId).order('document_count', { ascending: false })`.
      throw new Error('Not implemented: TopicsQueries.listWithCounts');
    },

    async assignToDocument(_documentId: string, _assignments: TopicAssignment[]): Promise<void> {
      // TODO(phase-2): upsert into `document_topics` on `(document_id, topic_id)`,
      // clearing `is_primary` on the document's other rows when a new primary wins.
      throw new Error('Not implemented: TopicsQueries.assignToDocument');
    },

    async updateCentroid(_id: string, _centroid: number[]): Promise<void> {
      // TODO(phase-2): `update({ centroid }).eq('id', id)`, formatting the vector as
      // the `'[1,2,3]'` literal the column expects.
      throw new Error('Not implemented: TopicsQueries.updateCentroid');
    },

    async findByKeyword(_userId: string, _keyword: string): Promise<TopicRow[]> {
      // TODO(phase-2): `.eq('user_id', userId).contains('keywords', [keyword])`.
      throw new Error('Not implemented: TopicsQueries.findByKeyword');
    },

    async mergeTopics(_fromId: string, _toId: string): Promise<void> {
      // TODO(phase-2): call a `merge_topics(from_id, to_id)` RPC that moves the
      // join rows, repoints memories, recomputes counters and deletes the source
      // topic inside one transaction.
      throw new Error('Not implemented: TopicsQueries.mergeTopics');
    },
  };
}
