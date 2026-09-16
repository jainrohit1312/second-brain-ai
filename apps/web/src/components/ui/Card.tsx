import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export type CardProps = HTMLAttributes<HTMLDivElement>;

/** Bordered surface used for every grouped block of content in the app. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-background shadow-sm', className)}
      {...props}
    />
  );
});

export type CardHeaderProps = HTMLAttributes<HTMLDivElement>;

/** Title/description block at the top of a card. */
export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props} />;
});

export type CardTitleProps = HTMLAttributes<HTMLHeadingElement>;

/** Primary label of a card. Rendered as an `h3` so the document outline stays sane. */
export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(function CardTitle(
  { className, ...props },
  ref,
) {
  return (
    <h3 ref={ref} className={cn('text-base font-semibold tracking-tight', className)} {...props} />
  );
});

export type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

/** Secondary line under a card title; also used for "not wired up yet" notes. */
export const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  function CardDescription({ className, ...props }, ref) {
    return <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
  },
);

export type CardContentProps = HTMLAttributes<HTMLDivElement>;

/** Main body of a card. */
export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(function CardContent(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />;
});

export type CardFooterProps = HTMLAttributes<HTMLDivElement>;

/** Action row at the bottom of a card. */
export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(function CardFooter(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('flex items-center gap-2 p-5 pt-0', className)} {...props} />;
});
