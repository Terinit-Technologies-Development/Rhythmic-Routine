import RhythmDeviceModule, {
  FallbackModule,
  NativeRecoveryStatus,
} from '../../../modules/rhythm-device';

export interface ReadingRecoveryTarget {
  requiredSeconds: number;
  requiredPages: number;
}

/** @deprecated Protocol V1 compatibility only. v1.2 policy uses daily Reader V2 evidence. */
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

export type RecoveryProviderAvailability =
  | 'available'
  | 'not-installed'
  | 'untrusted-signature'
  | 'permission-denied'
  | 'protocol-incompatible'
  | 'unavailable';

export type RecoveryQueryStatus =
  | RecoveryProviderAvailability
  | 'session-missing'
  | 'corrupt'
  | 'query-failed'
  | 'legacy-ambiguous-null';

/** Additive typed Reader V1 result; absence is never treated as completion. */
export interface RecoveryEvidenceResult {
  availability: RecoveryProviderAvailability;
  queryStatus: RecoveryQueryStatus;
  evidence?: RecoverySessionInfo;
  sessionMissing?: boolean;
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
  /** Additive typed query; legacy clients may omit it. */
  queryRecoveryStatusResult?(sessionId: string): Promise<RecoveryEvidenceResult>;
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

  async queryRecoveryStatusResult(sessionId: string): Promise<RecoveryEvidenceResult> {
    try {
      const detailed = (RhythmDeviceModule as {
        queryRecoveryStatusDetailed?: (id: string) => Promise<Record<string, unknown> | null>;
      }).queryRecoveryStatusDetailed;
      const isFallbackDetailed = detailed === FallbackModule.queryRecoveryStatusDetailed;
      if (typeof detailed === 'function' && !isFallbackDetailed) {
        const raw = await detailed(sessionId);
        if (!raw) {
          return { availability: 'unavailable', queryStatus: 'unavailable' };
        }
        const availability = normalizeRecoveryAvailability(raw.availability);
        const queryStatus = normalizeRecoveryQueryStatus(raw.queryStatus);
        if (availability !== 'available' || queryStatus !== 'available') {
          return {
            availability: availability === 'available' ? 'unavailable' : availability,
            queryStatus: queryStatus === 'available' ? 'corrupt' : queryStatus ?? 'corrupt',
            ...(queryStatus === 'session-missing' ? { sessionMissing: true } : {}),
          };
        }
        const evidence = parseRecoveryEvidence(raw.evidence, sessionId);
        if (!evidence) {
          return { availability: 'unavailable', queryStatus: 'corrupt' };
        }
        return { availability: 'available', queryStatus: 'available', evidence };
      }

      const raw = await this.queryRecoveryStatus(sessionId);
      if (!raw) {
        // A legacy nullable bridge cannot positively distinguish unknown-session
        // from provider error; never declare it satisfied.
        return { availability: 'unavailable', queryStatus: 'legacy-ambiguous-null' };
      }
      return { availability: 'available', queryStatus: 'available', evidence: raw };
    } catch {
      return { availability: 'unavailable', queryStatus: 'query-failed' };
    }
  }
}

function normalizeRecoveryAvailability(value: unknown): RecoveryProviderAvailability {
  switch (value) {
    case 'available':
    case 'not-installed':
    case 'untrusted-signature':
    case 'permission-denied':
    case 'protocol-incompatible':
    case 'unavailable':
      return value;
    default:
      return 'unavailable';
  }
}

function normalizeRecoveryQueryStatus(value: unknown): RecoveryQueryStatus | undefined {
  switch (value) {
    case 'available':
    case 'not-installed':
    case 'untrusted-signature':
    case 'permission-denied':
    case 'protocol-incompatible':
    case 'session-missing':
    case 'corrupt':
    case 'query-failed':
    case 'unavailable':
    case 'legacy-ambiguous-null':
      return value;
    default:
      return undefined;
  }
}

function parseRecoveryEvidence(
  raw: unknown,
  sessionId: string
): RecoverySessionInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const statuses: RecoverySessionStatus[] = [
    'ACTIVE',
    'COMPLETE',
    'ABANDONED',
    'EXPIRED',
    'UNAVAILABLE',
    'UNKNOWN',
  ];
  const parsedStatus = typeof value.status === 'string' ? value.status : '';
  const protocolVersion = Number(value.protocolVersion);
  const activeSeconds = Number(value.activeSeconds);
  const qualifiedPages = Number(value.qualifiedPages);
  const completedAtEpochMs = Number(value.completedAtEpochMs);
  if (
    typeof value.sessionId !== 'string' ||
    value.sessionId !== sessionId ||
    !Number.isInteger(protocolVersion) ||
    protocolVersion !== 1 ||
    !(statuses as string[]).includes(parsedStatus) ||
    !Number.isFinite(activeSeconds) ||
    activeSeconds < 0 ||
    !Number.isInteger(qualifiedPages) ||
    qualifiedPages < 0 ||
    !Number.isFinite(completedAtEpochMs) ||
    completedAtEpochMs < 0
  ) {
    return undefined;
  }
  return {
    sessionId: value.sessionId,
    protocolVersion,
    status: parsedStatus as RecoverySessionStatus,
    activeSeconds,
    qualifiedPages,
    completedAtEpochMs,
  };
}

/**
 * First cycle free rule:
 * Cycle 1 (initial allowance exhaustion of the day) grants free re-entry without reading recovery.
 * Subsequent exhaustion cycles (> 1) require completed reading recovery sessions.
 */
/** @deprecated Legacy per-group session model; do not use for v1.2 global ordinal policy. */
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
