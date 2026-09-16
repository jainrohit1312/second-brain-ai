import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types/database';
import type { DocumentSource, TopicAssignment } from '@second-brain/shared';

/** Row shape of `documents`. */
export type DocumentRow = Database['second_brain']['Tables']['documents']['Row'];

/** Insert shape of `documents`; the camelCase domain mapping happens at the call site. */
export type DocumentInsert = Database['second_brain']['Tables']['documents']['Insert'];

/** Options for {@link DocumentQueries.listRecent}. */
export interface ListRecentDocumentsOptions {
  /** Hard cap on returned rows. */
  limit: number;
  source?: DocumentSource;
  from?: string;
  to?: string;
}

/** Options for {@link DocumentQueries.searchByTitle}. */
export interface SearchByTitleOptions {
  /** Hard cap on returned rows; typeahead needs few. */
  limit: number;
}

/**
 * Data access for `documents` — the extracted, readable artifacts of things the
 * user read or watched. Written by processing, read by retrieval and the
 * dashboard.
 */
export interface DocumentQueries {
  /**
   * Idempotent insert keyed on the natural key `(user_id, content_hash)`,
   * returning the stored row — either the one just inserted or the one that was
   * already there. Re-reading an unchanged page is therefore a no-op instead of
   * a duplicate document.
   *
   * Expected to use the unique index on `(user_id, content_hash)`. A unique
   * violation surfacing from here means the conflict target is wrong.
   */
  upsertByContentHash(document: DocumentInsert): Promise<DocumentRow>;

  /**
   * Looks a document up by its normalized URL. Returns `null` when the URL has
   * never been captured — a normal outcome, since activity events arrive for
   * pages that are never extracted.
   *
   * Expected to use the index on `(user_id, canonical_url)`; `canonicalUrl` must
   * already be normalized by `canonicalizeUrl` from `@second-brain/shared`.
   */
  findByCanonicalUrl(userId: string, canonicalUrl: string): Promise<DocumentRow | null>;

  /**
   * Loads one document by primary key, `null` when it does not exist. Callers
   * that need only metadata should still prefer this over selecting `*`, because
   * `extracted_text` is large.
   */
  getById(id: string): Promise<DocumentRow | null>;

  /**
   * Most recently captured documents for a user, newest first. Expected to use
   * the index on `(user_id, captured_at desc)`.
   */
  listRecent(userId: string, opts: ListRecentDocumentsOptions): Promise<DocumentRow[]>;

  /**
   * Writes the distilled summary and nothing else. Called by the distillation
   * pass, which must not rewrite `extracted_text` and invalidate the chunks that
   * were derived from it.
   */
  setSummary(id: string, summary: string): Promise<void>;

  /**
   * Attaches topic assignments to a document, upserting into `document_topics`
   * on `(document_id, topic_id)` so re-running classification does not duplicate
   * links, and demoting the previous primary when a new one wins.
   *
   * Every `topicId` must already exist — resolve slugs through
   * `topics.upsertBySlug` first, or the insert trips the foreign key (`23503`).
   */
  attachTopics(documentId: string, assignments: TopicAssignment[]): Promise<void>;

  /**
   * Writes the importance score computed by the importance scorer. Never called
   * with a client-supplied value: the score is a server-side derivation and
   * overwriting it with a client's opinion would corrupt the ranking signal.
   */
  updateImportance(id: string, importance: number): Promise<void>;

  /**
   * Case-insensitive title search for the dashboard's typeahead. Expected to use
   * the trigram or tsvector index on `title`.
   *
   * Not part of retrieval: recall is what `matchChunks` and `hybrid_search` are
   * for, and this method cannot answer a content question.
   */
  searchByTitle(userId: string, query: string, opts: SearchByTitleOptions): Promise<DocumentRow[]>;
}

/**
 * Builds the `documents` repository. `attachTopics` fans out to `document_topics`;
 * `topics.document_count` is maintained by a trigger, not by this module.
 */
export function createDocumentQueries(_client: TypedSupabaseClient): DocumentQueries {
  return {
    async upsertByContentHash(_document: DocumentInsert): Promise<DocumentRow> {
      // TODO(phase-2): `.upsert(row, { onConflict: 'user_id,content_hash' }).select().single()`.
      throw new Error('Not implemented: DocumentQueries.upsertByContentHash');
    },

    async findByCanonicalUrl(_userId: string, _canonicalUrl: string): Promise<DocumentRow | null> {
      // TODO(phase-2): `.eq('user_id', userId).eq('canonical_url', canonicalUrl).maybeSingle()`.
      throw new Error('Not implemented: DocumentQueries.findByCanonicalUrl');
    },

    async getById(_id: string): Promise<DocumentRow | null> {
      // TODO(phase-2): `.eq('id', id).maybeSingle()`.
      throw new Error('Not implemented: DocumentQueries.getById');
    },

    async listRecent(_userId: string, _opts: ListRecentDocumentsOptions): Promise<DocumentRow[]> {
      // TODO(phase-2): filtered `select()`, `order('captured_at', { ascending: false })`,
      // `.limit(opts.limit)`.
      throw new Error('Not implemented: DocumentQueries.listRecent');
    },

    async setSummary(_id: string, _summary: string): Promise<void> {
      // TODO(phase-2): `update({ summary }).eq('id', id)`.
      throw new Error('Not implemented: DocumentQueries.setSummary');
    },

    async attachTopics(_documentId: string, _assignments: TopicAssignment[]): Promise<void> {
      // TODO(phase-2): upsert into `document_topics` on `(document_id, topic_id)`,
      // setting `is_primary` for the highest-confidence assignment. Slugs in
      // `assignments` must already have been resolved through `topics.upsertBySlug`.
      throw new Error('Not implemented: DocumentQueries.attachTopics');
    },

    async updateImportance(_id: string, _importance: number): Promise<void> {
      // TODO(phase-2): `update({ importance }).eq('id', id)`.
      throw new Error('Not implemented: DocumentQueries.updateImportance');
    },

    async searchByTitle(
      _userId: string,
      _query: string,
      _opts: SearchByTitleOptions,
    ): Promise<DocumentRow[]> {
      // TODO(phase-2): `.ilike('title', '%query%')` or a tsvector match, scoped to
      // the user and capped at `opts.limit`.
      throw new Error('Not implemented: DocumentQueries.searchByTitle');
    },
  };
}
