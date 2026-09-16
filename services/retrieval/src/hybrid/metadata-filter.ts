/**
 * Metadata filtering.
 *
 * ## Filters go inside the query
 *
 * The single most important decision in this file: `RetrievalQuery.filters` are translated
 * into predicates that the SQL RPCs apply **while searching**, not into a filter applied to
 * the results afterwards.
 *
 * The difference is not an optimisation, it is whether the system works. A nearest-neighbour
 * query returns the `topK` rows that are globally closest to the query vector; post-hoc
 * filtering then discards the ones that fail the filter, so a query filtered to `2026-03`
 * returns however few of the global top 40 happened to be in March — often none, even when
 * the corpus holds hundreds of March documents. Filtered inside the query, the index returns
 * the `topK` closest rows *among the March documents*, which is the question that was asked.
 * Post-hoc filtering does not narrow results, it destroys recall.
 *
 * ## Two representations in one place
 *
 * The same filters also have to run through the web app's supabase-js client, which speaks
 * PostgREST rather than SQL. Both translations are produced here, together, because two
 * translations of the same filter list that live in different files will eventually disagree
 * — and a disagreement between the SQL path and the client path is invisible until someone
 * compares two answers to the same question.
 *
 * ## Empty is not absent
 *
 * An explicitly empty array (`topicIds: []`) means "no topic", which selects nothing. An
 * absent filter means "any topic". Collapsing the first into the second turns a filter that
 * is meant to return nothing into a filter that returns everything, so `matchesNothing`
 * reports it explicitly and the caller must honour it.
 */
import type { FilterClause, FilterPredicate, PostgrestFilter, ScoredChunk } from '../types';
import type { RetrievalQuery } from '@second-brain/shared';

/**
 * Translates the shared filter shape into SQL predicates and their PostgREST equivalents.
 *
 * Pure. Column names are the ones the retrieval view exposes — a unified `topic_id`, `source`,
 * `kind`, `occurred_at` and `device_id` — not the physical column names of the underlying
 * tables; the projection belongs to `packages/database`. `occurred_at` is specifically a
 * projection: documents carry `captured_at` and memories carry `valid_from`, and the view
 * presents them as one axis so that a temporal filter means one thing.
 *
 * `from` and `to` are inclusive bounds, matching the shared `RetrievalQuery` documentation.
 *
 * @param filters - Filters from the query. Every field is optional and independent.
 */
export function buildFilterClause(filters: RetrievalQuery['filters']): FilterClause {
  const predicates: FilterPredicate[] = [];
  const postgrest: PostgrestFilter[] = [];
  let matchesNothing = false;

  const addIn = (column: string, values: readonly string[] | undefined): void => {
    if (values === undefined) return;
    if (values.length === 0) {
      matchesNothing = true;
      return;
    }
    predicates.push({ column, operator: 'in', value: values });
    postgrest.push({ method: 'in', column, value: values });
  };

  const addBound = (column: string, operator: '>=' | '<=', value: string | undefined): void => {
    if (value === undefined) return;
    predicates.push({ column, operator, value });
    postgrest.push({ method: operator === '>=' ? 'gte' : 'lte', column, value });
  };

  addIn('topic_id', filters.topicIds);
  addIn('source', filters.sourceTypes);
  addIn('kind', filters.kinds);
  addIn('device_id', filters.deviceIds);
  addBound('occurred_at', '>=', filters.from);
  addBound('occurred_at', '<=', filters.to);

  return { predicates, postgrest, matchesNothing };
}

/**
 * Applies a clause to rows in memory.
 *
 * **Test oracle only.** The production path pushes these predicates into the query, and using
 * this function to filter retrieved rows in production would undo the whole point of this
 * module: it is here so a test can assert that the SQL path and the in-memory path select the
 * same rows, and so the debug view can explain why a row the user expected was absent.
 *
 * A clause with `matchesNothing` returns an empty array regardless of the rows.
 *
 * @param rows - Candidates to filter.
 * @param clause - Predicates to apply, ANDed together.
 */
export function applyFilters(_rows: readonly ScoredChunk[], _clause: FilterClause): ScoredChunk[] {
  // TODO(phase-2): implement the in-memory equivalent of each predicate so tests can compare
  // it against the SQL path row for row.
  throw new Error('Not implemented: applyFilters');
}
