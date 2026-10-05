/**
 * Meditation evidence — the trust boundary for cooldown Meditation gates.
 *
 * Rhythmic Meditation is an evidence provider only. A gate may be satisfied
 * ONLY from durable provider evidence for the EXACT bound session id:
 *
 *   status === 'COMPLETED'
 *   AND completedQualifiedSeconds >= requiredQualifiedSeconds (1800)
 *   AND protocolVersion === 1
 *
 * Never trust: session launch, ACTIVE state, wall-clock duration, the user
 * returning from Meditation, or an Intent result code alone.
 *
 * Provider errors NEVER fail open: any unavailable/untrusted/incompatible/
 * missing/corrupt state leaves the gate incomplete.
 */

/** Meditation protocol contract version (MeditationProtocol.PROTOCOL_VERSION). */
export const MEDITATION_PROTOCOL_VERSION = 1;

/** The cooldown Meditation requirement: 30 qualified minutes. */
export const DEFAULT_MEDITATION_REQUIRED_SECONDS = 1800;

export type MeditationProviderAvailability =
  | 'available'
  | 'not-installed'
  | 'untrusted-signature'
  | 'protocol-incompatible'
  | 'unavailable';

export type MeditationSessionStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'INVALID'
  | 'UNKNOWN';

/** Durable status exposed by Meditation's status provider (7 columns only). */
export interface MeditationSessionEvidence {
  sessionId: string;
  protocolVersion: number;
  status: MeditationSessionStatus;
  requiredQualifiedSeconds: number;
  completedQualifiedSeconds: number;
  completedAtEpochMs: number | null;
  lastUpdatedAtEpochMs: number;
}

export interface MeditationEvidenceResult {
  availability: MeditationProviderAvailability;
  /** Present only when the provider answered for the exact session id. */
  evidence?: MeditationSessionEvidence;
  /** 'session-missing' / 'session-corrupt' are availability-neutral failures. */
  sessionMissing?: boolean;
}

/** Wire payload sent to Meditation (Bundle fields of extra_request_payload). */
export interface MeditationRecoveryRequestPayload {
  session_id: string;
  protocol_version: number;
  session_kind: 'MORNING_REQUIRED' | 'COOLDOWN_RESTORATIVE';
  required_qualified_seconds: number;
  created_at_epoch_ms: number;
  expires_at_epoch_ms?: number;
  source_cooldown_id?: string;
  source_risk_group_id?: string;
  source_rhythmic_day_id?: string;
}

/** Bridge to the native layer (Kotlin meditation client). */
export interface MeditationEvidenceBridge {
  isMeditationAvailable(): Promise<MeditationProviderAvailability>;
  startMeditationRecoverySession(
    request: MeditationRecoveryRequestPayload
  ): Promise<boolean>;
  queryMeditationStatus(sessionId: string): Promise<MeditationSessionEvidence | null>;
}

/**
 * The single trusted-completion rule. Strict by construction:
 * exact session id, protocol 1, COMPLETED, and enough QUALIFIED monotonic time.
 */
export function isVerifiedMeditationCompletion(input: {
  evidence?: MeditationSessionEvidence | null;
  sessionId: string;
  requiredQualifiedSeconds?: number;
}): boolean {
  const {
    evidence,
    sessionId,
    requiredQualifiedSeconds = DEFAULT_MEDITATION_REQUIRED_SECONDS,
  } = input;
  if (!evidence) return false;
  return (
    evidence.sessionId === sessionId &&
    evidence.protocolVersion === MEDITATION_PROTOCOL_VERSION &&
    evidence.status === 'COMPLETED' &&
    Number.isFinite(evidence.completedQualifiedSeconds) &&
    evidence.completedQualifiedSeconds >= requiredQualifiedSeconds &&
    Number.isFinite(evidence.requiredQualifiedSeconds) &&
    evidence.requiredQualifiedSeconds >= requiredQualifiedSeconds
  );
}

/** Parses an untyped provider row; corrupt rows are reported, never trusted. */
export function parseMeditationSessionEvidence(
  raw: Record<string, unknown> | null | undefined
): MeditationSessionEvidence | null {
  if (!raw) return null;
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : '';
  const protocolVersion = Number(raw.protocolVersion);
  const status = typeof raw.status === 'string' ? raw.status : '';
  const requiredQualifiedSeconds = Number(raw.requiredQualifiedSeconds);
  const completedQualifiedSeconds = Number(raw.completedQualifiedSeconds);
  const completedAtEpochMs =
    raw.completedAtEpochMs === null || raw.completedAtEpochMs === undefined
      ? null
      : Number(raw.completedAtEpochMs);
  const lastUpdatedAtEpochMs = Number(raw.lastUpdatedAtEpochMs);

  const corrupt =
    sessionId.length === 0 ||
    !Number.isFinite(protocolVersion) ||
    !Number.isFinite(requiredQualifiedSeconds) ||
    !Number.isFinite(completedQualifiedSeconds) ||
    (completedAtEpochMs !== null && !Number.isFinite(completedAtEpochMs)) ||
    !Number.isFinite(lastUpdatedAtEpochMs);
  if (corrupt) return null;

  const knownStatus: MeditationSessionStatus[] = [
    'PENDING',
    'ACTIVE',
    'PAUSED',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED',
    'INVALID',
    'UNKNOWN',
  ];
  return {
    sessionId,
    protocolVersion,
    status: (knownStatus as string[]).includes(status)
      ? (status as MeditationSessionStatus)
      : 'UNKNOWN',
    requiredQualifiedSeconds,
    completedQualifiedSeconds,
    completedAtEpochMs,
    lastUpdatedAtEpochMs,
  };
}
