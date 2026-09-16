# Second Brain — API Reference

The HTTP surface, specified before it is built: every endpoint, its auth, its request and response shapes, its error cases, and the cross-cutting rules that apply to all of them.

Status: draft — scaffold phase. **Every endpoint below is specified, and all but one is unimplemented.** `services/ingestion` and `services/retrieval` are placeholder packages, and the `embed` and `distill` edge functions have no bodies. The exception is batch ingestion, which is implemented and deployed as an edge function **at a path other than the one this document gives** — see the deployment note in [`POST /v1/ingest/batch`](#post-v1ingestbatch) and [ADR-022](./DECISIONS.md#adr-022-ingestion-runs-as-the-process-activity-edge-function). This document is the contract those implementations are written against, and it is the arbitration point when a client and the server disagree.

## Base URLs and versioning

| Environment      | Base URL                 | Source                                                          |
| ---------------- | ------------------------ | --------------------------------------------------------------- |
| Local (services) | `http://127.0.0.1:8787`  | `NEXT_PUBLIC_API_BASE_URL`, `VITE_API_BASE_URL`                 |
| Local (Supabase) | `http://127.0.0.1:55321` | `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `VITE_SUPABASE_URL` |
| Hosted           | one origin per service   | deployment configuration                                        |

Two kinds of API exist and they version differently:

- **The services API** is path-versioned under `/v1`. A breaking change to a request or response shape means `/v2`, with `/v1` supported in parallel for as long as a shipped client needs it. Clients are shipped artefacts (`apps/chrome-extension`, `apps/android`) and cannot be updated in lockstep with the server, so parallel support is a requirement, not a nicety.
- **The Supabase API** (PostgREST, Auth, Edge Functions) is not path-versioned by us. Its compatibility is governed by the pinned client version and by RLS, which is why clients read almost nothing through it directly except their own rows.

Additionally, every batch carries `schemaVersion` (the value of `SCHEMA_VERSION` from `@second-brain/shared`) so the server can distinguish an old client's payload shape from a malformed one. `schemaVersion` is **not** a substitute for `/v1`: the path version describes the _shape of the API_, `schemaVersion` describes the _shape of the event stream_, and the two change independently.

## Authentication

Three credentials, with distinct scopes. The full model is in [ARCHITECTURE.md](./ARCHITECTURE.md#security-model); the wire-level rules are here.

| Header            | Value                                    | Required on                                   | Validated by                                                              |
| ----------------- | ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| `apikey`          | Supabase anon key                        | All service endpoints                         | The Supabase gateway and the service's own check                          |
| `Authorization`   | `Bearer <Supabase user JWT>`             | All service endpoints except `GET /v1/health` | Supabase Auth; surfaces as `auth.uid()`                                   |
| `X-Device-Secret` | The device's ingest secret               | Ingest endpoints only                         | `services/ingestion`, against `devices.ingest_secret_hash`                |
| `X-Request-Id`    | Optional client-generated correlation id | Any                                           | Echoed back and used in logs if supplied; otherwise generated server-side |

Rules, stated so they can be tested:

1. **`user_id` is never read from a request body.** It is resolved from the verified JWT. A body field named `userId` is ignored, and there is a test that asserts it is.
2. **The anon key is not sufficient on its own.** Without a valid JWT, every endpoint that touches user data returns `401`, because RLS denies and the service does not fall back to a service-role read.
3. **A device secret is scoped to exactly one `device_id`.** Presenting a valid JWT with a `device_id` that does not belong to the user, or a secret that does not hash to that device's `ingest_secret_hash`, returns `401 device_mismatch`. Both checks run; either failing is fatal.
4. **A revoked device is rejected before any work.** `devices.revoked_at is not null` returns `403 device_revoked`, and the client must stop capturing and surface that to the user rather than retrying.
5. **JWT expiry is a client problem, not a server one.** An expired token returns `401 token_expired` with a distinct code so clients can refresh and retry rather than treating it as a logout.
6. **No endpoint accepts credentials in a query string.** Tokens in URLs end up in logs.

## The error envelope

Every non-2xx response from the services API has exactly this body:

```json
{
  "error": {
    "code": "device_revoked",
    "message": "This device has been revoked. Re-register it to resume capture.",
    "requestId": "req_01j9x2k5m3n4p6q7r8s9t0v1w2"
  }
}
```

| Field       | Type     | Notes                                                                                                              |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `code`      | `string` | A stable, machine-readable enum. Clients branch on this and never on `message`.                                    |
| `message`   | `string` | Human-readable, safe to display, and **never** containing content, a secret, or an internal path.                  |
| `requestId` | `string` | Present on every error. Matches the server log line, so a user-reported failure is traceable without reproduction. |

### Error codes

| Code                         | HTTP | Meaning                                                                                                                       | Client behaviour                                                                     |
| ---------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `bad_request`                | 400  | Malformed JSON, missing required field, or a value out of range.                                                              | Do not retry; log and drop the request.                                              |
| `validation_failed`          | 400  | Well-formed but schema-invalid (zod). Carries per-event detail for batches.                                                   | Drop the offending event ids; retry nothing.                                         |
| `unsupported_schema_version` | 400  | `schemaVersion` is not one the server accepts.                                                                                | Stop syncing and prompt for a client update.                                         |
| `invalid_cursor`             | 400  | A pagination or sync cursor failed to decode or validate.                                                                     | Restart the traversal from the beginning; do not attempt to repair the cursor.       |
| `unauthorized`               | 401  | Missing or invalid `apikey` or JWT.                                                                                           | Re-authenticate.                                                                     |
| `token_expired`              | 401  | The JWT is well-formed but expired.                                                                                           | Refresh and retry once.                                                              |
| `device_mismatch`            | 401  | `device_id` and `X-Device-Secret` do not describe the same authorised device.                                                 | Do not retry; the device needs re-registration.                                      |
| `device_revoked`             | 403  | The device exists and is revoked.                                                                                             | **Stop capture**, surface to the user, stop retrying.                                |
| `forbidden`                  | 403  | Authenticated but not permitted (e.g. an admin-only operation).                                                               | Do not retry.                                                                        |
| `not_found`                  | 404  | The referenced resource does not exist or the user cannot see it. Deliberately not distinguished, so existence is not leaked. | Do not retry.                                                                        |
| `conflict`                   | 409  | A state conflict (e.g. superseding a memory that is already superseded).                                                      | Re-read and reconcile.                                                               |
| `payload_too_large`          | 413  | The body exceeds the endpoint's limit.                                                                                        | Split and retry — this is what `SYNC_BATCH_SIZE` guards against.                     |
| `rate_limited`               | 429  | Rate limit exceeded. Carries `Retry-After`.                                                                                   | Back off for at least `Retry-After`, with jitter.                                    |
| `provider_unavailable`       | 503  | An upstream model provider is unreachable for an endpoint that cannot degrade.                                                | Retry with backoff; for retrieval, expect a `degraded` result rather than this code. |
| `internal_error`             | 500  | An unhandled server failure.                                                                                                  | Retry with backoff, and report the `requestId`.                                      |

Two rules about the envelope that keep it useful:

- **A partial success is not an error.** `POST /v1/ingest/batch` returning `200` with `rejected: 3` is a normal response, not a 4xx. Per-event outcomes belong in the result body, because a batch that is 97% accepted must be acknowledged per event, not discarded whole.
- **A degraded result is not an error.** `POST /v1/retrieve` returning `200` with `degraded: true` is a successful response describing a partial pipeline (see [Failure modes](./ARCHITECTURE.md#failure-modes-and-degraded-behaviour)). Clients must present it as a caveat, not a failure.

## Pagination

All list endpoints are **keyset paginated** (ADR-017). No endpoint accepts `offset` or a page number.

**Request parameters**

| Parameter | Type      | Default | Notes                                                                                                                                                     |
| --------- | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`   | `integer` | 50      | 1–200. Values above 200 are clamped, not rejected.                                                                                                        |
| `cursor`  | `string`  | —       | Opaque. Obtained from a previous response's `nextCursor`. Clients must not construct, parse, or persist-and-reuse a cursor across a different sort order. |

**Response envelope**

```json
{
  "items": [],
  "nextCursor": "eyJ2IjoxLCJ0IjoicGFnaW5hdGlvbiIsImtpbmQiOiJkb2N1bWVudHMiLCJjYXB0dXJlZEF0IjoiMjAyNi0wOS0xNFQwOToxMjowMFoiLCJpZCI6IjAxOWM0ZjJlLTA4MzctNzQyMS05YzYxLTNhYjRjZGU1ZjYwMSJ9",
  "hasMore": false
}
```

| Field        | Notes                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items`      | Array of the endpoint's resource type. Empty is a valid answer.                                                                                                |
| `nextCursor` | `null` when there is nothing more. Present even when `hasMore` is `false` if the implementation can cheaply know — clients must treat `null` as authoritative. |
| `hasMore`    | Convenience for the UI's "load more" affordance. Derived from whether a `nextCursor` exists.                                                                   |

**Why keyset and not offset.** The three reasons are in [ADR-017](./DECISIONS.md#adr-017-keyset-pagination-rather-than-offset-pagination); the operational consequence to know here is that **the ordering must be total** (a pivot column plus `id`) or the traversal can duplicate or skip rows. Each list endpoint documents its ordering in the table below.

| Endpoint            | Ordering            | Pivot                |
| ------------------- | ------------------- | -------------------- |
| `GET /v1/activity`  | `occurred_at desc`  | `(occurred_at, id)`  |
| `GET /v1/documents` | `captured_at desc`  | `(captured_at, id)`  |
| `GET /v1/memories`  | `created_at desc`   | `(created_at, id)`   |
| `GET /v1/topics`    | `last_seen_at desc` | `(last_seen_at, id)` |

**Cursors are opaque and versioned.** The decoded payload carries a `v` (version), a `t` (token type — `pagination` or `sync`, so the two cannot be confused), a `kind` (which resource and ordering it belongs to), and the pivot values. A cursor used against a different `kind` returns `400 invalid_cursor` rather than a wrong slice. A cursor is **not** an authorisation token: RLS applies to every query it drives, so another user's cursor returns nothing rather than their rows.

`POST /v1/chat`'s citation list is not paginated (it is bounded by the context window), and neither is `GET /v1/health`.

## Write endpoints

### `POST /v1/ingest/activity`

Submit a single activity event. The single-event form exists for clients that can afford one round trip per event (a first-run smoke test, a manual capture, an integration) and for debugging. **The batch endpoint is the normal path** — a single-event endpoint that a real client used in its capture loop would defeat the batching design.

**Specified, not implemented.**

|              |                                                        |
| ------------ | ------------------------------------------------------ |
| Method       | `POST`                                                 |
| Path         | `/v1/ingest/activity`                                  |
| Purpose      | Validate and persist one activity event, idempotently. |
| Auth         | `apikey` + user JWT + `X-Device-Secret`                |
| Content-Type | `application/json`                                     |
| Max body     | 128 KB                                                 |

**Request body** — a single `ActivityEvent` plus nothing else. `userId` is deliberately not a field: it comes from the JWT.

```ts
// TypeScript-shaped illustration. The authoritative type is `ActivityEvent`
// in @second-brain/shared — a discriminated union of nine members.
type RequestBody = ActivityEvent;
```

```json
{
  "id": "019c4f2e-0837-7421-9c61-3ab4cde5f601",
  "deviceId": "0b5f0f3a-5c4b-4f0e-9a1e-6b0f6a2c9d31",
  "type": "page_read",
  "occurredAt": "2026-09-16T09:12:00.000Z",
  "importance": 0.62,
  "dedupeKey": "page_read:example.com/ai-memory:9f2c4a1b7e8d",
  "url": "https://example.com/ai-memory",
  "title": "How recall systems are actually built",
  "domain": "example.com",
  "wordCount": 2140,
  "readingTimeSeconds": 512,
  "contentHash": "9f2c4a1b7e8d0c3f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f",
  "metadata": { "captureSurface": "content-script" }
}
```

**Response** — `201 Created`

```json
{
  "id": "019c4f2e-0837-7421-9c61-3ab4cde5f601",
  "status": "accepted",
  "serverCursor": "c_0000000000000001",
  "receivedAt": "2026-09-16T09:12:03.412Z",
  "processingTriggered": false
}
```

| Field                 | Notes                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `status`              | `"accepted"` \| `"duplicate"`. A duplicate is `200`, not an error — the `(device_id, dedupe_key)` constraint absorbed it (ADR-010). |
| `serverCursor`        | The device's new sync watermark.                                                                                                    |
| `processingTriggered` | Whether the `process-activity` invocation was dispatched. `false` is normal and not a problem; the scheduled sweep will pick it up. |

**Status codes**

| Code                                                     | When                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `201`                                                    | Accepted, new row.                                                                                                                      |
| `200`                                                    | Accepted, duplicate — the same `(deviceId, dedupeKey)` already exists.                                                                  |
| `400 bad_request`                                        | Malformed JSON, or a missing required field for the declared `type`.                                                                    |
| `400 validation_failed`                                  | Shape-valid JSON that fails the zod schema for its `type`, with the failing path in `error.details`.                                    |
| `401 unauthorized` / `token_expired` / `device_mismatch` | See [Error codes](#error-codes).                                                                                                        |
| `403 device_revoked`                                     | The device is revoked.                                                                                                                  |
| `413 payload_too_large`                                  | Over 128 KB — a single event should never approach this; it usually means a `page_read` body was sent where only metadata was intended. |
| `429 rate_limited`                                       | Over the per-device limit.                                                                                                              |

**Rate limit.** Per device: 600 requests per minute, burst 60. Generous because the endpoint is not the normal path; a client hitting it is either debugging or misconfigured.

**curl**

```bash
curl -sS -X POST "$API_BASE_URL/v1/ingest/activity" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_USER_JWT" \
  -H "X-Device-Secret: $DEVICE_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "019c4f2e-0837-7421-9c61-3ab4cde5f601",
    "deviceId": "0b5f0f3a-5c4b-4f0e-9a1e-6b0f6a2c9d31",
    "type": "page_read",
    "occurredAt": "2026-09-16T09:12:00.000Z",
    "importance": 0.62,
    "dedupeKey": "page_read:example.com/ai-memory:9f2c4a1b7e8d",
    "url": "https://example.com/ai-memory",
    "title": "How recall systems are actually built",
    "domain": "example.com",
    "wordCount": 2140,
    "readingTimeSeconds": 512,
    "contentHash": "9f2c4a1b7e8d0c3f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f",
    "metadata": {}
  }'
```

---

### `POST /v1/ingest/batch`

**The normal ingest path.** Submit a batch of events from one device's offline queue. This is the endpoint the extension's service worker and the Android `WorkManager` job call, and it is the only endpoint whose semantics are load-bearing for data integrity.

**Implemented — but deployed at a different path, as an edge function.** The running form of this endpoint is the `process-activity` Supabase edge function ([ADR-022](./DECISIONS.md#adr-022-ingestion-runs-as-the-process-activity-edge-function)):

|                 |                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Deployed path   | `POST {SUPABASE_URL}/functions/v1/process-activity`                                                                  |
| Called by       | `supabase.functions.invoke('process-activity', { body: batch })`, which attaches `apikey` and the session's user JWT |
| Everything else | unchanged — the request body, the response, the status codes and the error codes below all apply                     |

Still unimplemented behind it: `/v1/ingest/batch` on `services/ingestion`, and the `X-Device-Secret` issue/rotate path the `Auth` row below depends on — the deployed function verifies a stored secret but nothing issues one yet (see [the device-registration open question](#read-endpoints-referenced-but-not-specified-here)). `Idempotency-Key` is accepted and ignored for now: a retry is absorbed by the `(device_id, dedupe_key)` constraint rather than by a server-side replay window.

|              |                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Method       | `POST`                                                                                               |
| Path         | `/v1/ingest/batch`                                                                                   |
| Purpose      | Validate and persist a batch of events from one device, idempotently, and return per-event outcomes. |
| Auth         | `apikey` + user JWT + `X-Device-Secret`                                                              |
| Content-Type | `application/json`                                                                                   |
| Max body     | 4 MB (≈`SYNC_BATCH_SIZE` at the largest plausible event size)                                        |
| Idempotency  | `Idempotency-Key` header, plus `(deviceId, dedupeKey)` per event                                     |

**Request body** — an `ActivityBatch`:

```ts
type RequestBody = ActivityBatch; // { schemaVersion, deviceId, clientSentAt, events, documents? }
```

```json
{
  "schemaVersion": 1,
  "deviceId": "0b5f0f3a-5c4b-4f0e-9a1e-6b0f6a2c9d31",
  "clientSentAt": "2026-09-16T09:15:00.000Z",
  "events": [
    {
      "id": "019c4f2e-0837-7421-9c61-3ab4cde5f601",
      "deviceId": "0b5f0f3a-5c4b-4f0e-9a1e-6b0f6a2c9d31",
      "type": "page_view",
      "occurredAt": "2026-09-16T09:12:00.000Z",
      "importance": 0.41,
      "dedupeKey": "page_view:example.com/ai-memory:2026-09-16T09",
      "url": "https://example.com/ai-memory",
      "title": "How recall systems are actually built",
      "domain": "example.com",
      "durationMs": 184000,
      "scrollDepthPct": 0.86,
      "metadata": {}
    },
    {
      "id": "019c4f2e-0837-7421-9c61-3ab4cde5f602",
      "deviceId": "0b5f0f3a-5c4b-4f0e-9a1e-6b0f6a2c9d31",
      "type": "selection",
      "occurredAt": "2026-09-16T09:13:41.000Z",
      "importance": 0.77,
      "dedupeKey": "selection:example.com/ai-memory:5f3c9a",
      "url": "https://example.com/ai-memory",
      "title": "How recall systems are actually built",
      "text": "rank fusion is preferred to score interpolation because the two signals are not commensurable",
      "contextBefore": "In our design,",
      "contextAfter": "which means the weights are real weights.",
      "selectionLength": 104,
      "metadata": {}
    }
  ],
  "documents": [
    {
      "url": "https://example.com/ai-memory",
      "title": "How recall systems are actually built",
      "content": "Rank fusion is preferred to score interpolation because the two signals are not commensurable …",
      "language": "en",
      "source": "web",
      "wordCount": 1840,
      "occurredAt": "2026-09-16T09:14:02.000Z"
    }
  ]
}
```

Batch-level validation rules, applied before any per-event work:

| Rule                                                     | On violation                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` must be an accepted value                | `400 unsupported_schema_version`                                                                                                        |
| `events.length` must be 0–`SYNC_BATCH_SIZE`              | `400 bad_request` (over the limit ⇒ `413 payload_too_large`)                                                                            |
| Every `event.deviceId` must equal the batch's `deviceId` | `400 validation_failed` — a batch is single-device by construction, and mixed-device batches cannot be authenticated against one secret |
| `events` must be ordered by `occurredAt` ascending       | Not enforced; ordering is a client-side discipline, and the server stores `occurred_at` as given                                        |

Two further batch rules govern the document half. They are stated here rather than as rows above, to leave that table's alignment undisturbed:

- `documents.length` must be **0–5**. Over that is `413 payload_too_large`, the same code an over-long `events` array gets, because the remedy is the same one: split the batch and retry. The cap is far below `SYNC_BATCH_SIZE` because a single document carries a whole page body where a single event carries an excerpt.
- `events` may be **empty** when `documents` holds at least one entry, so a flush whose only pending work is a document body can still be sent. A batch empty on _both_ halves is `400 validation_failed`: it carries no work, and answering `200` with a full set of zeroes would tell the client its queue had drained when nothing had been sent.

**Response** — `200 OK`, an `ActivityBatchResult`:

```json
{
  "accepted": 1,
  "rejected": 1,
  "duplicates": 0,
  "serverCursor": "c_0000000000000042",
  "rejectedIds": ["019c4f2e-0837-7421-9c61-3ab4cde5f602"],
  "documentsAccepted": 1,
  "documentsRejected": 0,
  "rejectedDocumentUrls": []
}
```

| Field          | Notes                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accepted`     | Newly inserted events.                                                                                                                                                                                                                                                               |
| `duplicates`   | Events absorbed by the `(device_id, dedupe_key)` constraint. **Normal operation, not an error** — a retried batch looks like this.                                                                                                                                                   |
| `rejected`     | Events that failed per-event validation. `accepted + rejected + duplicates` equals `events.length` by construction, and there is a tested invariant for it.                                                                                                                         |
| `serverCursor` | The device's new watermark. Monotonic per device.                                                                                                                                                                                                                                    |
| `rejectedIds`  | The ids to remove from the client queue.                                                                                                                                                                                                                                             |
| _(missing)_    | Per-event rejection _reasons_ are deliberately **not** in the response, because they are not actionable by the client and would bloat every retry. The reason is logged server-side against the `requestId`. If a client needs reasons, that is a new field on a new schema version. |

Three further fields describe the document half. They are listed here rather than as rows above for the same alignment reason:

- **`documentsAccepted`** — documents stored or refreshed by this batch. Every validated document counts, whether it created a row or matched an existing one through `(user_id, content_hash)` and refreshed it. There is deliberately no `documentsDuplicates`: a re-capture is a success, not a no-op the client has to distinguish, and the client has nothing to do differently either way.
- **`documentsRejected`** — documents that failed per-document validation.
- **`rejectedDocumentUrls`** — the urls to remove from the client's document queue. Document rejections are deliberately **not** reported in `rejectedIds`, which carries event ids only: a document has no id, on the client or on the server, until its content has been hashed — so the url is the only handle both sides share.

**Status codes**

| Code                                                     | When                                                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`                                                    | Always, for any batch that was processed — even one where every event was rejected. A 4xx here means the _batch_ was unprocessable, not that an event was.                         |
| `400 unsupported_schema_version`                         | The client is older or newer than the server supports.                                                                                                                             |
| `401 unauthorized` / `token_expired` / `device_mismatch` | Authentication failed.                                                                                                                                                             |
| `403 device_revoked`                                     | The device is revoked; the client must stop capture.                                                                                                                               |
| `413 payload_too_large`                                  | Body over 4 MB.                                                                                                                                                                    |
| `429 rate_limited`                                       | Over the per-device limit.                                                                                                                                                         |
| `500 internal_error`                                     | The batch may be partially applied — and that is safe, because re-sending it is idempotent. This is the property that makes a 500 on this endpoint a retry rather than a recovery. |

**Idempotency.** Two layers, deliberately:

1. **`Idempotency-Key`** — a client-computed hash over the batch's event ids. The server records it for a window (15 minutes) and replays the previous response for a repeat, avoiding the work entirely. This is an optimisation.
2. **`(device_id, dedupe_key)`** — the constraint in the database. This is the guarantee, and it is why the `Idempotency-Key` window can expire safely.

**Rate limit.** Per device: 120 requests per minute, burst 12. A client syncing every 120 seconds (`VITE_SYNC_INTERVAL_SECONDS`) uses a tiny fraction of this; the limit exists to bound a runaway retry loop.

**curl**

```bash
curl -sS -X POST "$API_BASE_URL/v1/ingest/batch" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_USER_JWT" \
  -H "X-Device-Secret: $DEVICE_SECRET" \
  -H "Idempotency-Key: 4f1c0a9e7b3d5c2a8e6f0b1d4a7c3e9f" \
  -H 'Content-Type: application/json' \
  -d @batch.json
```

The same request against the deployed edge function ([ADR-022](./DECISIONS.md#adr-022-ingestion-runs-as-the-process-activity-edge-function)), which is what the extension actually calls. `Idempotency-Key` is omitted because nothing reads it yet:

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/process-activity" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_USER_JWT" \
  -H "X-Device-Secret: $DEVICE_SECRET" \
  -H 'Content-Type: application/json' \
  -d @batch.json
```

---

### `POST /v1/ingest/document`

Submit content for a document that no client captured — a manual save, a PDF whose text the client extracted, a newsletter body pasted from a mail client, or a `gdoc` the user explicitly filed. It creates the `documents` row and enqueues it for processing.

This is the one write path where the user is explicitly asserting "this is worth keeping", which is why it is the only ingest that can create a document directly rather than deriving one from events.

**Specified, not implemented.**

|              |                                                                                      |
| ------------ | ------------------------------------------------------------------------------------ |
| Method       | `POST`                                                                               |
| Path         | `/v1/ingest/document`                                                                |
| Purpose      | Create a `documents` row from client-supplied content and enqueue it for processing. |
| Auth         | `apikey` + user JWT + `X-Device-Secret` (for provenance)                             |
| Content-Type | `application/json`                                                                   |
| Max body     | 8 MB                                                                                 |
| Idempotency  | `(user_id, content_hash)` in the database; `Idempotency-Key` for the request         |

**Request body**

```ts
interface IngestDocumentRequest {
  /** Where the content came from. 'manual' for a deliberate save. */
  source: DocumentSource; // 'web' | 'youtube' | 'pdf' | 'gdoc' | 'newsletter' | 'manual'
  /** The page it came from, when there is one. Null is valid for a pasted body. */
  url: string | null;
  title: string;
  author?: string | null;
  siteName?: string | null;
  /** ISO 8601. Absent means "whenever the server received it". */
  publishedAt?: string | null;
  /** ISO 8601. Absent means "now". */
  capturedAt?: string | null;
  /** The readable text. Required — this endpoint exists to supply content, not metadata. */
  text: string;
  /** BCP-47-ish. Absent means "let the extractor decide". */
  language?: string | null;
  /** Free-form, stored in documents metadata. Never used for retrieval ranking. */
  metadata?: Record<string, unknown>;
}
```

```json
{
  "source": "manual",
  "url": "https://example.com/retention-policies",
  "title": "Data retention policies in Postgres",
  "author": null,
  "siteName": "example.com",
  "publishedAt": "2026-08-02T00:00:00.000Z",
  "capturedAt": null,
  "text": "Retention in Postgres is usually expressed as a scheduled delete...",
  "language": "en",
  "metadata": { "captureSurface": "web-app", "userInitiated": true }
}
```

**Response** — `202 Accepted`, because processing is asynchronous:

```json
{
  "documentId": "7d1c2f4a-9b8e-4c3d-a5f6-0e1d2c3b4a59",
  "status": "queued",
  "contentHash": "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809",
  "deduplicated": false,
  "processingTriggered": true
}
```

| Field                 | Notes                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`              | `"queued"` \| `"extracted"`. `extracted` when the supplied text was accepted directly, which is the normal case for `manual`.                                                        |
| `contentHash`         | Computed server-side with `contentHash` from `@shared`. The client must **not** supply it — a client-computed hash would let a client merge two documents it believes are identical. |
| `deduplicated`        | `true` when an existing document with the same `(user_id, content_hash)` was reused, in which case `documentId` is the existing row and no new content was stored.                   |
| `processingTriggered` | Whether the pipeline was kicked off.                                                                                                                                                 |

**Status codes**

| Code                         | When                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `202`                        | Accepted and queued.                                                                                                 |
| `200`                        | Accepted but deduplicated against an existing document — no new work will run unless the existing document is stale. |
| `400 bad_request`            | Missing `text` or `title`; `source` not in `DocumentSource`; a malformed ISO timestamp.                              |
| `401` / `403 device_revoked` | As above.                                                                                                            |
| `413 payload_too_large`      | Body over 8 MB. A source this large should be split or supplied as a URL for server-side extraction.                 |
| `429 rate_limited`           | Per user: 60 requests per minute, burst 10. This is a deliberate, human-driven action.                               |

**Rate limit.** Per user: 60 requests per minute, burst 10.

**curl**

```bash
curl -sS -X POST "$API_BASE_URL/v1/ingest/document" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_USER_JWT" \
  -H "X-Device-Secret: $DEVICE_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "manual",
    "url": "https://example.com/retention-policies",
    "title": "Data retention policies in Postgres",
    "text": "Retention in Postgres is usually expressed as a scheduled delete...",
    "language": "en"
  }'
```

---

### `GET /v1/health`

Liveness and dependency reachability. **Deliberately contains no user-specific data** — no counts, no ids, no versions of user content — because it is unauthenticated and therefore public. See [Observability](./ARCHITECTURE.md#observability).

**Specified, not implemented.**

|          |                                                                  |
| -------- | ---------------------------------------------------------------- |
| Method   | `GET`                                                            |
| Path     | `/v1/health`                                                     |
| Purpose  | Report process liveness and the reachability of each dependency. |
| Auth     | **None.** No `apikey`, no JWT.                                   |
| Response | `application/json`                                               |

**Response** — `200 OK` when every dependency is reachable, `503 Service Unavailable` when any is not:

```json
{
  "status": "ok",
  "service": "ingestion",
  "version": "0.1.0",
  "uptimeSeconds": 84213,
  "checks": {
    "database": { "status": "ok", "latencyMs": 3 },
    "embeddingProvider": { "status": "ok", "latencyMs": 118, "model": "nv-embedqa-e5-v5" },
    "llmProvider": { "status": "degraded", "latencyMs": 2490, "model": "deepseek-chat" },
    "reranker": { "status": "unavailable", "latencyMs": null }
  }
}
```

| Field                | Notes                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`             | `ok` \| `degraded` \| `unavailable`. The service's own verdict, derived from `checks`.                                                                               |
| `checks.*.status`    | `ok` \| `degraded` \| `unavailable` \| `skipped`. `degraded` means reachable but missing its latency budget; `skipped` means not configured, which is not a failure. |
| `checks.*.latencyMs` | The probe's observed latency, or `null` when the probe did not run.                                                                                                  |
| `model`              | The _configured_ model identifier. This is a public value (it is in `.env.example`), and it is not user content.                                                     |

**Status codes**

| Code  | When                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------- |
| `200` | All required checks `ok` or `skipped`. A `degraded` optional dependency does not fail the endpoint. |
| `503` | A required dependency (currently: the database) is `unavailable`.                                   |

**Rate limit.** Per IP: 60 requests per minute. Unauthenticated endpoints need a limit; this one is cheap and cacheable, so it is generous.

**What it must never do.** Probe a user's data, aggregate anything, or report a count of rows, users, documents, or events. An unauthenticated endpoint that leaks "how many documents exist" is a metadata leak even though no content is exposed.

**curl**

```bash
curl -sS "$API_BASE_URL/v1/health"
```

## Read endpoints

### `POST /v1/retrieve`

The hybrid retrieval pipeline as an endpoint. Returns ranked, cited chunks and memories — **without** a synthesised answer. This is the endpoint that proves the pipeline works, that the evaluation harness calls, and that `apps/web` uses when it wants the evidence rather than prose.

`POST` rather than `GET` because the query text is a body-shaped input: it can be long, it should not appear in a URL, and its filters are structured.

**Specified, not implemented.**

|              |                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------- |
| Method       | `POST`                                                                                      |
| Path         | `/v1/retrieve`                                                                              |
| Purpose      | Run the hybrid retrieval pipeline and return ranked, cited results.                         |
| Auth         | `apikey` + user JWT. **No device secret** — retrieval is a user-scoped read, not an ingest. |
| Content-Type | `application/json`                                                                          |
| Max body     | 64 KB                                                                                       |
| Idempotency  | Inherently read-only; no key needed.                                                        |

**Request body** — `RetrievalQuery`:

```ts
interface RequestBody {
  /** The question, in the user's words. Required, non-empty. */
  text: string;
  /**
   * Optional. When omitted the server classifies intent; supplying it is an
   * override for a UI that already knows (e.g. the activity tab).
   */
  intent?: QueryIntent; // 'semantic' | 'temporal' | 'activity' | 'entity' | 'mixed'
  /**
   * How many candidates each leg retrieves BEFORE fusion and reranking.
   * Defaults to RETRIEVAL_TOP_K (40). Values above 100 are clamped.
   * This does not set the response size — the response carries the post-rerank
   * top RERANK_TOP_K (8), because reranking needs a pool to choose from.
   */
  topK?: number;
  /** All optional and ANDed together. An absent key means "no constraint". */
  filters?: {
    topicIds?: string[];
    sourceTypes?: DocumentSource[];
    kinds?: MemoryKind[];
    /** ISO 8601 UTC, inclusive lower bound. */
    from?: string;
    /** ISO 8601 UTC, inclusive upper bound. */
    to?: string;
    deviceIds?: string[];
  };
}
```

Note the deliberate omission: **`userId` is not a field.** `RetrievalQuery` in `@second-brain/shared` carries one because the pipeline is a pure function that needs it internally; on the wire it comes from the JWT.

```json
{
  "text": "what did I read about vector index choices for retrieval",
  "topK": 8,
  "filters": {
    "topicIds": [],
    "sourceTypes": ["web", "pdf"],
    "from": "2026-08-01T00:00:00.000Z"
  }
}
```

**Response** — `200 OK`, a `RetrievalResult`:

```json
{
  "query": {
    "text": "what did I read about vector index choices for retrieval",
    "topK": 8,
    "filters": { "sourceTypes": ["web", "pdf"], "from": "2026-08-01T00:00:00.000Z" }
  },
  "intent": "semantic",
  "chunks": [
    {
      "chunkId": "3c7d9e1f-2a4b-4c6d-8e0f-1a2b3c4d5e6f",
      "documentId": "7d1c2f4a-9b8e-4c3d-a5f6-0e1d2c3b4a59",
      "text": "HNSW builds incrementally, which matters when the corpus grows a document at a time...",
      "score": 0.0317,
      "vectorScore": 0.87,
      "ftsScore": 0.14,
      "rerankScore": 0.71,
      "source": "document",
      "title": "Choosing a vector index for Postgres",
      "url": "https://example.com/vector-index-choice",
      "occurredAt": "2026-08-14T11:02:00.000Z"
    }
  ],
  "citations": [
    {
      "index": 1,
      "documentId": "7d1c2f4a-9b8e-4c3d-a5f6-0e1d2c3b4a59",
      "memoryId": null,
      "title": "Choosing a vector index for Postgres",
      "url": "https://example.com/vector-index-choice",
      "occurredAt": "2026-08-14T11:02:00.000Z",
      "snippet": "HNSW builds incrementally, which matters when the corpus grows a document at a time..."
    }
  ],
  "tookMs": 412,
  "degraded": false
}
```

| Field                  | Notes                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intent`               | The intent actually used — the server's classification when the request omitted one. Returned so the caller can see how its question was interpreted, which is the only way to debug a misroute from the outside.                           |
| `chunks[].score`       | The fused final score, **not** a similarity. Comparable only within one response.                                                                                                                                                           |
| `chunks[].vectorScore` | Cosine similarity in `[0, 1]`, or `null` if this candidate came from the full-text leg only. A display normalisation, not a fusion input (ADR-006).                                                                                         |
| `chunks[].ftsScore`    | Normalized `ts_rank` in `[0, 1]`, or `null` if this candidate came from the vector leg only.                                                                                                                                                |
| `chunks[].rerankScore` | Reranker output, or `null` when reranking was skipped or unavailable.                                                                                                                                                                       |
| `chunks[].source`      | `'document'` \| `'memory'`. A `memory` result carries its statement in `text` and `memoryId` in the citation.                                                                                                                               |
| `citations`            | Parallel to `chunks` but with a 1-based `index`, which is what an answer's citation markers reference. Exactly one of `documentId` / `memoryId` is non-null. Indices are assigned in the order the sources appear in the assembled context. |
| `tookMs`               | Server-side wall clock for the whole pipeline. The number the phase-4 latency baseline records.                                                                                                                                             |
| `degraded`             | **At least one configured stage did not run.** Set when the vector leg or the rerank stage was skipped; _not_ set for an empty result or a token-budget truncation.                                                                         |

**Status codes**

| Code                    | When                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `200`                   | Always, for a well-formed request — including an empty result set. `chunks: []` with `degraded: false` means "you have not captured anything about this", which is a correct answer. |
| `400 bad_request`       | Missing or empty `text`; `topK` non-integer; `from` after `to`.                                                                                                                      |
| `400 validation_failed` | A filter value outside its enum (e.g. an unknown `kinds` entry).                                                                                                                     |
| `401`                   | Auth.                                                                                                                                                                                |
| `429`                   | Over the per-user limit.                                                                                                                                                             |
| `500`                   | Unexpected failure.                                                                                                                                                                  |

`degraded: true` is **not** implemented as a 5xx or a 206. It is a successful response with an honest caveat, because the caller must display the results either way.

**Rate limit.** Per user: 120 requests per minute, burst 20. The evaluation harness is expected to run in bursts, so the limit is set to accommodate a sequential harness (roughly 2 requests per second sustained) while still bounding a runaway client.

**curl**

```bash
curl -sS -X POST "$API_BASE_URL/v1/retrieve" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_USER_JWT" \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "what did I read about vector index choices for retrieval",
    "topK": 8,
    "filters": { "sourceTypes": ["web", "pdf"] }
  }'
```

---

### `POST /v1/chat`

Ask a question and receive a streamed, cited answer. This is `/v1/retrieve` plus context assembly plus LLM synthesis, streamed so the user sees text appear rather than waiting for a full generation.

**Specified, not implemented.**

|              |                                                                                         |
| ------------ | --------------------------------------------------------------------------------------- |
| Method       | `POST`                                                                                  |
| Path         | `/v1/chat`                                                                              |
| Purpose      | Retrieve, assemble a context window, and stream a cited answer.                         |
| Auth         | `apikey` + user JWT                                                                     |
| Content-Type | `application/json`                                                                      |
| Accept       | `text/event-stream` (required for the streamed form), `application/json` (non-streamed) |
| Max body     | 64 KB                                                                                   |
| Idempotency  | Read-only. A retry regenerates, which is acceptable and expected.                       |

**Request body**

```ts
interface ChatRequest {
  /** The question. */
  text: string;
  /**
   * Which sub-retrievers participate. One of the four `AnswerMode` values:
   * `ask` (general question), `recall` (find what I saw), `reflect` (patterns
   * across the corpus), `activity` (time and behaviour). Defaults to `ask`.
   * The chat UI's mode selector sets this.
   */
  mode?: AnswerMode;
  /** Optional intent override, as in /v1/retrieve. */
  intent?: QueryIntent;
  /** Prior turns, oldest first. Bounded by the server, not by the client. */
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** When true, return one JSON object instead of an SSE stream. */
  stream?: boolean;
  /** Same shape as /v1/retrieve. */
  filters?: {
    topicIds?: string[];
    sourceTypes?: DocumentSource[];
    kinds?: MemoryKind[];
    from?: string;
    to?: string;
    deviceIds?: string[];
  };
}
```

```json
{
  "text": "why did I decide against event sourcing?",
  "mode": "ask",
  "stream": true,
  "history": [{ "role": "user", "text": "what have I read about event sourcing?" }]
}
```

**Response — streamed (`text/event-stream`)**

The stream is a sequence of named SSE events. The order is fixed: `meta`, then zero or more `token`, then `done` — or `error` at any point.

```
event: meta
data: {"mode":"ask","intent":"semantic","citations":[{"index":1,"documentId":"7d1c...","memoryId":null,"title":"Choosing a vector index for Postgres","url":"https://example.com/vector-index-choice","occurredAt":"2026-08-14T11:02:00.000Z","snippet":"..."}],"tookMs":418,"degraded":false}

event: token
data: {"text":"You ","done":false}

event: token
data: {"text":"decided against it ","done":false}

event: token
data: {"text":"because the domain is CRUD-shaped [1].","done":false}

event: token
data: {"text":"","done":true}

event: done
data: {"citationCount":1,"usedMemoryIds":["3c7d9e1f-2a4b-4c6d-8e0f-1a2b3c4d5e6f"],"model":"deepseek-chat","usage":{"inputTokens":2810,"outputTokens":42,"totalTokens":2852}}
```

| Event   | When                            | Payload                                                                                                                                                                                                                 |
| ------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta`  | First, always, before any token | The `AnswerMode` used, `RetrievalResult`'s `intent`, `citations`, `tookMs`, and `degraded`. Sending citations **before** the text is what lets the UI render citation chips before the answer finishes.                 |
| `token` | Zero or more                    | An `AnswerStreamChunk`: `{ text, done }`. `text` is a fragment, not necessarily a word. A `done: true` chunk with empty text is the stream's own end-of-generation marker, distinct from the `done` event that follows. |
| `done`  | Last on success                 | Citation count actually referenced, the memory ids that were read (for `access_count` bookkeeping), the model that generated, and its token usage.                                                                      |
| `error` | Terminal, at any point          | The standard error envelope, in the `data` field. A stream that fails mid-generation has already sent a `meta` event, so the client must handle "some text, then an error".                                             |

**Response — non-streamed (`stream: false`, or `Accept: application/json`)**

The non-streamed form returns the shared `Answer` shape unchanged, which is what makes an answer reproducible and auditable after the fact: it carries the retrieval it was grounded in, not just the text.

```json
{
  "text": "You decided against it because the domain is CRUD-shaped [1].",
  "mode": "ask",
  "citations": [
    {
      "index": 1,
      "documentId": "7d1c2f4a-9b8e-4c3d-a5f6-0e1d2c3b4a59",
      "memoryId": null,
      "title": "Choosing a vector index for Postgres",
      "url": "https://example.com/vector-index-choice",
      "occurredAt": "2026-08-14T11:02:00.000Z",
      "snippet": "HNSW builds incrementally..."
    }
  ],
  "model": "deepseek-chat",
  "usage": { "inputTokens": 2810, "outputTokens": 42, "totalTokens": 2852 },
  "retrieval": {
    "query": { "text": "why did I decide against event sourcing?", "topK": 40, "filters": {} },
    "intent": "semantic",
    "chunks": [],
    "citations": [],
    "tookMs": 418,
    "degraded": false
  }
}
```

The citation invariant is **bidirectional** and asserted before the response is returned: every `[n]` marker in `text` must have a matching entry in `citations`, and every entry in `citations` must be referenced from `text`. A citation the model retrieved but never used is as much a defect as a marker with no source, because it makes the provenance of the answer unreadable.

**Status codes — non-streamed**

| Code                       | When                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`                      | An answer was produced. An answer that says "I have not captured anything about this" is a `200` — the model is instructed to say so rather than to invent, and a refusal to answer from absent evidence is a success.                                                                                                                            |
| `400 bad_request`          | Missing `text`; `history` longer than the server's bound; a malformed ISO timestamp in filters.                                                                                                                                                                                                                                                   |
| `401`                      | Auth.                                                                                                                                                                                                                                                                                                                                             |
| `429`                      | Over the per-user limit.                                                                                                                                                                                                                                                                                                                          |
| `503 provider_unavailable` | No LLM provider is reachable **and** no local fallback is configured. With a fallback available, the request degrades instead: the citation list is returned with an empty `answer` and a note that synthesis was unavailable, so the user still gets the evidence (see [Failure modes](./ARCHITECTURE.md#failure-modes-and-degraded-behaviour)). |
| `504`                      | The provider did not respond within the configured timeout.                                                                                                                                                                                                                                                                                       |

**Status codes — streamed.** Once the response has begun, an HTTP status cannot change. This is why the `error` event exists, and why the client must treat a stream that ends without `done` as a failure regardless of the HTTP status it started with. A stream that fails **before** the first byte still returns a normal 5xx with the JSON error envelope. This asymmetry is a designed consequence of streaming, and the client must handle both.

**Rate limit.** Per user: 30 requests per minute, burst 5. It is the most expensive endpoint in the system — a chat turn costs a classification call, an embedding call, possibly a rerank, and a generation — so the limit is the tightest of any read path.

**Citation integrity.** Every `[n]` marker in the answer must have a matching entry in `citations`, and every `citations` entry must resolve to a row the user can open. This is asserted server-side before `done` and is a success criterion (S2 in [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)). A citation that does not resolve is a defect, not a cosmetic issue.

**curl**

```bash
# Streamed (default). curl shows the raw SSE frames.
curl -sS -N -X POST "$API_BASE_URL/v1/chat" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_USER_JWT" \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"text":"why did I decide against event sourcing?","stream":true}'

# Non-streamed
curl -sS -X POST "$API_BASE_URL/v1/chat" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_USER_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"text":"why did I decide against event sourcing?","stream":false}'
```

## Supabase edge functions

Three thin Deno functions, chosen for data locality and scheduling rather than for capability. Their bodies live in `supabase/functions/` and they are not part of the `/v1` surface — the path versioning rules above do not apply to them, which is why their invocation contract is specified here explicitly.

They authenticate with the service-role key (available to them as a Supabase runtime secret), and they are **not** callable by clients. Invoking one from a client is impossible by configuration, not merely forbidden by policy.

### `process-activity`

Runs the processing pipeline for a document. This is the function the ingest endpoints dispatch after a successful write, and the one the scheduled sweep calls.

|                 |                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose         | Run the processing pipeline ([ARCHITECTURE.md](./ARCHITECTURE.md#the-processing-pipeline)) for one document, or for a batch of backlogged ones.                                                                                                                          |
| Method / path   | `POST {SUPABASE_URL}/functions/v1/process-activity`                                                                                                                                                                                                                      |
| Auth            | `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`. Clients cannot reach it.                                                                                                                                                                                            |
| Payload         | `{ documentId: string }` \| `{ sweep: { limit: number; olderThan?: string } }`                                                                                                                                                                                           |
| Idempotency key | The document's stage stamps — not a request key. Running it twice on the same document with the same stamps is a no-op by construction (stages 1–10's `where <stamp> ≠ current` queries).                                                                                |
| Timeout         | Edge-function execution limit. A single document must complete within it; a `sweep` is bounded by `limit` so that a large backlog becomes many invocations rather than one that times out.                                                                               |
| Response        | `{ documentId, stages: [{ stage, status, durationMs }], memoryCandidateCount, memoriesWritten }` — `memoryCandidateCount: 0` is success (ADR-007).                                                                                                                       |
| Failure         | A stage failure is recorded on the document (e.g. `extraction_status = 'failed'` with `extraction_failure_reason`) and returned as a per-stage status. The function does not throw for a data-shaped failure, because a thrown error gives the caller nothing to act on. |

### `embed`

Embeds a batch of texts. Exists so that embedding can happen with the data, and so that a large backfill is chunked by the caller rather than by the provider's request limit.

|                 |                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose         | Embed a batch of texts through the configured `EmbeddingProvider` and return vectors with their model stamp.                                                                                                                            |
| Method / path   | `POST {SUPABASE_URL}/functions/v1/embed`                                                                                                                                                                                                |
| Auth            | Service role.                                                                                                                                                                                                                           |
| Payload         | `{ texts: string[]; inputType: 'query' \| 'passage'; model?: string }`                                                                                                                                                                  |
| Idempotency key | None needed — embedding is a pure function of `(text, model, inputType)`. The _caller_ decides whether to skip work, using `content_hash` and `embedding_model`.                                                                        |
| Timeout         | Must complete within the edge-function limit. `texts.length` is capped so that a full batch fits; a caller with more work issues more invocations.                                                                                      |
| Response        | `{ model, dimensions, vectors: number[][] }` — the model and dimensions are returned so the caller can assert them against `EMBEDDING_DIMENSIONS` **before** writing, rather than discovering a mismatch as a database error (ADR-004). |
| Failure         | `503 provider_unavailable` on provider failure; the caller leaves the row's `embedding` null and it is picked up by the re-embed backlog query.                                                                                         |

Note the `inputType` field: the default embedding model is asymmetric, and the same text embedded as a query and as a passage produces _different_ vectors. This is why the parameter is required rather than defaulted — a wrong value here is silent and degrades recall in a way that is very hard to diagnose.

### `distill`

Distills document chunks into memory candidates. The most expensive function in the system per invocation, and the one whose output is hardest to verify — see [RESEARCH_NOTES.md](./RESEARCH_NOTES.md).

|                 |                                                                                                                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose         | Produce `MemoryCandidate[]` from a document's chunks, with provenance.                                                                                                                                                                                                                             |
| Method / path   | `POST {SUPABASE_URL}/functions/v1/distill`                                                                                                                                                                                                                                                         |
| Auth            | Service role.                                                                                                                                                                                                                                                                                      |
| Payload         | `{ documentId: string; chunks: Array<{ chunkId: string; ordinal: number; headingPath: string[]; text: string }>; model?: string }`                                                                                                                                                                 |
| Idempotency key | `(documentId, distillation_prompt_version, distillation_model)`. The caller reads the memory rows already stamped with that triple and does not re-invoke.                                                                                                                                         |
| Timeout         | Must complete within the edge-function limit. A document with more chunks than fit is **split into multiple invocations by the caller**, each with a chunk window, and the resulting candidates are adjudicated together — rather than truncating the document, which would silently lose content. |
| Response        | `{ candidates: MemoryCandidate[]; promptVersion: string; model: string; usage: { inputTokens, outputTokens } }`                                                                                                                                                                                    |
| Failure         | `candidates: []` is a **successful** response, not a failure (ADR-007). A provider error returns `503`, and the document retains its chunks with no memories, to be retried.                                                                                                                       |
| Note            | `distill` returns candidates and does not write. Adjudication and persistence (insert / merge / supersede / reject) happen in `services/processing`, so the expensive model call and the transactional write are separate and the write can be retried without paying for the call again.          |

## Read endpoints referenced but not specified here

The dashboard needs list reads, and they follow every cross-cutting rule above (auth, error envelope, keyset pagination). They are listed so the surface is not a surprise, and their field-level detail is deferred to phase 5.

**Specified in phase 5, not implemented.**

| Endpoint                          | Purpose                                                                                        | Ordering            | Why not here                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/activity`                | The activity dashboard's event list, filterable by device, type, domain, band, and date range. | `occurred_at desc`  | Its filters depend on the dashboard's design, which does not exist yet.                                                                                                                                                                                                                                                                                                                  |
| `GET /v1/documents`               | The document list, filterable by source, topic, and date.                                      | `captured_at desc`  | Same.                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /v1/memories`                | The memory list and review queue, filterable by kind and status.                               | `created_at desc`   | Its review-queue semantics depend on the adjudication thresholds from phase 3.                                                                                                                                                                                                                                                                                                           |
| `GET /v1/topics`                  | The topic tree with counts.                                                                    | `last_seen_at desc` | Small enough that it may not be paginated at all; the decision depends on real data.                                                                                                                                                                                                                                                                                                     |
| `POST /v1/memories/:id/decisions` | Accept, reject, archive, or correct a memory.                                                  | —                   | Waits on the review UI from phase 3.                                                                                                                                                                                                                                                                                                                                                     |
| `POST /v1/devices`                | **Register a device and issue its ingest secret.**                                             | —                   | **This is a genuine gap, not a deferral.** Everything in [Authentication](#authentication) above depends on a per-device secret existing, and no endpoint in this document can create one, because issuance must be server-side (ADR-018). Phase 1 must resolve which service owns it — see the open question in [TASKS.md](./TASKS.md) — and this row is the placeholder until it does. |

## Cross-cutting concerns, summarised

| Concern                        | Rule                                                                                                                                                                                                                                                                            | Reference                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Versioning**                 | Path-versioned `/v1` for the services API; `schemaVersion` on batches for the event stream. Both exist; they change independently.                                                                                                                                              | [Base URLs](#base-urls-and-versioning)                           |
| **Auth**                       | `apikey` + JWT everywhere user data is touched; `X-Device-Secret` additionally on ingest. `user_id` never from the body.                                                                                                                                                        | [Authentication](#authentication)                                |
| **Errors**                     | One envelope, `{ error: { code, message, requestId } }`, one stable code enum, `requestId` on every error.                                                                                                                                                                      | [The error envelope](#the-error-envelope)                        |
| **Pagination**                 | Keyset only, opaque versioned cursors, total orderings per endpoint, `limit` 1–200.                                                                                                                                                                                             | [Pagination](#pagination)                                        |
| **Idempotency**                | Ingest is idempotent twice over: `Idempotency-Key` for the request, `(device_id, dedupe_key)` for the event. Processing is idempotent through version stamps.                                                                                                                   | [`POST /v1/ingest/batch`](#post-v1ingestbatch)                   |
| **Rate limits**                | Per device for ingest, per user for reads, per IP for the unauthenticated health check. `429` always carries `Retry-After`.                                                                                                                                                     | Each endpoint                                                    |
| **Degradation**                | A partial pipeline is a `200` with `degraded: true`, never a 5xx. A partial batch is a `200` with `rejected > 0`.                                                                                                                                                               | [Error envelope](#the-error-envelope)                            |
| **Content in errors and logs** | Never. Messages are human-readable but content-free; logs reference ids and counts.                                                                                                                                                                                             | [Observability](./ARCHITECTURE.md#observability)                 |
| **Excluded content**           | Never reaches these endpoints at all. The exclusion check runs on the device before an event is constructed (ADR-009), so there is no "excluded" flag on the wire and no redacted row.                                                                                          | [The privacy promise](./PROJECT_OVERVIEW.md#the-privacy-promise) |
| **Timeouts**                   | Services: 10 s for reads, 60 s for ingest. Edge functions: the platform limit, with callers sizing their payloads to fit rather than retrying a timeout. Streamed chat: no client-side timeout on the stream, but a server-side generation timeout that emits an `error` event. | Each endpoint                                                    |

## Open questions

Recorded rather than guessed. Each has an owner phase.

| Question                                                                                                                                                                                                                                                                                                           | Options and tradeoff                                                                                                                                                                                                                                                                                                                                                                  | Resolved by |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Who registers a device, and how?** Every authenticated ingest depends on `X-Device-Secret`, and nothing in this document issues one.                                                                                                                                                                             | (a) A `POST /v1/devices` on `services/ingestion` — closest to the secret's use, and it makes ingestion the owner of device identity. (b) A Supabase edge function, so registration can happen before any service is reachable. (c) A Supabase Auth hook after first sign-in, which pairs registration with identity but gives the user no way to register a second device explicitly. | Phase 1     |
| **Does `POST /v1/retrieve` need an `explain` mode?** The per-signal scores are already returned, which covers most debugging. A full `explain` (the pre-fusion lists, per-stage timings, the assembled context) would make the evaluation harness much easier to write and would add a large response to maintain. | (a) Add `explain: true` returning the intermediate state — a debugging superpower and a second response shape to keep in sync. (b) Keep the compact result and let the harness reconstruct lists from `vectorScore`/`ftsScore` — less information, one shape.                                                                                                                         | Phase 4     |
| **Should ingest and retrieval be one origin or two?** They are one base URL in `.env.example` today.                                                                                                                                                                                                               | (a) One origin — simpler clients, one CORS configuration, and a single point of failure for both capture and recall. (b) Two — retrieval can be scaled and rate-limited independently, and a retrieval incident does not stop capture.                                                                                                                                                | Phase 5     |
| **Cursor lifetime.** Cursors are stateless pivot encodings, so nothing expires them.                                                                                                                                                                                                                               | (a) Leave stateless — a cursor works forever, and a very old one simply returns a slice from an old position, which is correct. (b) Add an embedded issue time and reject cursors older than a bound — prevents a stale UI silently resuming from months ago.                                                                                                                         | Phase 5     |
| **`/v1/chat` history bound.** The request accepts `history`, and the server must bound it.                                                                                                                                                                                                                         | (a) Bound by turn count. (b) Bound by tokens. (c) Bound by tokens _and_ drop the oldest turns first.                                                                                                                                                                                                                                                                                  | Phase 5     |
| **A streaming fallback when SSE is unavailable.** The extension's service worker cannot consume SSE usefully, and it has no chat UI today.                                                                                                                                                                         | (a) Non-streamed only, which already exists (`stream: false`). (b) Long-polling onto the stream.                                                                                                                                                                                                                                                                                      | Phase 5     |

## Related documents

| Document                                   | Why                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)       | The sync protocol, the pipelines these endpoints trigger, and the degradation behaviour the status codes express. |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | The tables and constraints behind each endpoint, including the uniqueness that makes ingest idempotent.           |
| [DECISIONS.md](./DECISIONS.md)             | ADR-017 (keyset pagination) and ADR-018 (clients hold the anon key) are this document's cross-cutting rules.      |
| [RESEARCH_NOTES.md](./RESEARCH_NOTES.md)   | Provider reliability, which drives the timeout and retry values above.                                            |
| [TASKS.md](./TASKS.md)                     | Phase 1 implements the ingest endpoints; phase 4 implements retrieval; phase 5 implements chat.                   |
