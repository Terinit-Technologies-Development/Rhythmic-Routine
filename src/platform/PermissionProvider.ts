export interface PermissionState {
  usageAccess: 'unknown' | 'granted' | 'denied';
  restrictionAccess: 'unknown' | 'granted' | 'denied' | 'unsupported';
}

/**
 * PermissionProvider abstraction for native OS authorization flows.
 * Handles Android Usage Access & iOS Family Controls authorization.
 */
export interface PermissionProvider {
  /**
   * Retrieves the current permission state across usage and restrictions.
   */
  getStatus(): Promise<PermissionState>;

  /**
   * Triggers the platform-specific flow for Usage Access
   * (e.g. opens Settings.ACTION_USAGE_ACCESS_SETTINGS on Android,
   * or requests FamilyControls AuthorizationCenter on iOS).
   */
  requestUsageAccess(): Promise<void>;

  /**
   * Triggers restriction access authorization if required by the platform.
   */
  requestRestrictionAccess(): Promise<void>;
}
