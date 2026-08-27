import { RestrictionProvider } from '../RestrictionProvider';

export class MockRestrictionProvider implements RestrictionProvider {
  private activeRestrictedApps: Set<string> = new Set();

  async applyRestrictions(appIds: string[]): Promise<void> {
    appIds.forEach((id) => this.activeRestrictedApps.add(id));
    return Promise.resolve();
  }

  async clearRestrictions(appIds: string[]): Promise<void> {
    appIds.forEach((id) => this.activeRestrictedApps.delete(id));
    return Promise.resolve();
  }

  async getActiveRestrictedApps(): Promise<string[]> {
    return Promise.resolve(Array.from(this.activeRestrictedApps));
  }
}

export const mockRestrictionProvider = new MockRestrictionProvider();
