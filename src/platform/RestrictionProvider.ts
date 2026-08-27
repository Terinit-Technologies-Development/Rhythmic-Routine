export interface RestrictionProvider {
  /**
   * Applies temporary restriction overlay/blocking to specified applications.
   */
  applyRestrictions(appIds: string[]): Promise<void>;

  /**
   * Removes restrictions for specified applications.
   */
  clearRestrictions(appIds: string[]): Promise<void>;

  /**
   * Retrieves list of currently restricted application IDs.
   */
  getActiveRestrictedApps(): Promise<string[]>;
}
