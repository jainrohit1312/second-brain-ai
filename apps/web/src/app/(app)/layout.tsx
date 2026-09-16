import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/lib/supabase-server';

import { Header } from './components/Header';

import type { ReactNode } from 'react';

/**
 * Layout for every signed-in route.
 *
 * The session check is deliberately here rather than in the root layout: `/login` is a sibling of
 * this group, so the guard covers every route except the sign-in page without the root layout
 * having to know the current pathname.
 *
 * This is the second of two checks, not the only one. `src/middleware.ts` has already redirected an
 * anonymous visitor and refreshed the session cookies; this one re-validates for the case where
 * middleware was skipped, and gives `user` to the header.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header email={user.email ?? null} />
      {children}
    </div>
  );
}
