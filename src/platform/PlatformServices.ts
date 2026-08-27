import { UsageProvider } from './UsageProvider';
import { RestrictionProvider } from './RestrictionProvider';
import { mockUsageProvider } from './mock/MockUsageProvider';
import { mockRestrictionProvider } from './mock/MockRestrictionProvider';

export interface PlatformServices {
  usage: UsageProvider;
  restrictions: RestrictionProvider;
}

let services: PlatformServices = {
  usage: mockUsageProvider,
  restrictions: mockRestrictionProvider,
};

/**
 * Returns current active platform service adapters.
 */
export function getPlatformServices(): PlatformServices {
  return services;
}

/**
 * Configures platform service adapters (e.g. for testing or native swapping in Pass 02).
 */
export function configurePlatformServices(next: PlatformServices): void {
  services = next;
}
