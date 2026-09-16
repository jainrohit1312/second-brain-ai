import {
  ArrowRight,
  LayoutDashboard,
  MessageSquare,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * One route advertised on the landing page. `href` is a literal union rather than `string` so it
 * stays assignable to the App Router's typed-route `href`.
 */
interface EntryPoint {
  href: '/chat' | '/dashboard' | '/search' | '/settings';
  title: string;
  description: string;
  icon: typeof MessageSquare;
}

const ENTRY_POINTS: readonly EntryPoint[] = [
  {
    href: '/chat',
    title: 'Chat',
    description:
      'Ask questions against everything you have captured. Answers are synthesised from ranked chunks and carry inline citations.',
    icon: MessageSquare,
  },
  {
    href: '/dashboard',
    title: 'Dashboard',
    description:
      'What arrived from your devices, and what came out of it: today’s captures, the week’s documents, and the domains you spent time on.',
    icon: LayoutDashboard,
  },
  {
    href: '/search',
    title: 'Search',
    description:
      'Keyword search over the extracted text of your documents, ranked by relevance rather than by date.',
    icon: Search,
  },
  {
    href: '/settings',
    title: 'Settings',
    description:
      'Point the pipeline at an embedding and chat provider, tune the importance rules, and manage devices.',
    icon: Settings,
  },
];

/**
 * Landing page. Server component: it renders static copy plus links, and holds no client state.
 */
export default function HomePage() {
  return (
    <main className="container flex flex-col gap-12 py-16">
      <section className="flex max-w-2xl flex-col gap-5">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Phase 1c-1 — real captures, real answers
        </span>
        <h1>A second brain that shows its receipts.</h1>
        <p className="text-base text-muted-foreground">
          Second Brain quietly captures what you read, watch, and work on, distils it into durable
          memories, and lets you talk to the result. Every answer cites the passage it came from, so
          you can jump straight back to the source.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/chat" className={buttonVariants('primary', 'lg')}>
            Ask a question
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link href="/dashboard" className={buttonVariants('secondary', 'lg')}>
            View activity
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ENTRY_POINTS.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link
              key={entry.href}
              href={entry.href}
              className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardHeader>
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  <CardTitle>{entry.title}</CardTitle>
                  <CardDescription>{entry.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </section>

      <section className="max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Recent captures</CardTitle>
            <CardDescription>
              Nothing has been captured yet. Install the browser extension or the Android app to
              start filling this list.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* TODO(phase-2): replace with the last N documents from the retrieval service. */}
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
