export type RestrictionApplyStatus = 'applied' | 'unsupported' | 'failed';

export type EnforcementMode =
  | 'continuous-session'
  | 'system-activity-threshold'
  | 'routine-only'
  | 'foundation-only'
  | 'unsupported';

export interface RestrictionCapability {
  status: 'enforced' | 'foundation-only' | 'unsupported';
  mode: EnforcementMode;
  supportsRoutineWindows: boolean;
  supportsGroupCooldowns: boolean;
  supportsContinuousSessionGap: boolean;
  supportsEmergencyOverride: boolean;
  reason?: string;
}

export interface RestrictionResult {
  status: RestrictionApplyStatus;
  appIds: string[];
  reason?: string;
}

export interface RestrictionProvider {
  /**
   * Applies shielding restrictions to the given app IDs.
   */
  applyRestrictions(appIds: string[]): Promise<RestrictionResult>;

  /**
   * Clears shielding restrictions for the given app IDs.
   */
  clearRestrictions(appIds: string[]): Promise<RestrictionResult>;

  /**
   * Returns list of currently confirmed restricted app IDs.
   */
  getActiveRestrictedApps(): Promise<string[]>;

  /**
   * Reports the actual platform capability state truthfully.
   */
  getCapability(): Promise<RestrictionCapability>;
}
