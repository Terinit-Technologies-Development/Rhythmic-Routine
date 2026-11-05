import {
  NativeAccessLeasePolicy,
  RestrictionCapability,
  RestrictionLeaseResult,
  RestrictionProvider,
  RestrictionResult,
} from '../RestrictionProvider';

export class MockRestrictionProvider implements RestrictionProvider {
  private activeRestrictedApps: Set<string> = new Set();
  private activeLeases: Map<string, NativeAccessLeasePolicy> = new Map();

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

  async getCapability(): Promise<RestrictionCapability> {
    return {
      status: 'enforced',
      mode: 'continuous-session',
      supportsRoutineWindows: true,
      supportsGroupCooldowns: true,
      supportsContinuousSessionGap: true,
      supportsEmergencyOverride: true,
      reason: 'Mock/Web simulation environment',
    };
  }

  async startAccessLease(lease: NativeAccessLeasePolicy): Promise<RestrictionLeaseResult> {
    this.activeLeases.set(lease.groupId, lease);
    return { status: 'applied', groupId: lease.groupId };
  }

  async endAccessLease(groupId: string): Promise<RestrictionLeaseResult> {
    this.activeLeases.delete(groupId);
    return { status: 'applied', groupId };
  }
}

export const mockRestrictionProvider = new MockRestrictionProvider();
