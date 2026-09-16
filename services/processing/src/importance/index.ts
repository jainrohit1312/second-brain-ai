/**
 * The importance engine: the composition of signal extraction, rule weighting and scoring.
 *
 * Callers — the ingestion edge (server-side re-scoring) and the clients (cheap pre-filter) —
 * see only `score` and `scoreBatch`. The engine is stateless apart from its resolved rule
 * set, so one instance can be shared across requests and across devices.
 */
import {
  IMPORTANCE_ENGINE_VERSION,
  type ActivityEvent,
  type ActivityHistoryWindow,
  type ImportanceScore,
} from '@second-brain/shared';

import { DEFAULT_RULES, mergeRules, type ScoringRule } from './rules';

import type { ImportanceEngineConfig } from '../types';

/**
 * Version stamped into every `ImportanceScore.version`.
 *
 * Re-exported from the shared constant rather than re-declared so that the client, the
 * server and the database agree on one version string. Bump it whenever extraction,
 * normalization or the default weights change: persisted scores carry the version that
 * produced them, which is what turns "re-score everything" into an auditable operation
 * instead of a silent rewrite of the record.
 */
export const ENGINE_VERSION = IMPORTANCE_ENGINE_VERSION;

/**
 * Scores activity events.
 *
 * Implementations must be deterministic for a fixed `(event, history, rule set, version)`
 * tuple and must not mutate their inputs.
 */
export interface ImportanceEngine {
  /** Version stamped onto every score this engine produces. See `ENGINE_VERSION`. */
  readonly version: string;

  /**
   * Scores one event against the history window the caller supplies.
   *
   * @param event - The event to score. Unchanged by the call.
   * @param history - History the client cannot provide. See `ActivityHistoryWindow`.
   */
  score(event: ActivityEvent, history: ActivityHistoryWindow): Promise<ImportanceScore>;

  /**
   * Scores a batch that shares one history window.
   *
   * One window for the whole batch is a deliberate constraint, not an optimisation: it
   * keeps a batch's scores comparable with each other, and it is why a batch must come from
   * a single device. Result order matches input order.
   *
   * @param events - Events to score, in the order the results are expected.
   * @param history - The window loaded once for this batch.
   */
  scoreBatch(
    events: readonly ActivityEvent[],
    history: ActivityHistoryWindow,
  ): Promise<ImportanceScore[]>;
}

/**
 * Builds an engine.
 *
 * The rule set is resolved once, at construction: `mergeRules(DEFAULT_RULES, config.overrides)`.
 * Scoring afterwards does no rule resolution at all, so a settings change takes effect on
 * the next engine (i.e. the next request), never mid-batch.
 *
 * @param config - Rule overrides, version override, and the clock used for `scoredAt`.
 */
export function createImportanceEngine(_config: ImportanceEngineConfig = {}): ImportanceEngine {
  // TODO(phase-1): resolve rules with `mergeRules`, default the clock to the shared
  // `nowIso`, default the version to `ENGINE_VERSION`, then implement `score` as
  // `extractSignals` followed by `computeScore`, and `scoreBatch` over `Promise.all`.
  throw new Error('Not implemented: createImportanceEngine');
}

export { DEFAULT_RULES, mergeRules };
export type { ScoringRule };
