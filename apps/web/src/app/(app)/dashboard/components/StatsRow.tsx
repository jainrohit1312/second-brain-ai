import { CalendarDays, FileText, Globe, type LucideIcon } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

import type { DomainCount } from '@/lib/queries';

/** The three aggregates the dashboard opens with. */
export interface DashboardStats {
  pagesToday: number;
  documentsThisWeek: number;
  topDomains: DomainCount[];
}

export interface StatsRowProps {
  stats: DashboardStats;
  className?: string;
}

/**
 * Summary tiles: today's page views, the week's captures, and where the attention went.
 *
 * Server-renderable — it formats numbers and holds no state. The domain list is a tile rather than
 * a chart on purpose: five pairs of text are quicker to read than five bars.
 */
export function StatsRow({ stats, className }: StatsRowProps) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      <StatTile
        icon={CalendarDays}
        label="Pages today"
        value={stats.pagesToday}
        hint="Page views received since local midnight."
      />
      <StatTile
        icon={FileText}
        label="Documents this week"
        value={stats.documentsThisWeek}
        hint="Captures from the last seven days."
      />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" aria-hidden="true" />
            <CardTitle className="text-sm">Top domains</CardTitle>
          </div>
          <CardDescription>Last seven days.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.topDomains.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity in the last seven days.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stats.topDomains.map((domain) => (
                <li key={domain.domain} className="flex items-baseline gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-foreground">{domain.domain}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {domain.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** One number-and-label tile. */
function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          <CardTitle className="text-sm">{label}</CardTitle>
        </div>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
