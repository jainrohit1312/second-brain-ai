import { SOURCE_LABELS, type DocumentSource, type ImportanceBand } from '@second-brain/shared';
import {
  BookOpen,
  FileText,
  Globe,
  Mail,
  NotebookPen,
  Youtube,
  type LucideIcon,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn, formatRelativeDay } from '@/lib/utils';

/** One captured document as rendered in the activity list. */
export interface RecentActivityItem {
  id: string;
  source: DocumentSource;
  title: string;
  /** Host of the source URL; `null` for manual notes that have no origin. */
  domain: string | null;
  capturedAt: string;
  importance: ImportanceBand;
}

export interface RecentActivityProps {
  items: RecentActivityItem[];
  className?: string;
}

const SOURCE_ICONS: Record<DocumentSource, LucideIcon> = {
  web: Globe,
  youtube: Youtube,
  pdf: FileText,
  gdoc: BookOpen,
  newsletter: Mail,
  manual: NotebookPen,
};

const BAND_CLASSES: Record<ImportanceBand, string> = {
  noise: 'border-border bg-muted text-muted-foreground',
  low: 'border-border bg-muted text-muted-foreground',
  normal: 'border-primary/30 bg-primary/10 text-primary',
  high: 'border-primary/40 bg-primary/15 text-primary',
  critical: 'border-destructive/40 bg-destructive/10 text-destructive',
};

/**
 * Reverse-chronological list of captured documents. Server-renderable: it formats timestamps and
 * picks an icon per source but holds no state.
 */
export function RecentActivity({ items, className }: RecentActivityProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>The newest captures, most recent first.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing captured yet. Install a client to start syncing.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => {
              const Icon = SOURCE_ICONS[item.source];
              return (
                <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <Icon
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {SOURCE_LABELS[item.source]}
                      {item.domain ? ` · ${item.domain}` : ''}
                      {` · ${formatRelativeDay(item.capturedAt)}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
                      BAND_CLASSES[item.importance],
                    )}
                  >
                    {item.importance}
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
