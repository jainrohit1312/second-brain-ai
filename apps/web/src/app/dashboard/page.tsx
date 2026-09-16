import { DEFAULT_CATEGORY_SLUG, type Topic } from '@second-brain/shared';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

import { RecentActivity, type RecentActivityItem } from './components/RecentActivity';
import { TimeByTopic, type TimeByTopicDatum } from './components/TimeByTopic';
import { TopicCloud } from './components/TopicCloud';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Activity',
  description: 'Where your attention went, by topic and by day.',
};

/** User id used by the placeholder rows; a real id comes from the session in phase 2. */
const PLACEHOLDER_USER_ID = 'local-user';

/**
 * Placeholder chart series.
 *
 * TODO(phase-2): replace with the `topics` from `getActivityStats(range)` once the date-range
 * picker submits to the retrieval service.
 */
const PLACEHOLDER_TIME_BY_TOPIC: TimeByTopicDatum[] = [
  { day: '2026-09-10', minutesByTopic: { Engineering: 96, Research: 42, Media: 18 } },
  { day: '2026-09-11', minutesByTopic: { Engineering: 74, Research: 55, Media: 31 } },
  { day: '2026-09-12', minutesByTopic: { Engineering: 22, Research: 18, Media: 64 } },
  { day: '2026-09-13', minutesByTopic: { Engineering: 41, Research: 63, Media: 27 } },
  { day: '2026-09-14', minutesByTopic: { Engineering: 88, Research: 37, Media: 12 } },
  { day: '2026-09-15', minutesByTopic: { Engineering: 67, Research: 71, Media: 24 } },
  { day: '2026-09-16', minutesByTopic: { Engineering: 35, Research: 29, Media: 16 } },
];

/** TODO(phase-2): load the newest captures from the retrieval service. */
const PLACEHOLDER_RECENT_ACTIVITY: RecentActivityItem[] = [
  {
    id: 'doc_pgvector_tuning',
    source: 'web',
    title: 'Tuning pgvector for hybrid search',
    domain: 'example.com',
    capturedAt: '2026-09-16T08:12:00.000Z',
    importance: 'high',
  },
  {
    id: 'doc_hnsw_intro',
    source: 'web',
    title: 'Approximate nearest neighbour search with HNSW',
    domain: 'example.com',
    capturedAt: '2026-09-15T20:41:00.000Z',
    importance: 'normal',
  },
  {
    id: 'doc_youtube_chunking',
    source: 'youtube',
    title: 'Chunking strategies for retrieval-augmented generation',
    domain: 'youtube.com',
    capturedAt: '2026-09-15T18:05:00.000Z',
    importance: 'high',
  },
  {
    id: 'doc_newsletter_providers',
    source: 'newsletter',
    title: 'Embedding model round-up: what changed this quarter',
    domain: 'newsletter.example.com',
    capturedAt: '2026-09-14T07:30:00.000Z',
    importance: 'low',
  },
];

/** TODO(phase-2): replace with the topic rows returned alongside the activity stats. */
const PLACEHOLDER_TOPICS: Topic[] = [
  {
    id: 'topic_engineering',
    userId: PLACEHOLDER_USER_ID,
    slug: 'engineering',
    label: 'Engineering',
    description: 'Software design, infrastructure, and tooling.',
    parentId: null,
    keywords: ['postgres', 'pgvector', 'index'],
    categorySlug: DEFAULT_CATEGORY_SLUG,
    documentCount: 42,
    memoryCount: 11,
    centroid: null,
    firstSeenAt: '2026-08-02T10:00:00.000Z',
    lastSeenAt: '2026-09-16T08:12:00.000Z',
  },
  {
    id: 'topic_research',
    userId: PLACEHOLDER_USER_ID,
    slug: 'research',
    label: 'Research',
    description: 'Papers, benchmarks, and long reads.',
    parentId: null,
    keywords: ['retrieval', 'reranking'],
    categorySlug: DEFAULT_CATEGORY_SLUG,
    documentCount: 28,
    memoryCount: 7,
    centroid: null,
    firstSeenAt: '2026-08-04T09:30:00.000Z',
    lastSeenAt: '2026-09-15T20:41:00.000Z',
  },
  {
    id: 'topic_media',
    userId: PLACEHOLDER_USER_ID,
    slug: 'media',
    label: 'Media',
    description: 'Talks, podcasts, and video.',
    parentId: null,
    keywords: ['video', 'talks'],
    categorySlug: DEFAULT_CATEGORY_SLUG,
    documentCount: 12,
    memoryCount: 3,
    centroid: null,
    firstSeenAt: '2026-08-11T17:00:00.000Z',
    lastSeenAt: '2026-09-15T18:05:00.000Z',
  },
];

/**
 * Activity dashboard. Server component: every panel is either static or a client child, so the page
 * itself can be rendered and cached on the server.
 */
export default function DashboardPage() {
  return (
    <main className="container flex flex-col gap-6 py-10">
      <div className="flex flex-col gap-1">
        <h1>Activity</h1>
        <p className="text-sm text-muted-foreground">
          Where your attention went, by topic and by day.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Date range</CardTitle>
          <CardDescription>
            Shell only — the range is not applied until the stats endpoint exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* TODO(phase-2): make this a client component that owns `range`, synchronises it into the
              URL, and refetches `getActivityStats(range)`. */}
          <form action="/dashboard" className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              From
              <Input type="date" name="from" defaultValue="2026-09-10" className="w-40" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              To
              <Input type="date" name="to" defaultValue="2026-09-16" className="w-40" />
            </label>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <TimeByTopic data={PLACEHOLDER_TIME_BY_TOPIC} className="lg:col-span-2" />
        <TopicCloud topics={PLACEHOLDER_TOPICS} />
      </div>

      <RecentActivity items={PLACEHOLDER_RECENT_ACTIVITY} />
    </main>
  );
}
