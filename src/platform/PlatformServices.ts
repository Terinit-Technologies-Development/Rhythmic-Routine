import { UsageProvider } from './UsageProvider';
import { RestrictionProvider } from './RestrictionProvider';
import { StorageProvider } from './StorageProvider';
import { PermissionProvider } from './PermissionProvider';
import {
  NativeRhythmSyncProvider,
  NoopNativeRhythmSyncProvider,
} from './NativeRhythmSyncProvider';
import { mockUsageProvider } from './mock/MockUsageProvider';
import { mockRestrictionProvider } from './mock/MockRestrictionProvider';
import { WebStorageProvider } from './storage/WebStorageProvider';
import { MockPermissionProvider } from './permissions/MockPermissionProvider';

import { SecureCredentialProvider } from './SecureCredentialProvider';
import { NativeSecureCredentialProvider } from './credentials/NativeSecureCredentialProvider';

export interface PlatformServices {
  usage: UsageProvider;
  restrictions: RestrictionProvider;
  storage: StorageProvider;
  permissions: PermissionProvider;
  nativeRhythm: NativeRhythmSyncProvider;
  credentials: SecureCredentialProvider;
}

let services: PlatformServices = {
  usage: mockUsageProvider,
  restrictions: mockRestrictionProvider,
  storage: new WebStorageProvider(),
  permissions: new MockPermissionProvider(),
  nativeRhythm: new NoopNativeRhythmSyncProvider(),
  credentials: new NativeSecureCredentialProvider(),
};

/**
 * Returns current active platform service adapters.
 */
export function getPlatformServices(): PlatformServices {
  return services;
}

export type ConfigurablePlatformServices = Partial<PlatformServices> &
  Pick<PlatformServices, 'usage' | 'restrictions' | 'storage' | 'permissions'>;

/**
 * Configures platform service adapters (e.g. for native swapping or testing).
 */
export function configurePlatformServices(next: ConfigurablePlatformServices): void {
  services = {
    ...services,
    ...next,
  };
}
