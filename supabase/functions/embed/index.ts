/**
 * Edge function: `embed`.
 *
 * Batch-embeds the text of `document_chunks` rows that have no vector yet and
 * writes each vector back together with the id of the model that produced it.
 * Invoked by services/processing as a background job, never by a client waiting
 * on a response.
 *
 * MODEL / DIMENSION PINNING — read before changing anything here:
 *   `document_chunks.embedding` is a single `vector(N)` column and
 *   `document_chunks.embedding_model` records which model produced each row.
 *   Vectors from different models are not comparable, so mixing them in one
 *   column either fails the column's dimension check on insert or — worse, when
 *   the dimensions happen to agree — silently returns similarity scores that mean
 *   nothing, and the failure looks like "retrieval is just bad" rather than an
 *   error. Therefore:
 *     1. `EMBEDDING_DIMENSIONS` must equal both the column's declared width and
 *        the model's real output width. It is a correctness constraint, not a
 *        tuning knob; `.env.example` lists the width of each supported model.
 *     2. The vector and its `embedding_model` are written in the SAME statement,
 *        so no row can ever be read without knowing its producer.
 *     3. Changing the active model is a migration plus a full re-embed, never a
 *        config flip: a partial re-embed leaves two incomparable populations in
 *        the column. See docs/DECISIONS.md (ADR-004).
 *     4. Vector search must exclude rows whose `embedding_model` differs from the
 *        active model until they have been re-embedded; that filter lives in the
 *        retrieval service.
 *
 * TWO CLIENTS, ON PURPOSE: `serviceClient` (service-role) writes the vectors and
 * bypasses RLS, so every statement must filter on the `user_id` taken from the
 * verified caller. `userClient` carries the caller's `Authorization` header so
 * RLS still applies and is used for reads whose result is returned to the caller.
 *
 * NOTE: this directory is outside the pnpm workspace (Deno resolves imports from
 * ./deno.json), so it cannot import `@second-brain/shared` or
 * `@second-brain/providers`. The `Wire*` types below are the narrow wire contract
 * this function needs; provider selection and API keys stay with the processing
 * service that queues the work.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Stable name used in logs and in every response body, so a report can name a function. */
const FUNCTION_NAME = 'embed';

/**
 * Headers returned on every response. Cross-origin callers are server processes
 * rather than browsers, but the preflight path is kept uniform across functions.
 */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Body of an embed request: the chunks to embed, owned by one user. */
interface WireEmbedRequest {
  userId: string;
  chunkIds: string[];
  /**
   * Re-embed chunks that already carry a vector. Only ever set together with a
   * model/dimension change, because it is the one path that can leave the column
   * holding two incomparable populations.
   */
  force: boolean;
}

/** Thrown for caller mistakes, so the handler can answer 400 instead of a generic 500. */
class BadRequestError extends Error {}

/**
 * Reads a required environment value.
 * @throws Error naming the missing variable. Edge functions get no startup
 * validation, so without this a misconfigured secret surfaces as `undefined`
 * inside a provider call instead of at the top of the request.
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

/** Builds the privileged client. It bypasses RLS: never return its rows to the caller unfiltered. */
function createServiceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Builds a client bound to the caller's JWT so every statement it issues is
 * subject to Row Level Security.
 * @throws Error when the Authorization header is absent or is not a bearer token.
 */
function createUserClient(req: Request): SupabaseClient {
  const authorization = req.headers.get('Authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    throw new Error('Expected an "Authorization: Bearer <access token>" header.');
  }
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Serialises a body as JSON, attaching the CORS headers and the request id. */
function jsonResponse(body: Record<string, unknown>, status: number, requestId: string): Response {
  return new Response(JSON.stringify({ ...body, requestId }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** `catch` narrows to `unknown`; this keeps error mapping in one place. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads the request body and checks the envelope only.
 * @throws BadRequestError when the body is malformed, so the caller gets a 400.
 */
async function readRequest(req: Request): Promise<WireEmbedRequest> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new BadRequestError('Request body must be JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BadRequestError('Request body must be a JSON object.');
  }
  const request = parsed as Partial<WireEmbedRequest>;
  if (typeof request.userId !== 'string' || !Array.isArray(request.chunkIds)) {
    throw new BadRequestError(
      'Request body must contain a string `userId` and a `chunkIds` array.',
    );
  }
  return { userId: request.userId, chunkIds: request.chunkIds, force: request.force === true };
}

Deno.serve(async (req: Request): Promise<Response> => {
  // One id per invocation: logged here and echoed to the client. This is how a
  // report such as "documents stopped getting searchable" is matched to a log line.
  const requestId = crypto.randomUUID();

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse(
      { function: FUNCTION_NAME, error: `Method ${req.method} is not allowed; use POST.` },
      405,
      requestId,
    );
  }

  try {
    const embedRequest = await readRequest(req);

    // The active model and its width are read together with the rest of the config
    // so a partial configuration cannot be used to write an unlabelled vector.
    const embeddingModel = requireEnv('EMBEDDING_MODEL');
    const embeddingDimensions = Number.parseInt(requireEnv('EMBEDDING_DIMENSIONS'), 10);
    if (!Number.isInteger(embeddingDimensions) || embeddingDimensions <= 0) {
      throw new Error('EMBEDDING_DIMENSIONS must be a positive integer.');
    }
    console.log(
      `[${FUNCTION_NAME}] requestId=${requestId} model=${embeddingModel} dims=${embeddingDimensions} ` +
        `chunks=${embedRequest.chunkIds.length} force=${embedRequest.force}`,
    );

    // Both clients are built before the core so a missing secret or a missing
    // Authorization header fails as a structured error rather than a partial write.
    const serviceClient = createServiceClient();
    const userClient = createUserClient(req);

    // --- Unimplemented core (phase 2) --------------------------------------
    // TODO(phase-2): load the requested chunks through `userClient` (RLS proves
    // ownership), skipping rows whose `embedding_model` already matches the active
    // model unless `force` is set.
    // TODO(phase-2): resolve the provider adapter from `@second-brain/providers`
    // (EMBEDDING_PROVIDER / EMBEDDING_MODEL / EMBEDDING_DIMENSIONS + the matching
    // API key), call it in provider-sized batches, and retry per batch so one bad
    // chunk cannot fail the whole job.
    // TODO(phase-2): assert each returned vector's length equals
    // `embeddingDimensions` BEFORE writing, then write vector + `embedding_model`
    // in one `serviceClient` statement filtered by `user_id`.
    // TODO(phase-2): report per-chunk success/failure counts, and on a model change
    // leave every untouched row's `embedding_model` intact so search can exclude it.
    //
    // `serviceClient` is the writer for all of the above; `userClient` is the only
    // path allowed to read chunk text back for the caller.
    void serviceClient;
    void userClient;

    return jsonResponse(
      {
        function: FUNCTION_NAME,
        error: 'Not implemented: chunk embedding (phase 2).',
      },
      501,
      requestId,
    );
  } catch (error) {
    const status = error instanceof BadRequestError ? 400 : 500;
    console.error(`[${FUNCTION_NAME}] requestId=${requestId} failed (status=${status}):`, error);
    return jsonResponse({ function: FUNCTION_NAME, error: errorMessage(error) }, status, requestId);
  }
});
