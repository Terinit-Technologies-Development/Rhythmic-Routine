import { RestrictionProvider } from '../RestrictionProvider';
import RhythmDeviceModule from '../../../modules/rhythm-device';

export class NativeRestrictionProvider implements RestrictionProvider {
  private activeRestrictedApps: Set<string> = new Set();

  async applyRestrictions(appIds: string[]): Promise<void> {
    try {
      await RhythmDeviceModule.applyShieldRestrictions(appIds);
    } catch {
      // Platform restriction boundary
    }
    for (const id of appIds) {
      this.activeRestrictedApps.add(id);
    }
  }

  async clearRestrictions(appIds: string[]): Promise<void> {
    try {
      await RhythmDeviceModule.clearShieldRestrictions(appIds);
    } catch {
      // Platform restriction boundary
    }
    for (const id of appIds) {
      this.activeRestrictedApps.delete(id);
    }
  }

  async getActiveRestrictedApps(): Promise<string[]> {
    return Array.from(this.activeRestrictedApps);
  }
}
