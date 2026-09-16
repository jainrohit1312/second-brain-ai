/**
 * The configurable importance rule set.
 *
 * A rule binds a set of signals to a weight. The score is the weighted sum of the
 * normalized signals (see `./score`), so this file is the whole tuning surface: changing
 * how much dwell time matters is a weight edit here, not a code change anywhere else.
 *
 * This is also the table the web app's Settings page exposes, which shapes two decisions:
 *
 * - `ImportanceRule` comes from `@second-brain/shared` and is extended locally with an
 *   optional `condition`. `condition` is a function and therefore **not persistable**, so
 *   the user-editable surface (`ImportanceRuleOverride`) intentionally carries only
 *   `weight` and `enabled`.
 * - Overrides are applied over these defaults rather than replacing them, so shipping a
 *   new default rule does not silently discard a user's tuning of the rules they did edit.
 */
import type { ImportanceRuleOverride } from '../types';
import type { ImportanceRule, ImportanceSignals } from '@second-brain/shared';

/**
 * A predicate a rule must satisfy to contribute.
 *
 * Pure and synchronous by construction: it sees only the signal vector, so it cannot
 * consult a clock, a database, or the network. A false condition removes the rule from
 * both the weighted sum and the `contributions` list.
 */
export type RuleCondition = (signals: ImportanceSignals) => boolean;

/**
 * A scoring rule: the shared rule shape plus an applicability predicate.
 *
 * `signals` may hold more than one key; `computeScore` spreads the rule's weight evenly
 * across them so that the contribution list stays one entry per signal.
 */
export type ScoringRule = ImportanceRule & { condition?: RuleCondition };

/** Rule id of the exclusion veto. Referenced by `sumScoringWeights` and by tests. */
export const APP_EXCLUDED_RULE_ID = 'rule.app-excluded';

/**
 * The sum that the enabled, positive rules are expected to reach.
 *
 * This is an invariant of the default set, not an enforced constraint: a user is allowed to
 * tune weights into a sum below 1 (making the corpus generally less important), and
 * `bandFor` thresholds are absolute, not percentiles.
 */
export const REQUIRED_WEIGHT_SUM = 1;

/**
 * The default rule set — one rule per key of `ImportanceSignals`.
 *
 * Weights of the 12 positive rules sum to `REQUIRED_WEIGHT_SUM`. `rule.app-excluded` is
 * deliberately excluded from that sum: its weight is `-1`, which is what makes the veto
 * exact. With every positive weight totalling 1, a normalized `appIsExcluded` of 1 pushes
 * the sum to `0` before clamping, so an excluded app cannot score anything but `noise`.
 *
 * No rule declares a `condition`. Every extractor already reports `0` for signals that do
 * not apply to an event's type (a bookmark has no dwell time), so a condition would be
 * redundant here. The field exists for rules that should not apply even when their signal
 * *is* present, such as a future "only credit weekday-morning reading" rule.
 */
export const DEFAULT_RULES: readonly ScoringRule[] = [
  {
    id: 'rule.dwell',
    description: 'Time actively spent on the page. Scroll-and-leave scores near zero.',
    signals: ['dwellSeconds'],
    weight: 0.16,
    enabled: true,
  },
  {
    id: 'rule.word-count',
    description: 'Length of the readable body. Long-form reading is usually deliberate.',
    signals: ['wordCount'],
    weight: 0.08,
    enabled: true,
  },
  {
    id: 'rule.topic-novelty',
    description: 'Dissimilarity from everything already known. The strongest content signal.',
    signals: ['topicNovelty'],
    weight: 0.13,
    enabled: true,
  },
  {
    id: 'rule.bookmark',
    description: 'Explicitly bookmarked. Explicit intent, never treated as noise.',
    signals: ['isBookmarked'],
    weight: 0.12,
    enabled: true,
  },
  {
    id: 'rule.copy',
    description: 'A passage was copied to the clipboard. Stronger than a highlight.',
    signals: ['hasCopy'],
    weight: 0.09,
    enabled: true,
  },
  {
    id: 'rule.selection',
    description: 'A passage was highlighted. A weak but deliberate signal.',
    signals: ['hasSelection'],
    weight: 0.07,
    enabled: true,
  },
  {
    id: 'rule.download',
    description: 'A file was downloaded. Explicit intent to keep the artifact.',
    signals: ['isDownloaded'],
    weight: 0.07,
    enabled: true,
  },
  {
    id: 'rule.revisit',
    description:
      'The URL was visited before. People return to what matters and forget what does not.',
    signals: ['revisitCount'],
    weight: 0.06,
    enabled: true,
  },
  {
    id: 'rule.scroll-depth',
    description: 'How far down the page the reader actually got.',
    signals: ['scrollDepthPct'],
    weight: 0.06,
    enabled: true,
  },
  {
    id: 'rule.youtube-progress',
    description:
      'Fraction of a video watched. Meaningless for non-video content, which reports zero.',
    signals: ['youtubeWatchedPct'],
    weight: 0.06,
    enabled: true,
  },
  {
    id: 'rule.unique-domain',
    description: 'First visit to this domain. Novel sources are worth more than habitual ones.',
    signals: ['isUniqueDomain'],
    weight: 0.05,
    enabled: true,
  },
  {
    id: 'rule.working-hours',
    description:
      'Captured inside the working-hours window, where reading is more likely to be work.',
    signals: ['isWorkingHours'],
    weight: 0.05,
    enabled: true,
  },
  {
    id: 'rule.app-excluded',
    description:
      'Veto: an excluded app or domain forces the score to zero. Not a tuning knob — see the exclusion invariant.',
    signals: ['appIsExcluded'],
    weight: -1,
    enabled: true,
  },
];

/**
 * Applies user overrides over a base rule set.
 *
 * Pure. Rules are matched by id, and an override for an unknown id is ignored rather than
 * creating a rule: a new rule needs a signal list and a description, which the settings
 * surface does not carry. Order is preserved and the input arrays are never mutated.
 *
 * @param base - Rule set to start from, normally `DEFAULT_RULES`.
 * @param overrides - Values changed in Settings. An absent field keeps the base value.
 */
export function mergeRules(
  base: readonly ScoringRule[],
  overrides: readonly ImportanceRuleOverride[],
): ScoringRule[] {
  if (overrides.length === 0) return [...base];

  const overridesById = new Map(overrides.map((override) => [override.id, override]));

  return base.map((rule) => {
    const override = overridesById.get(rule.id);
    if (override === undefined) return rule;
    return {
      ...rule,
      weight: override.weight ?? rule.weight,
      enabled: override.enabled ?? rule.enabled,
    };
  });
}

/**
 * Sums the weights the enabled, positive rules contribute.
 *
 * Pure. The veto rule is excluded because its negative weight is not part of the total the
 * defaults are designed around. Used by the engine's startup check and by tests asserting
 * the `REQUIRED_WEIGHT_SUM` invariant; the comparison should allow floating-point
 * tolerance, since summing decimal weights is not exact.
 */
export function sumScoringWeights(rules: readonly ScoringRule[]): number {
  return rules.reduce(
    (total, rule) => (rule.enabled && rule.weight > 0 ? total + rule.weight : total),
    0,
  );
}
