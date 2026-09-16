/**
 * Device identity and sync state.
 *
 * A device is any client that produces activity events: the Chrome extension,
 * the Android app, the web app, or a server-side integration. Devices are
 * registered once and then authenticate with a per-device ingest secret, so a
 * single compromised client can be revoked without invalidating the others.
 */

/** Opaque device identifier. A UUID in Postgres; treated as a bare string here. */
export type DeviceId = string;

/**
 * Which kind of client this device is.
 *
 * `api` covers server-side producers (imports, scripts) that are not a
 * first-party app but still need an identity for attribution.
 */
export type DevicePlatform = 'chrome-extension' | 'android' | 'web' | 'api';

export interface Device {
  id: DeviceId;
  /** Owner. Every row is additionally protected by RLS on `user_id`. */
  userId: string;
  platform: DevicePlatform;
  /** Human-readable label shown in Settings, e.g. "Work laptop". Not unique. */
  label: string;
  appVersion: string | null;
  osVersion: string | null;
  /** ISO-8601 UTC. Refreshed on every successful sync, so this is also a liveness signal. */
  lastSeenAt: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  /**
   * ISO-8601 UTC, or `null` while the device is active. A revoked device keeps
   * its history but its ingest secret is rejected, so it can no longer write.
   */
  revokedAt: string | null;
}

/**
 * Local, per-device view of how far sync has progressed. Lives on the client
 * (IndexedDB / Room), not on the server: the client queue is the source of
 * truth for what has not been sent yet.
 */
export interface DeviceSyncState {
  deviceId: DeviceId;
  /** Opaque server cursor for keyset pagination. `null` before the first pull. */
  cursor: string | null;
  /** Events captured locally but not yet acknowledged by the server. */
  pendingCount: number;
  /** ISO-8601 UTC of the last fully acknowledged batch. */
  lastSyncedAt: string | null;
  /** Last sync failure, kept so the UI can surface a persistent problem. */
  lastError: string | null;
}

export interface DeviceRegistrationRequest {
  platform: DevicePlatform;
  label: string;
  appVersion: string | null;
  osVersion: string | null;
}

/**
 * Returned exactly once, at registration. The secret is shown to the user and
 * stored by the client; the server keeps only a hash of it.
 */
export interface DeviceRegistrationResponse {
  device: Device;
  ingestSecret: string;
}
