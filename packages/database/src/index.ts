/**
 * `@second-brain/database` — the single place in the monorepo that knows Postgres.
 *
 * Services import query factories from here and never build a PostgREST query
 * themselves, so schema changes have exactly one place to land and the RLS story
 * is decided once, at client construction.
 *
 * Every object lives in the `second_brain` schema, not `public`. Clients created
 * here are bound to it (see {@link DEFAULT_SCHEMA}), which is why the query
 * modules can address tables unqualified.
 */

export {
  asDbError,
  createSupabaseClient,
  createUserScopedClient,
  DbError,
  DEFAULT_SCHEMA,
  isForeignKeyViolation,
  isUndefinedTable,
  isUniqueViolation,
  supabaseFromEnv,
} from './client';
export { createActivityQueries } from './queries/activity';
export { createChunksQueries } from './queries/chunks';
export { createDocumentQueries } from './queries/documents';
export { createMemoriesQueries } from './queries/memories';
export { createTopicsQueries } from './queries/topics';
export { Constants } from './types/database';

export type {
  ClientAuthOptions,
  ClientMode,
  DatabaseEnv,
  DbErrorOptions,
  PublicClientConfig,
  ServiceClientConfig,
  SupabaseClientConfig,
  TypedSupabaseClient,
} from './client';
export type {
  ActivityEventRow,
  ActivityQueries,
  ActivityTypeCount,
  ListRecentActivityOptions,
  TimeByTopic,
  TimeRange,
} from './queries/activity';
export type {
  ChunkEmbeddingUpdate,
  ChunksQueries,
  DocumentChunkInsert,
  DocumentChunkRow,
  ListChunksOptions,
  MatchChunksArgs,
  MatchChunksResult,
} from './queries/chunks';
export type {
  DocumentInsert,
  DocumentQueries,
  DocumentRow,
  ListRecentDocumentsOptions,
  SearchByTitleOptions,
} from './queries/documents';
export type {
  FindSimilarMemoriesOptions,
  ListActiveMemoriesOptions,
  MatchMemoriesArgs,
  MatchMemoriesResult,
  MemoriesQueries,
  MemoryInsert,
  MemoryRow,
} from './queries/memories';
export type { DocumentTopicRow, TopicInsert, TopicRow, TopicsQueries } from './queries/topics';
export type { Database, Enums, Json, Tables, TablesInsert, TablesUpdate } from './types/database';
