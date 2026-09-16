'use client';

import { useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { askQuestion } from '@/lib/api';

import { MessageInput } from './components/MessageInput';
import { MessageList, type ChatMessage } from './components/MessageList';
import { ModeSelector, intentForMode, type ChatMode } from './components/ModeSelector';

import type { RetrievalQuery } from '@second-brain/shared';

/** How many ranked chunks the retrieval service should fuse for one chat turn. */
const CHAT_TOP_K = 12;

/**
 * Seed transcript so the surface renders with realistic content. Replaced by the real transcript
 * once sessions are persisted.
 *
 * TODO(phase-2): load the conversation history for the signed-in user instead of seeding it.
 */
const SEED_MESSAGES: ChatMessage[] = [
  {
    id: 'seed-1',
    role: 'system',
    content:
      'Answers are assembled from your captured activity. Citation markers link back to the exact passage they came from.',
  },
  {
    id: 'seed-2',
    role: 'user',
    content: 'What did I read about HNSW indexes?',
  },
  {
    id: 'seed-3',
    role: 'assistant',
    content:
      'You read two pieces on HNSW this month. The main one argues that HNSW trades recall for latency through its graph layer count, and that ef_search is the knob worth tuning before rebuilding the index.',
    citations: [
      {
        index: 1,
        documentId: 'doc_hnsw_intro',
        memoryId: null,
        title: 'Approximate nearest neighbour search with HNSW',
        url: 'https://example.com/notes/hnsw',
        occurredAt: '2026-09-11T08:40:00.000Z',
        snippet:
          'The graph is built in layers; the top layers are sparse and act as an index into the denser bottom layer, which is what keeps search logarithmic.',
      },
      {
        index: 2,
        documentId: 'doc_pgvector_tuning',
        memoryId: null,
        title: 'Tuning pgvector for hybrid search',
        url: 'https://example.com/notes/pgvector-tuning',
        occurredAt: '2026-09-14T19:05:00.000Z',
        snippet:
          'Raising ef_search improves recall at query time without a rebuild, so tune it before touching m or ef_construction.',
      },
    ],
  },
];

/**
 * Chat route. Client component because the transcript, the selected mode, and the in-flight answer
 * are view state; the page renders nothing server-side beyond the app shell.
 *
 * TODO(phase-2): gate this route behind the Supabase session and take `userId` from it.
 */
export default function ChatPage() {
  const [mode, setMode] = useState<ChatMode>('ask');
  const [messages, setMessages] = useState<ChatMessage[]>(SEED_MESSAGES);

  const ask = useMutation({
    mutationFn: (query: RetrievalQuery) => askQuestion(query),
    // TODO(phase-3): consume `AnswerStream.deltas`, append each fragment to a pending assistant
    // message, then replace that message with `AnswerStream.completed` and its citations.
  });

  const handleSubmit = useCallback(
    (text: string) => {
      setMessages((previous) => [
        ...previous,
        { id: `local-${previous.length + 1}`, role: 'user', content: text },
      ]);

      ask.mutate({
        // TODO(phase-2): take the user id from the Supabase session instead of a literal.
        userId: 'local-user',
        text,
        intent: intentForMode(mode),
        topK: CHAT_TOP_K,
        filters: {},
      });
    },
    [ask, mode],
  );

  const handleStop = useCallback(() => {
    // TODO(phase-3): abort the in-flight request through an AbortController and keep the partial
    // answer in the transcript instead of discarding it.
    ask.reset();
  }, [ask]);

  return (
    <main className="container flex max-w-4xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1>Chat</h1>
          <p className="text-sm text-muted-foreground">
            Ask questions against your captured activity. Every answer is cited.
          </p>
        </div>
        <ModeSelector value={mode} onChange={setMode} />
      </div>

      <Card className="flex h-[70vh] flex-col overflow-hidden">
        <CardHeader className="border-b border-border pb-3">
          <CardTitle>Transcript</CardTitle>
          <CardDescription>
            {ask.isPending
              ? 'Streaming an answer…'
              : `Mode hint: ${intentForMode(mode)} retrieval.`}
          </CardDescription>
        </CardHeader>

        <MessageList messages={messages} isStreaming={ask.isPending} className="min-h-0 flex-1" />

        {ask.isError ? (
          <p className="px-4 pb-1 text-xs text-muted-foreground" role="status">
            The retrieval service is not wired up yet: <code>askQuestion()</code> throws until phase
            3.
          </p>
        ) : null}

        <MessageInput onSubmit={handleSubmit} onStop={handleStop} isStreaming={ask.isPending} />
      </Card>
    </main>
  );
}
