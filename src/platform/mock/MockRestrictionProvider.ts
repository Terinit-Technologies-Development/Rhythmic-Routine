import { RestrictionProvider, RestrictionResult } from '../RestrictionProvider';

export class MockRestrictionProvider implements RestrictionProvider {
  private activeRestrictedApps: Set<string> = new Set();

  async applyRestrictions(appIds: string[]): Promise<RestrictionResult> {
    for (const id of appIds) {
      this.activeRestrictedApps.add(id);
    }
    return {
      status: 'applied',
      appIds,
    };
  }

  async clearRestrictions(appIds: string[]): Promise<RestrictionResult> {
    for (const id of appIds) {
      this.activeRestrictedApps.delete(id);
    }
    return {
      status: 'applied',
      appIds,
    };
  }

  async getActiveRestrictedApps(): Promise<string[]> {
    return Array.from(this.activeRestrictedApps);
  }

  async getCapability(): Promise<'enforced' | 'foundation-only' | 'unsupported'> {
    return 'enforced'; // Mock provider simulates complete enforcement for web/tests
  }
}

export const mockRestrictionProvider = new MockRestrictionProvider();
