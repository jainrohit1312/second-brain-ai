import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { getSession, onAuthStateChange, signInWithOtp, signInWithPassword, signOut } from '@/lib/auth';
import { sendRuntimeMessage } from '@/lib/messages';
import { SETTING_KEYS, onSettingChanged, writeCaptureEnabled } from '@/lib/settings';

import type { AuthStateSnapshot, ExtensionStatus, QueueStatus, SyncOutcome } from '@/types/events';
import type { FormEvent } from 'react';

/**
 * Popup shell.
 *
 * Shows capture state at a glance — is capture running, how deep is the queue, when did it
 * last sync — and gives the user the two controls that matter before opening the side
 * panel: pause capture, and force a sync. Every value comes from the service worker; the
 * popup owns no state beyond the control it is currently manipulating and the sign-in form
 * it is currently displaying.
 */

/** Projection of the background status that the popup renders. */
export interface PopupViewModel {
  queue: QueueStatus;
  lastSync: SyncOutcome | null;
  captureEnabled: boolean;
  signedIn: boolean;
  /** Full auth projection; `signedIn` is the one bit the layout mostly cares about. */
  auth: AuthStateSnapshot;
  /** Transport or configuration failure worth showing the user; null when healthy. */
  error: string | null;
}

/** Rendered before the worker has answered yet: empty queue, never synced, signed out. */
const SIGNED_OUT_SNAPSHOT: AuthStateSnapshot = {
  status: 'signed-out',
  userId: null,
  email: null,
  expiresAt: null,
};

/** Rendered while the worker has not answered yet: empty queue, never synced. */
export const EMPTY_POPUP_VIEW: PopupViewModel = {
  queue: {
    depth: 0,
    oldestQueuedAt: null,
    newestQueuedAt: null,
    droppedCount: 0,
    isPaused: false,
    lastSyncedAt: null,
  },
  lastSync: null,
  captureEnabled: true,
  signedIn: false,
  auth: SIGNED_OUT_SNAPSHOT,
  error: null,
};

/** What {@link usePopupStatus} hands the component: a view, a first-load flag, and a refresh. */
interface PopupStatusState {
  view: PopupViewModel;
  /** True until the first session read and status round trip have both settled. */
  isLoading: boolean;
  /** Re-reads the full status from the worker. */
  refresh: () => Promise<void>;
}

/** Renders `error` as a message the user can act on. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads live status from the service worker and keeps it fresh.
 *
 * Three sources feed the view, each for a different reason:
 * - `getSession()` on mount decides the first screen, and is fast because it reads the
 *   same `chrome.storage` session the worker uses.
 * - `GET_STATUS` is the full picture: auth, capture toggle, queue depth, last sync.
 * - `SYNC_STATUS` is the cheap refresh fired by setting changes, so a drain that wrote
 *   `last-sync` updates the numbers without re-reading the queue twice.
 */
function usePopupStatus(): PopupStatusState {
  const [view, setView] = useState<PopupViewModel>(EMPTY_POPUP_VIEW);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const status: ExtensionStatus = await sendRuntimeMessage({ type: 'GET_STATUS' });
      setView({
        queue: status.queue,
        lastSync: status.lastSync,
        captureEnabled: status.captureEnabled,
        signedIn: status.auth.status === 'signed-in',
        auth: status.auth,
        error: null,
      });
    } catch (error) {
      setView((previous) => ({ ...previous, error: describeError(error) }));
    }
  }, []);

  useEffect(() => {
    let active = true;

    const loadStatus = async (): Promise<void> => {
      try {
        const status: ExtensionStatus = await sendRuntimeMessage({ type: 'GET_STATUS' });
        if (!active) return;
        setView({
          queue: status.queue,
          lastSync: status.lastSync,
          captureEnabled: status.captureEnabled,
          signedIn: status.auth.status === 'signed-in',
          auth: status.auth,
          error: null,
        });
      } catch (error) {
        if (!active) return;
        setView((previous) => ({ ...previous, error: describeError(error) }));
      }
    };

    const loadCounts = async (): Promise<void> => {
      try {
        const snapshot = await sendRuntimeMessage({ type: 'SYNC_STATUS' });
        if (!active) return;
        setView((previous) => ({
          ...previous,
          queue: { ...previous.queue, depth: snapshot.queueDepth },
          lastSync: snapshot.lastSync,
        }));
      } catch {
        // A failed light refresh leaves the last good numbers on screen; the next
        // transition or the user's next action will retry.
      }
    };

    void (async () => {
      await getSession();
      await loadStatus();
      if (active) {
        setIsLoading(false);
      }
    })();

    const unsubscribeAuth = onAuthStateChange(() => {
      void loadStatus();
    });
    const unsubscribeSync = onSettingChanged(SETTING_KEYS.lastSync, () => {
      void loadCounts();
    });
    const unsubscribeDropped = onSettingChanged(SETTING_KEYS.droppedCount, () => {
      void loadCounts();
    });

    return () => {
      active = false;
      unsubscribeAuth();
      unsubscribeSync();
      unsubscribeDropped();
    };
  }, []);

  return { view, isLoading, refresh };
}

/** Renders an ISO timestamp as a short relative label; 'never' when there is none. */
function formatTimestamp(iso: string | null): string {
  if (iso === null) {
    return 'never';
  }
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return 'unknown';
  }
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1_000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Applies the capture-pause preference.
 *
 * Writes storage first — the content scripts read it directly, so they stop building draft
 * events immediately — and then tells the worker, which broadcasts the change to every
 * content script so already-open tabs notice without waiting for a storage event.
 */
async function setCaptureEnabled(enabled: boolean): Promise<void> {
  await writeCaptureEnabled(enabled);
  await sendRuntimeMessage({ type: 'SET_CAPTURE_ENABLED', enabled });
}

/** Sends a manual flush request and resolves with the worker's accounting. */
async function requestSyncNow(): Promise<SyncOutcome> {
  return sendRuntimeMessage({ type: 'SYNC_NOW', force: true });
}

/** Opens the side panel in the current window; requires the click that called it. */
async function openSidePanel(): Promise<void> {
  const current = await chrome.windows.getCurrent();
  if (current.id === undefined) {
    throw new Error('Cannot open the side panel: the current window has no id');
  }
  await chrome.sidePanel.open({ windowId: current.id });
}

/** Throbber markup shared by the loading screen and the in-flight buttons. */
function Spinner(): JSX.Element {
  return <span className="spinner" aria-hidden="true" />;
}

/** The loading screen: the session has not been read yet, so the layout cannot be chosen. */
function LoadingScreen(): JSX.Element {
  return (
    <main className="popup">
      <header className="popup__header">
        <h1 className="popup__title">Second Brain</h1>
      </header>
      <p className="note">
        <Spinner /> Loading…
      </p>
    </main>
  );
}

/** Parameters for {@link SignInScreen}. */
interface SignInScreenProps {
  error: string | null;
  onRefresh: () => Promise<void>;
}

/** The signed-out screen: email + password, with the magic-link path beside it. */
function SignInScreen({ error, onRefresh }: SignInScreenProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSignIn = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await signInWithPassword(email, password);
      await onRefresh();
    } catch (signInError) {
      setMessage(describeError(signInError));
    } finally {
      setBusy(false);
    }
  };

  const handleMagicLink = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await signInWithOtp(email);
      setMessage('Magic link sent. Phase 1a cannot complete a link sign-in yet — use your password.');
    } catch (otpError) {
      setMessage(describeError(otpError));
    } finally {
      setBusy(false);
    }
  };

  const shown = message ?? error;

  return (
    <main className="popup">
      <header className="popup__header">
        <h1 className="popup__title">Second Brain</h1>
        <span className="pill pill--off">Signed out</span>
      </header>

      <form className="form" onSubmit={(event) => void handleSignIn(event)}>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {shown ? (
          <p className="error" role="alert">
            {shown}
          </p>
        ) : null}

        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
        <button
          className="button button--secondary"
          type="button"
          disabled={busy || email.trim().length === 0}
          onClick={() => void handleMagicLink()}
        >
          Send magic link
        </button>
      </form>

      <p className="note">New events queue locally while you are signed out.</p>
    </main>
  );
}

/** Parameters for {@link SignedInScreen}. */
interface SignedInScreenProps {
  status: PopupStatusState;
}

/** The signed-in screen: identity, queue depth, last sync, and the four controls. */
function SignedInScreen({ status }: SignedInScreenProps): JSX.Element {
  const { view, refresh } = status;
  const [captureEnabled, setCaptureEnabledState] = useState(view.captureEnabled);
  const [busy, setBusy] = useState<'sync' | 'sign-out' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setCaptureEnabledState(view.captureEnabled);
  }, [view.captureEnabled]);

  const handleToggle = async (enabled: boolean): Promise<void> => {
    setCaptureEnabledState(enabled);
    setMessage(null);
    try {
      await setCaptureEnabled(enabled);
    } catch (toggleError) {
      setCaptureEnabledState(!enabled);
      setMessage(describeError(toggleError));
    }
  };

  const handleSyncNow = async (): Promise<void> => {
    setBusy('sync');
    setMessage(null);
    try {
      const outcome = await requestSyncNow();
      setMessage(`Sync ${outcome.status}: ${outcome.sent} sent`);
      await refresh();
    } catch (syncError) {
      setMessage(describeError(syncError));
    } finally {
      setBusy(null);
    }
  };

  const handleSignOut = async (): Promise<void> => {
    setBusy('sign-out');
    setMessage(null);
    try {
      // Drain first: anything already captured belongs to the account that captured it,
      // and the worker drops the queue's association with the session on sign-out.
      await sendRuntimeMessage({ type: 'FLUSH_QUEUE', reason: 'sign-out' });
    } catch {
      // A failed final drain is not a reason to refuse to sign out.
    }
    try {
      await signOut();
      await refresh();
    } catch (signOutError) {
      setMessage(describeError(signOutError));
    } finally {
      setBusy(null);
    }
  };

  const handleOpenSidePanel = async (): Promise<void> => {
    try {
      await openSidePanel();
    } catch (panelError) {
      setMessage(describeError(panelError));
    }
  };

  return (
    <main className="popup">
      <header className="popup__header">
        <h1 className="popup__title">Second Brain</h1>
        <span className={captureEnabled ? 'pill pill--on' : 'pill pill--off'}>
          {captureEnabled ? 'Capturing' : 'Paused'}
        </span>
      </header>

      <dl className="stats">
        <div className="stats__row">
          <dt>Signed in</dt>
          <dd>{view.auth.email ?? view.auth.userId ?? 'unknown'}</dd>
        </div>
        <div className="stats__row">
          <dt>Queued</dt>
          <dd>{view.queue.depth}</dd>
        </div>
        <div className="stats__row">
          <dt>Oldest</dt>
          <dd>{formatTimestamp(view.queue.oldestQueuedAt)}</dd>
        </div>
        <div className="stats__row">
          <dt>Dropped</dt>
          <dd>{view.queue.droppedCount}</dd>
        </div>
        <div className="stats__row">
          <dt>Last sync</dt>
          <dd>{view.lastSync ? formatTimestamp(view.lastSync.finishedAt) : 'never'}</dd>
        </div>
      </dl>

      <label className="toggle">
        <input
          type="checkbox"
          checked={captureEnabled}
          onChange={(event) => void handleToggle(event.target.checked)}
        />
        <span>Capture while I browse</span>
      </label>

      {message ? <p className="note">{message}</p> : null}
      {view.error ? (
        <p className="error" role="alert">
          {view.error}
        </p>
      ) : null}

      <button
        className="button"
        type="button"
        disabled={busy !== null}
        onClick={() => void handleSyncNow()}
      >
        {busy === 'sync' ? (
          <>
            <Spinner /> Syncing…
          </>
        ) : (
          'Sync now'
        )}
      </button>
      <button
        className="button button--secondary"
        type="button"
        onClick={() => void handleOpenSidePanel()}
      >
        Open side panel
      </button>
      <button
        className="button button--secondary"
        type="button"
        disabled={busy !== null}
        onClick={() => void handleSignOut()}
      >
        Sign out
      </button>

      <p className="note">
        {view.lastSync
          ? `Last sync ${view.lastSync.status} — ${formatTimestamp(view.lastSync.finishedAt)}.`
          : 'Nothing synced yet.'}
      </p>
      {view.lastSync?.error ? (
        <p className="error" role="alert">
          {view.lastSync.error}
        </p>
      ) : null}
    </main>
  );
}

/** Capture status, queue depth, sync toggle, and the side-panel shortcut. */
export function PopupApp(): JSX.Element {
  const status = usePopupStatus();

  if (status.isLoading) {
    return <LoadingScreen />;
  }
  if (status.view.auth.status !== 'signed-in') {
    return <SignInScreen error={status.view.error} onRefresh={status.refresh} />;
  }
  return <SignedInScreen status={status} />;
}

/** Mounts the popup tree into `#root`; called once per popup document. */
export function mountPopup(): void {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Popup root container #root is missing from index.html');
  }
  createRoot(container).render(
    <StrictMode>
      <PopupApp />
    </StrictMode>,
  );
}

mountPopup();
