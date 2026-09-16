/**
 * Edge function: `process-activity`.
 *
 * Intake for `ActivityBatch` payloads sent by the Chrome extension, the Android
 * app, and the ingestion service. It authenticates the caller, resolves the
 * device the batch claims to come from, validates each event and each document,
 * persists the accepted rows idempotently, and reports per-item outcomes.
 *
 * ROUTE: POST {SUPABASE_URL}/functions/v1/process-activity, which is this
 * repository's deployment of the `POST /v1/ingest/batch` contract in
 * docs/API_REFERENCE.md. That document — not this file — is the arbitration point
 * when a client and the server disagree, so where the two differ the document
 * wins and the difference is a bug here. The extension reaches it through
 * `supabase.functions.invoke('process-activity', { body: batch })`, which is why
 * the CORS header list below has to admit the extension's own client header.
 *
 * TWO CLIENTS, ON PURPOSE:
 *   - `serviceClient` (service-role key) performs the privileged write into
 *     `activity_events`. It bypasses Row Level Security, so every statement it
 *     runs must carry an explicit `user_id` filter taken from the authenticated
 *     caller. That filter is the only thing standing between a bug here and a
 *     cross-user write, which is why `user_id` is read from the verified JWT and
 *     never from the body.
 *   - `userClient` carries the caller's `Authorization` header, so Postgres RLS
 *     still applies. Auth verification and the device lookup both go through it:
 *     `devices_select_own` makes a `device_id` owned by somebody else
 *     indistinguishable from one that does not exist, so the read cannot be
 *     turned into an existence probe for another user's devices.
 *
 * WHY THE SERVICE ROLE IS THE WRITER, AND NOT THE CALLER'S TOKEN
 *   `activity_events` has RLS enabled *and forced*, with no INSERT policy at all:
 *   clients never write activity directly (ADR-018), so no anon-key client
 *   carrying a user JWT can insert a row here — including this function's own
 *   `userClient`. The alternative, granting `authenticated` an INSERT policy,
 *   moves validation into the client and is ADR-018's explicitly rejected
 *   alternative. Validation therefore lives here, in one place, and the write runs
 *   as the one role that is allowed to make it.
 *
 * THE DOCUMENT HALF OF A BATCH, AND WHY IT IS SHAPED DIFFERENTLY
 *   A batch may also carry `documents` — page bodies the client already extracted
 *   with Readability — which land in `second_brain.documents`. They are not events
 *   and are not processed like events:
 *
 *   - The write is an RPC, not a PostgREST upsert. The contract is
 *     `ON CONFLICT (user_id, content_hash) DO UPDATE SET last_seen_at, title, url`
 *     — three columns, named. PostgREST's upsert sets *every* column in the
 *     payload, so it would rewrite `captured_at` on a re-capture, and `captured_at`
 *     is the document list's sort key. `upsert_document_captures` exists to keep
 *     the update set to what the contract names; its migration carries the long
 *     form of this reasoning.
 *   - `content_hash` is computed here, with shared's `contentHash` transcribed
 *     below, and is the document's dedup identity. It is never read from the wire:
 *     a client that could name it could merge two documents it merely believes are
 *     identical.
 *   - `extraction_status` is written as `succeeded`, because the client has
 *     already run extraction. A client that could not extract a body sends no
 *     document at all — the failure is recorded as an event, not as a document row
 *     with no text.
 *   - Documents are *not* linked to events. `page_read`, and the correlation
 *     between the two halves, are deliberately absent from this phase; a later
 *     phase joins them by URL and timestamp.
 *
 * PHASE 1 TRANSITIONAL GAP: per-device ingest secrets are issued server-side at
 * registration (ADR-018) and register-device does not exist yet, so no
 * `devices.ingest_secret_hash` has ever been written. See `assertDeviceSecret`
 * for the four-case rule that keeps verification strict where a hash exists and
 * visible-but-open where it does not.
 *
 * STILL PHASE 2, DELIBERATELY ABSENT:
 *   - Re-scoring. `scoreImportance()` needs history (`revisitCount`,
 *     `topicNovelty`, `seenDomains`) that a single request does not have, so the
 *     stored `importance` is the client's advisory number, exactly as ADR-009
 *     describes, and `server_importance`/`importance_version` stay null. Nothing
 *     is dropped for scoring low either: a server that discarded rows on the
 *     client's own score would be trusting the number ADR-009 calls untrusted.
 *   - Enqueueing follow-up work. The schema has no job-queue table yet (the nine
 *     tables are devices, activity_events, documents, document_chunks, topics,
 *     memories, document_topics, memory_sources and user_settings), so there is
 *     nowhere to put a job; the extract → chunk → embed → distill chain is
 *     triggered by a later migration plus its own change.
 *   - `importance_band` is derived from the client's score by `bandFor` for the
 *     same reason. When the re-score lands, the band must be recomputed from
 *     `server_importance` in the same statement, or the retention sweep keeps
 *     filtering on a value that no longer means what its name says.
 *
 * NOTE: this directory is outside the pnpm workspace (Deno resolves imports from
 * ./deno.json), so it cannot import `@second-brain/shared`. The `Wire*` types and
 * the two mirrored constant tables below are the narrow contract this function
 * needs, and they must be kept in sync with `packages/shared/src/types/activity.ts`,
 * `.../types/device.ts` and `.../constants/{event-types,importance}.ts`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Stable name used in logs, so a report can name a function. */
const FUNCTION_NAME = 'process-activity';

/**
 * The application schema. Every product table lives in `second_brain` (ADR-020)
 * while PostgREST's default schema is `public`, which holds none of them — so a
 * client that omits this reads the wrong schema and gets "relation does not
 * exist" for a table that exists. Deno cannot import `@second-brain/database`,
 * so `DEFAULT_SCHEMA` is mirrored here the way the wire types are.
 */
const APP_SCHEMA = 'second_brain';

/**
 * The client type this function is written against.
 *
 * Both generic arguments are named on purpose. `Database` stays `any` because this
 * function sits outside the workspace and cannot use the generated row types;
 * `SchemaName` is pinned to the application schema, so a client built without the
 * `db: { schema }` bind — one that would silently query `public` and find none of
 * these tables — does not type-check as this type.
 */
type AppSchemaClient = SupabaseClient<any, typeof APP_SCHEMA>;

/**
 * Headers returned on every response. This endpoint is called cross-origin by the
 * browser extension, so a missing CORS header shows up as an opaque client error.
 *
 * `x-second-brain-client` and `idempotency-key` are listed because callers send
 * them — the extension attaches the first to every request it makes
 * (`EXTENSION_CLIENT_HEADER`) and the ingestion contract documents the second. A
 * header a caller sends but this list omits fails the preflight, which means the
 * request never reaches this handler at all and no log line here can explain why.
 */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-second-brain-client, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Accepted `schemaVersion`. Mirrors `SCHEMA_VERSION` in shared's `constants/event-types.ts`. */
const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Maximum events per batch. Mirrors `SYNC_BATCH_SIZE` in `.env.example`, which is
 * also what the extension's queue page size and the documented 4 MB body ceiling
 * are sized against.
 */
const SYNC_BATCH_SIZE = 100;

/** The closed set of captureable event types. Mirrors `ACTIVITY_EVENT_TYPES`. */
const ACTIVITY_EVENT_TYPES: readonly string[] = [
  'page_view',
  'page_read',
  'selection',
  'copy',
  'youtube_watch',
  'app_session',
  'search',
  'bookmark',
  'download',
];

/**
 * Bounds from `activity_events_dedupe_key_len_check`. Checked here so a bad key
 * becomes one rejected event instead of a constraint violation that fails the
 * whole batch — the difference between 99 events stored and none.
 */
const DEDUPE_KEY_MIN_LENGTH = 8;
const DEDUPE_KEY_MAX_LENGTH = 128;

/**
 * Plausibility window for the client's `occurredAt`. Deliberately loose: the point
 * is to catch a broken clock (which would poison the ordering key every read path
 * sorts and pages on), not to police the client's timezone or a laptop resuming
 * from sleep. A value outside the window is clamped, not dropped, and the original
 * is recorded in `metadata.occurredAtClamped`.
 */
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1_000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;

/**
 * Band thresholds, *lower bounds*, mirrored from
 * `IMPORTANCE_BAND_THRESHOLDS` in shared's `constants/importance.ts` and listed
 * highest-first so a score lands in the highest band it meets. This is the same
 * unavoidable duplication as the wire types, with the same failure mode: a
 * threshold changed in one place and not the other tags rows with a band their
 * score does not earn.
 *
 * This array is also what `IMPORTANCE_MIN_THRESHOLD` (0.25, i.e. `low`) mirrors —
 * which is why the drop-below-threshold rule belongs with the server re-score and
 * not with the client's advisory number.
 */
const IMPORTANCE_BAND_THRESHOLDS: ReadonlyArray<readonly [string, number]> = [
  ['critical', 0.9],
  ['high', 0.7],
  ['normal', 0.45],
  ['low', 0.25],
  ['noise', 0],
];

/**
 * Maximum documents per batch. Far below `SYNC_BATCH_SIZE` because the units are
 * not comparable: an event carries an excerpt, a document carries a whole page
 * body, and the ceiling below is five times larger than any excerpt. See
 * docs/API_REFERENCE.md#post-v1ingestbatch for the documented cap.
 */
const MAX_DOCUMENTS_PER_BATCH = 5;

/**
 * Bounds on an uploaded body. Below the floor there is no document — that is a
 * cookie wall, a login gate, or a gallery, and the client records the failure as
 * an event rather than uploading a stub. Above the ceiling is a client bug.
 *
 * THE RULE THESE TWO CONSTANTS ENCODE — "loose server, tight client". The server's
 * bounds are the widest any client may rely on; deciding that a page is not worth
 * capturing belongs to the client, which is the only side that can see why. So the
 * extension refuses to offer a body under `READABILITY_MIN_CHARACTERS` (500, in
 * `content/extractor.ts`, and the same value as `charThreshold` in its Readability
 * options) while this contract accepts one down to 200 — a floor loose enough for
 * the Android extractor, which need not choose the same number.
 *
 * The rule is written down rather than left implicit because the failure it prevents
 * is one-sided and silent: a server floor tighter than a client's rejects bodies that
 * client considered worth sending, and `rejectedDocumentUrls` reports a url but never
 * a reason, so the client cannot discover the threshold by experiment — it can only
 * lose documents to it. Loosening these bounds is safe; tightening them is a contract
 * change that has to move with every client's extractor.
 */
const DOCUMENT_MIN_CHARS = 200;
const DOCUMENT_MAX_CHARS = 500_000;

/**
 * The closed set `documents_source_check` accepts. Mirrors `DocumentSource` in
 * shared's `types/document.ts`. Checked here so a value outside the enum becomes
 * one rejected document instead of a constraint violation that fails the insert —
 * the same reason `ACTIVITY_EVENT_TYPES` is checked before a row is built.
 *
 * Browser captures send `web`. The extension's own `'chrome'` was the obvious
 * mistake here and the constraint is what catches it, which is why the check runs
 * before the write rather than being left to the database.
 */
const DOCUMENT_SOURCES: readonly string[] = [
  'web',
  'youtube',
  'pdf',
  'gdoc',
  'newsletter',
  'manual',
];

/**
 * The name of the RPC that performs the document write, in the application schema.
 * Kept as a constant because the function it names is defined in
 * `supabase/migrations/20260916099000_upsert_document_captures.sql` — a rename
 * there and here must move together, and a single definition is easier to grep for.
 */
const UPSERT_DOCUMENTS_RPC = 'upsert_document_captures';

/**
 * `contentHash`'s algorithm prefix and its two FNV-1a constants, mirrored from
 * shared's `utils/hash.ts`.
 *
 * THE MIRROR IS LOAD-BEARING, so read this before changing any of it.
 * `documents.content_hash` is a document's dedup identity under
 * `documents_user_content_hash_key`, and four already-committed artifacts agree on
 * what it contains: `docs/DATABASE_SCHEMA.md`, `docs/API_REFERENCE.md`,
 * `services/ingestion/src/handlers/document.ts` ("the hash must be the one the
 * shared `contentHash` helper produces"), and the client-sent
 * `page_read.contentHash` validated by `services/ingestion/src/validation/schemas.ts`.
 *
 * A second algorithm here would put two incompatible values under one unique
 * constraint, so the same article captured by the two write paths would become two
 * rows — silently, with no error and no log, destroying exactly the deduplication
 * the constraint exists to provide. `documents.content_hash` is also server-owned
 * and immutable, so the mistake would need a migration to undo.
 *
 * Deno cannot import `@second-brain/shared` (this directory is outside the pnpm
 * workspace), so the function is transcribed rather than imported — the same
 * unavoidable duplication the `Wire*` types carry.
 */
const CONTENT_HASH_PREFIX = 'fnv1a64';
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK_64 = 0xffffffffffffffffn;

/**
 * Instant form only — `2026-09-16T09:12:00Z` or with an offset. A bare
 * `2026-09-16` and a locale string both parse successfully in JavaScript while
 * meaning something else than an instant, and `occurred_at` is the ordering key
 * for every read path, so the format is checked before the value is trusted.
 */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Canonical UUID form, which is the column type of both `activity_events.id` and `devices.id`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Wire fields that become columns. Everything else in an event is variant-specific
 * (`domain`, `durationMs`, `text`, `videoId`, …) and is stored verbatim in
 * `payload`, which is what that column is for: "the variant-specific fields, keyed
 * per event type". `receivedAt` is stripped even though the client is documented
 * not to send it, because the server stamps it and a client-supplied value would
 * look authoritative in the row.
 */
const BASE_EVENT_FIELDS: readonly string[] = [
  'id',
  'deviceId',
  'type',
  'occurredAt',
  'receivedAt',
  'importance',
  'dedupeKey',
  'url',
  'title',
  'metadata',
];

/**
 * Base fields of a captured event as they arrive over the wire. Type-specific
 * fields are not enumerated: they are copied to `payload` unexamined, so adding a
 * field to an event type is a client change and not a change here.
 */
interface WireActivityEventBase {
  id: string;
  deviceId: string;
  type: string;
  occurredAt: string;
  importance: number;
  dedupeKey: string;
  url: string | null;
  title: string | null;
  metadata: Record<string, unknown>;
}

/**
 * The base fields plus whatever the event's type adds (`domain`, `durationMs`,
 * `text`, `videoId`, …). The index signature is what lets the two promoted fields
 * be read by name while everything else is copied verbatim, and it is why an
 * unenumerated variant field is `unknown` here — read it only after a check.
 */
type WireActivityEvent = WireActivityEventBase & Record<string, unknown>;

/**
 * One uploaded document body, as it arrives over the wire. Mirrors `DocumentUpload`
 * in `packages/shared/src/types/activity.ts`, with two fields deliberately absent
 * on both sides: no `contentHash` (the server computes it, because it is the
 * document's dedup identity) and no `metadata` (nothing persists one).
 */
interface WireDocument {
  url: string;
  title: string;
  content: string;
  language: string | null;
  source: string;
  wordCount: number;
  occurredAt: string;
}

/** One sync payload from one device. `schemaVersion` is checked against `SUPPORTED_SCHEMA_VERSION`. */
interface WireActivityBatch {
  schemaVersion: number;
  deviceId: string;
  clientSentAt: string;
  events: WireActivityEvent[];
  /**
   * Extracted page bodies. Optional, and independent of `events`: a batch may carry
   * documents and no events. `readBatch` narrows the value before `checkBatchRules`
   * counts it, so by then it is either absent or an array — the type says optional,
   * the validation guarantees the shape.
   */
  documents?: WireDocument[];
}

/**
 * The columns this function writes. `received_at`, `server_importance` and
 * `importance_version` are absent on purpose: the first is the database's own
 * receipt stamp, and the other two belong to the server re-score.
 */
interface ActivityEventRow {
  id: string;
  user_id: string;
  device_id: string;
  type: string;
  occurred_at: string;
  importance: number;
  importance_band: string;
  dedupe_key: string;
  url: string | null;
  title: string | null;
  domain: string | null;
  duration_seconds: number | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/**
 * The response body. Mirrors `ActivityBatchResult` in
 * `packages/shared/src/types/activity.ts`; its shape is what clients advance their
 * queue on, so it cannot change without a schema version bump.
 */
interface ActivityBatchResult {
  accepted: number;
  rejected: number;
  duplicates: number;
  serverCursor: string;
  rejectedIds: string[];
  /**
   * Documents stored or refreshed by this batch. Counts every document that passed
   * validation, including one collapsed onto another in the same batch (see
   * `upsertDocuments`) — it is stored, and the client has nothing different to do.
   */
  documentsAccepted: number;
  /** Documents that failed per-document validation. */
  documentsRejected: number;
  /**
   * The urls to drop from the client's document queue. Separate from `rejectedIds`
   * because that field carries event ids, and a document has no id on either side
   * until its content is hashed.
   */
  rejectedDocumentUrls: string[];
}

/** The columns the device phase needs. The hash is read but never logged or returned. */
interface DeviceRow {
  id: string;
  ingest_secret_hash: string | null;
  revoked_at: string | null;
}

/**
 * One element of the `p_documents` JSON array `upsert_document_captures` reads
 * through `jsonb_to_recordset`. The keys are the parameter names that function
 * declares, so this interface and its recordset definition have to move together —
 * a key renamed on one side only is a null field on the other, not an error.
 */
interface DocumentCapture {
  source: string;
  url: string;
  title: string;
  language: string | null;
  word_count: number;
  content_hash: string;
  extracted_text: string;
  captured_at: string;
}

/**
 * A rejection with the status and `code` the client is documented to branch on
 * (docs/API_REFERENCE.md#error-codes). Both travel on the error so the mapping
 * lives at the throw site, where the reason is known, rather than in a chain of
 * `instanceof` checks in the handler.
 */
class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Thrown for caller mistakes, so the handler can answer 400 — or 413 for an
 * over-sized batch, which is the same class of problem with a different status.
 */
class BadRequestError extends RequestError {
  constructor(code: string, message: string, status = 400) {
    super(status, code, message);
  }
}

/**
 * Reads a required environment value.
 * @throws Error naming the missing variable. Edge functions get no startup
 * validation, so without this a misconfigured secret surfaces as `undefined`
 * somewhere deep inside a query instead of at the top of the request.
 */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required secret: ${name}. Set it with \`supabase secrets set ${name}=<value>\` ` +
        'or add it to the --env-file passed to `supabase functions serve`, then retry.',
    );
  }
  return value;
}

/** Builds the privileged client. It bypasses RLS: never run a statement without a `user_id` filter. */
function createServiceClient(): AppSchemaClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    db: { schema: APP_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Reads the bearer token from the request.
 * @throws RequestError(401 unauthorized) when the header is absent, is not a
 * bearer token, or carries no token. Returning a 401 rather than throwing a plain
 * Error matters: a plain Error becomes a 500, and a 500 tells the client to retry
 * a request that can never succeed.
 */
function readBearerToken(req: Request): string {
  const authorization = req.headers.get('Authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    throw new RequestError(
      401,
      'unauthorized',
      'Expected an "Authorization: Bearer <access token>" header.',
    );
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (token === '') {
    throw new RequestError(401, 'unauthorized', 'The Authorization header carries an empty token.');
  }
  return token;
}

/**
 * Builds a client bound to the caller's JWT so every statement it issues is
 * subject to Row Level Security. The schema bind is not optional: without it the
 * client queries `public`, which holds none of this application's tables.
 * @throws RequestError(401 unauthorized) when no bearer token is present.
 */
function createUserClient(req: Request): AppSchemaClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    db: { schema: APP_SCHEMA },
    global: { headers: { Authorization: `Bearer ${readBearerToken(req)}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Serialises a success body as JSON, attaching the CORS headers and the request id. */
function jsonResponse(body: Record<string, unknown>, status: number, requestId: string): Response {
  return new Response(JSON.stringify({ ...body, requestId }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Serialises an error in the documented envelope: a stable `code` the client
 * branches on, a human-readable `message`, and the `requestId` that matches this
 * invocation's log lines. The sibling functions answer with a flat
 * `{ function, error }` shape instead; this one follows API_REFERENCE.md because
 * the extension's error handling is written against `code`.
 */
function errorResponse(code: string, message: string, status: number, requestId: string): Response {
  return new Response(JSON.stringify({ error: { code, message, requestId } }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** `catch` narrows to `unknown`; this keeps error rendering in one place. Used for logs only. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads the request body and checks the envelope: a JSON object with a UUID
 * `deviceId`, an `events` array, and an optional `documents` array. Nothing about
 * the members of either array is validated here — a malformed event is a rejected
 * event and a malformed document is a rejected document, but neither is a rejected
 * batch, and that distinction is enforced in `toActivityEventRow` and
 * `toDocumentRow`.
 * @throws BadRequestError when the body is malformed, so the caller gets a 400.
 */
async function readBatch(req: Request): Promise<WireActivityBatch> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new BadRequestError('bad_request', 'Request body must be JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BadRequestError('bad_request', 'Request body must be a JSON object.');
  }
  const batch = parsed as Partial<WireActivityBatch>;
  if (typeof batch.deviceId !== 'string' || !UUID_PATTERN.test(batch.deviceId)) {
    throw new BadRequestError(
      'bad_request',
      'Request body must contain a `deviceId` that is a UUID.',
    );
  }
  if (!Array.isArray(batch.events)) {
    throw new BadRequestError('bad_request', 'Request body must contain an `events` array.');
  }
  // Optional, but when present it must be an array. `checkBatchRules` counts it and
  // the document phase maps over it, so a non-array would fail later — inside the
  // map, or against the accounting invariant — with an error that names nothing
  // the caller can act on.
  if (batch.documents !== undefined && !Array.isArray(batch.documents)) {
    throw new BadRequestError(
      'bad_request',
      'Request body `documents` must be an array when it is present.',
    );
  }
  return batch as WireActivityBatch;
}

/**
 * Batch-level rules from docs/API_REFERENCE.md, applied before any per-item work.
 * A violation is a batch the server cannot process, so the whole request fails; an
 * individual event or document that fails validation is a different thing entirely
 * and is counted into `rejectedIds` / `rejectedDocumentUrls` instead. Keeping the
 * two apart is what makes "one bad event must not discard the other 99" true.
 */
function checkBatchRules(batch: WireActivityBatch): void {
  if (batch.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new BadRequestError(
      'unsupported_schema_version',
      `schemaVersion ${String(batch.schemaVersion)} is not supported; this server accepts ` +
        `${SUPPORTED_SCHEMA_VERSION}. Update the client rather than retrying.`,
    );
  }

  const events = batch.events;
  const documents = batch.documents ?? [];

  if (events.length > SYNC_BATCH_SIZE) {
    throw new BadRequestError(
      'payload_too_large',
      `The batch holds ${events.length} events; the maximum is ${SYNC_BATCH_SIZE}. Split it and retry.`,
      413,
    );
  }

  // The document cap is separate and much smaller, because the units differ: an
  // event carries an excerpt and a document carries a whole page body.
  if (documents.length > MAX_DOCUMENTS_PER_BATCH) {
    throw new BadRequestError(
      'payload_too_large',
      `The batch holds ${documents.length} documents; the maximum is ` +
        `${MAX_DOCUMENTS_PER_BATCH}. Split it and retry.`,
      413,
    );
  }

  // Empty `events` is allowed, but only when `documents` carries something: a flush
  // whose only pending work is a page body still has to be sendable. A batch empty on
  // both halves carries no work at all, and answering 200 with a full set of zeroes
  // would tell the client its queue had drained when nothing had been sent.
  if (events.length === 0 && documents.length === 0) {
    throw new BadRequestError(
      'validation_failed',
      'The batch must carry at least one event or at least one document.',
    );
  }

  // A batch is single-device by construction, and that is what lets one device
  // identity authenticate the whole request. A mixed batch could not be checked
  // against a single device row at all. Documents carry no `deviceId` of their own —
  // they inherit the batch's — so only events are checked here.
  if (events.some((event) => event.deviceId !== batch.deviceId)) {
    throw new BadRequestError(
      'validation_failed',
      'Every event must carry the same `deviceId` as the batch that contains it.',
    );
  }
}

/**
 * Verifies the caller's JWT by asking GoTrue to resolve it. The token is never
 * parsed for its claims to decide *who* the caller is — only to tell an expired
 * token apart from an unverifiable one, because the documented client behaviour
 * differs: refresh and retry once on `token_expired`, re-authenticate on
 * `unauthorized`. Those are different screens for the user.
 *
 * Note that a deployed function with `verify_jwt = true` (see
 * supabase/config.toml) has already had the token checked by the platform before
 * this code runs, and the platform answers a malformed token with its own body
 * rather than this envelope. The check stays because it is what makes the
 * documented codes real, and because it is the only thing protecting the handler
 * when it is served locally with verification off.
 */
async function authenticateCaller(
  req: Request,
  userClient: AppSchemaClient,
): Promise<{ id: string }> {
  const token = readBearerToken(req);
  const { data, error } = await userClient.auth.getUser(token);
  if (error !== null || data.user === null) {
    if (isExpiredJwt(token)) {
      throw new RequestError(
        401,
        'token_expired',
        'The access token has expired. Refresh it and retry once.',
      );
    }
    throw new RequestError(401, 'unauthorized', 'The access token could not be verified.');
  }
  return { id: data.user.id };
}

/**
 * True when the token's own `exp` claim is in the past.
 *
 * This runs only on a token GoTrue has already refused, so it classifies a
 * rejection rather than authorising anything: a forged token with a past expiry
 * still gets 401, it just gets `token_expired` instead of `unauthorized`. The
 * signature is never checked here — that is GoTrue's job, and re-implementing it
 * would be a second, weaker answer to the same question.
 */
function isExpiredJwt(token: string): boolean {
  const payload = token.split('.')[1];
  if (payload === undefined) {
    return false;
  }
  try {
    const claims = JSON.parse(atob(base64UrlToBase64(payload))) as { exp?: unknown };
    return typeof claims.exp === 'number' && claims.exp * 1_000 <= Date.now();
  } catch {
    // A payload that will not decode is not evidence of expiry; GoTrue's refusal
    // is what stands, and the caller gets `unauthorized`.
    return false;
  }
}

/** `atob` wants standard base64 with padding; a JWT segment is base64url without it. */
function base64UrlToBase64(value: string): string {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const remainder = padded.length % 4;
  return remainder === 0 ? padded : padded.padEnd(padded.length + (4 - remainder), '=');
}

/**
 * Loads the device the batch claims to come from, through the caller-bound client
 * so RLS does the ownership check: `devices_select_own` restricts the read to rows
 * whose `user_id = auth.uid()`. The explicit `user_id` filter repeats what the
 * policy already enforces — belt and braces against a policy that is later
 * loosened, and free because the column is indexed by the primary key.
 *
 * "Not found" and "not yours" are deliberately the same answer. Distinguishing
 * them would turn this endpoint into an oracle for whether another user's device
 * id exists (docs/API_REFERENCE.md takes the same position on `not_found`).
 *
 * @throws RequestError(401 device_mismatch) when no such device is owned by the
 * caller — the documented code for a `deviceId` and credential that do not
 * describe the same authorised device.
 */
async function loadOwnedDevice(
  userClient: AppSchemaClient,
  userId: string,
  deviceId: string,
): Promise<DeviceRow> {
  const { data, error } = await userClient
    .from('devices')
    .select('id, ingest_secret_hash, revoked_at')
    .eq('id', deviceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error !== null) {
    // A failed lookup is a server problem, not a caller one: a 401 here would tell
    // the client to re-register a device that may be perfectly fine.
    throw new Error(`devices lookup failed: ${error.message}`);
  }
  if (data === null) {
    throw new RequestError(
      401,
      'device_mismatch',
      '`deviceId` does not identify a device registered to this account.',
    );
  }
  return data as DeviceRow;
}

/**
 * PHASE 1 TRANSITIONAL GAP — read before changing.
 *
 * A per-device ingest secret is issued server-side at registration (ADR-018) and
 * register-device has not shipped, so every row in `devices` has a null
 * `ingest_secret_hash` and no client can present a verifiable secret. Neither
 * extreme is acceptable: rejecting on a missing secret makes sync impossible for
 * everyone today, and accepting anything whenever a hash *is* present ships a
 * check that silently stops working the moment registration lands.
 *
 * So a stored hash is authoritative and a missing one is a known, logged gap:
 *
 *   | X-Device-Secret | stored hash | outcome                                   |
 *   | --------------- | ----------- | ----------------------------------------- |
 *   | present         | present     | verify it; mismatch is 401 device_mismatch |
 *   | present         | null        | allow, WARN — registration has not run     |
 *   | absent          | null        | allow, WARN — registration has not run     |
 *   | absent          | present     | 401 device_mismatch                        |
 *
 * The last row is what makes the rule forward-compatible without a change here:
 * when register-device starts storing hashes, a client that does not send one is
 * a genuine mismatch rather than a missing feature, and the two WARN paths fall
 * silent as the rows they cover disappear.
 *
 * Revocation is checked by the caller, before this, and outranks all four rows:
 * `devices_revoked_consistency_check` forces a revoked device's hash to null, so
 * without that ordering case 3 above would quietly keep a revoked device writing.
 *
 * THE HASH FORMAT IS AN ASSUMPTION STATED HERE BECAUSE NOTHING ELSE STATES IT:
 * lowercase hex SHA-256 of the secret, compared value-independently. register-device
 * must store exactly that, and if it ever stores something else (a salted or
 * memory-hard digest), the comparison below is wrong rather than merely weaker and
 * must change with it.
 */
async function assertDeviceSecret(
  device: DeviceRow,
  presentedSecret: string | null,
  requestId: string,
): Promise<void> {
  const storedHash = device.ingest_secret_hash;
  const hasSecret = presentedSecret !== null && presentedSecret !== '';

  if (storedHash === null) {
    if (!hasSecret) {
      console.warn(
        `[${FUNCTION_NAME}] requestId=${requestId} device=${device.id} accepted without an ` +
          'X-Device-Secret: no ingest secret has been registered for it yet (phase 1 gap).',
      );
    } else {
      console.warn(
        `[${FUNCTION_NAME}] requestId=${requestId} device=${device.id} presented an ` +
          'X-Device-Secret that could not be verified: no hash is stored for it yet (phase 1 gap).',
      );
    }
    return;
  }

  if (!hasSecret) {
    throw new RequestError(
      401,
      'device_mismatch',
      'This device has a registered ingest secret; the request must present it.',
    );
  }

  const presentedHash = await hashIngestSecret(presentedSecret);
  if (!timingSafeEqual(presentedHash, storedHash.trim().toLowerCase())) {
    throw new RequestError(401, 'device_mismatch', 'The ingest secret does not match this device.');
  }
}

/** Hex SHA-256 of a secret, in the form `assertDeviceSecret` expects to read back. */
async function hashIngestSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Compares two digests without leaking *where* they differ through timing. The
 * length check short-circuits, which reveals only the length — a fixed property of
 * the format, not a property of the secret.
 */
function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** `null` when the value is not an ISO-8601 instant, so the event is rejected rather than guessed at. */
function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `undefined` means "not storable as written"; `null` and a string are both stored as given. */
function optionalString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * `duration_seconds` is a promoted column that `activity_events_promoted_fields_check`
 * requires for three of the nine event types, so this both maps and enforces:
 * `page_view` reports milliseconds (`durationMs`) while `app_session` and
 * `youtube_watch` report seconds (`durationSeconds`).
 *
 * `undefined` — not storable — is a real outcome, not a defensive branch: a
 * `youtube_watch` whose `durationSeconds` is null (captions or duration unknown)
 * has no value the column accepts, and 0 would be a lie the retention sweep and
 * every duration-based read would then believe.
 */
function durationSecondsFor(type: string, event: WireActivityEvent): number | null | undefined {
  if (type === 'page_view') {
    const durationMs = event['durationMs'];
    return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
      ? Math.round(durationMs / 1_000)
      : undefined;
  }
  if (type === 'app_session' || type === 'youtube_watch') {
    const durationSeconds = event['durationSeconds'];
    return typeof durationSeconds === 'number' &&
      Number.isFinite(durationSeconds) &&
      durationSeconds >= 0
      ? Math.round(durationSeconds)
      : undefined;
  }
  return null;
}

/** Event types whose `domain` the schema requires to be present. */
function requiresDomain(type: string): boolean {
  return type === 'page_view' || type === 'page_read';
}

/**
 * Replaces an implausible `occurredAt` with the server's receipt time and reports
 * what it replaced, so the caller can record the original in
 * `metadata.occurredAtClamped` rather than losing it. Clamping beats dropping: a
 * clock-skewed event is still evidence the user read something, and `occurred_at`
 * only has to be sane, not exact.
 */
function clampOccurredAt(
  occurredAt: Date,
  now: Date,
): { storedAt: string; clampedFrom: string | null } {
  const skewMs = occurredAt.getTime() - now.getTime();
  if (skewMs > MAX_FUTURE_SKEW_MS || skewMs < -MAX_AGE_MS) {
    return { storedAt: now.toISOString(), clampedFrom: occurredAt.toISOString() };
  }
  return { storedAt: occurredAt.toISOString(), clampedFrom: null };
}

/**
 * The stored band for a score: the highest band whose lower bound the score meets.
 * Computed from the *client's* advisory score until the server re-score lands —
 * see this file's header for why that is a deliberate phase-1 position rather than
 * an oversight, and for what has to change with it.
 */
function bandFor(score: number): string {
  for (const [band, lowerBound] of IMPORTANCE_BAND_THRESHOLDS) {
    if (score >= lowerBound) {
      return band;
    }
  }
  return 'noise';
}

/** Every wire field that is not promoted to a column, kept verbatim as the type-specific half of the row. */
function variantFields(event: WireActivityEvent): Record<string, unknown> {
  const variant: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!BASE_EVENT_FIELDS.includes(key)) {
      variant[key] = value;
    }
  }
  return variant;
}

/** The row to insert, or the reason this one event is not storable. */
type EventVerdict =
  | { ok: true; row: ActivityEventRow }
  | { ok: false; eventId: string; reason: string };

/** A rejected event keeps its id so the client can drop exactly that entry from its queue. */
function reject(eventId: unknown, reason: string): EventVerdict {
  return { ok: false, eventId: typeof eventId === 'string' ? eventId : String(eventId), reason };
}

/**
 * Validates one wire event and maps it onto the columns of `activity_events`.
 *
 * Rejection is per event, never per batch: a batch of 100 with one malformed
 * payload answers 200 with `rejected: 1`, because discarding 99 valid events to
 * report one bad one is the failure mode this endpoint exists to avoid.
 *
 * Most checks below are not stylistic. They are the database's own constraints
 * moved to where a single event can be blamed for them — a non-UUID `id`, a
 * `dedupe_key` outside 8–128 characters, an `importance` outside [0, 1], a
 * `page_read` with no `domain`, a `type` outside the closed set. Left in the
 * database, each of those fails the *whole statement*, which turns one client bug
 * into a 500 for a batch that was otherwise fine.
 *
 * `now` is passed in rather than read here so every row in one batch is clamped
 * against the same instant, which is also what the database's `now()` does for
 * `received_at`.
 */
function toActivityEventRow(
  event: WireActivityEvent,
  userId: string,
  deviceId: string,
  now: Date,
): EventVerdict {
  const id = event.id;
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    return reject(id, 'id is not a UUID');
  }

  const type = event.type;
  if (typeof type !== 'string' || !ACTIVITY_EVENT_TYPES.includes(type)) {
    return reject(id, `type ${JSON.stringify(type)} is not a captureable event type`);
  }

  // Already enforced batch-wide; repeated so this function is safe to call on an
  // event from anywhere, and because `device_id` is half of the row's identity and
  // half of the idempotency constraint.
  if (event.deviceId !== deviceId) {
    return reject(id, 'deviceId does not match the batch');
  }

  const occurredAt = parseTimestamp(event.occurredAt);
  if (occurredAt === null) {
    return reject(id, 'occurredAt is not an ISO-8601 instant');
  }

  const importance = event.importance;
  if (
    typeof importance !== 'number' ||
    !Number.isFinite(importance) ||
    importance < 0 ||
    importance > 1
  ) {
    return reject(id, 'importance is not a number in [0, 1]');
  }

  const dedupeKey = event.dedupeKey;
  if (
    typeof dedupeKey !== 'string' ||
    dedupeKey.length < DEDUPE_KEY_MIN_LENGTH ||
    dedupeKey.length > DEDUPE_KEY_MAX_LENGTH
  ) {
    return reject(
      id,
      `dedupeKey must be a string of ${DEDUPE_KEY_MIN_LENGTH}–${DEDUPE_KEY_MAX_LENGTH} characters`,
    );
  }

  const url = optionalString(event.url);
  if (url === undefined) {
    return reject(id, 'url must be a string or null');
  }
  const title = optionalString(event.title);
  if (title === undefined) {
    return reject(id, 'title must be a string or null');
  }

  const metadata = event.metadata;
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return reject(id, 'metadata must be an object');
  }

  const domain = optionalString(event['domain']);
  if (domain === undefined) {
    return reject(id, 'domain must be a string or null');
  }
  if (requiresDomain(type) && domain === null) {
    return reject(id, `${type} must carry a domain`);
  }

  const durationSeconds = durationSecondsFor(type, event);
  if (durationSeconds === undefined) {
    return reject(id, `${type} must carry a duration that is a non-negative number of seconds`);
  }

  const { storedAt, clampedFrom } = clampOccurredAt(occurredAt, now);

  // Server-owned annotations win over the client's `metadata`, so a client cannot
  // pre-empt the fields that describe what the server did to its payload.
  const annotations: Record<string, unknown> = {
    // Receipt lag, measured against the timestamp actually stored: an event whose
    // clock ran ahead reports 0 rather than a negative lag, which is the only
    // reading of "how stale is this" that stays meaningful.
    syncLagMs: now.getTime() - Date.parse(storedAt),
  };
  if (clampedFrom !== null) {
    annotations['occurredAtClamped'] = clampedFrom;
  }

  return {
    ok: true,
    row: {
      id,
      user_id: userId,
      device_id: deviceId,
      type,
      occurred_at: storedAt,
      importance,
      importance_band: bandFor(importance),
      dedupe_key: dedupeKey,
      url,
      title,
      domain,
      duration_seconds: durationSeconds,
      payload: variantFields(event),
      metadata: { ...metadata, ...annotations },
    },
  };
}

/**
 * `contentHash` from shared's `utils/hash.ts`, transcribed. See `CONTENT_HASH_PREFIX`
 * for why the transcription is load-bearing rather than lazy.
 *
 * Byte-for-byte identical to the shared implementation, and it has to stay that way:
 * `charCodeAt` walks UTF-16 code units, the mask is `2**64 - 1`, and the prefix is
 * part of the value. The two normalizers are transcribed for the same reason —
 * hashing raw text would store two documents for one article whose only difference
 * is reflowed whitespace or a non-breaking space, which is exactly the duplicate
 * this hash exists to collapse.
 */
function contentHashOf(text: string): string {
  return `${CONTENT_HASH_PREFIX}:${fnv1a64Hex(normalizeWhitespace(normalizeUnicode(text)))}`;
}

/** NFC, plus the zero-width characters that break equality. Mirrors shared's `normalizeUnicode`. */
function normalizeUnicode(text: string): string {
  return text.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/** Collapse whitespace runs and trim. Mirrors shared's `normalizeWhitespace`. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * FNV-1a 64-bit, as 16 lowercase hex characters. Mirrors shared's `fnv1a64Hex`.
 *
 * BigInt rather than Number because 64 bits does not fit in a double: with `Number`
 * the multiply would silently discard the low bits, and every hash would be wrong
 * in a way that still looks like a hash.
 */
function fnv1a64Hex(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * FNV_PRIME) & FNV_MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

/** The row to upsert, or the reason this one document is not storable. */
type DocumentVerdict =
  | { ok: true; capture: DocumentCapture }
  | { ok: false; url: string; reason: string };

/** A rejected document keeps its url so the client can drop exactly that entry. */
function rejectDocument(url: unknown, reason: string): DocumentVerdict {
  // `String(url)` is the same best effort the event path makes with `eventId`. The url
  // is the only handle the client and the server share for a document, so even an
  // unusable one is reported rather than dropped: the count has to add up.
  return { ok: false, url: typeof url === 'string' ? url : String(url), reason };
}

/**
 * Validates one wire document and maps it onto the arguments
 * `upsert_document_captures` takes.
 *
 * Rejection is per document, never per batch, for the same reason it is per event:
 * discarding four good bodies to report one bad one is the failure mode this endpoint
 * exists to avoid. Most checks below are again the database's own constraints moved
 * to where a single document can be blamed for them — a `source` outside the enum, a
 * `word_count` below 1, a `title` that is not a string. Left in the database, any of
 * those fails the whole statement, turning one client bug into a 500 for a batch that
 * was otherwise fine.
 *
 * `content_hash` is computed here and never read from the wire, because it is the
 * document's dedup identity: a client that could name it could merge two documents it
 * merely believes are identical.
 */
function toDocumentRow(document: WireDocument, now: Date): DocumentVerdict {
  const url = document.url;
  if (typeof url !== 'string' || url === '') {
    return rejectDocument(url, 'url must be a non-empty string');
  }

  // Empty is legitimate — `documents.title` is `not null default ''` — so this checks
  // the type and nothing else.
  const title = document.title;
  if (typeof title !== 'string') {
    return rejectDocument(url, 'title must be a string');
  }

  const content = document.content;
  if (typeof content !== 'string') {
    return rejectDocument(url, 'content must be a string');
  }
  if (content.length < DOCUMENT_MIN_CHARS) {
    return rejectDocument(url, `content is shorter than ${DOCUMENT_MIN_CHARS} characters`);
  }
  if (content.length > DOCUMENT_MAX_CHARS) {
    return rejectDocument(url, `content is longer than ${DOCUMENT_MAX_CHARS} characters`);
  }

  const language = optionalString(document.language);
  if (language === undefined) {
    return rejectDocument(url, 'language must be a string or null');
  }

  const source = document.source;
  if (typeof source !== 'string' || !DOCUMENT_SOURCES.includes(source)) {
    return rejectDocument(url, `source ${JSON.stringify(source)} is not a document source`);
  }

  const wordCount = document.wordCount;
  if (typeof wordCount !== 'number' || !Number.isInteger(wordCount) || wordCount < 1) {
    return rejectDocument(url, 'wordCount must be an integer of at least 1');
  }

  const occurredAt = parseTimestamp(document.occurredAt);
  if (occurredAt === null) {
    return rejectDocument(url, 'occurredAt is not an ISO-8601 instant');
  }

  // Clamped against the same instant as every event in the batch, so a clock-skewed
  // client cannot put a document's `captured_at` outside the window the event path
  // already refuses to trust.
  const { storedAt } = clampOccurredAt(occurredAt, now);

  return {
    ok: true,
    capture: {
      source,
      url,
      title,
      language,
      word_count: wordCount,
      content_hash: contentHashOf(content),
      extracted_text: content,
      captured_at: storedAt,
    },
  };
}

/**
 * Writes the validated documents through `upsert_document_captures`, or throws.
 *
 * Rows are collapsed on `content_hash` before the call. Two rows sharing a hash in one
 * statement raise `21000` — "ON CONFLICT DO UPDATE command cannot affect row a second
 * time" — which would fail the entire batch for one duplicated article, and a client
 * seeing the same piece through two URLs is an ordinary occurrence rather than a bug.
 * The collapsed entry still counts as accepted at the call site: the document is in
 * the corpus, and the client has nothing different to do about it.
 *
 * A failure throws, which the handler turns into a 500. That is deliberate: the
 * document counters are asserted against the batch length, and a database that stored
 * nothing cannot be reported as having accepted anything. Re-sending the batch is
 * harmless, because the write is idempotent on `(user_id, content_hash)`.
 */
async function upsertDocuments(
  serviceClient: AppSchemaClient,
  userId: string,
  deviceId: string,
  captures: readonly DocumentCapture[],
): Promise<void> {
  if (captures.length === 0) {
    return;
  }

  const distinct = new Map<string, DocumentCapture>();
  for (const capture of captures) {
    // First wins. Every capture here has passed validation and they share a content
    // hash, so they describe the same document; the only difference the RPC would act
    // on is `title` and `url`, and preferring the batch's first of those is arbitrary
    // but deterministic.
    if (!distinct.has(capture.content_hash)) {
      distinct.set(capture.content_hash, capture);
    }
  }

  const { data, error } = await serviceClient.rpc(UPSERT_DOCUMENTS_RPC, {
    p_user_id: userId,
    p_device_id: deviceId,
    p_documents: [...distinct.values()],
  });
  if (error !== null) {
    throw new Error(`document upsert failed: ${error.message}`);
  }
  // The function is `returns integer`, so PostgREST hands back a bare number. Any
  // other shape is a contract change rather than a count, and reading it as zero would
  // report "stored nothing" for a batch the database accepted.
  if (typeof data !== 'number') {
    throw new Error(`document upsert returned ${JSON.stringify(data)} instead of a count`);
  }
  if (data !== distinct.size) {
    throw new Error(`document upsert accounted for ${data} of ${distinct.size} distinct documents`);
  }
}

/**
 * Inserts the validated rows, letting `activity_events_device_dedupe_key` absorb
 * replays: a batch re-sent after a lost response inserts nothing, is reported as
 * duplicates, and leaves the rows it already created untouched (ADR-010). This is
 * what makes a 500 on this endpoint a retry rather than a recovery.
 *
 * `onConflict` names the constraint explicitly instead of letting PostgREST infer
 * one, so adding a unique index later cannot silently change which conflict is
 * absorbed. The returned ids are the rows actually inserted — which is how
 * `accepted` and `duplicates` are known without a second query to ask which of the
 * candidates were new.
 */
async function insertEvents(
  serviceClient: AppSchemaClient,
  rows: readonly ActivityEventRow[],
): Promise<string[]> {
  if (rows.length === 0) {
    return [];
  }
  const { data, error } = await serviceClient
    .from('activity_events')
    .upsert([...rows], { onConflict: 'device_id,dedupe_key', ignoreDuplicates: true })
    .select('id');
  if (error !== null) {
    throw new Error(`activity_events insert failed: ${error.message}`);
  }
  return (data ?? []).flatMap((row) => {
    const id: unknown = (row as { id?: unknown }).id;
    return typeof id === 'string' ? [id] : [];
  });
}

/**
 * The device's new sync watermark, encoded as the versioned cursor token
 * docs/API_REFERENCE.md#pagination describes: `v` (version), `t` (token type) and
 * `kind`, plus the pivot the token was built from.
 *
 * `t: 'sync'` rather than `'pagination'` is load-bearing. That document's rule is
 * that a cursor used against a different `kind` is rejected rather than silently
 * returning a wrong slice, and the same envelope is what makes a sync watermark
 * unusable as a `GET /v1/activity` page cursor.
 *
 * Nothing persists a cursor: `DeviceSyncState.cursor` is a client-side field
 * (packages/shared/src/types/device.ts), so this is derived per response from the
 * batch's server receipt time. That makes it non-decreasing across batches rather
 * than strictly monotonic, which is the property a watermark is used for. The
 * batch's own event ids are the pivot when it stored any, and null when it did not.
 */
function encodeSyncCursor(receivedAt: Date, lastAcceptedId: string | null): string {
  const payload = JSON.stringify({
    v: 1,
    t: 'sync',
    kind: 'activity_events',
    receivedAt: receivedAt.toISOString(),
    id: lastAcceptedId,
  });
  return btoa(payload).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * Refreshes `devices.last_seen_at`, the liveness signal `Device.lastSeenAt` feeds
 * the settings screen. A failure here is logged and swallowed: the events are
 * already durable, and the only cost of a missed refresh is a stale "last seen"
 * in the UI — not a reason to answer 500 and make the client re-send a batch that
 * was stored.
 */
async function touchDevice(
  serviceClient: AppSchemaClient,
  userId: string,
  deviceId: string,
  now: Date,
): Promise<void> {
  const { error } = await serviceClient
    .from('devices')
    .update({ last_seen_at: now.toISOString() })
    .eq('id', deviceId)
    .eq('user_id', userId);
  if (error !== null) {
    console.warn(`[${FUNCTION_NAME}] devices.last_seen_at update failed: ${error.message}`);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // One id per invocation: logged here and echoed to the client. This is how a
  // report such as "my sync failed at 14:02" is matched to a log line.
  const requestId = crypto.randomUUID();

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return errorResponse(
      'method_not_allowed',
      `Method ${req.method} is not allowed; use POST.`,
      405,
      requestId,
    );
  }

  try {
    const batch = await readBatch(req);
    checkBatchRules(batch);

    // Both clients are built before the core so a missing secret or a missing
    // Authorization header fails as a structured error rather than a database write.
    const serviceClient = createServiceClient();
    const userClient = createUserClient(req);

    // Who the caller is, and which device they are claiming to be. The identity
    // comes from the verified token and never from the body; the device has to be
    // one the caller owns, which is checked before any row is built.
    const caller = await authenticateCaller(req, userClient);
    const device = await loadOwnedDevice(userClient, caller.id, batch.deviceId);

    // Revocation outranks every secret rule: `devices_revoked_consistency_check`
    // forces a revoked device's hash to null, so the transitional allowance inside
    // `assertDeviceSecret` would otherwise let a revoked device keep writing.
    if (device.revoked_at !== null) {
      throw new RequestError(
        403,
        'device_revoked',
        'This device has been revoked. Re-register it to resume capture.',
      );
    }
    await assertDeviceSecret(device, req.headers.get('X-Device-Secret'), requestId);

    // One instant for the whole batch, matching the database's `now()` for the
    // receipt stamp and keeping the plausibility clamp consistent across rows.
    const now = new Date();
    const verdicts = batch.events.map((event) =>
      toActivityEventRow(event, caller.id, batch.deviceId, now),
    );
    const rows = verdicts.flatMap((verdict) => (verdict.ok ? [verdict.row] : []));
    const rejectedIds = verdicts.flatMap((verdict) => {
      if (verdict.ok) {
        return [];
      }
      // Reasons are logged against the requestId and deliberately kept out of the
      // response, which is what the documented `ActivityBatchResult` prescribes:
      // a reason is not actionable by the client and would bloat every retry.
      console.warn(
        `[${FUNCTION_NAME}] requestId=${requestId} device=${batch.deviceId} ` +
          `rejected event id=${verdict.eventId}: ${verdict.reason}`,
      );
      return [verdict.eventId];
    });

    const insertedIds = await insertEvents(serviceClient, rows);
    const accepted = insertedIds.length;
    const duplicates = rows.length - accepted;
    const rejected = rejectedIds.length;

    // Every event is either stored, absorbed by the dedupe constraint, or rejected.
    // Asserted rather than assumed because a client drains its queue from these
    // three numbers, so a batch that does not add up is a bug whose symptom is a
    // user whose events silently stop syncing.
    if (accepted + duplicates + rejected !== batch.events.length) {
      throw new Error(
        `accounting invariant violated: ${accepted} accepted + ${duplicates} duplicates + ` +
          `${rejected} rejected != ${batch.events.length} events`,
      );
    }

    // The document half, in the same shape as the event half: validate every item
    // first, keep the ones that pass, and let each failure name exactly the item it
    // belongs to.
    const documents = batch.documents ?? [];
    const documentVerdicts = documents.map((document) => toDocumentRow(document, now));
    const captures = documentVerdicts.flatMap((verdict) => (verdict.ok ? [verdict.capture] : []));
    const rejectedDocumentUrls = documentVerdicts.flatMap((verdict) => {
      if (verdict.ok) {
        return [];
      }
      // Same treatment as the event reasons above: logged against the requestId and
      // kept out of the response, whose documented shape carries no reason field.
      console.warn(
        `[${FUNCTION_NAME}] requestId=${requestId} device=${batch.deviceId} ` +
          `rejected document url=${verdict.url}: ${verdict.reason}`,
      );
      return [verdict.url];
    });

    await upsertDocuments(serviceClient, caller.id, batch.deviceId, captures);

    // Counted from the validated captures rather than from the write's own report,
    // because `upsertDocuments` collapses captures sharing a content hash: the write
    // answers "how many distinct documents did I touch", while the client has to be
    // able to account for every document it sent. Both are stored either way, so
    // both are accepted.
    const documentsAccepted = captures.length;
    const documentsRejected = rejectedDocumentUrls.length;

    if (documentsAccepted + documentsRejected !== documents.length) {
      throw new Error(
        `accounting invariant violated: ${documentsAccepted} documents accepted + ` +
          `${documentsRejected} documents rejected != ${documents.length} documents`,
      );
    }

    const result: ActivityBatchResult = {
      accepted,
      rejected,
      duplicates,
      serverCursor: encodeSyncCursor(now, insertedIds.at(-1) ?? null),
      rejectedIds,
      documentsAccepted,
      documentsRejected,
      rejectedDocumentUrls,
    };

    await touchDevice(serviceClient, caller.id, batch.deviceId, now);

    console.log(
      `[${FUNCTION_NAME}] requestId=${requestId} user=${caller.id} device=${batch.deviceId} ` +
        `events=${batch.events.length} accepted=${accepted} duplicates=${duplicates} ` +
        `rejected=${rejected} documents=${documents.length} ` +
        `documentsAccepted=${documentsAccepted} documentsRejected=${documentsRejected}`,
    );

    return jsonResponse({ ...result }, 200, requestId);
  } catch (error) {
    if (error instanceof RequestError) {
      console.error(
        `[${FUNCTION_NAME}] requestId=${requestId} rejected (status=${error.status}, ` +
          `code=${error.code}): ${errorMessage(error)}`,
      );
      return errorResponse(error.code, error.message, error.status, requestId);
    }
    // An unexpected failure's message can name a table, a column or a query, so it
    // is logged with the request id and never returned. The client's documented
    // behaviour on `internal_error` is to retry with backoff and report the id —
    // safe here because re-sending a batch is idempotent.
    console.error(`[${FUNCTION_NAME}] requestId=${requestId} failed (status=500):`, error);
    return errorResponse(
      'internal_error',
      'The batch could not be processed. Retry with backoff and report the requestId.',
      500,
      requestId,
    );
  }
});
