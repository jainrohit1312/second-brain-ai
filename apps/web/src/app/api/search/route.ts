import { NextResponse } from 'next/server';

import { searchDocumentsHybrid } from '@/lib/queries';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/** Hits returned per query. Small on purpose: this is a keyword lookup, not a result browser. */
const MAX_RESULTS = 20;

/**
 * `GET /api/search?q=` — hybrid ranked search over the caller's documents.
 *
 * A route handler rather than a Server Action because the search box is a read that the client
 * issues on submit, and because the same retrieval call is what the chat route needs next.
 *
 * Retrieval is the vector leg over `document_chunks` fused with the full-text leg
 * (`search_documents_hybrid`). The typist's own words are handed to both legs — this is keyword
 * entry by contract, so the stopword-stripping `toSearchQuery` is *not* applied here; a
 * deliberate word must not be dropped. When the embedding provider is unavailable the query
 * degrades to full-text alone and still answers.
 *
 * The session is read from the request cookies, so the query runs under the caller's identity and
 * Row Level Security scopes it. Middleware refreshes the session before this handler runs, but the
 * check is repeated here because a route handler is also reachable by a direct request.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const query = (new URL(request.url).searchParams.get('q') ?? '').trim();

  // An empty query is not an error: it is what the box looks like before anything is typed.
  if (query === '') {
    return NextResponse.json({ query, results: [] });
  }

  try {
    const results = await searchDocumentsHybrid(supabase, user.id, query, { limit: MAX_RESULTS });
    return NextResponse.json({ query, results });
  } catch (error) {
    // Surfaced as JSON rather than allowed to bubble: the most likely cause is a retrieval RPC
    // that has not been pushed to this database yet, and a message saying so is worth more to
    // the reader than Next's HTML error page.
    console.error('GET /api/search failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed.' },
      { status: 500 },
    );
  }
}
