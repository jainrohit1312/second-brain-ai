import {
  countDocumentsThisWeek,
  countPagesToday,
  listRecentActivity,
  listRecentDocuments,
  topDomains,
} from '@/lib/queries';
import { createServerSupabaseClient } from '@/lib/supabase-server';

import { ActivityFeed } from './components/ActivityFeed';
import { RecentDocuments } from './components/RecentDocuments';
import { StatsRow } from './components/StatsRow';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Where your attention went, and what was captured from it.',
};

/**
 * Row caps for the three panels. Bounds rather than pages: the feed and the document list are the
 * newest slice of each table, and keyset paging (ADR-017) is what will make them navigable.
 */
const ACTIVITY_LIMIT = 50;
const DOCUMENT_LIMIT = 20;
const DOMAIN_LIMIT = 5;

/**
 * Dashboard. Server component: it reads through the caller's session, so every query is scoped by
 * Row Level Security to the signed-in user. There is no service-role credential in this app to
 * bypass that with, by design.
 *
 * The five reads are independent, so they run concurrently — a slow section delays the page by its
 * own latency rather than by the sum of all five.
 */
export default async function DashboardPage() {
  const supabase = createServerSupabaseClient();

  const [activity, documents, pagesToday, documentsThisWeek, domains] = await Promise.all([
    listRecentActivity(supabase, ACTIVITY_LIMIT),
    listRecentDocuments(supabase, DOCUMENT_LIMIT),
    countPagesToday(supabase),
    countDocumentsThisWeek(supabase),
    topDomains(supabase, DOMAIN_LIMIT),
  ]);

  return (
    <main className="container flex flex-col gap-6 py-10">
      <div className="flex flex-col gap-1">
        <h1>Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          What arrived from your devices, and what came out of it.
        </p>
      </div>

      <StatsRow stats={{ pagesToday, documentsThisWeek, topDomains: domains }} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ActivityFeed items={activity} />
        <RecentDocuments documents={documents} />
      </div>
    </main>
  );
}
