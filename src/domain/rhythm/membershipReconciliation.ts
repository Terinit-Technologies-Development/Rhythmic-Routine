import { DeviceApp, RiskGroup } from '../../types/domain';

/**
 * Reconciles Risk Group membership strictly from authoritative DeviceApp state.
 *
 * Invariants:
 * 1. An app appears in group.appIds if and only if app.classification === 'risk' and app.riskGroupId === group.id.
 * 2. Stale IDs (such as mock demo IDs 'instagram', 'x' or removed package IDs) never remain authoritative.
 * 3. An app classified as 'essential', 'normal', or 'unclassified' is never included in any group.
 */
export function reconcileRiskGroupMembership(
  apps: DeviceApp[],
  riskGroups: RiskGroup[]
): RiskGroup[] {
  return riskGroups.map((group) => ({
    ...group,
    appIds: apps
      .filter((app) => app.classification === 'risk' && app.riskGroupId === group.id)
      .map((app) => app.id),
  }));
}
