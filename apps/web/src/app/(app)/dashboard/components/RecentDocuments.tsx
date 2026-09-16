import { ExternalLink, FileText } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn, formatRelativeDay } from '@/lib/utils';

import type { RecentDocument } from '@/lib/queries';

export interface RecentDocumentsProps {
  documents: RecentDocument[];
  className?: string;
}

/**
 * How each extraction state reads. A `failed` document is shown rather than hidden: the failure is
 * a recorded state with a reason, and a list that silently omits it is how a user concludes the
 * product does not work (see `docs/RESEARCH_NOTES.md` on the extraction failure taxonomy).
 */
const STATUS_CLASSES: Record<string, string> = {
  succeeded: 'border-primary/30 bg-primary/10 text-primary',
  pending: 'border-border bg-muted text-muted-foreground',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
  skipped: 'border-border bg-muted text-muted-foreground',
};

/**
 * Captured documents, newest first, with the two facts that explain whether a capture is usable:
 * how much text it holds and whether extraction produced any.
 *
 * Server-renderable.
 */
export function RecentDocuments({ documents, className }: RecentDocumentsProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Recent documents</CardTitle>
        <CardDescription>
          Extractable captures, newest first. A document only reaches the chunker once extraction
          has succeeded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No documents yet — open an article with the extension and it will be extracted and
            stored here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {documents.map((document) => (
              <li key={document.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <FileText
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate text-sm font-medium text-foreground">{document.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {document.wordCount.toLocaleString()} words
                    {` · ${formatRelativeDay(document.capturedAt)}`}
                  </p>
                  {document.url === null ? null : (
                    <a
                      href={document.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex w-fit items-center gap-1 truncate text-xs text-primary hover:underline"
                    >
                      {document.url}
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </a>
                  )}
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
                    STATUS_CLASSES[document.extractionStatus] ?? STATUS_CLASSES.pending,
                  )}
                >
                  {document.extractionStatus}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
