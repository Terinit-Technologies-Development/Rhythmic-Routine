import { UsageProvider } from './UsageProvider';
import { RestrictionProvider } from './RestrictionProvider';
import { StorageProvider } from './StorageProvider';
import { PermissionProvider } from './PermissionProvider';
import { mockUsageProvider } from './mock/MockUsageProvider';
import { mockRestrictionProvider } from './mock/MockRestrictionProvider';
import { LocalStorageProvider } from './storage/LocalStorageProvider';
import { MockPermissionProvider } from './permissions/MockPermissionProvider';

export interface PlatformServices {
  usage: UsageProvider;
  restrictions: RestrictionProvider;
  storage: StorageProvider;
  permissions: PermissionProvider;
}

let services: PlatformServices = {
  usage: mockUsageProvider,
  restrictions: mockRestrictionProvider,
  storage: new LocalStorageProvider(),
  permissions: new MockPermissionProvider(),
};

/**
 * Returns current active platform service adapters.
 */
export function getPlatformServices(): PlatformServices {
  return services;
}

/**
 * Configures platform service adapters (e.g. for native swapping or testing).
 */
export function configurePlatformServices(next: PlatformServices): void {
  services = next;
}
