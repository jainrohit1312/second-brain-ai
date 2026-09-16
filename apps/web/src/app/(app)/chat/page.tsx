'use client';

import { useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

import { MessageInput } from './components/MessageInput';
import { MessageList, type ChatMessage } from './components/MessageList';
import { CHAT_MODES, ModeSelector, type ChatMode } from './components/ModeSelector';

import type { Citation } from '@second-brain/shared';

/** What `POST /api/chat` answers with. */
interface ChatResponse {
  answer: string;
  citations: Citation[];
  model?: string;
}

/**
 * Sends one question and resolves the answer.
 *
 * Non-streaming: the route returns a complete answer with its citations. Streaming arrives with the
 * `AnswerStream` contract in a later phase, which is why `MessageInput`'s stop affordance is wired to
 * a no-op below rather than to an abort.
 */
async function askQuestion(question: string, mode: ChatMode): Promise<ChatResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, mode }),
  });

  const body = (await response.json()) as ChatResponse & { error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? `The answer request failed (${response.status}).`);
  }

  return body;
}

/**
 * Chat route. Client component because the transcript, the selected mode, and the in-flight question
 * are view state.
 *
 * The question is answered by `/api/chat`, which retrieves from the signed-in user's documents and
 * calls the answer model server-side — where the credential lives and stays.
 */
export default function ChatPage() {
  const [mode, setMode] = useState<ChatMode>('recall');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const ask = useMutation({
    mutationFn: (input: { question: string; mode: ChatMode }) =>
      askQuestion(input.question, input.mode),
    onSuccess: (answer) => {
      setMessages((previous) => [
        ...previous,
        {
          id: `answer-${previous.length + 1}`,
          role: 'assistant',
          content: answer.answer,
          citations: answer.citations,
        },
      ]);
    },
  });

  const handleSubmit = useCallback(
    (text: string) => {
      setMessages((previous) => [
        ...previous,
        { id: `question-${previous.length + 1}`, role: 'user', content: text },
      ]);

      ask.mutate({ question: text, mode });
    },
    [ask, mode],
  );

  const handleStop = useCallback(() => {
    // A non-streaming answer cannot be interrupted mid-flight: the request is already in the
    // provider's hands. The button clears the pending state so the composer unlocks.
    ask.reset();
  }, [ask]);

  const activeMode = CHAT_MODES.find((option) => option.id === mode);

  return (
    <main className="container flex max-w-4xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1>Chat</h1>
          <p className="text-sm text-muted-foreground">
            Ask questions against your captured documents. Every answer is cited.
          </p>
        </div>
        <ModeSelector value={mode} onChange={setMode} />
      </div>

      <Card className="flex h-[70vh] flex-col overflow-hidden">
        <CardHeader className="border-b border-border pb-3">
          <CardTitle>Transcript</CardTitle>
          <CardDescription>
            {ask.isPending
              ? 'Searching your documents, then writing an answer…'
              : `${activeMode?.label ?? mode} mode — answers are drawn only from documents captured by your devices.`}
          </CardDescription>
        </CardHeader>

        <MessageList messages={messages} isStreaming={ask.isPending} className="min-h-0 flex-1" />

        {ask.isError ? (
          <p className="px-4 pb-1 text-xs text-destructive" role="alert">
            {ask.error instanceof Error ? ask.error.message : 'The answer request failed.'}
          </p>
        ) : null}

        <MessageInput onSubmit={handleSubmit} onStop={handleStop} isStreaming={ask.isPending} />
      </Card>
    </main>
  );
}
