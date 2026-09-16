import { cn } from '@/lib/utils';

import type { HTMLAttributes } from 'react';

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Pulsing placeholder that reserves the space real content will occupy. Purely decorative, so it is
 * hidden from assistive technology; the surrounding region owns `aria-busy`.
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
