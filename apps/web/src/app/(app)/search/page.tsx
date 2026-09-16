import { SearchPanel } from './components/SearchPanel';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Keyword search over everything you have captured.',
};

/**
 * Search route. Server component: it renders the heading and the client panel that owns the query
 * state. The read itself goes through `/api/search`, so the session — not the browser — is what the
 * query runs under.
 */
export default function SearchPage() {
  return (
    <main className="container flex max-w-3xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-1">
        <h1>Search</h1>
        <p className="text-sm text-muted-foreground">
          Keyword search over the extracted text of your documents, ranked by relevance.
        </p>
      </div>

      <SearchPanel />
    </main>
  );
}
