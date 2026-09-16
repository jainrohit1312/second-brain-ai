'use client';

import {
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Search,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/**
 * One destination in the app header. `href` is a literal union rather than `string` so it stays
 * assignable to the App Router's typed-route `href`.
 */
interface NavItem {
  href: '/dashboard' | '/search' | '/chat' | '/settings';
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export interface HeaderProps {
  /** Signed-in user's email, or `null` when the session carries none. */
  email: string | null;
  className?: string;
}

/**
 * App header: product mark, primary navigation, the signed-in identity, and sign-out.
 *
 * Client component because navigation needs `usePathname()` for the active state and signing out
 * needs the browser Supabase client.
 */
export function Header({ email, className }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    await getSupabaseBrowserClient().auth.signOut();
    // `replace` so the back button cannot return to a page rendered for the ended session, and
    // `refresh` so the router discards the RSC payload cached while it was still valid.
    router.replace('/login');
    router.refresh();
  }, [router]);

  return (
    <header className={cn('border-b border-border', className)}>
      <div className="container flex h-14 items-center gap-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          Second Brain
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {email === null ? null : (
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">{email}</span>
          )}
          <Button
            variant="secondary"
            size="sm"
            isLoading={isSigningOut}
            disabled={isSigningOut}
            onClick={handleSignOut}
          >
            <LogOut className="h-3 w-3" aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
