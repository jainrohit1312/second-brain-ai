'use client';

import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getSupabaseBrowserClient } from '@/lib/supabase';

export interface SignInFormProps {
  /**
   * Already sanitized against an allow-list by `page.tsx`. Typed loosely on purpose: the value
   * arrives from the query string, and the page — not this component — is what guarantees it is an
   * in-app path.
   */
  redirectTo: string;
}

/**
 * Email + password sign-in. Client component because the credentials are typed here and the session
 * ends up in cookies the browser client writes.
 *
 * A successful sign-in does a **full** navigation rather than `router.replace`: the destination's
 * Server Components have to be rendered with the new session cookies, and a client-side transition
 * could serve them from the router cache established while signed out.
 */
export function SignInForm({ redirectTo }: SignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsPending(true);
      setErrorMessage(null);

      const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMessage(error.message);
        setIsPending(false);
        return;
      }

      window.location.assign(redirectTo);
    },
    [email, password, redirectTo],
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Email
        <Input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="text-sm font-normal text-foreground"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Password
        <Input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="text-sm font-normal text-foreground"
        />
      </label>

      {errorMessage === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      )}

      <Button
        type="submit"
        isLoading={isPending}
        disabled={isPending || email.trim() === '' || password === ''}
      >
        Sign in
      </Button>
    </form>
  );
}
