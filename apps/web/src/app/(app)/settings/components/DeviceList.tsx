'use client';

import { Chrome, Globe, Server, Smartphone, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatRelativeDay } from '@/lib/utils';

import type { Device, DevicePlatform } from '@second-brain/shared';

/**
 * A device row as rendered by the settings table.
 *
 * `schemaVersion` is the activity-event schema version the device last synced with. It lives on the
 * sync state rather than on `Device`, so it is modelled here as an extension until the device list
 * endpoint returns it.
 */
export interface DeviceRow extends Device {
  schemaVersion: number;
}

export interface DeviceListProps {
  devices: DeviceRow[];
  className?: string;
}

const PLATFORM_ICONS: Record<DevicePlatform, LucideIcon> = {
  'chrome-extension': Chrome,
  android: Smartphone,
  web: Globe,
  api: Server,
};

const PLATFORM_LABELS: Record<DevicePlatform, string> = {
  'chrome-extension': 'Chrome extension',
  android: 'Android',
  web: 'Web',
  api: 'API client',
};

/**
 * Registered devices with their last sync and event schema version, plus a revoke action.
 *
 * Revoking is optimistic and local: the row is marked revoked immediately, and the server call is
 * still to be written.
 */
export function DeviceList({ devices, className }: DeviceListProps) {
  const [revokedIds, setRevokedIds] = useState<string[]>([]);

  const isRevoked = (device: DeviceRow) =>
    device.revokedAt !== null || revokedIds.includes(device.id);

  /** TODO(phase-2): DELETE /devices/:id, refresh `listDevices()`, and roll back on failure. */
  const handleRevoke = (deviceId: string) => {
    setRevokedIds((previous) => (previous.includes(deviceId) ? previous : [...previous, deviceId]));
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>
          Every client allowed to sync into this account. Revoking stops future batches; it does not
          delete what was already captured.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {devices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No devices have synced yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Device
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Platform
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Last seen
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Schema
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => {
                  const Icon = PLATFORM_ICONS[device.platform];
                  const revoked = isRevoked(device);

                  return (
                    <tr key={device.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">
                        <span className="flex items-center gap-2">
                          <Icon
                            className="h-4 w-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium text-foreground">
                              {device.label}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {[device.appVersion, device.osVersion]
                                .filter((value): value is string => Boolean(value))
                                .join(' · ') || 'No version reported'}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {PLATFORM_LABELS[device.platform]}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {formatRelativeDay(device.lastSeenAt)}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                        v{device.schemaVersion}
                      </td>
                      <td className="py-3 text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={revoked}
                          onClick={() => handleRevoke(device.id)}
                        >
                          {revoked ? 'Revoked' : 'Revoke'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
