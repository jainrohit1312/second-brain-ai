/**
 * Edge function: `embed`.
 *
 * Two modes, dispatched on the request body:
 *
 * 1. `{ documentId }` — chunk one document's `extracted_text`, embed every chunk with
 *    `inputType: 'passage'`, and upsert the rows into `document_chunks`. This is the mode the
 *    pg_net trigger (20260916100500_auto_embed_trigger.sql) and the web backfill endpoint
 *    (`/api/admin/backfill-embeddings`) call, and it returns `{ documentId, chunksCreated }`.
 * 2. `{ texts, inputType, model? }` — the pure embedding utility documented at
 *    docs/API_REFERENCE.md#embed, returning `{ model, dimensions, vectors }`. No database
 *    access. Service role only.
 *
 * MODEL / DIMENSION PINNING — read before changing anything here:
 *   `document_chunks.embedding` is a single `vector(N)` column and
 *   `document_chunks.embedding_model` records which model produced each row. Vectors from
 *   different models are not comparable, so mixing them in one column either fails the
 *   column's dimension check on insert or — worse, when the dimensions happen to agree —
 *   silently returns similarity scores that mean nothing. Therefore:
 *     1. `EMBEDDING_DIMENSIONS` must equal the width of the `vector(N)` column. It is a
 *        correctness constraint, not a tuning knob. The pinned model is 2048-wide natively
 *        (`nvidia/nemotron-3-embed-1b`) and the endpoint accepts no other `dimensions`, so the
 *        1024-wide vectors this function stores are a Matryoshka first-k slice of the native
 *        output, re-normalized before storage. See ADR-024 and `reduceToDimensions` below.
 *     2. The vector and its `embedding_model` are written in the SAME statement, so no row
 *        can ever be read without knowing its producer.
 *     3. Changing the active model — or the width — is a migration plus a full re-embed, never
 *        a config flip. See docs/DECISIONS.md (ADR-004).
 *
 * TWO CLIENTS, ON PURPOSE: `serviceClient` (service-role) writes the vectors and bypasses
 * RLS, so every statement must filter on the `user_id` it resolved explicitly. `userClient`
 * carries the caller's `Authorization` header so RLS still applies and is what verifies a
 * user token in mode 1.
 *
 * AUTHORIZATION OF MODE 1: the dispatch token is the service-role key (held in Vault for the
 * trigger, in the server environment for the web app's own call), and a user's session token
 * is accepted only when the target document's `user_id` matches the *verified* user id from
 * `auth.getUser()`. The document's `user_id` is never taken from the request body — it is
 * read from the row, which is authoritative.
 *
 * NOTE: this directory is outside the pnpm workspace (Deno resolves imports from ./deno.json),
 * so it cannot import `@second-brain/shared`, `@second-brain/providers` or
 * `@second-brain/processing`. The chunker and the NVIDIA call below are therefore faithful
 * MIRRORS of:
 *
 *   services/processing/src/chunking/recursive.ts   (CHUNK_SIZE / CHUNK_OVERLAP /
 *                                                    MIN_CHUNK_SIZE / DEFAULT_SEPARATORS /
 *                                                    the splitter, overlap and heading rules)
 *   packages/providers/src/embedding/nvidia.ts      (the `/embeddings` body, `input_type`
 *                                                    mapping, retry and width validation)
 *   packages/shared/src/utils/hash.ts + text.ts     (`contentHash`, `estimateTokens`)
 *
 * They must be changed together: a divergence here silently changes what a chunk *is*, and
 * `document_chunks.content_hash` is what a later re-processing pass uses to decide a chunk is
 * unchanged. The long-term fix is a dependency-free module both runtimes can import; until
 * then this comment is the contract.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The application schema. Every product table lives in `second_brain` (ADR-020) while
 * PostgREST's default schema is `public`, which holds none of them — so a client that omits
 * this reads the wrong schema and gets "Could not find the table 'public.documents' in the
 * schema cache" for a table that exists. Deno cannot import `@second-brain/database`, so
 * `DEFAULT_SCHEMA` is mirrored here the way the wire types are.
 */
const APP_SCHEMA = 'second_brain';

/**
 * The client type this function is written against.
 *
 * Both generic arguments are named on purpose. `Database` stays `any` because this function
 * sits outside the workspace and cannot use the generated row types; `SchemaName` is pinned to
 * the application schema, so a client built without the `db: { schema }` bind — one that would
 * silently query `public` and find none of these tables — does not type-check as this type.
 */
type AppSchemaClient = SupabaseClient<any, typeof APP_SCHEMA>;

/** Stable name used in logs and in every response body, so a report can name a function. */
const FUNCTION_NAME = 'embed';

/**
 * Headers returned on every response. Cross-origin callers are server processes rather than
 * browsers, but the preflight path is kept uniform across functions.
 */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------------
// Mirrored constants — see the file header.
// ---------------------------------------------------------------------------

/** Target maximum characters per chunk. Mirrors `CHUNK_SIZE` in `.env.example`. */
const CHUNK_SIZE = 800;
/** Characters of overlap between consecutive chunks, counted inside `CHUNK_SIZE`. */
const CHUNK_OVERLAP = 120;
/** Floor below which a trailing fragment is folded into its predecessor rather than dropped. */
const MIN_CHUNK_SIZE = 400;
/** Separators, coarsest first. The empty string is the terminal hard-split case. */
const DEFAULT_SEPARATORS: readonly string[] = ['\n\n', '\n', '. ', ' ', ''];
/** Strategy name persisted on every row, so a re-chunk knows which chunks are stale. */
const CHUNKING_STRATEGY = 'recursive';
/** Rough characters-per-token ratio for English prose; mirrors `CHARS_PER_TOKEN`. */
const CHARS_PER_TOKEN = 4;
/** Vectors per provider request. Bounds one call inside the edge function's wall-clock budget. */
const EMBEDDING_BATCH_SIZE = 16;
/** Attempts after the first failed one, for a transport failure, a timeout or a 5xx. */
const EMBEDDING_MAX_RETRIES = 2;
/** Budget for one provider attempt. */
const EMBEDDING_TIMEOUT_MS = 20_000;
/** `document_chunks` rows per PostgREST statement. */
const CHUNK_WRITE_BATCH_SIZE = 100;

/** Defaults matching `NVIDIA_EMBEDDING_DEFAULTS` in `@second-brain/providers`. */
const DEFAULT_EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b';
const DEFAULT_EMBEDDING_DIMENSIONS = 1024;
const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/**
 * The pinned model's native width, and the only `dimensions` value the endpoint accepts.
 *
 * Measured 2026-09-17: `dimensions: 1024` and `dimensions: 512` are both rejected with
 * `400 {"message":"dimensions must be one of 2048"}`. The reduction to `EMBEDDING_DIMENSIONS` is
 * therefore a client-side first-k slice plus a re-normalization, per the model card ("sliced
 * vectors must be L2-normalized again before similarity scoring"). Verified: the native vector is
 * unit-norm (1.000000) while its first-1024 slice is not (0.691104).
 */
const NATIVE_EMBEDDING_DIMENSIONS = 2048;

/**
 * Models whose native output supports Matryoshka-style first-k slicing — mirrors
 * `MATRYOSHKA_MODELS` in packages/providers/src/embedding/nvidia.ts.
 *
 * Gated rather than applied to every wide response, because slicing a model that was not trained
 * for it discards information while still producing a numerically valid vector (ADR-004).
 */
const MATRYOSHKA_MODELS: ReadonlySet<string> = new Set(['nvidia/nemotron-3-embed-1b']);

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** Mode 1: chunk + embed one document. */
interface WireDocumentRequest {
  documentId: string;
}

/** Mode 2: the documented pure utility. */
interface WireTextsRequest {
  texts: string[];
  inputType: 'query' | 'passage';
  model?: string;
}

/** Claims decoded from the caller's bearer token. The platform verified the signature. */
interface CallerClaims {
  role: string;
  sub: string | null;
}

/** Resolved provider configuration. */
interface EmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
}

/** One chunk before persistence. */
interface Chunk {
  text: string;
  headingPath: string[];
}

/** A slice of the source text plus the offset it came from. */
interface Piece {
  text: string;
  start: number;
}

/** One ATX heading found in the body. */
interface Heading {
  offset: number;
  level: number;
  title: string;
}

/** Thrown for caller mistakes, so the handler can answer 400 instead of a generic 500. */
class BadRequestError extends Error {}

// ---------------------------------------------------------------------------
// Mirrored hashing and sizing helpers (packages/shared/src/utils/{hash,text}.ts)
// ---------------------------------------------------------------------------

/** Collapse all whitespace runs to a single space and trim the result. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** NFC-normalize and strip zero-width characters, matching the shared helper. */
function normalizeUnicode(text: string): string {
  return text.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/** FNV-1a 64-bit hash as 16 lowercase hex characters. */
function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Stable content identity for a chunk body. Prefixed with the algorithm, as the shared helper
 * does. Deliberately over the text alone: the hash must be reproducible from the row's own
 * `text`, and `(document_id, ordinal)` is already what makes a re-chunk idempotent.
 */
function contentHash(text: string): string {
  return `fnv1a64:${fnv1a64Hex(normalizeWhitespace(normalizeUnicode(text)))}`;
}

/** Estimated token count from character count. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Mirrored chunker (services/processing/src/chunking/recursive.ts)
// ---------------------------------------------------------------------------

/**
 * Chunks a document body: paragraph → line → sentence → word → hard cut, merged back up to the
 * body budget, overlapped, with a short tail folded rather than dropped, and each chunk
 * carrying the heading stack in force where it starts.
 */
function chunkDocument(body: string): Chunk[] {
  if (body.trim().length === 0) return [];

  const bodyMax = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP - 1);
  const headings = findHeadings(body);
  const leaves = splitRecursive(body, 0, DEFAULT_SEPARATORS, bodyMax);
  const merged = mergeLeaves(leaves, bodyMax);
  const sized = foldShortTail(merged, MIN_CHUNK_SIZE);

  return assemble(sized, headings);
}

/** Turns prepared pieces into chunks, applying overlap and resolving heading paths. */
function assemble(pieces: readonly Piece[], headings: readonly Heading[]): Chunk[] {
  const chunks: Chunk[] = [];
  let previousText: string | undefined;

  for (const piece of pieces) {
    const trimmed = trimPiece(piece);
    if (trimmed.text.length === 0) continue;

    const prefix = previousText === undefined ? '' : overlapTail(previousText, CHUNK_OVERLAP);
    const text = joinOverlap(prefix, trimmed.text);

    chunks.push({ text, headingPath: headingPathAt(headings, trimmed.start) });
    previousText = trimmed.text;
  }

  return chunks;
}

/** Splits at the coarsest usable separator, recursing only into pieces still over `max`. */
function splitRecursive(
  text: string,
  offset: number,
  separators: readonly string[],
  max: number,
): Piece[] {
  if (text.length <= max) return [{ text, start: offset }];

  const [separator, ...rest] = separators;
  if (separator === undefined || separator === '') return hardSplit(text, offset, max);

  const parts = splitOn(text, offset, separator);
  if (parts.length <= 1) return splitRecursive(text, offset, rest, max);

  const leaves: Piece[] = [];
  for (const part of parts) {
    if (part.text.length <= max) leaves.push(part);
    else leaves.push(...splitRecursive(part.text, part.start, rest, max));
  }
  return leaves;
}

/** Cuts text into `max`-character pieces: the base case for input with no usable separator. */
function hardSplit(text: string, offset: number, max: number): Piece[] {
  const pieces: Piece[] = [];
  for (let cursor = 0; cursor < text.length; cursor += max) {
    pieces.push({ text: text.slice(cursor, cursor + max), start: offset + cursor });
  }
  return pieces.length > 0 ? pieces : [{ text, start: offset }];
}

/** Splits on `separator` keeping it at the end of each piece, so offsets stay exact. */
function splitOn(text: string, offset: number, separator: string): Piece[] {
  const parts: Piece[] = [];
  let cursor = 0;

  for (;;) {
    const index = text.indexOf(separator, cursor);
    if (index === -1) {
      parts.push({ text: text.slice(cursor), start: offset + cursor });
      return parts;
    }
    const end = index + separator.length;
    parts.push({ text: text.slice(cursor, end), start: offset + cursor });
    cursor = end;
  }
}

/** Merges adjacent leaves back up to `max` characters, dropping nothing. */
function mergeLeaves(leaves: readonly Piece[], max: number): Piece[] {
  const merged: Piece[] = [];
  let current: Piece | undefined;

  for (const leaf of leaves) {
    if (current === undefined) {
      current = { ...leaf };
      continue;
    }
    if (current.text.length + leaf.text.length <= max) {
      current = { text: current.text + leaf.text, start: current.start };
    } else {
      merged.push(current);
      current = { ...leaf };
    }
  }

  if (current !== undefined) merged.push(current);
  return merged;
}

/** Folds a trailing piece shorter than `min` into its predecessor; discards nothing. */
function foldShortTail(pieces: readonly Piece[], min: number): Piece[] {
  if (pieces.length <= 1 || min <= 0) return [...pieces];

  const last = pieces[pieces.length - 1];
  const previous = pieces[pieces.length - 2];
  if (last === undefined || previous === undefined) return [...pieces];
  if (last.text.trim().length >= min) return [...pieces];

  return [...pieces.slice(0, -2), { text: previous.text + last.text, start: previous.start }];
}

/** Removes a piece's outer whitespace, advancing `start` past what it trimmed. */
function trimPiece(piece: Piece): Piece {
  const leading = piece.text.length - piece.text.trimStart().length;
  return { text: piece.text.trim(), start: piece.start + leading };
}

/** Every ATX heading in the body, in reading order. */
function findHeadings(text: string): Heading[] {
  const headings: Heading[] = [];
  const pattern = /(^|\n)(#{1,6})[ \t]+([^\n]*)/g;

  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    headings.push({
      offset: match.index + (match[1] ?? '').length,
      level: (match[2] ?? '').length,
      title: (match[3] ?? '').trim(),
    });
  }
  return headings;
}

/** The heading stack in force at `start`, outermost first. */
function headingPathAt(headings: readonly Heading[], start: number): string[] {
  const stack: Heading[] = [];

  for (const heading of headings) {
    if (heading.offset > start) break;
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) stack.pop();
    stack.push(heading);
  }
  return stack.map((heading) => heading.title);
}

/** Up to `max` characters from the end of `text`, started after the first word boundary. */
function overlapTail(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;

  const slice = text.slice(text.length - max);
  const boundary = slice.search(/\s/);
  return boundary === -1 ? slice : slice.slice(boundary + 1);
}

/** Joins an overlap prefix to a body without welding two words together. */
function joinOverlap(prefix: string, text: string): string {
  if (prefix === '') return text;
  return /\s$/.test(prefix) || /^\s/.test(text) ? prefix + text : `${prefix} ${text}`;
}

// ---------------------------------------------------------------------------
// Mirrored NVIDIA provider (packages/providers/src/embedding/nvidia.ts)
// ---------------------------------------------------------------------------

/** `[1,2,3]` — the literal pgvector's input function accepts for a `vector` column. */
function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}

/** Embeds a batch in provider-sized chunks, preserving input order. */
async function embedTexts(
  texts: string[],
  inputType: 'query' | 'passage',
  config: EmbeddingConfig,
): Promise<number[][]> {
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
    vectors.push(...(await requestBatch(batch, inputType, config)));
  }
  return vectors;
}

/** One batch, retried while the failure is transient. */
async function requestBatch(
  texts: string[],
  inputType: 'query' | 'passage',
  config: EmbeddingConfig,
): Promise<number[][]> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= EMBEDDING_MAX_RETRIES; attempt += 1) {
    try {
      return await requestOnce(texts, inputType, config);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === EMBEDDING_MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** One HTTP attempt, bounded by `EMBEDDING_TIMEOUT_MS`. */
async function requestOnce(
  texts: string[],
  inputType: 'query' | 'passage',
  config: EmbeddingConfig,
): Promise<number[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: config.model,
        input_type: inputType,
        encoding_format: 'float',
        // The model's native width, and the endpoint's only accepted value. The reduction to
        // `config.dimensions` is a client-side slice — see NATIVE_EMBEDDING_DIMENSIONS.
        dimensions: NATIVE_EMBEDDING_DIMENSIONS,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderFailure(
        `NVIDIA embeddings request failed with HTTP ${response.status}: ${body.slice(0, 500)}`,
        response.status,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    return validateVectors(payload, texts.length, config);
  } finally {
    clearTimeout(timer);
  }
}

/** A provider failure, carrying enough to decide whether a retry is worth it. */
class ProviderFailure extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
    this.name = 'ProviderFailure';
  }
}

/** Transport failures, timeouts, 408/429 and 5xx are retryable; every other 4xx is not. */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ProviderFailure)) return true;
  const status = error.statusCode;
  if (status === null) return true;
  return status === 408 || status === 429 || status >= 500;
}

/** Orders, shape-checks and reduces the provider's response to the configured width. */
function validateVectors(
  payload: { data?: Array<{ embedding?: number[]; index?: number }> },
  expectedCount: number,
  config: EmbeddingConfig,
): number[][] {
  const data = payload.data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new ProviderFailure(
      `NVIDIA returned ${Array.isArray(data) ? data.length : 'no'} embeddings for ${expectedCount} input(s).`,
      null,
    );
  }

  const ordered = data.every((datum) => typeof datum.index === 'number')
    ? [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    : data;

  return ordered.map((datum, position) => {
    const embedding = datum.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new ProviderFailure(`NVIDIA returned no vector for input ${position}.`, null);
    }
    return reduceToDimensions(embedding, config);
  });
}

/** L2-normalizes a vector, so cosine similarity is a plain dot product. */
function l2Normalize(vector: readonly number[]): number[] {
  let squared = 0;
  for (const value of vector) squared += value * value;

  const norm = Math.sqrt(squared);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new ProviderFailure(
      'Refusing to normalize an embedding whose norm is zero or non-finite: it carries no ' +
        'direction, so dividing by its norm would write NaN into the vector column.',
      null,
    );
  }
  return vector.map((value) => value / norm);
}

/** Matryoshka reduction: keep the first `targetDims` elements and re-normalize. */
function sliceAndNormalize(vector: readonly number[], targetDims: number): number[] {
  return l2Normalize(vector.slice(0, targetDims));
}

/**
 * Reduces a provider vector to the configured width, and refuses the cases that are not a
 * reduction. Mirrors `reduceToDimensions` in packages/providers/src/embedding/nvidia.ts:
 * equal width passes through; wider + Matryoshka-trained is sliced and re-normalized; anything
 * else is refused rather than quietly accepted (ADR-004).
 */
function reduceToDimensions(embedding: number[], config: EmbeddingConfig): number[] {
  const { dimensions, model } = config;
  if (embedding.length === dimensions) return embedding;

  if (embedding.length > dimensions && MATRYOSHKA_MODELS.has(model)) {
    return sliceAndNormalize(embedding, dimensions);
  }

  throw new ProviderFailure(
    `NVIDIA returned a ${embedding.length}-dimensional vector, but EMBEDDING_DIMENSIONS is ` +
      `${dimensions} for model ${model}. Stored vectors would be incomparable; a width or model ` +
      'change is a re-embed migration (ADR-004). Reduction is only applied to models trained ' +
      'for it, and a narrower vector cannot be widened.',
    null,
  );
}

// ---------------------------------------------------------------------------
// Client and request helpers
// ---------------------------------------------------------------------------

/**
 * Reads a required environment value.
 * @throws Error naming the missing variable. Edge functions get no startup validation, so
 * without this a misconfigured secret surfaces as `undefined` inside a provider call.
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

/** Reads an optional environment value, treating whitespace-only as unset. */
function optionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** Builds the privileged client. It bypasses RLS: never return its rows to the caller unfiltered. */
function createServiceClient(): AppSchemaClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    // Without this the client defaults to `public`, which holds none of this product's tables,
    // so every read below fails with "Could not find the table 'public.documents' in the schema
    // cache" while the table exists. Same bind as process-activity's clients.
    db: { schema: APP_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Builds a client bound to the caller's JWT so every statement it issues is subject to Row
 * Level Security.
 * @throws Error when the Authorization header is absent or is not a bearer token.
 */
function createUserClient(req: Request): AppSchemaClient {
  const authorization = req.headers.get('Authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    throw new Error('Expected an "Authorization: Bearer <access token>" header.');
  }
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    db: { schema: APP_SCHEMA },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Decodes the role and subject from the caller's bearer token.
 *
 * The signature is NOT checked here, and does not need to be: the platform gateway validated
 * it before the function ran (`verify_jwt = true`). In mode 1 the value is only used to
 * decide which authority path to take, and the user path additionally re-verifies through
 * `auth.getUser()`.
 */
function readClaims(req: Request): CallerClaims {
  const authorization = req.headers.get('Authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    throw new BadRequestError('Expected an "Authorization: Bearer <access token>" header.');
  }

  const token = authorization.slice('Bearer '.length).trim();
  const payload = token.split('.')[1];
  if (payload === undefined) {
    throw new BadRequestError('The bearer token is not a JWT.');
  }

  const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const decoded = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  const claims = JSON.parse(decoded) as { role?: string; sub?: string };

  return { role: claims.role ?? 'anon', sub: claims.sub ?? null };
}

/** Resolves the embedding provider configuration, validated before any work is done. */
function resolveEmbeddingConfig(): EmbeddingConfig {
  const provider = optionalEnv('EMBEDDING_PROVIDER') ?? 'nvidia';
  if (provider !== 'nvidia') {
    // The mirror only speaks the NVIDIA wire format. Failing loudly is the only correct
    // behaviour: embedding with the wrong model writes vectors nothing else can compare.
    throw new Error(
      `EMBEDDING_PROVIDER is "${provider}", but this function only implements the nvidia ` +
        'adapter. Add the provider here, or set EMBEDDING_PROVIDER=nvidia.',
    );
  }

  const dimensions = Number.parseInt(optionalEnv('EMBEDDING_DIMENSIONS') ?? String(DEFAULT_EMBEDDING_DIMENSIONS), 10);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('EMBEDDING_DIMENSIONS must be a positive integer.');
  }

  return {
    apiKey: requireEnv('NVIDIA_API_KEY'),
    baseUrl: optionalEnv('NVIDIA_BASE_URL') ?? DEFAULT_NVIDIA_BASE_URL,
    model: optionalEnv('EMBEDDING_MODEL') ?? DEFAULT_EMBEDDING_MODEL,
    dimensions,
  };
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

/** Reads the JSON body, rejecting a non-object with a 400. */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new BadRequestError('Request body must be JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/** Narrows the body to mode 1. */
function asDocumentRequest(body: Record<string, unknown>): WireDocumentRequest {
  if (typeof body.documentId !== 'string' || body.documentId.trim() === '') {
    throw new BadRequestError('Expected a non-empty string `documentId`.');
  }
  return { documentId: body.documentId.trim() };
}

/** Narrows the body to mode 2. */
function asTextsRequest(body: Record<string, unknown>): WireTextsRequest {
  const { texts, inputType, model } = body;
  if (!Array.isArray(texts) || !texts.every((text) => typeof text === 'string')) {
    throw new BadRequestError('Expected `texts` to be an array of strings.');
  }
  if (inputType !== 'query' && inputType !== 'passage') {
    throw new BadRequestError("Expected `inputType` to be 'query' or 'passage'.");
  }
  if (model !== undefined && typeof model !== 'string') {
    throw new BadRequestError('Expected `model` to be a string when present.');
  }
  return { texts: texts as string[], inputType, model: model as string | undefined };
}

// ---------------------------------------------------------------------------
// Mode handlers
// ---------------------------------------------------------------------------

/** Mode 2: the documented pure utility. Service role only; touches no table. */
async function handleTexts(
  body: Record<string, unknown>,
  claims: CallerClaims,
  requestId: string,
): Promise<Response> {
  if (claims.role !== 'service_role') {
    return jsonResponse(
      { function: FUNCTION_NAME, error: 'The texts mode is available to the service role only.' },
      403,
      requestId,
    );
  }

  const { texts, inputType, model } = asTextsRequest(body);
  const config = resolveEmbeddingConfig();
  const vectors = await embedTexts(texts, inputType, { ...config, model: model ?? config.model });

  return jsonResponse(
    { function: FUNCTION_NAME, model: model ?? config.model, dimensions: config.dimensions, vectors },
    200,
    requestId,
  );
}

/** Mode 1: chunk + embed one document and upsert its chunks. */
async function handleDocument(
  body: Record<string, unknown>,
  claims: CallerClaims,
  req: Request,
  requestId: string,
): Promise<Response> {
  const { documentId } = asDocumentRequest(body);
  const serviceClient = createServiceClient();

  // The document row is the authority for `user_id`; the request body never supplies it.
  const { data: document, error: readError } = await serviceClient
    .from('documents')
    .select('id, user_id, extracted_text, extraction_status, deleted_at')
    .eq('id', documentId)
    .maybeSingle<{
      id: string;
      user_id: string;
      extracted_text: string | null;
      extraction_status: string;
      deleted_at: string | null;
    }>();

  if (readError !== null) {
    throw new Error(`Failed to load document ${documentId}: ${readError.message}`);
  }
  if (document === null) {
    return jsonResponse({ function: FUNCTION_NAME, error: `No document ${documentId}.` }, 404, requestId);
  }

  // A user token may only embed its owner's document. The service-role dispatch token is the
  // trusted background caller and is taken at its word, with the row supplying `user_id`.
  let userId = document.user_id;
  if (claims.role !== 'service_role') {
    const userClient = createUserClient(req);
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError !== null || auth.user === null) {
      return jsonResponse({ function: FUNCTION_NAME, error: 'Invalid session.' }, 401, requestId);
    }
    if (auth.user.id !== document.user_id) {
      return jsonResponse(
        { function: FUNCTION_NAME, error: 'That document belongs to another user.' },
        403,
        requestId,
      );
    }
    userId = auth.user.id;
  }

  if (document.extraction_status !== 'succeeded' || document.extracted_text === null) {
    // Not an error: a document can be queued before extraction lands. Reported as 200 so a
    // retrying dispatcher does not treat it as a failure.
    return jsonResponse(
      {
        function: FUNCTION_NAME,
        documentId,
        chunksCreated: 0,
        skipped: `extraction_status=${document.extraction_status}`,
      },
      200,
      requestId,
    );
  }

  const chunks = chunkDocument(document.extracted_text);
  if (chunks.length === 0) {
    return jsonResponse(
      { function: FUNCTION_NAME, documentId, chunksCreated: 0, skipped: 'no_text' },
      200,
      requestId,
    );
  }

  const config = resolveEmbeddingConfig();
  console.log(
    `[${FUNCTION_NAME}] requestId=${requestId} documentId=${documentId} model=${config.model} ` +
      `dims=${config.dimensions} chunks=${chunks.length} role=${claims.role}`,
  );

  const vectors = await embedTexts(
    chunks.map((chunk) => chunk.text),
    'passage',
    config,
  );

  const rows = chunks.map((chunk, ordinal) => {
    const vector = vectors[ordinal];
    if (vector === undefined) {
      throw new Error(`Missing embedding for chunk ${ordinal} of document ${documentId}.`);
    }
    return {
      document_id: documentId,
      user_id: userId,
      ordinal,
      text: chunk.text,
      token_count: estimateTokens(chunk.text),
      heading_path: chunk.headingPath,
      strategy: CHUNKING_STRATEGY,
      content_hash: contentHash(chunk.text),
      // Vector and model stamp travel in the same statement, so no row is ever read without
      // knowing which model produced its vector (ADR-004).
      embedding: toVectorLiteral(vector),
      embedding_model: config.model,
    };
  });

  for (let start = 0; start < rows.length; start += CHUNK_WRITE_BATCH_SIZE) {
    const batch = rows.slice(start, start + CHUNK_WRITE_BATCH_SIZE);
    // Idempotent on the `(document_id, ordinal)` unique key: re-running replaces the document's
    // chunks instead of duplicating them. Re-embedding is therefore safe to retry.
    const { error: writeError } = await serviceClient
      .from('document_chunks')
      .upsert(batch, { onConflict: 'document_id,ordinal' });
    if (writeError !== null) {
      throw new Error(`Failed to write chunks for document ${documentId}: ${writeError.message}`);
    }
  }

  return jsonResponse(
    {
      function: FUNCTION_NAME,
      documentId,
      chunksCreated: rows.length,
      model: config.model,
      dimensions: config.dimensions,
    },
    200,
    requestId,
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  // One id per invocation: logged here and echoed to the client. This is how a report such as
  // "documents stopped getting searchable" is matched to a log line.
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
    const body = await readBody(req);
    const claims = readClaims(req);

    // The two modes are told apart by shape, and `documentId` wins if both are somehow present:
    // a body carrying a document id is asking for the write path, not for vectors.
    return typeof body.documentId === 'string'
      ? await handleDocument(body, claims, req, requestId)
      : await handleTexts(body, claims, requestId);
  } catch (error) {
    const status = error instanceof BadRequestError ? 400 : 500;
    console.error(`[${FUNCTION_NAME}] requestId=${requestId} failed (status=${status}):`, error);
    return jsonResponse({ function: FUNCTION_NAME, error: errorMessage(error) }, status, requestId);
  }
});
