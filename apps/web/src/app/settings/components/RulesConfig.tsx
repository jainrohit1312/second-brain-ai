'use client';

import {
  IMPORTANCE_BAND_THRESHOLDS,
  type ImportanceBand,
  type ImportanceSignals,
} from '@second-brain/shared';
import { useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

/** Every tunable importance signal; keys of `ImportanceSignals` are the contract. */
export type RuleSignal = keyof ImportanceSignals;

/**
 * One row of the scoring table. `weight` is the multiplier applied to the normalised 0..1 signal
 * value when the processor computes an `ImportanceScore`.
 */
export interface ImportanceRule {
  signal: RuleSignal;
  weight: number;
  enabled: boolean;
}

/** Band order, from the noisiest to the most important score. */
const BAND_ORDER: readonly ImportanceBand[] = ['noise', 'low', 'normal', 'high', 'critical'];

/** Default cut-off below which an event is dropped before it reaches the sync queue. */
const DEFAULT_THRESHOLD = 0.25;

/**
 * TODO(phase-2): load these weights from the processing service (the rules are configurable per
 * user) instead of shipping them in the bundle.
 */
const PLACEHOLDER_RULES: ImportanceRule[] = [
  { signal: 'dwellSeconds', weight: 0.25, enabled: true },
  { signal: 'scrollDepthPct', weight: 0.15, enabled: true },
  { signal: 'revisitCount', weight: 0.2, enabled: true },
  { signal: 'wordCount', weight: 0.1, enabled: true },
  { signal: 'hasSelection', weight: 0.1, enabled: true },
  { signal: 'hasCopy', weight: 0.1, enabled: true },
  { signal: 'isBookmarked', weight: 0.15, enabled: true },
  { signal: 'isDownloaded', weight: 0.1, enabled: true },
  { signal: 'youtubeWatchedPct', weight: 0.15, enabled: true },
  { signal: 'isUniqueDomain', weight: 0.05, enabled: false },
  { signal: 'topicNovelty', weight: 0.1, enabled: false },
  { signal: 'isWorkingHours', weight: 0.05, enabled: false },
  { signal: 'appIsExcluded', weight: 0, enabled: false },
];

export interface RulesConfigProps {
  className?: string;
}

/**
 * Importance tuning: the minimum score an event must reach to be captured, plus the per-signal
 * weights behind that score. Edits are local state only — nothing is persisted yet.
 */
export function RulesConfig({ className }: RulesConfigProps) {
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [rules, setRules] = useState<ImportanceRule[]>(PLACEHOLDER_RULES);

  const band = bandForThreshold(threshold);
  const activeWeight = rules
    .filter((rule) => rule.enabled)
    .reduce((total, rule) => total + rule.weight, 0);

  const toggleRule = (signal: RuleSignal) => {
    // TODO(phase-2): PATCH the rule set and roll back on failure instead of mutating local state.
    setRules((previous) =>
      previous.map((rule) => (rule.signal === signal ? { ...rule, enabled: !rule.enabled } : rule)),
    );
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Importance rules</CardTitle>
        <CardDescription>
          Scores below the cut-off are dropped on the client, which is what keeps the sync queue
          small. {rules.length} signals, {activeWeight.toFixed(2)} combined weight enabled.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-foreground">Minimum importance score</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-sm tabular-nums text-foreground">
                {threshold.toFixed(2)}
              </span>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium capitalize text-primary">
                {band}
              </span>
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            aria-label="Minimum importance score"
            aria-valuetext={`${threshold.toFixed(2)}, ${band} band`}
            onChange={(event) => setThreshold(Number(event.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[hsl(var(--primary))]"
          />

          <p className="text-xs text-muted-foreground">
            Band floor for <span className="capitalize">{band}</span> is{' '}
            {bandFloor(band).toFixed(2)}. Events scoring between 0 and {threshold.toFixed(2)} are
            never queued or uploaded.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Signal
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Weight
                </th>
                <th scope="col" className="py-2 font-medium">
                  Enabled
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.signal} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">{rule.signal}</td>
                  <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                    {rule.weight.toFixed(2)}
                  </td>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      aria-label={`Enable ${rule.signal}`}
                      onChange={() => toggleRule(rule.signal)}
                      className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Returns the highest band whose threshold is at or below `value`, using the shared
 * `IMPORTANCE_BAND_THRESHOLDS` map (band → minimum score).
 */
function bandForThreshold(value: number): ImportanceBand {
  let band: ImportanceBand = 'noise';
  for (const candidate of BAND_ORDER) {
    const min = IMPORTANCE_BAND_THRESHOLDS[candidate];
    if (typeof min === 'number' && value >= min) band = candidate;
  }
  return band;
}

/** Minimum score that belongs to a band, read from the shared threshold map. */
function bandFloor(band: ImportanceBand): number {
  return IMPORTANCE_BAND_THRESHOLDS[band];
}
