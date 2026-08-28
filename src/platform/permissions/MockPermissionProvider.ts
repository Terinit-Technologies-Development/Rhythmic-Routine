import { PermissionProvider, PermissionState } from '../PermissionProvider';

export class MockPermissionProvider implements PermissionProvider {
  private state: PermissionState;

  constructor(
    initialState: PermissionState = {
      usageAccess: 'granted',
      restrictionAccess: 'granted',
    }
  ) {
    this.state = { ...initialState };
  }

  async getStatus(): Promise<PermissionState> {
    return { ...this.state };
  }

  async requestUsageAccess(): Promise<void> {
    this.state.usageAccess = 'granted';
  }

  async requestRestrictionAccess(): Promise<void> {
    this.state.restrictionAccess = 'granted';
  }

  /**
   * Test helper to simulate permissions being denied or revoked.
   */
  setMockStatus(status: Partial<PermissionState>): void {
    this.state = {
      ...this.state,
      ...status,
    };
  }
}
