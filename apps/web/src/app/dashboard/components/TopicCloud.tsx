import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatPercent } from '@/lib/utils';

import type { Topic } from '@second-brain/shared';

export interface TopicCloudProps {
  topics: Topic[];
  className?: string;
}

const MIN_FONT_PX = 14;
const MAX_FONT_PX = 30;
const MIN_OPACITY = 0.6;

/**
 * Weighted tag cloud. Font size and opacity are driven by `Topic.documentCount` relative to the
 * lightest and heaviest topics in the set, so the cloud re-scales with the selected date range.
 * Server-renderable: it holds no state.
 */
export function TopicCloud({ topics, className }: TopicCloudProps) {
  const counts = topics.map((topic) => topic.documentCount);
  const minCount = counts.length > 0 ? Math.min(...counts) : 0;
  const maxCount = counts.length > 0 ? Math.max(...counts) : 0;
  const totalCount = counts.reduce((total, count) => total + count, 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Topics</CardTitle>
        <CardDescription>
          {topics.length > 0
            ? `${topics.length} topics, sized by document count.`
            : 'No topics classified yet.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        {topics.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Capture a few pages and the classifier will start grouping them.
          </p>
        ) : (
          topics.map((topic) => {
            const weight = normalize(topic.documentCount, minCount, maxCount);
            const share = totalCount > 0 ? topic.documentCount / totalCount : 0;
            return (
              // TODO(phase-2): link each topic to a filtered dashboard (`/dashboard?topic=<slug>`).
              <span
                key={topic.id}
                title={`${topic.label} · ${topic.documentCount} documents (${formatPercent(share)}) · ${topic.memoryCount} memories`}
                className="font-medium leading-tight text-foreground"
                style={{
                  fontSize: `${(MIN_FONT_PX + weight * (MAX_FONT_PX - MIN_FONT_PX)).toFixed(1)}px`,
                  opacity: Number((MIN_OPACITY + weight * (1 - MIN_OPACITY)).toFixed(2)),
                }}
              >
                {topic.label}
              </span>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

/** Maps a count onto 0..1 between `min` and `max`; flat sets collapse to 0.5. */
function normalize(count: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return Math.min(1, Math.max(0, (count - min) / (max - min)));
}
