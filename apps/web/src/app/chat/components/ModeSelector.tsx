'use client';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

import type { QueryIntent } from '@second-brain/shared';

/** Send-modes offered by the chat surface. Each maps onto a retrieval intent hint. */
export type ChatMode = 'ask' | 'recall' | 'reflect' | 'activity';

/** One selectable mode: its label, its one-line explanation, and the intent it hints at. */
export interface ChatModeOption {
  id: ChatMode;
  label: string;
  description: string;
  intent: QueryIntent;
}

/**
 * Mode catalogue. `intent` is only a hint placed on `RetrievalQuery.intent`; the retrieval service
 * is free to re-classify the query (and reports the intent it actually used on the answer).
 */
export const CHAT_MODES: readonly ChatModeOption[] = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Answer a question from what you have captured, with citations.',
    intent: 'semantic',
  },
  {
    id: 'recall',
    label: 'Recall',
    description: 'Find a specific page, video, or passage you saw before, by mixed signal search.',
    intent: 'mixed',
  },
  {
    id: 'reflect',
    label: 'Reflect',
    description: 'Surface durable memories, people, and projects connected to the topic.',
    intent: 'entity',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Report what you actually spent time on, filtered by date and device.',
    intent: 'activity',
  },
];

/** Maps a chat mode onto the intent hint sent with the query; falls back to `mixed`. */
export function intentForMode(mode: ChatMode): QueryIntent {
  return CHAT_MODES.find((option) => option.id === mode)?.intent ?? 'mixed';
}

export interface ModeSelectorProps {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
  className?: string;
}

/** Segmented control over {@link CHAT_MODES} with the active mode's description underneath. */
export function ModeSelector({ value, onChange, className }: ModeSelectorProps) {
  const active = CHAT_MODES.find((option) => option.id === value);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        role="group"
        aria-label="Chat mode"
        className="inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-muted p-1"
      >
        {CHAT_MODES.map((option) => {
          const isActive = option.id === value;
          return (
            <Button
              key={option.id}
              size="sm"
              variant={isActive ? 'primary' : 'ghost'}
              aria-pressed={isActive}
              onClick={() => onChange(option.id)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>

      {active ? <p className="text-xs text-muted-foreground">{active.description}</p> : null}
    </div>
  );
}
