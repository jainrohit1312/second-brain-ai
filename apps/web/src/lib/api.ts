import type {
  ActivityBatch,
  ActivityBatchResult,
  Citation,
  Device,
  QueryIntent,
  RetrievalQuery,
} from '@second-brain/shared';

/**
 * Inclusive ISO-8601 window used by every stats call. Both bounds are UTC instants supplied by the
 * caller; the dashboard converts local dates before sending them.
 */
export interface DateRange {
  from: string;
  to: string;
}

/** Minutes attributed to one topic inside a date range, as returned by the retrieval service. */
export interface TopicTimeBucket {
  topicId: string;
  label: string;
  minutes: number;
}

/** Aggregate activity counters for one date range. */
export interface ActivityStats {
  range: DateRange;
  documentCount: number;
  memoryCount: number;
  totalMinutes: number;
  topics: TopicTimeBucket[];
}

/**
 * A completed answer. `text` is the assembled synthesis and `citations` are the passages it was
 * built from; citation `index` values are the `[n]` markers referenced inside `text`.
 */
export interface Answer {
  id: string;
  query: RetrievalQuery;
  intent: QueryIntent;
  text: string;
  citations: Citation[];
  /** True when the context window was assembled without reranking or with a degraded source. */
  degraded: boolean;
  createdAt: string;
}

/**
 * Handle for an in-flight answer. `deltas` yields text fragments in order; `completed` resolves
 * with the full {@link Answer} (including citations) once the stream ends.
 */
export interface AnswerStream {
  answerId: string;
  deltas: AsyncIterable<string>;
  completed: Promise<Answer>;
}

/** Resolves the services API base URL, or throws when the app was built without it. */
function apiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_API_BASE_URL');
  }
  return base.replace(/\/+$/, '');
}

/**
 * Thin typed wrapper around `fetch` for the services API.
 *
 * Resolves `path` against `NEXT_PUBLIC_API_BASE_URL`, sends/accepts JSON, and throws on a non-2xx
 * response. The caller owns the result type: the response is cast, not validated.
 *
 * TODO(phase-2): attach the Supabase session token as a bearer header and validate response bodies
 * with `zod` schemas built from the `@second-brain/shared` types.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText} (${path})`);
  }

  return (await response.json()) as T;
}

/**
 * Sends a retrieval query and returns a streaming answer. POST `/ask`.
 *
 * TODO(phase-3): implement against the retrieval service; the response is a server-sent event
 * stream of `{ delta }` frames followed by one `{ answer }` frame.
 */
export async function askQuestion(_query: RetrievalQuery): Promise<AnswerStream> {
  // TODO(phase-3): build the stream adapter and map SSE frames onto `AnswerStream`.
  throw new Error('Not implemented: askQuestion');
}

/**
 * Uploads one batch of captured activity events. POST `/ingest`.
 *
 * Only used by clients that cannot write to Supabase directly (the web app is read-mostly), but it
 * is part of the shared client contract so the signature lives here.
 *
 * TODO(phase-3): implement, and treat a `serverCursor` response as the caller's new sync cursor.
 */
export async function ingestBatch(_batch: ActivityBatch): Promise<ActivityBatchResult> {
  // TODO(phase-3): POST the batch and return the accepted/rejected/duplicate counts.
  throw new Error('Not implemented: ingestBatch');
}

/**
 * Lists the caller's registered devices, including revoked ones. GET `/devices`.
 *
 * TODO(phase-2): implement; the settings table consumes this to render the revoke actions.
 */
export async function listDevices(): Promise<Device[]> {
  // TODO(phase-2): return `apiFetch<Device[]>('/devices')`.
  throw new Error('Not implemented: listDevices');
}

/**
 * Loads aggregate activity counters for a date range. GET `/activity/stats`.
 *
 * TODO(phase-2): implement; the dashboard date-range picker is a shell until this exists.
 */
export async function getActivityStats(_range: DateRange): Promise<ActivityStats> {
  // TODO(phase-2): pass the range as `?from=&to=` query parameters.
  throw new Error('Not implemented: getActivityStats');
}
