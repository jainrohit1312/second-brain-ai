/**
 * Edge function: `distill`.
 *
 * Turns processed `document_chunks` into durable memories: chunk-level extraction
 * of candidate facts/preferences/decisions, deduplication against what is already
 * stored, then merge-or-supersede decisions per candidate. This is the longest
 * running piece of the system and the one that decides what the user's memory
 * actually contains, so its writes need the strictest care.
 *
 * WHY A BACKGROUND INVOCATION, NOT AN INLINE REQUEST:
 *   One document means many chunk-level LLM calls, then an embedding per candidate,
 *   then a similarity lookup and a merge decision per candidate against the
 *   existing memory set. That is tens of seconds to minutes of wall clock — far
 *   past any HTTP request budget and past the edge runtime's own limit. The
 *   processing service therefore queues it (and may queue it again for the same
 *   document); a client request must never wait on this function, and no caller
 *   should treat a 200 as "the user's memory is up to date" — the job record is.
 *
 * WHY IT MUST BE IDEMPOTENT UNDER RETRY:
 *   A retry is expected, not exceptional: provider errors and timeouts, container
 *   restarts, `per_worker` isolate recycling, and an operator re-running a
 *   document all produce a second invocation for work that may already be part
 *   done. So a retry must converge on the same memory set rather than duplicate
 *   statements or supersede a memory twice. Concretely, the implementation must:
 *     1. key every write on a stable identity derived from (documentId, chunkId,
 *        candidate statement) so a repeat insert hits a conflict instead of
 *        appending a near-duplicate memory;
 *     2. never delete memories in place — a supersede sets `status` +
 *        `superseded_by` + `valid_to`, so replaying the same decision is a no-op;
 *     3. mark the job complete only after every memory write for the document has
 *        committed, so a crash mid-way is retried from the same starting point
 *        instead of being recorded as done.
 *
 * TWO CLIENTS, ON PURPOSE: `serviceClient` (service-role) performs the memory
 * writes and bypasses RLS, so every statement must filter on the `user_id` from
 * the verified caller. `userClient` carries the caller's `Authorization` header
 * so RLS still applies, and is used for reads whose result is returned to the caller.
 *
 * NOTE: this directory is outside the pnpm workspace (Deno resolves imports from
 * ./deno.json), so it cannot import `@second-brain/shared`. The `Wire*` types below
 * are the narrow wire contract this function needs and must be kept in sync with
 * `packages/shared/src/types/memory.ts` and `.../document.ts`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Stable name used in logs and in every response body, so a report can name a function. */
const FUNCTION_NAME = 'distill';

/**
 * Headers returned on every response. The caller is a server process rather than a
 * browser, but the preflight path is kept uniform across the three functions.
 */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Body of a distillation request. */
interface WireDistillRequest {
  userId: string;
  documentId: string;
  /**
   * `incremental` re-runs only chunks that have no candidate memories yet;
   * `full` re-runs every chunk of the document. Both must be safe to repeat.
   */
  mode: 'incremental' | 'full';
}

/** Thrown for caller mistakes, so the handler can answer 400 instead of a generic 500. */
class BadRequestError extends Error {}

/**
 * Reads a required environment value.
 * @throws Error naming the missing variable. Edge functions get no startup
 * validation, so without this a misconfigured secret surfaces as `undefined`
 * inside an LLM call instead of at the top of the request.
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
async function readRequest(req: Request): Promise<WireDistillRequest> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new BadRequestError('Request body must be JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BadRequestError('Request body must be a JSON object.');
  }
  const request = parsed as Partial<WireDistillRequest>;
  if (typeof request.userId !== 'string' || typeof request.documentId !== 'string') {
    throw new BadRequestError('Request body must contain string `userId` and `documentId` fields.');
  }
  return {
    userId: request.userId,
    documentId: request.documentId,
    mode: request.mode === 'full' ? 'full' : 'incremental',
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  // One id per invocation: logged here and echoed to the client. Because this
  // function is retried, the job's own record carries this id too, so a duplicate
  // run is identifiable in the log rather than merely suspected.
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
    const distillRequest = await readRequest(req);

    // The LLM provider is resolved here rather than trusted from the body: the
    // caller queues work, it does not choose the model.
    const llmProvider = requireEnv('LLM_PROVIDER');
    const llmModel = requireEnv('LLM_MODEL');
    console.log(
      `[${FUNCTION_NAME}] requestId=${requestId} document=${distillRequest.documentId} ` +
        `mode=${distillRequest.mode} provider=${llmProvider} model=${llmModel}`,
    );

    // Both clients are built before the core so a missing secret or a missing
    // Authorization header fails as a structured error rather than a partial write.
    const serviceClient = createServiceClient();
    const userClient = createUserClient(req);

    // --- Unimplemented core (phase 2) --------------------------------------
    // TODO(phase-2): mark the job running (idempotent: a second invocation for a
    // running job must join or no-op, not duplicate), then load the document's
    // chunks through `userClient`.
    // TODO(phase-2): extract `MemoryCandidate`s per chunk with the LLM (structured
    // output, one call per chunk, retried per chunk) and discard anything below the
    // confidence floor.
    // TODO(phase-2): dedup each candidate against existing memories — exact on a
    // stable candidate key, then nearest-neighbour over `embedding` restricted to
    // rows whose `embedding_model` matches the active model.
    // TODO(phase-2): resolve every candidate to a single `MemoryMergeDecision`
    // (insert / merge / supersede / reject) and apply it through `serviceClient` in
    // one transaction per candidate, with `on conflict do nothing` on the insert path.
    // TODO(phase-2): mark the job complete and report counts (inserted, merged,
    // superseded, rejected) plus the list of chunk ids covered, so the caller can
    // resume without repeating work.
    //
    // `serviceClient` is the writer for all of the above; `userClient` is the only
    // path allowed to read document content back for the caller.
    void serviceClient;
    void userClient;

    return jsonResponse(
      {
        function: FUNCTION_NAME,
        error: 'Not implemented: chunk distillation into memories (phase 2).',
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
