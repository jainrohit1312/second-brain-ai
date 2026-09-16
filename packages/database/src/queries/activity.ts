import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types/database';
import type { ActivityEvent, ActivityEventType, DeviceId } from '@second-brain/shared';

/** Row shape of `activity_events`. */
export type ActivityEventRow = Database['second_brain']['Tables']['activity_events']['Row'];

/**
 * A time window as an ISO-8601 UTC pair. `from` is inclusive, `to` is exclusive,
 * so adjacent windows never double-count an event on the boundary.
 */
export interface TimeRange {
  from: string;
  to: string;
}

/** Options for {@link ActivityQueries.listRecent}. */
export interface ListRecentActivityOptions {
  /** Hard cap on returned rows; always set it, the table only grows. */
  limit: number;
  from?: string;
  to?: string;
  types?: ActivityEventType[];
  deviceIds?: DeviceId[];
}

/**
 * One row of the activity dashboard's time-by-topic breakdown. This is the DTO
 * the dashboard consumes directly; the fields are named for the chart, not for
 * the table they come from.
 */
export interface TimeByTopic {
  topicId: string;
  topicSlug: string;
  label: string;
  /** Dwell time attributed to the topic, in seconds, summed over the range. */
  totalSeconds: number;
  eventCount: number;
  lastOccurredAt: string | null;
}

/** One row of the per-event-type breakdown behind the dashboard's source chart. */
export interface ActivityTypeCount {
  type: ActivityEventType;
  eventCount: number;
  totalSeconds: number;
}

/**
 * Data access for `activity_events` — the write-heavy table everything else is
 * derived from. Ingestion writes here; processing and the dashboard read.
 */
export interface ActivityQueries {
  /**
   * Inserts a batch in one statement, mapping the camelCase event variants from
   * `@second-brain/shared` onto the wide snake_case table (only the columns the
   * variant populates are set). Returns the rows as stored.
   *
   * Intended to be preceded by `getByDedupeKeys`, so that a conflict is an
   * unexpected state rather than normal traffic. Duplicates are the caller's to
   * count for `ActivityBatchResult`.
   */
  insertEvents(events: ActivityEvent[]): Promise<ActivityEventRow[]>;

  /**
   * Inserts one event and returns the stored row. Convenience over
   * `insertEvents`, for single-event paths and tests.
   */
  insertEvent(event: ActivityEvent): Promise<ActivityEventRow>;

  /**
   * The dedup check: returns the subset of `keys` that already exists for this
   * device. Callers subtract it from a batch to get `duplicates` and pass only
   * the remainder to `insertEvents`.
   *
   * Expected to use the unique index on `(device_id, dedupe_key)`.
   */
  getByDedupeKeys(deviceId: DeviceId, keys: string[]): Promise<string[]>;

  /**
   * Most recent events for a user, newest first, with the optional filters
   * applied. Expected to use the index on `(user_id, occurred_at desc)`;
   * `limit` is required so a dashboard request cannot scan the whole table.
   */
  listRecent(userId: string, opts: ListRecentActivityOptions): Promise<ActivityEventRow[]>;

  /**
   * Sums dwell time per topic over a range, for the dashboard's time-by-topic
   * chart. Attribution is indirect: events join to `documents` on the URL and
   * `documents` joins to `document_topics`, so events whose URL was never
   * captured as a document are absent from the result rather than bucketed as
   * "unknown".
   *
   * Expected to use `(user_id, occurred_at)`. This is the heaviest read in the
   * dashboard and the first candidate to become an RPC or a materialized view.
   */
  aggregateTimeByTopic(userId: string, range: TimeRange): Promise<TimeByTopic[]>;

  /**
   * Event counts and total seconds per event type over a range, largest first.
   * Expected to use `(user_id, occurred_at)`.
   */
  countBySource(userId: string, range: TimeRange): Promise<ActivityTypeCount[]>;

  /**
   * Retention: deletes events that occurred before `cutoff` and returns how many
   * rows went. Deletes in bounded batches so the sweep does not hold a long
   * transaction, and expects `(occurred_at)` to keep each batch cheap.
   */
  deleteOlderThan(cutoff: string): Promise<number>;
}

/**
 * Builds the `activity_events` repository. The client determines the security
 * model: a service-role client writes any user's events, a user-scoped client
 * only passes RLS for its own.
 */
export function createActivityQueries(_client: TypedSupabaseClient): ActivityQueries {
  return {
    async insertEvents(_events: ActivityEvent[]): Promise<ActivityEventRow[]> {
      // TODO(phase-2): map each variant onto its columns and issue one
      // multi-row `.insert(rows).select()`, letting a unique violation on
      // `(user_id, dedupe_key)` surface as a duplicate rather than being ignored.
      throw new Error('Not implemented: ActivityQueries.insertEvents');
    },

    async insertEvent(_event: ActivityEvent): Promise<ActivityEventRow> {
      // TODO(phase-2): single-row insert, sharing the variant mapper with `insertEvents`.
      throw new Error('Not implemented: ActivityQueries.insertEvent');
    },

    async getByDedupeKeys(_deviceId: DeviceId, _keys: string[]): Promise<string[]> {
      // TODO(phase-2): `select('dedupe_key').eq('device_id', id).in('dedupe_key', keys)`
      // in chunks small enough to stay inside the URL length limit.
      throw new Error('Not implemented: ActivityQueries.getByDedupeKeys');
    },

    async listRecent(
      _userId: string,
      _opts: ListRecentActivityOptions,
    ): Promise<ActivityEventRow[]> {
      // TODO(phase-2): filtered `select()`, `order('occurred_at', { ascending: false })`,
      // `.limit(opts.limit)`.
      throw new Error('Not implemented: ActivityQueries.listRecent');
    },

    async aggregateTimeByTopic(_userId: string, _range: TimeRange): Promise<TimeByTopic[]> {
      // TODO(phase-2): sum the dwell column per event type (duration_ms,
      // watched_seconds, duration_seconds), join through documents to
      // document_topics, and group by topic. Escalate to an RPC if the planner
      // will not keep it on `(user_id, occurred_at)`.
      throw new Error('Not implemented: ActivityQueries.aggregateTimeByTopic');
    },

    async countBySource(_userId: string, _range: TimeRange): Promise<ActivityTypeCount[]> {
      // TODO(phase-2): group by `type` over the range, ordered by event count.
      throw new Error('Not implemented: ActivityQueries.countBySource');
    },

    async deleteOlderThan(_cutoff: string): Promise<number> {
      // TODO(phase-2): batched `delete().lt('occurred_at', cutoff)` loop, returning
      // the total number of rows removed.
      throw new Error('Not implemented: ActivityQueries.deleteOlderThan');
    },
  };
}
