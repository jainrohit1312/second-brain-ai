import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { ChatMode } from '@/types/events';
import type { Citation } from '@second-brain/shared';

/**
 * Side panel: search and chat over captured material.
 *
 * The panel renders whatever the retrieval service returns and nothing it does not: every
 * assistant turn carries its citations, and a turn without citations is rendered as an
 * uncited answer rather than silently blended into prose. No retrieval happens here — the
 * request goes out as an ASK_QUESTION message and the worker owns the round trip.
 */

/** One turn in the transcript. */
export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Sources backing this turn; empty for user turns and for uncited answers. */
  citations: Citation[];
  createdAt: string;
}

/** Everything the transcript needs to render. */
export interface ChatViewModel {
  turns: ChatTurn[];
  isStreaming: boolean;
  error: string | null;
}

/** Modes offered in the panel, in display order. */
export const CHAT_MODES: readonly ChatMode[] = ['ask', 'recall', 'timeline'];

/** Human labels for {@link CHAT_MODES}. */
export const MODE_LABELS: Record<ChatMode, string> = {
  ask: 'Ask',
  recall: 'Recall',
  timeline: 'Timeline',
};

/** Rendered before the first question of a session. */
const EMPTY_CHAT: ChatViewModel = { turns: [], isStreaming: false, error: null };

/**
 * Reads the transcript for the current mode. Placeholder: returns the empty view and does
 * not subscribe.
 */
function useChat(_mode: ChatMode): ChatViewModel {
  // TODO(phase-3): send { type: 'ASK_QUESTION', question, mode } per submit, append turns as
  // they arrive, and surface transport failures on `error`.
  return EMPTY_CHAT;
}

/** Sends one question to the worker for retrieval and synthesis. */
function askQuestion(_question: string, _mode: ChatMode): void {
  // TODO(phase-3): post the question over chrome.runtime.sendMessage and stream the answer
  // into the transcript.
}

/** Citations backing one assistant turn, rendered as an ordered list. */
export function CitationList({ citations }: { citations: Citation[] }): JSX.Element {
  return (
    <ul className="citations">
      {citations.map((citation) => (
        <li
          key={`${citation.documentId ?? citation.memoryId ?? 'unknown'}:${citation.index}`}
          className="citations__item"
        >
          <span className="citations__index">[{citation.index}]</span>
          <span className="citations__title">{citation.title}</span>
          <span className="citations__snippet">{citation.snippet}</span>
        </li>
      ))}
    </ul>
  );
}

/** One transcript entry: role, text, and its citations. */
export function TranscriptTurn({ turn }: { turn: ChatTurn }): JSX.Element {
  return (
    <li className={`turn turn--${turn.role}`}>
      <span className="turn__role">{turn.role === 'user' ? 'You' : 'Second Brain'}</span>
      <p className="turn__body">{turn.text}</p>
      {turn.citations.length > 0 ? <CitationList citations={turn.citations} /> : null}
    </li>
  );
}

/** Search input, transcript, mode selector, and source citations. */
export function SidePanelApp(): JSX.Element {
  const [mode, setMode] = useState<ChatMode>('ask');
  const [draft, setDraft] = useState('');
  const chat = useChat(mode);

  return (
    <div className="sidepanel">
      <header className="sidepanel__header">
        <h1 className="sidepanel__title">Ask your memory</h1>
        <label className="mode-select">
          <span className="turn__role">Mode</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as ChatMode)}
            aria-label="Retrieval mode"
          >
            {CHAT_MODES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {MODE_LABELS[candidate]}
              </option>
            ))}
          </select>
        </label>
      </header>

      {chat.error ? (
        <p className="empty" role="alert">
          {chat.error}
        </p>
      ) : null}

      <ul className="transcript">
        {chat.turns.length === 0 ? (
          <li>
            <p className="empty">
              Nothing asked yet. Questions are answered from what the extension captured, with
              citations.
            </p>
          </li>
        ) : (
          chat.turns.map((turn) => <TranscriptTurn key={turn.id} turn={turn} />)
        )}
      </ul>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim().length === 0) {
            return;
          }
          askQuestion(draft, mode);
          setDraft('');
        }}
      >
        <input
          className="composer__input"
          type="search"
          value={draft}
          placeholder="Search your memory…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="composer__submit" type="submit" disabled={draft.trim().length === 0}>
          {chat.isStreaming ? 'Asking…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}

/** Mounts the side panel tree into `#root`; called once per panel document. */
export function mountSidePanel(): void {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Side panel root container #root is missing from index.html');
  }
  createRoot(container).render(
    <StrictMode>
      <SidePanelApp />
    </StrictMode>,
  );
}

mountSidePanel();
