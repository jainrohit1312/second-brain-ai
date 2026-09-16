import { createLlmProvider } from '@second-brain/providers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { searchDocumentsHybrid, toSearchQuery, type SearchHit } from '@/lib/queries';
import { createServerSupabaseClient } from '@/lib/supabase-server';

import type { Citation } from '@second-brain/shared';

/**
 * Documents pulled into the prompt per question, and the character budget each one gets.
 *
 * Both are cost control: the context window is a per-token expense, and five documents at 3000
 * characters is roughly a third of `deepseek-chat`'s 64k window including the answer.
 */
const RETRIEVAL_LIMIT = 5;
const DOCUMENT_CHAR_BUDGET = 3000;

/**
 * Hits below this score are dropped. A weak match is worse than no match: it invites the model
 * to answer from loosely related text and cite it.
 *
 * The value is read on two different scales, deliberately. On the full-text leg it is compared
 * against the RPC's own `ts_rank_cd`, which normalization 32 maps onto `[0, 1)` — a genuine
 * weak-match floor. The hybrid RPC compares the same argument against its *fused* RRF score,
 * where each candidate list is only `3 * RETRIEVAL_LIMIT` deep and therefore cannot score below
 * `1/75`; there the argument is inert and the candidate depth is what bounds the result set.
 */
const MIN_RANK = 0.01;

/** Upper bound on the generated answer, in tokens. */
const MAX_ANSWER_TOKENS = 800;

/**
 * Sampling temperature. Low but not zero: this is synthesis, not classification, and a completely
 * greedy decode on a context-heavy prompt is the setting most prone to looping.
 */
const TEMPERATURE = 0.2;

/**
 * Interactive budget. The provider defaults (30s per attempt, 3 retries) are sized for a background
 * worker, where a two-minute call is free; here it would look like a hung page.
 */
const REQUEST_TIMEOUT_MS = 20_000;
const REQUEST_MAX_RETRIES = 1;

/** Modes the chat route can answer. The rest of `ChatMode` lands in phase 1c-2. */
const ANSWERING_MODES = ['recall', 'ask'] as const;

/** Request body of `POST /api/chat`. */
const chatRequestSchema = z.object({
  question: z.string().trim().min(1),
  mode: z.string().trim().min(1).default('recall'),
});

const SYSTEM_PROMPT =
  "You are a personal AI assistant answering questions about the user's own browsing and reading " +
  'history. Answer ONLY from the provided context. If the context does not contain the answer, say ' +
  'so explicitly. Cite sources by their number [1], [2], etc.';

/**
 * Resolves the DeepSeek credential and endpoint.
 *
 * Read from `process.env` inside the handler rather than at module scope so that a missing key is a
 * per-request 500 with a message naming the variable, instead of a build-time failure that takes
 * the whole route down. These are server-only variables and must never be renamed with a
 * `NEXT_PUBLIC_` prefix: that prefix is inlined into the browser bundle.
 */
function resolveDeepSeekConfig():
  { ok: true; apiKey: string; baseUrl: string; model: string } | { ok: false; message: string } {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (apiKey === undefined || apiKey === '') {
    return {
      ok: false,
      message:
        'DEEPSEEK_API_KEY is not set. Add it to apps/web/.env.local (or the repo-root .env) and restart the dev server.',
    };
  }

  return {
    ok: true,
    apiKey,
    // Defaults match DEEPSEEK_LLM_DEFAULTS in @second-brain/providers.
    baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() ?? 'https://api.deepseek.com/v1',
    model: process.env.DEEPSEEK_MODEL?.trim() ?? 'deepseek-chat',
  };
}

/** Formats the retrieved documents as the numbered context block the system prompt refers to. */
function buildUserPrompt(question: string, hits: SearchHit[]): string {
  const blocks = hits.map((hit, index) => {
    // The RPC caps each document's text in SQL; this is the second, tighter cap, so that five
    // long documents cannot push the answer out of the model's context window.
    const text =
      hit.text.length > 0 ? hit.text.slice(0, DOCUMENT_CHAR_BUDGET) : '(no extractable text)';

    return `[${index + 1}] Title: ${hit.title}\nURL: ${hit.url ?? 'none'}\nText: ${text}`;
  });

  return `Context:\n${blocks.join('\n\n')}\n\nQuestion: ${question}`;
}

/**
 * Turns ranked hits into citations.
 *
 * The shape is `@second-brain/shared`'s `Citation`, which is what `SourceCitation` renders: the
 * spec's `{ index, title, url, capturedAt }` is a subset of it, with `capturedAt` spelled
 * `occurredAt` and `documentId`/`snippet` added because the popover needs a target and a quote.
 */
function toCitations(hits: SearchHit[]): Citation[] {
  return hits.map((hit, index) => ({
    index: index + 1,
    documentId: hit.id,
    memoryId: null,
    title: hit.title,
    url: hit.url,
    occurredAt: hit.capturedAt,
    snippet: hit.snippet,
  }));
}

/**
 * `POST /api/chat` — retrieve, then answer with citations.
 *
 * The retrieval leg is hybrid (vector + full-text, fused by reciprocal rank fusion) narrowed to
 * the five best matches; it falls back to full-text alone when the embedding provider is
 * unavailable. The answer leg is DeepSeek through the `LlmProvider` interface, so the credential
 * lives only in this process and the browser never sees it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected a JSON body of { question: string, mode?: string }.' },
      { status: 400 },
    );
  }

  const { question, mode } = parsed.data;

  if (!ANSWERING_MODES.includes(mode as (typeof ANSWERING_MODES)[number])) {
    // 501 rather than 400: the mode is real and named in the UI, it just has no implementation yet.
    return NextResponse.json(
      { error: `The '${mode}' mode is coming in phase 1c-2.` },
      { status: 501 },
    );
  }

  let hits: SearchHit[];
  try {
    // Hybrid retrieval: the natural-language question is embedded as a `query`, while the RPC's
    // text leg gets `toSearchQuery(question)` rather than the question itself, because
    // `websearch_to_tsquery` reads unquoted words as AND and a sentence interrogative enough to
    // pass every content word through would also demand every stopword be present in the
    // document. The answer itself is still built from the untouched question.
    //
    // A provider outage degrades to full-text-only inside `searchDocumentsHybrid` instead of
    // failing here, so this catch now only sees a genuine retrieval error.
    hits = await searchDocumentsHybrid(supabase, user.id, question, {
      limit: RETRIEVAL_LIMIT,
      minRank: MIN_RANK,
      ftsQuery: toSearchQuery(question),
    });
  } catch (error) {
    console.error('POST /api/chat retrieval failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Retrieval failed.' },
      { status: 500 },
    );
  }

  // No usable context means no question for the model to answer. Spending a completion here would
  // only produce the same sentence the prompt already tells it to write.
  if (hits.length === 0) {
    return NextResponse.json({
      answer:
        'Nothing in your captured documents matches that question yet. Capture a page about it with the browser extension, then ask again.',
      citations: [],
    });
  }

  const config = resolveDeepSeekConfig();
  if (!config.ok) {
    return NextResponse.json({ error: config.message }, { status: 500 });
  }

  const provider = createLlmProvider('deepseek', {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxRetries: REQUEST_MAX_RETRIES,
  });

  try {
    const completion = await provider.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(question, hits) }],
      temperature: TEMPERATURE,
      maxTokens: MAX_ANSWER_TOKENS,
    });

    // TODO(phase-1c-2): persist answers and their citations, and attribute cost with real prices
    // instead of logging a token count the process forgets.
    console.log('POST /api/chat', {
      model: completion.model,
      retrieved: hits.length,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      totalTokens: completion.usage.totalTokens,
      latencyMs: completion.latencyMs,
      finishReason: completion.finishReason,
    });

    return NextResponse.json({
      answer: completion.content,
      citations: toCitations(hits),
      model: completion.model,
      usage: completion.usage,
    });
  } catch (error) {
    console.error('POST /api/chat completion failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The answer provider failed.' },
      { status: 502 },
    );
  }
}
