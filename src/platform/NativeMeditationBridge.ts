import {
  MEDITATION_PROTOCOL_VERSION,
  type MeditationEvidenceBridge,
  type MeditationProviderAvailability,
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
};

let nativeModule: Partial<NativeMeditationModule> | undefined;

function native(): Partial<NativeMeditationModule> {
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
    case 'protocol-incompatible':
    case 'unavailable':
      return value;
    default:
      return 'unavailable';
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
};
