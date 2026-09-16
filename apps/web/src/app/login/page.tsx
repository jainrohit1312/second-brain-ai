import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

import { SignInForm } from './components/SignInForm';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Second Brain.',
};

/**
 * In-app paths `/login?next=` is allowed to return to.
 *
 * An allow-list rather than a prefix check: a crafted `/login?next=https://evil.example` must not
 * turn the sign-in page into an open redirect, and a path allow-list cannot be bypassed the way
 * `startsWith('/')` can (`//evil.example` and `/\evil.example` both look relative to a naive check).
 */
const RETURN_PATHS = ['/', '/chat', '/dashboard', '/search', '/settings'] as const;

function safeReturnPath(raw: string | string[] | undefined): string {
  const value = typeof raw === 'string' ? raw : undefined;
  return RETURN_PATHS.find((path) => path === value) ?? '/';
}

/**
 * Sign-in route. Server component: it sanitizes the return path and renders the form, which owns
 * the credential state. Middleware keeps a signed-in visitor away from this route entirely.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string | string[] };
}) {
  const redirectTo = safeReturnPath(searchParams.next);

  return (
    <main className="container flex min-h-screen max-w-md flex-col justify-center py-10">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Use the same account your browser extension syncs to. Sessions are stored in cookies, so
            the server can read your captures under Row Level Security.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm redirectTo={redirectTo} />
        </CardContent>
      </Card>
    </main>
  );
}
