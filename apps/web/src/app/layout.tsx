import '@/styles/globals.css';

import { Inter } from 'next/font/google';

import { QueryProvider } from './providers';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

/**
 * Root metadata. `metadataBase` makes relative Open Graph and icon URLs absolute; the placeholder
 * origin must be replaced before deployment.
 *
 * TODO(phase-2): read the canonical origin from an env var (e.g. `NEXT_PUBLIC_SITE_URL`) and add
 * the og-image/social card entries once the assets exist.
 */
export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: {
    default: 'Second Brain',
    template: '%s · Second Brain',
  },
  description:
    'Chat with everything you have read, watched, and worked on — every answer cited back to its source.',
  applicationName: 'Second Brain',
};

/**
 * Root layout. `suppressHydrationWarning` is required on `<html>` because the theme class is added
 * by a client script before hydration.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
