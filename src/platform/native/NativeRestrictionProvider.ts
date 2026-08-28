import { RestrictionProvider, RestrictionResult } from '../RestrictionProvider';
import RhythmDeviceModule from '../../../modules/rhythm-device';

export class NativeRestrictionProvider implements RestrictionProvider {
  private activeRestrictedApps: Set<string> = new Set();

  async applyRestrictions(appIds: string[]): Promise<RestrictionResult> {
    try {
      const nativeApplied = await RhythmDeviceModule.applyShieldRestrictions(appIds);
      if (nativeApplied === true) {
        for (const id of appIds) {
          this.activeRestrictedApps.add(id);
        }
        return {
          status: 'applied',
          appIds,
        };
      }
    } catch {
      // Platform restriction boundary
    }

    // Honest reporting: Native shielding is currently in foundation-only phase
    return {
      status: 'unsupported',
      appIds,
      reason: 'Physical app shielding requires active platform Screen Time token binding.',
    };
  }

  async clearRestrictions(appIds: string[]): Promise<RestrictionResult> {
    try {
      const nativeCleared = await RhythmDeviceModule.clearShieldRestrictions(appIds);
      if (nativeCleared === true) {
        for (const id of appIds) {
          this.activeRestrictedApps.delete(id);
        }
        return {
          status: 'applied',
          appIds,
        };
      }
    } catch {
      // Platform restriction boundary
    }

    return {
      status: 'unsupported',
      appIds,
    };
  }

  async getActiveRestrictedApps(): Promise<string[]> {
    return Array.from(this.activeRestrictedApps);
  }

  async getCapability(): Promise<'enforced' | 'foundation-only' | 'unsupported'> {
    return 'foundation-only';
  }
}
