'use client';

import { extractDomain, truncate, type Citation } from '@second-brain/shared';
import { ExternalLink } from 'lucide-react';
import { useId, useState } from 'react';

import { cn, formatRelativeDay } from '@/lib/utils';

export interface SourceCitationProps {
  citation: Citation;
  className?: string;
}

/** Longest snippet rendered in the popover before it is cut with an ellipsis. */
const SNIPPET_MAX_LENGTH = 240;

/**
 * Inline `[n]` marker for one {@link Citation}. The popover opens on hover, keyboard focus, or tap
 * and shows the source title, domain, capture date, and snippet; when the citation carries a `url`
 * it also links out. `n` is `citation.index`, matching the markers the answer text refers to.
 */
export function SourceCitation({ citation, className }: SourceCitationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverId = useId();

  const domain = citation.url ? extractDomain(citation.url) : 'Memory';
  const capturedOn = citation.occurredAt ? formatRelativeDay(citation.occurredAt) : null;

  return (
    <span className={cn('group relative inline-block align-baseline', className)}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={popoverId}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          'mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-xs font-medium tabular-nums',
          'bg-primary/10 text-primary hover:bg-primary/20',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        )}
      >
        {citation.index}
      </button>

      <span
        id={popoverId}
        className={cn(
          'absolute bottom-full left-0 z-20 mb-2 w-72 flex-col gap-2 rounded-lg border border-border bg-background p-3 text-left shadow-lg',
          isOpen ? 'flex' : 'hidden group-hover:flex group-focus-within:flex',
        )}
      >
        <span className="text-sm font-medium leading-snug text-foreground">{citation.title}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{domain}</span>
          {capturedOn ? <span aria-hidden="true">·</span> : null}
          {capturedOn ? <span className="whitespace-nowrap">{capturedOn}</span> : null}
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {truncate(citation.snippet, SNIPPET_MAX_LENGTH)}
        </span>
        {citation.url ? (
          <a
            href={citation.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open source
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
      </span>
    </span>
  );
}
