/** How often playback progress is sampled into the local accumulator. */
export const WATCH_PING_INTERVAL_MS = 15_000;

/**
 * Minimum watched time for a flush to be worth an event. Below it the user was skipping
 * past a video, not watching it, and the event would be noise.
 */
export const WATCH_FLUSH_MIN_SECONDS = 5;

/** What the content script knows about the current video. */
export interface YouTubeVideoInfo {
  videoId: string;
  title: string;
  /** Null on the watch page until the channel name renders, or on embeds. */
  channelName: string | null;
}

/** Playback accumulated locally for one video. */
export interface WatchProgress {
  videoId: string;
  /** Seconds actually played, summed across samples; seeks do not count as watched time. */
  watchedSeconds: number;
  /** Total duration in seconds, or null while the player has not reported it. */
  durationSeconds: number | null;
  /** `watchedSeconds / durationSeconds`, clamped to 0..1; 0 while the duration is unknown. */
  watchedPct: number;
  isPlaying: boolean;
  /** ISO timestamp of the last sample taken. */
  lastUpdatedAt: string;
}

/**
 * Per-video accumulator. One tracker per video id: a tracker created for a new id starts
 * from zero, which is what makes the SPA navigation case work.
 *
 * Watch progress is sampled on a timer and flushed on `visibilitychange` and
 * `beforeunload`, because YouTube navigations are SPA pushes — no page unload ever fires,
 * so nothing else would tell the service worker that a view ended.
 */
export interface WatchTracker {
  /** Current accumulator state; never resets the counters. */
  getProgress(): WatchProgress;
  /** Adds playback time observed since the last sample. Ignores negative deltas. */
  recordTick(deltaSeconds: number): WatchProgress;
  /**
   * Returns the accumulated progress for this video and resets the accumulator, so the
   * same playback time is never sent twice. Returns null when nothing was watched or the
   * total stayed below {@link WATCH_FLUSH_MIN_SECONDS}.
   */
  flush(): WatchProgress | null;
  /** Detaches timers and listeners; the progress is not flushed. */
  dispose(): void;
}

/** True when `url` is on a YouTube host, including the mobile and nocookie hosts. */
export function isYouTubeUrl(url: string): boolean {
  void url;
  // TODO(phase-1): compare the parsed hostname against the allow-list of YouTube origins.
  throw new Error('Not implemented: isYouTubeUrl');
}

/**
 * Extracts the 11-character video id from a watch, shorts, embed, or live URL, or null
 * when the URL carries no video.
 */
export function parseVideoId(url: string): string | null {
  void url;
  // TODO(phase-1): read `v`, the `/shorts/`, `/embed/`, and `/live/` path segments, then
  // validate the id shape.
  throw new Error('Not implemented: parseVideoId');
}

/**
 * Reads the currently open video from the live document, or null when this page is not a
 * video. Called once per content-script boot and again on every SPA navigation.
 */
export function detectYouTubeVideo(): YouTubeVideoInfo | null {
  // TODO(phase-1): parseVideoId(location.href) plus the title and channel from the player
  // metadata, tolerating the player not being mounted yet.
  throw new Error('Not implemented: detectYouTubeVideo');
}

/** Creates a {@link WatchTracker} for one video. */
export function createWatchTracker(videoId: string): WatchTracker {
  void videoId;
  // TODO(phase-1): seed the accumulator with the current duration and start the
  // WATCH_PING_INTERVAL_MS sampler plus the visibilitychange/beforeunload flush hooks.
  throw new Error('Not implemented: createWatchTracker');
}
