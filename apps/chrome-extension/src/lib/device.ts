/**
 * Device identity.
 *
 * Purpose: provide the `deviceId` every `ActivityEvent` carries. Phase 1a scope: the
 * device is **not registered** with the server. The id is read from the build-time
 * `VITE_DEVICE_ID` and must already exist in `second_brain.devices` for the signed-in
 * user — the row is seeded by hand (a migration or a fixture), not by this client.
 *
 * Phase 1a limitation, stated plainly: there is no `register-device` edge function yet,
 * and this module must not call one. So the extension has no per-device ingest secret,
 * and a device id is not a credential — it is only an attribution label. The
 * `X-Device-Secret` half of the ingestion contract arrives with device registration in a
 * later phase; until then the pipeline authenticates the caller by JWT alone.
 */
import { SETTING_KEYS, readSetting, removeSetting, writeSetting } from './settings';

/** The identity record as this client stores it. */
export interface DeviceIdentity {
  deviceId: string;
  platform: 'chrome-extension';
  label: string;
  /** ISO timestamp of first initialisation on this profile. Not a server timestamp. */
  registeredAt: string;
}

/** Build-time environment as Vite exposes it. */
interface ExtensionEnv {
  VITE_DEVICE_ID?: string;
}

/** Label recorded for a Phase 1a install; the real label becomes user-editable later. */
export const PHASE_1A_DEVICE_LABEL = 'Chrome Extension (Phase 1a)';

/**
 * Returns the device id, initialising it from `VITE_DEVICE_ID` on first call.
 *
 * @throws Error when no id has been initialised and the build carries no
 * `VITE_DEVICE_ID`. Failing loudly is deliberate: a batch sent without a device id is
 * rejected server-side, and the alternative — minting a random id — would produce rows
 * the ingestion path cannot attribute to the seeded device.
 */
export async function getOrInitDeviceId(): Promise<string> {
  const stored = await readSetting<unknown>(SETTING_KEYS.deviceId, null);
  if (typeof stored === 'string' && stored.length > 0) {
    return stored;
  }

  const env = import.meta.env as unknown as ExtensionEnv;
  const fromEnv = env.VITE_DEVICE_ID?.trim();
  if (!fromEnv) {
    throw new Error(
      'Missing VITE_DEVICE_ID. Phase 1a cannot register a device yet, so the id must be ' +
        'supplied at build time: set VITE_DEVICE_ID in the repo-root .env (see ' +
        '.env.example) to a device row that already exists for the signed-in user, then ' +
        'rebuild — Vite inlines env values at build time.',
    );
  }

  const identity: DeviceIdentity = {
    deviceId: fromEnv,
    platform: 'chrome-extension',
    label: PHASE_1A_DEVICE_LABEL,
    registeredAt: new Date().toISOString(),
  };

  await writeSetting(SETTING_KEYS.deviceId, fromEnv);
  await writeSetting(SETTING_KEYS.deviceIdentity, identity);
  return fromEnv;
}

/** Returns the stored identity, or null before {@link getOrInitDeviceId} has run. */
export async function getDeviceIdentity(): Promise<DeviceIdentity | null> {
  const value = await readSetting<unknown>(SETTING_KEYS.deviceIdentity, null);
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DeviceIdentity>;
  if (typeof candidate.deviceId !== 'string' || !candidate.deviceId) {
    return null;
  }
  return {
    deviceId: candidate.deviceId,
    platform: 'chrome-extension',
    label: typeof candidate.label === 'string' ? candidate.label : PHASE_1A_DEVICE_LABEL,
    registeredAt:
      typeof candidate.registeredAt === 'string' ? candidate.registeredAt : new Date(0).toISOString(),
  };
}

/** Forgets the local device identity; the next capture re-initialises it from the build env. */
export async function clearDeviceIdentity(): Promise<void> {
  await removeSetting(SETTING_KEYS.deviceId);
  await removeSetting(SETTING_KEYS.deviceIdentity);
}
