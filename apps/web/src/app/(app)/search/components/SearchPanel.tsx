'use client';

import { extractDomain } from '@second-brain/shared';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, SearchIcon } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatRelativeDay } from '@/lib/utils';

import type { SearchHit } from '@/lib/queries';

/** Response body of `GET /api/search`. */
interface SearchResponse {
  query: string;
  results: SearchHit[];
}

/**
 * Runs one search against the API route.
 *
 * The query string is passed through `URLSearchParams`, which percent-encodes it — the API route is
 * the only party that ever sees it as a value, and it binds it as a statement parameter.
 */
async function fetchSearch(query: string): Promise<SearchResponse> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const body = (await response.json()) as SearchResponse & { error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? `Search failed (${response.status}).`);
  }

  return body;
}

/**
 * Keyword search over captured documents.
 *
 * Client component: the box, the submitted term, and the result list are view state, and the read
 * happens through the API route so the query runs server-side under the session.
 *
 * `useQuery` (rather than a hand-rolled fetch effect) is what makes re-submitting the same term free
 * and gives the loading/error states without extra state variables.
 */
export function SearchPanel() {
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState('');

  const search = useQuery({
    queryKey: ['search', submitted],
    queryFn: () => fetchSearch(submitted),
    // Nothing has been searched for yet; the empty state below is the prompt instead.
    enabled: submitted !== '',
  });

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitted(draft.trim());
    },
    [draft],
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Search your captures</CardTitle>
          <CardDescription>
            Full-text search over extracted document text. Quotes match a phrase, `or` matches
            either term, and `-` excludes one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
            <Input
              type="search"
              name="q"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="vector databases"
              aria-label="Search documents"
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={draft.trim() === ''}>
              <SearchIcon className="h-4 w-4" aria-hidden="true" />
              Search
            </Button>
          </form>
        </CardContent>
      </Card>

      {submitted === '' ? (
        <p className="text-sm text-muted-foreground">
          Search runs over the text your captures extracted, ranked by relevance.
        </p>
      ) : (
        <Results
          query={submitted}
          hits={search.data?.results}
          isPending={search.isPending}
          error={search.error}
        />
      )}
    </div>
  );
}

/** Result list for one submitted query, including its loading, error, and empty states. */
function Results({
  query,
  hits,
  isPending,
  error,
}: {
  query: string;
  hits: SearchHit[] | undefined;
  isPending: boolean;
  error: unknown;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Results</CardTitle>
        <CardDescription>
          {isPending
            ? 'Searching…'
            : hits === undefined
              ? '—'
              : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'} for “${query}”.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error !== null && error !== undefined ? (
          <p role="alert" className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Search failed.'}
          </p>
        ) : isPending ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : hits === undefined || hits.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No matches for &lsquo;{query}&rsquo;.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {hits.map((hit) => (
              <li key={hit.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                {hit.url === null ? (
                  <span className="text-sm font-medium text-foreground">{hit.title}</span>
                ) : (
                  <a
                    href={hit.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    {hit.title}
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </a>
                )}

                <p className="text-xs text-muted-foreground">
                  {extractDomain(hit.url ?? '') ?? 'No source'}
                  {` · ${hit.wordCount.toLocaleString()} words`}
                  {` · captured ${formatRelativeDay(hit.capturedAt)}`}
                  {` · rank ${hit.rank.toFixed(3)}`}
                </p>

                <p className="text-sm leading-relaxed text-muted-foreground">{hit.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
