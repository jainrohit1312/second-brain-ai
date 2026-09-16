import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types/database';

/** Row shape of `document_chunks`. */
export type DocumentChunkRow = Database['second_brain']['Tables']['document_chunks']['Row'];

/** Insert shape of `document_chunks`. */
export type DocumentChunkInsert = Database['second_brain']['Tables']['document_chunks']['Insert'];

/** Arguments of the `match_chunks` RPC, as declared in the generated types. */
export type MatchChunksArgs = Database['second_brain']['Functions']['match_chunks']['Args'];

/** One row returned by the `match_chunks` RPC. */
export type MatchChunksResult =
  Database['second_brain']['Functions']['match_chunks']['Returns'][number];

/** Options for {@link ChunksQueries.listByDocument}. */
export interface ListChunksOptions {
  /**
   * Whether to select the `embedding` column. Defaults to `false`: a document's
   * vectors are megabytes, and only the backfill and the re-embed migration need
   * them. When excluded, `embedding` comes back as `null`, which means "not
   * fetched", not "not embedded" — use `countWithoutEmbeddings` for that.
   */
  includeEmbedding?: boolean;
  limit?: number;
}

/** A vector write for a single chunk, produced by the embedding pass. */
export interface ChunkEmbeddingUpdate {
  chunkId: string;
  /** Vector from the active embedding provider; length must match the column's width. */
  embedding: number[];
  /** Model that produced the vector, persisted as provenance. */
  embeddingModel: string;
}

/**
 * Data access for `document_chunks` — the unit of retrieval. A document is
 * chunked once, embedded once, and everything downstream cites these rows.
 */
export interface ChunksQueries {
  /**
   * Inserts a document's chunks in one statement, returning them as stored.
   * Chunking is expected to be idempotent (the caller deletes first, or reuses
   * unchanged chunks), because the unique key is `(document_id, ordinal)`:
   * re-chunking without clearing collides rather than replacing.
   */
  insertMany(chunks: DocumentChunkInsert[]): Promise<DocumentChunkRow[]>;

  /**
   * A document's chunks in reading order. Expected to use the index on
   * `(document_id, ordinal)`; `embedding` is excluded unless asked for.
   */
  listByDocument(documentId: string, opts?: ListChunksOptions): Promise<DocumentChunkRow[]>;

  /**
   * Writes embeddings for existing chunks, in bulk, as the embedding pass
   * completes batches. Each update carries its own `embeddingModel`, so a
   * partially migrated column is still self-describing.
   */
  setEmbeddings(updates: ChunkEmbeddingUpdate[]): Promise<void>;

  /**
   * Calls the `match_chunks` RPC: vector similarity over one user's chunks,
   * nearest first. `rpcArgs.user_id` is what keeps it scoped — a user-scoped
   * client adds RLS on top, a service-role client relies on the argument.
   *
   * `query_embedding` must come from the same model and width as the stored
   * vectors, and must be embedded with `inputType: 'query'`.
   */
  matchChunks(rpcArgs: MatchChunksArgs): Promise<MatchChunksResult[]>;

  /**
   * Deletes every chunk of a document and returns how many rows went. Cascades
   * from the document normally; this exists for re-processing, where the
   * document row survives but its derived text is stale.
   */
  deleteByDocument(documentId: string): Promise<number>;

  /**
   * How many of a user's chunks still have no vector — the size of the embedding
   * backlog, which the processing service uses to decide whether a backfill pass
   * is worth starting. Expected to use the partial index on `where embedding is null`.
   */
  countWithoutEmbeddings(userId: string): Promise<number>;
}

/**
 * Builds the `document_chunks` repository. This is the only module that reads or
 * writes vectors, which is deliberate: the width of `embedding` and the active
 * provider's model are the same fact, and it is expressed here.
 */
export function createChunksQueries(_client: TypedSupabaseClient): ChunksQueries {
  return {
    async insertMany(_chunks: DocumentChunkInsert[]): Promise<DocumentChunkRow[]> {
      // TODO(phase-2): single multi-row `.insert(chunks).select()`, chunked so one
      // statement does not carry thousands of rows.
      throw new Error('Not implemented: ChunksQueries.insertMany');
    },

    async listByDocument(
      _documentId: string,
      _opts?: ListChunksOptions,
    ): Promise<DocumentChunkRow[]> {
      // TODO(phase-2): `select(columns).eq('document_id', id).order('ordinal')`,
      // with `embedding` omitted from `columns` unless `opts.includeEmbedding`.
      throw new Error('Not implemented: ChunksQueries.listByDocument');
    },

    async setEmbeddings(_updates: ChunkEmbeddingUpdate[]): Promise<void> {
      // TODO(phase-2): one update per chunk (PostgREST cannot set a different
      // vector per row in a single statement), issued with bounded concurrency.
      throw new Error('Not implemented: ChunksQueries.setEmbeddings');
    },

    async matchChunks(_rpcArgs: MatchChunksArgs): Promise<MatchChunksResult[]> {
      // TODO(phase-2): `.rpc('match_chunks', rpcArgs)`. Format the vector as the
      // `'[1,2,3]'` literal the PostgREST function expects.
      throw new Error('Not implemented: ChunksQueries.matchChunks');
    },

    async deleteByDocument(_documentId: string): Promise<number> {
      // TODO(phase-2): `delete({ count: 'exact' }).eq('document_id', id)`.
      throw new Error('Not implemented: ChunksQueries.deleteByDocument');
    },

    async countWithoutEmbeddings(_userId: string): Promise<number> {
      // TODO(phase-2): `select('*', { count: 'exact', head: true })` filtered on
      // `embedding is null` and the user.
      throw new Error('Not implemented: ChunksQueries.countWithoutEmbeddings');
    },
  };
}
