import { createEmbeddingProvider } from '@second-brain/providers';
import { normalizeWhitespace, type ActivityEventType } from '@second-brain/shared';

import type { ActivityEventRow, DocumentRow } from '@second-brain/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Read queries for the dashboard. Every function takes the caller's request-scoped client and
 * relies on Row Level Security for scoping: the policies on `documents` and `activity_events` are
 * `user_id = auth.uid()`, so no query here filters by user id and none may be handed a service-role
 * client.
 *
 * Rows are projected and renamed to the camelCase shape the components render, because that mapping
 * belongs at the data boundary rather than in JSX (see `@second-brain/database`'s note on where the
 * snake_case mapping happens).
 */

/** A week, in milliseconds — the window the stats tiles use. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rows scanned when counting domains. PostgREST exposes no `GROUP BY`, so the counts are folded
 * here and the scan has to be bounded; a week of browsing is far below this ceiling.
 */
const MAX_DOMAIN_ROWS = 5000;

/** One row of the activity feed. */
export interface ActivityFeedItem {
  id: string;
  /**
   * Narrowed to the shared union rather than left as the column's `text`/`string`: the closed set is
   * enforced by `activity_events_type_check`, and the UI switches on it.
   */
  type: ActivityEventType;
  url: string | null;
  title: string | null;
  /** Server-computed importance score in `[0, 1]`. */
  importance: number;
  /** The band that score falls into; what the feed renders, since a band is readable at a glance. */
  importanceBand: string;
  receivedAt: string;
}

/** One row of the recent-documents list. */
export interface RecentDocument {
  id: string;
  title: string;
  url: string | null;
  wordCount: number;
  /** `pending` / `succeeded` / `failed` / `skipped`. */
  extractionStatus: string;
  capturedAt: string;
}

/** One domain and how many events pointed at it inside the window. */
export interface DomainCount {
  domain: string;
  count: number;
}

/** Newest activity events first, capped at `limit`. */
export async function listRecentActivity(
  client: SupabaseClient,
  limit = 50,
): Promise<ActivityFeedItem[]> {
  const { data, error } = await client
    .from('activity_events')
    .select('id, type, url, title, importance, importance_band, received_at')
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load recent activity: ${error.message}`);
  }

  return ((data ?? []) as ActivityEventRow[]).map((row) => ({
    id: row.id,
    type: row.type as ActivityEventType,
    url: row.url,
    title: row.title,
    importance: row.importance,
    importanceBand: row.importance_band,
    receivedAt: row.received_at,
  }));
}

/**
 * Newest documents first, capped at `limit`.
 *
 * Soft-deleted rows are filtered out in the query, not by the policy: `documents_select_own`
 * deliberately lets a user see their own deleted rows so a delete can be undone, which makes
 * `deleted_at is null` every read path's responsibility.
 */
export async function listRecentDocuments(
  client: SupabaseClient,
  limit = 20,
): Promise<RecentDocument[]> {
  const { data, error } = await client
    .from('documents')
    .select('id, title, url, word_count, extraction_status, captured_at')
    .is('deleted_at', null)
    .order('captured_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load recent documents: ${error.message}`);
  }

  return ((data ?? []) as DocumentRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    wordCount: row.word_count,
    extractionStatus: row.extraction_status,
    capturedAt: row.captured_at,
  }));
}

/**
 * `page_view` events captured since local midnight.
 *
 * "Today" is the server's calendar day, which for a locally hosted app is the reader's.
 * `received_at` (when the server accepted the event) rather than `occurred_at` is what the count
 * uses, so an event captured on another device lands in the day it arrived.
 */
export async function countPagesToday(client: SupabaseClient): Promise<number> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const { count, error } = await client
    .from('activity_events')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'page_view')
    .gte('received_at', startOfToday.toISOString());

  if (error) {
    throw new Error(`Failed to count today's pages: ${error.message}`);
  }

  return count ?? 0;
}

/** Documents captured in the last seven days, rolling from now rather than from a calendar week. */
export async function countDocumentsThisWeek(client: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - WEEK_MS).toISOString();

  const { count, error } = await client
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .gte('captured_at', since);

  if (error) {
    throw new Error(`Failed to count this week's documents: ${error.message}`);
  }

  return count ?? 0;
}

/** The busiest domains over the last seven days, most events first. */
export async function topDomains(client: SupabaseClient, limit = 5): Promise<DomainCount[]> {
  const since = new Date(Date.now() - WEEK_MS).toISOString();

  const { data, error } = await client
    .from('activity_events')
    .select('domain')
    .gte('received_at', since)
    .limit(MAX_DOMAIN_ROWS);

  if (error) {
    throw new Error(`Failed to load top domains: ${error.message}`);
  }

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<Pick<ActivityEventRow, 'domain'>>) {
    if (row.domain === null || row.domain === '') continue;
    counts.set(row.domain, (counts.get(row.domain) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    .slice(0, limit);
}

/** One ranked search hit. */
export interface SearchHit {
  id: string;
  url: string | null;
  title: string;
  wordCount: number;
  capturedAt: string;
  extractionStatus: string;
  /** Raw `ts_rank_cd` value; `[0, 1)` because the RPC normalizes it. */
  rank: number;
  /** The document's opening text, whitespace collapsed, capped by the RPC's own SQL-side limit. */
  text: string;
  /** First {@link SNIPPET_LENGTH} characters of {@link text}, for a result row. */
  snippet: string;
}

/** Options for {@link searchDocuments}. */
export interface SearchOptions {
  /** Hard cap on returned rows; the RPC clamps it again server-side. */
  limit?: number;
  /** Hits below this rank are dropped by the RPC. Used to keep weak matches out of a prompt. */
  minRank?: number;
}

/** Characters of document text carried per hit — enough to judge a match, small enough to ship 20. */
const SNIPPET_LENGTH = 200;

/**
 * Words carrying no retrieval signal in a natural-language question.
 *
 * Closed and hand-written rather than borrowed from a text-processing dependency: this list only
 * has to be good enough that the surviving words describe the subject, and a package's list is
 * tuned for a different corpus. `read` is here despite being a verb a question about documents
 * leans on — as a question word it says nothing about *which* document, and leaving it in is what
 * made "What did I read about vector databases?" require the literal token `read` in the article.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'about', 'as', 'at', 'be', 'by', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'its', 'me',
  'my', 'of', 'on', 'or', 'read', 'said', 'say', 'that', 'the', 'this', 'to', 'was',
  'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you',
  'your', 'am', 'been', 'being', 'but', 'can', 'could', 'should', 'would', 'may',
  'might', 'must', 'shall', 'they', 'them', 'their', 'he', 'she', 'him', 'her',
  'we', 'us', 'our', 'also', 'than', 'then', 'there', 'here', 'so', 'if', 'not',
  'no', 'yes', 'any', 'all', 'some', 'more', 'most', 'much', 'many', 'very',
]);

/**
 * Rewrites a natural-language question as a keyword search string for {@link searchDocuments}.
 *
 * The RPC hands its argument to `websearch_to_tsquery`, which reads unquoted words as AND: passing
 * a question through verbatim demands *every* word be present, so "What did I read about vector
 * databases?" matches only a document containing all of `read`, `vector` and `databas`, and the
 * Wikipedia "Vector database" article is missed by one stopword. Joining the surviving words with
 * `OR` makes any single content word enough for `@@`, and `ts_rank_cd` still orders the results, so
 * a query naming the subject ranks the article about it first.
 *
 * Only the chat leg calls this. The search box is keyword entry by contract — the typist supplies
 * the terms — and running it through this filter would silently drop a deliberate word.
 *
 * Punctuation is stripped for the same reason: the `-` and `"` of search-box syntax are characters
 * a question can contain in their ordinary sense ("state-of-the-art", a quoted phrase), and
 * `websearch_to_tsquery` would read them as exclusion and phrase operators.
 */
export function toSearchQuery(question: string): string {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));

  // Every word was a stopword (or too short to keep): fall back to the original text so the caller
  // still issues a well-formed query. It will usually retrieve nothing, and the chat route's
  // no-context branch answers that better than a blank query would.
  return words.length > 0 ? words.join(' OR ') : question.trim();
}

/**
 * Ranked full-text search over the caller's documents. Backs both the search page and the
 * retrieval step of the chat route.
 *
 * Calls the `search_documents` RPC rather than filtering through PostgREST, because ranking is the
 * whole point of a text search and PostgREST cannot order by `ts_rank_cd`. The RPC is
 * `security invoker`, so Row Level Security scopes the rows; `userId` is passed because every
 * function in the retrieval family takes it explicitly, and a wrong value narrows the result to
 * nothing rather than widening it.
 *
 * `query` is bound as a parameter — it never reaches SQL as text. The RPC hands it to
 * `websearch_to_tsquery`, which treats it as search-box syntax and cannot raise on malformed input.
 */
export async function searchDocuments(
  client: SupabaseClient,
  userId: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  const { limit = 20, minRank = 0 } = options;

  const { data, error } = await client.rpc('search_documents', {
    user_id: userId,
    query_text: query,
    match_count: limit,
    min_rank: minRank,
  });

  if (error) {
    throw new Error(`Document search failed: ${error.message}`);
  }

  return mapSearchRows((data ?? []) as SearchRow[]);
}

/** Options for {@link searchDocumentsHybrid}. */
export interface HybridSearchOptions extends SearchOptions {
  /**
   * The string handed to the full-text leg, when it should differ from the string embedded.
   *
   * The two legs want different inputs and this is the only place that difference can be
   * expressed. The chat route embeds the natural-language question but must send
   * {@link toSearchQuery}(question) to the RPC, because `websearch_to_tsquery` reads unquoted
   * words as AND and a question would then demand every stopword be present in the document.
   * The search box is keyword entry by contract, so it leaves this unset and both legs see the
   * typist's own words.
   */
  ftsQuery?: string;
}

/**
 * Env var holding the NVIDIA credential. Read server-side only, inside the function, and
 * **never** given a `NEXT_PUBLIC_` prefix: that prefix is inlined into the browser bundle.
 */
const NVIDIA_API_KEY_ENV = 'NVIDIA_API_KEY';

/**
 * Interactive budget for the query embedding. The provider defaults (30s per attempt, 3
 * retries) are sized for a background worker; a search box that waits two minutes looks hung.
 */
const QUERY_EMBEDDING_TIMEOUT_MS = 20_000;
const QUERY_EMBEDDING_MAX_RETRIES = 1;

/** Set once, so a missing key warns rather than filling the log on every request. */
let warnedAboutMissingEmbeddingKey = false;

/**
 * Embeds one search query with `inputType: 'query'`.
 *
 * Returns `null` — rather than throwing — when the credential is absent, which is a
 * configuration state and means "run the text leg alone", exactly as phase 1c-1 did.
 *
 * The asymmetry is not cosmetic. `nv-embedqa-e5-v5` is trained with different projections for
 * stored passages and for the query that searches them, and `'query'` is what selects the
 * query projection. Omitting it — or embedding the query as a `'document'` — does not fail; it
 * silently returns worse neighbours, which is the worst kind of bug here.
 */
async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env[NVIDIA_API_KEY_ENV]?.trim();

  if (apiKey === undefined || apiKey === '') {
    if (!warnedAboutMissingEmbeddingKey) {
      warnedAboutMissingEmbeddingKey = true;
      console.warn(
        `${NVIDIA_API_KEY_ENV} is not set; hybrid retrieval is running the full-text leg alone. ` +
          'Set it in the server environment to enable vector search.',
      );
    }
    return null;
  }

  const provider = createEmbeddingProvider('nvidia', {
    apiKey,
    timeoutMs: QUERY_EMBEDDING_TIMEOUT_MS,
    maxRetries: QUERY_EMBEDDING_MAX_RETRIES,
  });

  const vector = await provider.embedOne(text, { inputType: 'query' });
  if (vector.length !== provider.dimensions) {
    throw new Error(
      `Embedding provider returned a ${vector.length}-dimensional query vector, but ` +
        `${provider.model} is configured for ${provider.dimensions}.`,
    );
  }
  return vector;
}

/**
 * Hybrid retrieval: the vector leg over `document_chunks` fused with the full-text leg over
 * `documents.fts` by reciprocal rank fusion, via the `search_documents_hybrid` RPC. Same
 * return shape as {@link searchDocuments}, so a caller can swap one for the other.
 *
 * **This function never throws because the embedding provider is unavailable.** A provider
 * outage degrades to full-text search and is logged; it does not 500 the request. That is the
 * documented behaviour of the retrieval engine (services/retrieval, S6) and the reason the
 * fallback goes through {@link searchDocuments} rather than returning an error.
 *
 * Losing the vector leg loses exactly what the vector leg is for — paraphrase and
 * cross-language queries — so the failure is logged at `error` and the caller's answer is
 * built from a keyword-only result set. An RPC failure degrades the same way, for the same
 * reason: a database that has not had this migration applied should still answer searches.
 */
export async function searchDocumentsHybrid(
  client: SupabaseClient,
  userId: string,
  query: string,
  options: HybridSearchOptions = {},
): Promise<SearchHit[]> {
  const { limit = 20, minRank = 0, ftsQuery = query } = options;

  let embedding: number[] | null = null;
  try {
    embedding = await embedQuery(query);
  } catch (error) {
    console.error('Query embedding failed; falling back to full-text retrieval only.', error);
  }

  if (embedding === null) {
    return searchDocuments(client, userId, ftsQuery, { limit, minRank });
  }

  try {
    const { data, error } = await client.rpc('search_documents_hybrid', {
      user_id: userId,
      query_text: ftsQuery,
      // PostgREST sends the argument as text and lets the database cast it to `vector`; the
      // literal form is what pgvector's input function accepts.
      query_embedding: JSON.stringify(embedding),
      match_count: limit,
      min_rank: minRank,
    });

    if (error) {
      throw new Error(`Hybrid search RPC failed: ${error.message}`);
    }

    return mapSearchRows((data ?? []) as SearchRow[]);
  } catch (error) {
    console.error('Hybrid search failed; falling back to full-text retrieval only.', error);
    return searchDocuments(client, userId, ftsQuery, { limit, minRank });
  }
}

/**
 * Projects the shared row shape of `search_documents` and `search_documents_hybrid`.
 *
 * Both RPCs return the same columns on purpose — see the header of
 * `20260916100600_hybrid_search_rpc.sql` — so the mapping lives here once rather than in two
 * functions that could drift.
 */
function mapSearchRows(rows: readonly SearchRow[]): SearchHit[] {
  return rows.map((row) => {
    const text = normalizeWhitespace(row.excerpt ?? '');

    return {
      id: row.id,
      url: row.url,
      title: row.title,
      wordCount: row.word_count,
      capturedAt: row.captured_at,
      extractionStatus: row.extraction_status,
      rank: row.rank,
      text,
      snippet: text.slice(0, SNIPPET_LENGTH),
    };
  });
}

/**
 * Row shape returned by the `search_documents` RPC.
 *
 * Written out rather than projected from
 * `Database['second_brain']['Functions']['search_documents']['Returns']`: the generator emits every
 * function-return column as non-nullable, including `url`, which the SQL leaves nullable because a
 * document can be captured without one. Deriving from it would type a genuine `null` as a `string`
 * and carry the mistake into the UI.
 */
interface SearchRow {
  id: string;
  url: string | null;
  title: string;
  word_count: number;
  captured_at: string;
  extraction_status: string;
  rank: number;
  excerpt: string | null;
}
