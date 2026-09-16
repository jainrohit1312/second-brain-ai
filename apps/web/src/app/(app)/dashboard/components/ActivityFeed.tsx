import { EVENT_TYPE_LABELS, extractDomain, type ActivityEventType } from '@second-brain/shared';
import {
  Bookmark,
  Copy,
  Download,
  Eye,
  MonitorPlay,
  MousePointerSquareDashed,
  NotebookPen,
  Search,
  Youtube,
  type LucideIcon,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn, formatRelativeDay } from '@/lib/utils';

import type { ActivityFeedItem } from '@/lib/queries';

export interface ActivityFeedProps {
  items: ActivityFeedItem[];
  className?: string;
}

/** One icon per captureable event type; the type union is closed, so the map must be exhaustive. */
const TYPE_ICONS: Record<ActivityEventType, LucideIcon> = {
  page_view: Eye,
  page_read: NotebookPen,
  selection: MousePointerSquareDashed,
  copy: Copy,
  youtube_watch: Youtube,
  app_session: MonitorPlay,
  search: Search,
  bookmark: Bookmark,
  download: Download,
};

/**
 * How each importance band reads. Bands outside this map (a value written by a newer scorer) fall
 * back to the `normal` styling rather than rendering unstyled.
 */
const BAND_CLASSES: Record<string, string> = {
  noise: 'border-border bg-muted text-muted-foreground',
  low: 'border-border bg-muted text-muted-foreground',
  normal: 'border-primary/30 bg-primary/10 text-primary',
  high: 'border-primary/40 bg-primary/15 text-primary',
  critical: 'border-destructive/40 bg-destructive/10 text-destructive',
};

/**
 * The raw event stream, newest first: what arrived, from where, and how much the scorer cared.
 *
 * Server-renderable. This is the feed behind "pages today" — the documents list below it shows what
 * was actually read, which is a much smaller set.
 */
export function ActivityFeed({ items, className }: ActivityFeedProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>The last {items.length} captured events, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No activity yet — browse something with the extension.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => {
              const Icon = TYPE_ICONS[item.type] ?? Eye;
              const domain = item.url === null ? null : extractDomain(item.url);

              return (
                <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <Icon
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.title ?? domain ?? EVENT_TYPE_LABELS[item.type]}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {EVENT_TYPE_LABELS[item.type]}
                      {domain === null ? '' : ` · ${domain}`}
                      {` · ${formatRelativeDay(item.receivedAt)}`}
                    </p>
                    {item.url === null ? null : (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="truncate text-xs text-primary hover:underline"
                      >
                        {item.url}
                      </a>
                    )}
                  </div>
                  <span
                    title={`Importance score ${item.importance.toFixed(2)}`}
                    className={cn(
                      'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
                      BAND_CLASSES[item.importanceBand] ?? BAND_CLASSES.normal,
                    )}
                  >
                    {item.importanceBand}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
