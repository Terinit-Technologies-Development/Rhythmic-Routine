export interface PermissionState {
  usageAccess: 'unknown' | 'granted' | 'denied';
  restrictionAuthorization: 'unknown' | 'granted' | 'denied' | 'unsupported';
  restrictionCapability: 'enforced' | 'foundation-only' | 'unsupported';
}

/**
 * PermissionProvider abstraction for native OS authorization flows.
 * Accurately distinguishes between observation permissions, authorization, and actual enforcement capability.
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
