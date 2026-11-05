import {
  MEDITATION_PROTOCOL_VERSION,
  hasMeditationIdentityMetadata,
  type MeditationEvidenceBridge,
  type MeditationEvidenceResult,
  type MeditationProviderAvailability,
  type MeditationQueryStatus,
  type MeditationRecoveryRequestPayload,
  type MeditationSessionEvidence,
} from '../domain/rhythm/meditationEvidence';
import { parseMeditationSessionEvidence } from '../domain/rhythm/meditationEvidence';

/**
 * Native bridge to the Rhythmic Meditation companion app.
 *
 * The Kotlin side enforces the trust boundary (deny-by-default package +
 * signing-certificate verification against Routine's own signer); this side
 * only translates the wire contract:
 *
 *   action  com.terinit.rhythmicmeditation.action.START_MEDITATION_RECOVERY
 *   extra   extra_request_payload (Bundle fields)
 *   status  content://com.terinit.rhythmicmeditation.status
 *
 * The native module is required lazily so pure domain/unit tests never pull
 * react-native into their module graph.
 */

type NativeMeditationModule = {
  isMeditationAvailable(): Promise<string>;
  startMeditationRecoverySession(request: Record<string, unknown>): Promise<boolean>;
  queryMeditationStatus(sessionId: string): Promise<Record<string, unknown> | null>;
  queryMeditationStatusDetailed?(sessionId: string): Promise<Record<string, unknown> | null>;
};

let nativeModule: Partial<NativeMeditationModule> | undefined;
let nativeModuleOverride: Partial<NativeMeditationModule> | undefined;

/** Test-only native module boundary; production continues through requireNativeModule. */
export function setNativeMeditationModuleForTests(
  module: Partial<NativeMeditationModule> | undefined
): void {
  nativeModuleOverride = module;
}

function native(): Partial<NativeMeditationModule> {
  if (nativeModuleOverride) return nativeModuleOverride;
  if (nativeModule) return nativeModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('expo-modules-core') as {
      requireNativeModule(name: string): Partial<NativeMeditationModule>;
    };
    nativeModule = core.requireNativeModule('RhythmDevice');
  } catch {
    nativeModule = {};
  }
  return nativeModule;
}

function normalizeAvailability(value: string | undefined): MeditationProviderAvailability {
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

function normalizeQueryStatus(value: unknown): MeditationQueryStatus | undefined {
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

/**
 * Builds the cooldown Meditation request for a bound gate session
 * (spec: session_kind COOLDOWN_RESTORATIVE, 1800 seconds, source ids).
 */
export function buildCooldownMeditationRequest(input: {
  sessionId: string;
  sourceCooldownId: string;
  sourceRiskGroupId: string;
  sourceRhythmicDayId: string;
  createdAtEpochMs: number;
  requiredQualifiedSeconds?: number;
  expiresAtEpochMs?: number;
}): MeditationRecoveryRequestPayload {
  return {
    session_id: input.sessionId,
    protocol_version: MEDITATION_PROTOCOL_VERSION,
    session_kind: 'COOLDOWN_RESTORATIVE',
    required_qualified_seconds: input.requiredQualifiedSeconds ?? 1800,
    created_at_epoch_ms: input.createdAtEpochMs,
    ...(input.expiresAtEpochMs !== undefined
      ? { expires_at_epoch_ms: input.expiresAtEpochMs }
      : {}),
    source_cooldown_id: input.sourceCooldownId,
    source_risk_group_id: input.sourceRiskGroupId,
    source_rhythmic_day_id: input.sourceRhythmicDayId,
  };
}

/** Builds the Routine-authoritative morning session request. */
export function buildMorningMeditationRequest(input: {
  sessionId: string;
  sourceRhythmicDayId: string;
  createdAtEpochMs: number;
  requiredQualifiedSeconds?: number;
}): MeditationRecoveryRequestPayload {
  return {
    session_id: input.sessionId,
    protocol_version: MEDITATION_PROTOCOL_VERSION,
    session_kind: 'MORNING_REQUIRED',
    required_qualified_seconds: input.requiredQualifiedSeconds ?? 1800,
    created_at_epoch_ms: input.createdAtEpochMs,
    source_rhythmic_day_id: input.sourceRhythmicDayId,
  };
}

export const nativeMeditationBridge: MeditationEvidenceBridge = {
  async isMeditationAvailable(): Promise<MeditationProviderAvailability> {
    try {
      return normalizeAvailability(await native().isMeditationAvailable?.());
    } catch {
      return 'unavailable';
    }
  },

  async startMeditationRecoverySession(
    request: MeditationRecoveryRequestPayload
  ): Promise<boolean> {
    try {
      return (
        (await native().startMeditationRecoverySession?.(
          request as unknown as Record<string, unknown>
        )) === true
      );
    } catch {
      return false;
    }
  },

  async queryMeditationStatus(
    sessionId: string
  ): Promise<MeditationSessionEvidence | null> {
    try {
      const raw = await native().queryMeditationStatus?.(sessionId);
      return parseMeditationSessionEvidence(raw ?? null);
    } catch {
      return null;
    }
  },

  async queryMeditationStatusResult(
    sessionId: string
  ): Promise<MeditationEvidenceResult> {
    const availability = await this.isMeditationAvailable();
    if (availability !== 'available') {
      return { availability, queryStatus: availability };
    }
    try {
      if (native().queryMeditationStatusDetailed) {
        const raw = await native().queryMeditationStatusDetailed?.(sessionId);
        if (!raw) {
          return { availability: 'unavailable', queryStatus: 'unavailable' };
        }
        const evidenceRaw = raw.evidence as Record<string, unknown> | null | undefined;
        const evidence = evidenceRaw ? parseMeditationSessionEvidence(evidenceRaw) : undefined;
        const queryStatus = normalizeQueryStatus(raw.queryStatus);
        const availability = normalizeAvailability(
          typeof raw.availability === 'string' ? raw.availability : undefined
        );
        if (queryStatus !== 'available' || availability !== 'available') {
          return {
            availability: availability === 'available' ? 'unavailable' : availability,
            queryStatus: queryStatus && queryStatus !== 'available' ? queryStatus : 'corrupt',
            identityMetadataAvailable: false,
            ...(queryStatus === 'session-missing' ? { sessionMissing: true } : {}),
          };
        }
        if (!evidence || evidence.sessionId !== sessionId) {
          return {
            availability: 'unavailable',
            queryStatus: 'corrupt',
            identityMetadataAvailable: false,
          };
        }
        return {
          availability,
          ...(queryStatus ? { queryStatus } : {}),
          ...(evidence ? { evidence } : {}),
          identityMetadataAvailable: raw.identityMetadataAvailable === true,
        };
      }

      const raw = await native().queryMeditationStatus?.(sessionId);
      if (!raw) {
        // A legacy seven-column bridge cannot positively distinguish an unknown
        // session from a query failure/denial. Never call this sessionMissing.
        return {
          availability: 'unavailable',
          queryStatus: 'legacy-ambiguous-null',
          sessionMissing: false,
        };
      }
      const evidence = parseMeditationSessionEvidence(raw);
      if (!evidence) {
        return { availability: 'unavailable', queryStatus: 'corrupt' };
      }
      return {
        availability: 'available',
        queryStatus: 'available',
        evidence,
        identityMetadataAvailable: hasMeditationIdentityMetadata(evidence),
      };
    } catch {
      return { availability: 'unavailable', queryStatus: 'query-failed' };
    }
  },
};
