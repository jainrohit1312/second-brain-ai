import { DeviceList, type DeviceRow } from './components/DeviceList';
import { ProviderConfig } from './components/ProviderConfig';
import { RulesConfig } from './components/RulesConfig';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Providers, importance rules, and registered devices.',
};

/**
 * Placeholder device rows.
 *
 * TODO(phase-2): replace with `listDevices()`. The values below mirror what the extension, the
 * Android app, and the web session would each report.
 */
const PLACEHOLDER_DEVICES: DeviceRow[] = [
  {
    id: 'dev_chrome_work',
    userId: 'local-user',
    platform: 'chrome-extension',
    label: 'Chrome — Work profile',
    appVersion: '0.1.0',
    osVersion: 'Windows 11',
    lastSeenAt: '2026-09-16T09:12:00.000Z',
    createdAt: '2026-08-02T10:00:00.000Z',
    revokedAt: null,
    schemaVersion: 1,
  },
  {
    id: 'dev_pixel_8',
    userId: 'local-user',
    platform: 'android',
    label: 'Pixel 8',
    appVersion: '0.1.0',
    osVersion: 'Android 15',
    lastSeenAt: '2026-09-15T21:40:00.000Z',
    createdAt: '2026-08-09T18:20:00.000Z',
    revokedAt: null,
    schemaVersion: 1,
  },
  {
    id: 'dev_web_session',
    userId: 'local-user',
    platform: 'web',
    label: 'This browser',
    appVersion: null,
    osVersion: null,
    lastSeenAt: '2026-09-16T09:30:00.000Z',
    createdAt: '2026-09-01T07:05:00.000Z',
    revokedAt: null,
    schemaVersion: 1,
  },
];

/**
 * Settings route. Server component: each panel is a client island that owns its own edit state, so
 * the page shell itself stays static.
 */
export default function SettingsPage() {
  return (
    <main className="container flex max-w-4xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-1">
        <h1>Settings</h1>
        <p className="text-sm text-muted-foreground">
          Nothing on this page is persisted yet — every control is structure and validation only.
        </p>
      </div>

      <ProviderConfig />
      <RulesConfig />
      <DeviceList devices={PLACEHOLDER_DEVICES} />
    </main>
  );
}
