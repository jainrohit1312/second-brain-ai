'use client';

import { CornerDownLeft, Square } from 'lucide-react';
import { useCallback, useState, type FormEvent, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export interface MessageInputProps {
  /** Called with the trimmed message text; never called with an empty string. */
  onSubmit: (text: string) => void;
  /** Only meaningful while `isStreaming`; wires the stop affordance. */
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Composer for the chat surface. Enter sends, Shift+Enter inserts a newline, and the field is
 * cleared only after `onSubmit` has been called. While `isStreaming` the send button is replaced by
 * a stop button.
 */
export function MessageInput({
  onSubmit,
  onStop,
  isStreaming = false,
  disabled = false,
  placeholder = 'Ask about anything you have read, watched, or worked on…',
  className,
}: MessageInputProps) {
  const [value, setValue] = useState('');
  const isBlocked = disabled || isStreaming;

  const submit = useCallback(() => {
    const text = value.trim();
    if (text.length === 0 || isBlocked) return;
    onSubmit(text);
    setValue('');
  }, [isBlocked, onSubmit, value]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submit();
    },
    [submit],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex flex-col gap-2 border-t border-border p-4', className)}
    >
      {/* TODO(phase-2): extract a `Textarea` ui primitive next to `Input`; chat is the only
          multiline field in the app and the primitives folder is shared with it. */}
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        disabled={disabled}
        aria-label="Message"
        placeholder={placeholder}
        className={cn(
          'w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</p>

        {isStreaming ? (
          <Button variant="secondary" size="sm" onClick={onStop} disabled={onStop === undefined}>
            <Square className="h-3 w-3" aria-hidden="true" />
            Stop
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={isBlocked || value.trim().length === 0}>
            <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Send
          </Button>
        )}
      </div>
    </form>
  );
}
