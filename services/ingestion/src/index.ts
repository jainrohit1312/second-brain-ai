/**
 * `@second-brain/ingestion` — the HTTP edge.
 *
 * Everything a client sends enters through this app: activity events, document captures
 * and mixed flushes. The app's only jobs are to authenticate, to validate, and to hand a
 * parsed payload to the handlers. It owns no extraction, no scoring math and no SQL.
 *
 * TODO(phase-1): decide and pin the runtime. Hono runs on Deno Deploy, Bun, Cloudflare
 * Workers and Node (`@hono/node-server`); the choice determines how the app is served and
 * how the Supabase service-role client is constructed, so it has to be made before any
 * route body is implemented. `createApp()` is deliberately runtime-free.
 */
import { SCHEMA_VERSION } from '@second-brain/shared';
import { Hono } from 'hono';

import type { MiddlewareHandler } from 'hono';

/** Package name reported by `GET /health`. */
export const SERVICE_NAME = '@second-brain/ingestion';

/**
 * Bearer-token guard for every `/ingest` route.
 *
 * TODO(phase-1): read `Authorization: Bearer <token>`, compare it against
 * `INGEST_SHARED_SECRET` with a timing-safe comparison, resolve the token to a
 * `(userId, deviceId)` pair, and reject with 401 before any handler runs. A middleware
 * placeholder rather than a route-level check so a new route cannot forget it.
 *
 * Declared as a constant so importing this module never throws: only a request to a
 * protected route does.
 */
export const bearerAuth: MiddlewareHandler = (_c, _next) => {
  throw new Error('Not implemented: bearerAuth');
};

/**
 * Builds the ingestion app.
 *
 * Route surface:
 * - `POST /ingest/activity` — one `ActivityBatch` from a device flush.
 * - `POST /ingest/batch` — one `MixedBatch`: events and document captures together.
 * - `POST /ingest/document` — one document capture.
 * - `GET /health` — liveness plus the schema version the server speaks.
 *
 * All three write routes are behind `bearerAuth` and, once implemented, parse their body
 * with the matching schema from `./validation/schemas` and delegate to the handlers in
 * `./handlers`. Nothing else belongs in a route body.
 *
 * @returns A Hono app with no server attached; the caller chooses the runtime.
 */
export function createApp(): Hono {
  const app = new Hono();

  app.use('/ingest/*', bearerAuth);

  app.get('/health', (c) =>
    c.json({ status: 'ok', service: SERVICE_NAME, schemaVersion: SCHEMA_VERSION }),
  );

  app.post('/ingest/activity', (_c) => {
    // TODO(phase-1): parse with `activityBatchSchema` (400 on failure), build the
    // `IngestionContext` from the authenticated device, delegate to `handleActivityBatch`.
    throw new Error('Not implemented: POST /ingest/activity');
  });

  app.post('/ingest/batch', (_c) => {
    // TODO(phase-1): parse the mixed body and delegate to `handleMixedBatch`, returning
    // 202 with the batch result because partial acceptance is normal.
    throw new Error('Not implemented: POST /ingest/batch');
  });

  app.post('/ingest/document', (_c) => {
    // TODO(phase-1): parse with `ingestDocumentSchema` and delegate to
    // `handleDocumentCapture`.
    throw new Error('Not implemented: POST /ingest/document');
  });

  return app;
}

export {
  activityBatchSchema,
  activityEventSchema,
  ingestDocumentSchema,
  MAX_BATCH_EVENTS,
  MAX_SELECTION_CONTEXT_LENGTH,
  MAX_SELECTION_TEXT_LENGTH,
  SCHEMA_VERSION,
} from './validation/schemas';
export type {
  ActivityBatchInput,
  ActivityEventInput,
  IngestDocumentInput,
} from './validation/schemas';

export { handleActivityBatch, handleActivityEvent } from './handlers/activity';
export type {
  ActivityRepository,
  DocumentDraft,
  DocumentRepository,
  ImportancePort,
  IngestionClock,
  IngestionContext,
  IngestionLogger,
  IngestionRepository,
  ProcessingQueue,
  ScoredEvent,
} from './handlers/activity';

export { buildDocumentDraft, captureModeFor, handleDocumentCapture } from './handlers/document';
export type { CaptureMode, DocumentOutcome } from './handlers/document';

export { batchIdempotencyKey, chunkBatch, handleMixedBatch } from './handlers/batch';
export type { DocumentBatchResult, MixedBatch, MixedBatchResult } from './handlers/batch';
