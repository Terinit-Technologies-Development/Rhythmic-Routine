import RhythmDeviceModule, { NativeRecoveryStatus } from '../../../modules/rhythm-device';

export interface ReadingRecoveryTarget {
  requiredSeconds: number;
  requiredPages: number;
}

export const DEFAULT_READING_RECOVERY_TARGET: ReadingRecoveryTarget = {
  requiredSeconds: 1800, // 30 minutes
  requiredPages: 10,
};

export type RecoverySessionStatus =
  | 'ACTIVE'
  | 'COMPLETE'
  | 'ABANDONED'
  | 'EXPIRED'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export interface RecoverySessionInfo {
  sessionId: string;
  protocolVersion: number;
  status: RecoverySessionStatus;
  activeSeconds: number;
  qualifiedPages: number;
  completedAtEpochMs: number;
}

export interface RecoveryProviderClient {
  isReaderAvailable(): Promise<boolean>;
  startRecoverySession(request: {
    sessionId: string;
    requiredSeconds: number;
    requiredPages: number;
    createdAt: number;
    expiresAt: number;
  }): Promise<boolean>;
  queryRecoveryStatus(sessionId: string): Promise<RecoverySessionInfo | null>;
}

export class NativeRecoveryProviderClient implements RecoveryProviderClient {
  async isReaderAvailable(): Promise<boolean> {
    try {
      return await RhythmDeviceModule.isReaderAvailable();
    } catch {
      return false;
    }
  }

  async startRecoverySession(request: {
    sessionId: string;
    requiredSeconds: number;
    requiredPages: number;
    createdAt: number;
    expiresAt: number;
  }): Promise<boolean> {
    try {
      return await RhythmDeviceModule.startRecoverySession(
        request.sessionId,
        request.requiredSeconds,
        request.requiredPages,
        request.createdAt,
        request.expiresAt
      );
    } catch {
      return false;
    }
  }

  async queryRecoveryStatus(sessionId: string): Promise<RecoverySessionInfo | null> {
    try {
      const raw: NativeRecoveryStatus | null = await RhythmDeviceModule.queryRecoveryStatus(sessionId);
      if (!raw) return null;
      return {
        sessionId: raw.sessionId,
        protocolVersion: raw.protocolVersion,
        status: raw.status as RecoverySessionStatus,
        activeSeconds: raw.activeSeconds,
        qualifiedPages: raw.qualifiedPages,
        completedAtEpochMs: raw.completedAtEpochMs,
      };
    } catch {
      return null;
    }
  }
}

/**
 * First cycle free rule:
 * Cycle 1 (initial allowance exhaustion of the day) grants free re-entry without reading recovery.
 * Subsequent exhaustion cycles (> 1) require completed reading recovery sessions.
 */
export function isRecoveryRequiredForCycle(cycleNumber: number): boolean {
  return cycleNumber > 1;
}

/**
 * Generates an RFC 4122 v4 UUID string for cross-application session tracking.
 */
export function generateRecoverySessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface ReentryEvaluationContext {
  now?: number;
  cooldownEndsAt: number;
  recoveryRequired: boolean;
  recoveryStatus?: RecoverySessionStatus | null;
  readerAvailable: boolean;
}

export interface ReentryEvaluationResult {
  reentryEligible: boolean;
  cooldownElapsed: boolean;
  recoverySatisfied: boolean;
  reason: string;
}

/**
 * Pure policy evaluation for cooldown re-entry eligibility.
 *
 * Core invariant:
 * reentryEligible = cooldownElapsed && recoverySatisfied
 *
 * Fail-closed policy: If recovery is required but Rhythmic Reader is missing or unresponsive,
 * re-entry remains strictly locked.
 */
export function evaluateReentryEligibility(
  context: ReentryEvaluationContext
): ReentryEvaluationResult {
  const now = context.now ?? Date.now();
  const cooldownElapsed = now >= context.cooldownEndsAt;

  if (!context.recoveryRequired) {
    return {
      reentryEligible: cooldownElapsed,
      cooldownElapsed,
      recoverySatisfied: true,
      reason: cooldownElapsed ? 'Cooldown elapsed (no recovery required)' : 'Cooldown active',
    };
  }

  // Recovery is required
  if (!context.readerAvailable) {
    return {
      reentryEligible: false,
      cooldownElapsed,
      recoverySatisfied: false,
      reason: 'Rhythmic Reader is not available (fail-closed)',
    };
  }

  const isComplete = context.recoveryStatus === 'COMPLETE';
  const recoverySatisfied = isComplete;
  const reentryEligible = cooldownElapsed && recoverySatisfied;

  let reason: string;
  if (!recoverySatisfied) {
    reason = `Reading recovery incomplete (status: ${context.recoveryStatus ?? 'NONE'})`;
  } else if (!cooldownElapsed) {
    reason = 'Reading recovery complete, cooldown in progress';
  } else {
    reason = 'Eligible for re-entry';
  }

  return {
    reentryEligible,
    cooldownElapsed,
    recoverySatisfied,
    reason,
  };
}
