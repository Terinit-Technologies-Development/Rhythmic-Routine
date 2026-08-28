import { DeviceApp, RiskGroup } from '../../types/domain';
import { ActiveRiskSession, SESSION_RESET_GAP_MS } from './types';

/**
 * Finds the risk group ID for a specific app if it is classified as 'risk'.
 */
export function getAppRiskGroupId(appId: string, apps: DeviceApp[]): string | undefined {
  const app = apps.find((a) => a.id === appId);
  if (app && app.classification === 'risk') {
    return app.riskGroupId;
  }
  return undefined;
}

/**
 * Evaluates whether an existing active session should be continued when a new app event occurs.
 * If the app belongs to the same Risk Group and occurred within the inactivity gap (or while actively in foreground),
 * the session continues.
 */
export function shouldContinueSession(
  session: ActiveRiskSession,
  nextGroupId: string,
  timestamp: number,
  gapMs: number = SESSION_RESET_GAP_MS
): boolean {
  if (session.groupId !== nextGroupId) return false;
  if (session.activeAppId) return true;
  return timestamp - session.lastActivityAt <= gapMs;
}

/**
 * Creates a brand new continuous risk session.
 */
export function createNewRiskSession(
  groupId: string,
  appId: string,
  timestamp: number
): ActiveRiskSession {
  return {
    groupId,
    startedAt: timestamp,
    lastActivityAt: timestamp,
    accumulatedSeconds: 0,
    activeAppId: appId,
  };
}

/**
 * Records active foreground usage.
 * Only intervals where an app in the group was actively in foreground increment accumulatedSeconds.
 */
export function recordActiveUsage(
  session: ActiveRiskSession,
  appId: string | undefined,
  timestamp: number
): ActiveRiskSession {
  const elapsed = session.activeAppId
    ? Math.max(0, Math.floor((timestamp - session.lastActivityAt) / 1000))
    : 0;

  return {
    ...session,
    accumulatedSeconds: session.accumulatedSeconds + elapsed,
    lastActivityAt: timestamp,
    activeAppId: appId,
  };
}

/**
 * Resumes an existing continuous Risk Group session after an inactive gap (within tolerance).
 * Updates the activity pointer without counting the inactive gap as screen usage.
 */
export function resumeRiskSession(
  session: ActiveRiskSession,
  appId: string,
  timestamp: number
): ActiveRiskSession {
  return {
    ...session,
    lastActivityAt: timestamp,
    activeAppId: appId,
  };
}

/**
 * Checks whether an active session has reached or exceeded the group continuous session threshold.
 */
export function isThresholdReached(
  session: ActiveRiskSession,
  group: RiskGroup
): boolean {
  if (!group || !group.sessionThresholdMinutes || group.sessionThresholdMinutes <= 0) {
    return false;
  }
  return session.accumulatedSeconds >= group.sessionThresholdMinutes * 60;
}
