import { DeviceApp, RiskGroup, RoutineWindow } from '../types/domain';

/**
 * Finds a routine window by type.
 */
export function getRoutineWindow(
  windows: RoutineWindow[],
  type: RoutineWindow['type']
): RoutineWindow | undefined {
  return windows.find((window) => window.type === type);
}

/**
 * Finds a risk group by ID.
 */
export function getRiskGroup(
  groups: RiskGroup[],
  id: string
): RiskGroup | undefined {
  return groups.find((group) => group.id === id);
}

/**
 * Determines which field is user-editable on a routine window card.
 * For Morning Buffer: endTime is when apps unlock (e.g. 08:00).
 * For Evening Wind-Down & others: startTime is when downtime begins (e.g. 21:30).
 */
export function getEditableTimeField(
  window: RoutineWindow
): 'startTime' | 'endTime' {
  return window.type === 'morning-buffer' ? 'endTime' : 'startTime';
}

/**
 * Retrieves the primary user-facing target time for a routine window.
 */
export function getRoutineTargetTime(window: RoutineWindow): string {
  if (window.type === 'morning-buffer') {
    return window.endTime || window.startTime;
  }
  return window.startTime;
}

/**
 * Canonical derivation: find all routine windows protecting a specific risk group.
 */
export function getProtectedWindowIdsForGroup(
  windows: RoutineWindow[],
  groupId: string
): string[] {
  return windows
    .filter((window) => window.protectedGroupIds.includes(groupId))
    .map((window) => window.id);
}

/**
 * Invariant safety: only apps strictly classified as 'risk' can ever be restricted.
 * Essential and Normal apps are excluded from restrictions.
 */
export function getRestrictableAppIds(
  appIds: string[],
  apps: DeviceApp[]
): string[] {
  return appIds.filter((id) => {
    const app = apps.find((item) => item.id === id);
    return app?.classification === 'risk';
  });
}

/**
 * Creates a unique, URL-safe Risk Group ID that does not collide with existing IDs.
 */
export function createUniqueGroupId(
  name: string,
  existingIds: string[]
): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'group';

  let id = base;
  let index = 2;

  while (existingIds.includes(id)) {
    id = `${base}-${index++}`;
  }

  return id;
}

/**
 * Formats total seconds into HH:MM:SS string.
 */
export function formatSecondsToHHMMSS(totalSeconds: number): string {
  const safeSecs = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safeSecs / 3600);
  const mins = Math.floor((safeSecs % 3600) / 60);
  const secs = safeSecs % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins
    .toString()
    .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
