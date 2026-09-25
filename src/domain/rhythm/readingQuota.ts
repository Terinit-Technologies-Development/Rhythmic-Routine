import {
  AttentionGateStatus,
  DailyAttentionExchangeState,
  DEFAULT_READING_ATTENTION_POLICY,
  ReadingAttentionPolicy,
  requirementForCooldownOrdinal,
} from './attentionExchange';
import { ReadingEvidenceSnapshot } from './readingEvidence';

/**
 * v1.2.0: resolves the reading-quota view for the Today surface.
 *
 * The daily quota is the verified Reader progress for the active local day.
 * Cooldown quotas are the global-ordinal reading requirements that Routine
 * assigns when a Risk Group exhausts its allowance.
 */
export interface ReadingQuotaActiveTarget {
  groupId: string;
  ordinal?: number;
  phase: AttentionGateStatus['phase'];
  requiredSeconds: number;
  requiredPages: number;
  verifiedSeconds: number;
  verifiedPages: number;
  remainingSeconds: number;
  remainingPages: number;
  cooldownEndsAt?: number;
}

export interface ReadingQuotaView {
  dateKey: string;
  evidenceAvailable: boolean;
  evidenceProtocolCompatible: boolean;
  verifiedSeconds: number;
  qualifiedPages: number;
  cooldownsTriggered: number;
  nextOrdinal: number;
  nextRequiredSeconds: number;
  nextRequiredPages: number;
  nextHasReadingQuota: boolean;
  activeTarget?: ReadingQuotaActiveTarget;
}

export interface ReadingQuotaInput {
  dateKey: string;
  evidence?: ReadingEvidenceSnapshot;
  dailyAttentionExchange?: DailyAttentionExchangeState;
  attentionStatus?: AttentionGateStatus;
  policy?: ReadingAttentionPolicy;
}

export function resolveReadingQuotaView(input: ReadingQuotaInput): ReadingQuotaView {
  const policy = input.policy ?? DEFAULT_READING_ATTENTION_POLICY;
  const evidence = input.evidence?.dateKey === input.dateKey ? input.evidence : undefined;
  const evidenceAvailable = Boolean(evidence?.providerAvailable && evidence.protocolCompatible);

  const triggeredToday =
    input.dailyAttentionExchange?.dateKey === input.dateKey
      ? input.dailyAttentionExchange.cooldownsTriggered
      : 0;
  const cooldownsTriggered = Math.max(triggeredToday, input.attentionStatus?.ordinal ?? 0);
  const nextOrdinal = cooldownsTriggered + 1;
  const nextRequirement = requirementForCooldownOrdinal(nextOrdinal, policy);

  const activeTarget = resolveActiveTarget(input.attentionStatus, evidenceAvailable);

  return {
    dateKey: input.dateKey,
    evidenceAvailable,
    evidenceProtocolCompatible: Boolean(evidence?.protocolCompatible),
    verifiedSeconds: evidenceAvailable ? evidence!.verifiedActiveSeconds : 0,
    qualifiedPages: evidenceAvailable ? evidence!.qualifiedPages : 0,
    cooldownsTriggered,
    nextOrdinal,
    nextRequiredSeconds: nextRequirement.activeSeconds,
    nextRequiredPages: nextRequirement.qualifiedPages,
    nextHasReadingQuota:
      nextRequirement.activeSeconds > 0 || nextRequirement.qualifiedPages > 0,
    activeTarget,
  };
}

function resolveActiveTarget(
  status: AttentionGateStatus | undefined,
  evidenceAvailable: boolean
): ReadingQuotaActiveTarget | undefined {
  if (!status || status.phase === 'none') return undefined;
  const requiredSeconds = Math.max(0, status.requiredReadingSeconds);
  const requiredPages = Math.max(0, status.requiredQualifiedPages);
  if (requiredSeconds <= 0 && requiredPages <= 0) return undefined;

  const verifiedSeconds = evidenceAvailable ? Math.max(0, status.verifiedReadingSeconds) : 0;
  const verifiedPages = evidenceAvailable ? Math.max(0, status.qualifiedPages) : 0;

  return {
    groupId: status.groupId,
    ...(status.ordinal !== undefined ? { ordinal: status.ordinal } : {}),
    phase: status.phase,
    requiredSeconds,
    requiredPages,
    verifiedSeconds,
    verifiedPages,
    remainingSeconds: Math.max(0, requiredSeconds - verifiedSeconds),
    remainingPages: Math.max(0, requiredPages - verifiedPages),
    ...(status.cooldownEndsAt !== undefined ? { cooldownEndsAt: status.cooldownEndsAt } : {}),
  };
}
