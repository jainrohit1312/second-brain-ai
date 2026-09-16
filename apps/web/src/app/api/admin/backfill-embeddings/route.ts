import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * `POST /api/admin/backfill-embeddings?confirm=yes` — one-time backfill of the embedding
 * backlog: documents that already exist but have no chunks yet.
 *
 * ## Why this route does not write chunks itself
 *
 * `document_chunks` deliberately has no INSERT or UPDATE policy — writing text and vectors is
 * a service-role operation (ADR-018), and `apps/web` must never hold
 * `SUPABASE_SERVICE_ROLE_KEY` (see apps/web/README.md). So this handler does what the route
 * layer is allowed to do — *read* the caller's own state under RLS — and delegates the write
 * to the `embed` edge function, which runs with service-role privileges and takes `user_id`
 * from the document row, not from this request. `supabase.functions.invoke` forwards the
 * caller's access token, and the function refuses a document that is not the token's owner.
 *
 * That also keeps one chunking implementation on the write path: the edge function is the only
 * writer, and this endpoint cannot disagree with it about chunk boundaries.
 *
 * ## Why `?confirm=yes`
 *
 * The endpoint spends provider credit and writes rows, and a session-authenticated `POST` is
 * reachable from any page the user visits. The flag is not a security boundary — the session
 * is — it is a guard against a casual or accidental call.
 *
 * ## Why at most five documents per call
 *
 * A single call must fit inside the platform's request budget: each document is one provider
 * round trip per chunk batch plus one write. Five keeps the worst case bounded, and the caller
 * re-invokes until `documentsProcessed` is `0`, which is the documented way to drive it.
 */

/** Documents embedded per invocation. See the note above. */
const MAX_DOCUMENTS_PER_CALL = 5;

/**
 * Documents considered when looking for the backlog. Bounds the read; the oldest are taken
 * first so repeated calls make deterministic progress rather than re-scanning the same head.
 */
const MAX_CANDIDATE_DOCUMENTS = 200;

/**
 * Rows read when collecting the set of documents that already have chunks.
 *
 * PostgREST cannot express the anti-join this endpoint needs, so the set is read and filtered
 * here — which means this is the one bound that can make the filter approximate. If a user has
 * more chunk rows than this, a document that IS chunked can be missing from the set and will
 * be re-embedded. That is idempotent (the function upserts on `(document_id, ordinal)`) and
 * costs provider credit rather than correctness. An anti-join RPC would remove the bound.
 */
const MAX_CHUNK_ROWS_SCANNED = 1_000;

/** Edge function that performs the chunk + embed + write. */
const EMBED_FUNCTION = 'embed';

/** The value `?confirm=` must carry before anything is written. */
const CONFIRM_VALUE = 'yes';

/** One document's failure, reported rather than thrown so one bad document cannot stop the run. */
interface BackfillError {
  documentId: string;
  message: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const confirm = new URL(request.url).searchParams.get('confirm');
  if (confirm !== CONFIRM_VALUE) {
    return NextResponse.json(
      {
        error: `This endpoint writes chunks and spends embedding credit. Re-run with ?confirm=${CONFIRM_VALUE}.`,
      },
      { status: 400 },
    );
  }

  // Oldest first, so two consecutive calls cannot both pick the same five and stall.
  const { data: documentRows, error: documentsError } = await supabase
    .from('documents')
    .select('id')
    .eq('extraction_status', 'succeeded')
    .is('deleted_at', null)
    .order('captured_at', { ascending: true })
    .limit(MAX_CANDIDATE_DOCUMENTS);

  if (documentsError !== null) {
    return NextResponse.json(
      { error: `Failed to list documents: ${documentsError.message}` },
      { status: 500 },
    );
  }

  // RLS scopes this to the caller's own chunks, so the set needs no user filter of its own.
  const { data: chunkRows, error: chunksError } = await supabase
    .from('document_chunks')
    .select('document_id')
    .limit(MAX_CHUNK_ROWS_SCANNED);

  if (chunksError !== null) {
    return NextResponse.json(
      { error: `Failed to list existing chunks: ${chunksError.message}` },
      { status: 500 },
    );
  }

  const chunkedDocumentIds = new Set(
    ((chunkRows ?? []) as Array<{ document_id: string }>).map((row) => row.document_id),
  );

  const pendingDocumentIds = ((documentRows ?? []) as Array<{ id: string }>)
    .map((row) => row.id)
    .filter((id) => !chunkedDocumentIds.has(id))
    .slice(0, MAX_DOCUMENTS_PER_CALL);

  const errors: BackfillError[] = [];
  let documentsProcessed = 0;
  let chunksCreated = 0;

  for (const documentId of pendingDocumentIds) {
    try {
      const response = await supabase.functions.invoke(EMBED_FUNCTION, {
        body: { documentId },
      });

      if (response.error !== null) {
        errors.push({ documentId, message: response.error.message });
        continue;
      }

      const payload = response.data as { chunksCreated?: unknown } | null;
      const created = typeof payload?.chunksCreated === 'number' ? payload.chunksCreated : 0;

      documentsProcessed += 1;
      chunksCreated += created;
    } catch (error) {
      errors.push({
        documentId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log('POST /api/admin/backfill-embeddings', {
    userId: user.id,
    candidates: pendingDocumentIds.length,
    documentsProcessed,
    chunksCreated,
    failures: errors.length,
  });

  return NextResponse.json({ documentsProcessed, chunksCreated, errors });
}
