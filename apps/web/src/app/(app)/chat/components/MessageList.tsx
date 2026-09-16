'use client';

import { Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

import { SourceCitation } from './SourceCitation';

import type { Citation } from '@second-brain/shared';

/** Author of a transcript entry. `system` carries product copy, not model output. */
export type ChatRole = 'user' | 'assistant' | 'system';

/** One transcript entry. `citations` is only ever set on assistant turns. */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  citations?: Citation[];
}

export interface MessageListProps {
  messages: ChatMessage[];
  /** True while an answer is still streaming; renders the caret and a pending bubble. */
  isStreaming?: boolean;
  className?: string;
}

/**
 * Scrollable transcript. Auto-scrolls to the newest turn as messages arrive or streaming starts,
 * shows an empty state before the first question, and renders a blinking caret while streaming.
 */
export function MessageList({ messages, isStreaming = false, className }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, isStreaming]);

  if (messages.length === 0) {
    return <EmptyState className={className} />;
  }

  const lastIndex = messages.length - 1;

  return (
    <div
      role="log"
      aria-live="polite"
      aria-busy={isStreaming}
      className={cn('flex flex-col gap-4 overflow-y-auto px-5 py-4', className)}
    >
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          showCaret={isStreaming && index === lastIndex && message.role === 'assistant'}
        />
      ))}

      {isStreaming && messages[lastIndex]?.role === 'user' ? <PendingBubble /> : null}

      <div ref={bottomRef} />
    </div>
  );
}

/** Shown before the transcript has any turns; suggests the shape of a good question. */
function EmptyState({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">Ask your second brain anything</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Try “What did I read about vector indexes last week?” or “Summarise the videos I watched
        about Postgres.”
      </p>
    </div>
  );
}

/** One rendered turn, including its citation markers. */
function MessageBubble({ message, showCaret }: { message: ChatMessage; showCaret: boolean }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-muted/50 text-foreground',
        )}
      >
        <span className="sr-only">{isUser ? 'You said' : 'Assistant said'}</span>
        <p className="whitespace-pre-wrap">
          {message.content}
          {message.citations?.map((citation) => (
            <SourceCitation key={citation.index} citation={citation} />
          ))}
          {showCaret ? (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-caret bg-foreground"
            />
          ) : null}
        </p>
      </div>
    </div>
  );
}

/** Placeholder bubble rendered between sending a question and the first streamed delta. */
function PendingBubble() {
  return (
    <div className="flex justify-start" aria-hidden="true">
      <div className="flex w-64 flex-col gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}
