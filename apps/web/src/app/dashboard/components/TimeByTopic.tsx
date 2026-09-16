'use client';

import { format, parseISO } from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatDuration } from '@/lib/utils';

/** One day of activity, split by topic. */
export interface TimeByTopicDatum {
  /** Calendar day in `yyyy-MM-dd` form; the chart renders one stacked bar per day. */
  day: string;
  /** Minutes per topic label for that day. Each key becomes a recharts series. */
  minutesByTopic: Record<string, number>;
}

/** Series colours, cycled when there are more topics than entries. */
const TOPIC_COLORS = ['#4f6ef7', '#2fa8a0', '#e0a63a', '#a06cf0', '#d9622b', '#5b7f97'];

const FALLBACK_COLOR = '#5b7f97';

export interface TimeByTopicProps {
  data: TimeByTopicDatum[];
  className?: string;
}

/**
 * Stacked bar chart of captured minutes per topic per day. Client component: recharts renders to
 * SVG in the browser and cannot be server-rendered.
 */
export function TimeByTopic({ data, className }: TimeByTopicProps) {
  const topicLabels = Array.from(
    new Set(data.flatMap((datum) => Object.keys(datum.minutesByTopic))),
  );
  const totalMinutes = data.reduce(
    (total, datum) =>
      total + Object.values(datum.minutesByTopic).reduce((sum, minutes) => sum + minutes, 0),
    0,
  );
  const chartData = data.map((datum) => ({
    dayLabel: formatDayLabel(datum.day),
    ...datum.minutesByTopic,
  }));

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Time by topic</CardTitle>
        <CardDescription>
          {formatDuration(totalMinutes * 60)} captured in this range.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No activity in this range.
          </p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="dayLabel" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={36} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {topicLabels.map((label, index) => (
                  <Bar
                    key={label}
                    dataKey={label}
                    stackId="time"
                    fill={TOPIC_COLORS[index % TOPIC_COLORS.length] ?? FALLBACK_COLOR}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Formats an ISO day key as a short axis label, falling back to the raw key if unparseable. */
function formatDayLabel(day: string): string {
  const parsed = parseISO(day);
  return Number.isNaN(parsed.getTime()) ? day : format(parsed, 'EEE d');
}
