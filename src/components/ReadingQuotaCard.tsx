import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BookOpen, ChevronRight } from 'lucide-react-native';
import { usePrototypeStore } from '../store/usePrototypeStore';
import { colors, radii, shadows } from '../theme/tokens';
import { getLocalDateKey } from '../domain/rhythm/allowance';
import { useNow } from '../domain/timer';
import { resolveReadingQuotaView } from '../domain/rhythm/readingQuota';

function formatMinutes(seconds: number): string {
  return `${Math.max(0, Math.floor(seconds / 60))} min`;
}

function formatRemainingMinutes(seconds: number): string {
  if (seconds <= 0) return 'met';
  return `${Math.max(1, Math.ceil(seconds / 60))} min left`;
}

const PHASE_LABEL: Record<string, string> = {
  'cooldown-active': 'Cooldown running',
  'reading-required': 'Reading required',
  'reader-unavailable': 'Reader unavailable',
  'reader-incompatible': 'Reader update needed',
  satisfied: 'Quota met',
};

export const ReadingQuotaCard: React.FC = () => {
  const now = useNow(5000);
  const readingEvidence = usePrototypeStore((s) => s.readingEvidence);
  const dailyAttentionExchange = usePrototypeStore((s) => s.dailyAttentionExchange);
  const attentionStatus = usePrototypeStore((s) => s.activeAttentionGateStatus);
  const riskGroups = usePrototypeStore((s) => s.riskGroups);
  const openRhythmicReader = usePrototypeStore((s) => s.openRhythmicReader);

  const view = resolveReadingQuotaView({
    dateKey: getLocalDateKey(now),
    evidence: readingEvidence,
    dailyAttentionExchange,
    attentionStatus,
  });

  const active = view.activeTarget;
  const activeGroupName = active
    ? riskGroups.find((group) => group.id === active.groupId)?.name ?? active.groupId
    : undefined;
  const cooldownMinutesLeft =
    active?.cooldownEndsAt && active.cooldownEndsAt > now
      ? Math.max(1, Math.ceil((active.cooldownEndsAt - now) / 60000))
      : undefined;

  const evidenceBlocked = !view.evidenceAvailable;
  const protocolMismatch = Boolean(
    readingEvidence?.providerAvailable && !readingEvidence.protocolCompatible
  );

  const openReader = () => {
    openRhythmicReader().catch(() => {});
  };

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={openReader}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <View style={styles.iconCircle}>
            <BookOpen size={18} color={colors.forest} />
          </View>
          <View>
            <Text style={styles.title}>Reading quota</Text>
            <Text style={styles.subtitle}>Rhythmic Reader · today</Text>
          </View>
        </View>
        <ChevronRight size={18} color={colors.textMuted} />
      </View>

      {/* Daily verified totals */}
      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>
            {evidenceBlocked ? '—' : formatMinutes(view.verifiedSeconds)}
          </Text>
          <Text style={styles.statLabel}>Verified reading today</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBlock}>
          <Text style={styles.statValue}>{evidenceBlocked ? '—' : view.qualifiedPages}</Text>
          <Text style={styles.statLabel}>Qualified pages today</Text>
        </View>
      </View>

      {evidenceBlocked && (
        <Text style={styles.notice}>
          {protocolMismatch
            ? 'Reader evidence is incompatible. Update Rhythmic Reader to sync reading quotas.'
            : 'Open Rhythmic Reader to sync today’s verified reading. Routine only shows evidence Reader has confirmed.'}
        </Text>
      )}

      {/* Active cooldown quota */}
      {active && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {activeGroupName} · cooldown #{active.ordinal ?? '—'}
            </Text>
            <View
              style={[
                styles.phasePill,
                active.phase === 'satisfied' && styles.phasePillMet,
              ]}
            >
              <Text
                style={[
                  styles.phasePillText,
                  active.phase === 'satisfied' && styles.phasePillTextMet,
                ]}
              >
                {PHASE_LABEL[active.phase] ?? 'Reading required'}
              </Text>
            </View>
          </View>

          {cooldownMinutesLeft !== undefined && (
            <Text style={styles.sectionSubtitle}>{cooldownMinutesLeft} min of timer left</Text>
          )}

          {active.requiredSeconds > 0 && (
            <QuotaProgressRow
              label="Verified active reading"
              verifiedLabel={formatMinutes(active.verifiedSeconds)}
              requiredLabel={formatMinutes(active.requiredSeconds)}
              ratio={active.requiredSeconds > 0 ? active.verifiedSeconds / active.requiredSeconds : 1}
              remainingLabel={formatRemainingMinutes(active.remainingSeconds)}
            />
          )}
          {active.requiredPages > 0 && (
            <QuotaProgressRow
              label="Dwell-qualified pages"
              verifiedLabel={`${active.verifiedPages}`}
              requiredLabel={`${active.requiredPages}`}
              ratio={active.requiredPages > 0 ? active.verifiedPages / active.requiredPages : 1}
              remainingLabel={
                active.remainingPages <= 0 ? 'met' : `${active.remainingPages} pages left`
              }
            />
          )}

          {active.phase === 'satisfied' && (
            <Text style={styles.notice}>
              Quota met. Routine releases access when this cooldown’s timer ends.
            </Text>
          )}
          {active.phase === 'reader-unavailable' && (
            <Text style={styles.notice}>
              This cooldown keeps its reading quota until Reader can verify it.
            </Text>
          )}
        </View>
      )}

      {/* Next cooldown quota */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Next cooldown · #{view.nextOrdinal}</Text>
          <Text style={styles.cooldownCount}>
            {view.cooldownsTriggered} used today
          </Text>
        </View>
        {view.nextHasReadingQuota ? (
          <Text style={styles.nextTarget}>
            {formatMinutes(view.nextRequiredSeconds)} reading + {view.nextRequiredPages} qualified
            pages
          </Text>
        ) : (
          <Text style={styles.nextTargetMuted}>
            No reading quota — this cooldown only uses its timer.
          </Text>
        )}
      </View>

      <Text style={styles.footer}>
        Reader verifies the reading. Routine applies the quota.
      </Text>
    </TouchableOpacity>
  );
};

interface QuotaProgressRowProps {
  label: string;
  verifiedLabel: string;
  requiredLabel: string;
  ratio: number;
  remainingLabel: string;
}

const QuotaProgressRow: React.FC<QuotaProgressRowProps> = ({
  label,
  verifiedLabel,
  requiredLabel,
  ratio,
  remainingLabel,
}) => {
  const clampedRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return (
    <View style={styles.progressBlock}>
      <View style={styles.progressLabelRow}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressValue}>
          {verifiedLabel} / {requiredLabel}
        </Text>
      </View>
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${clampedRatio * 100}%` }]} />
      </View>
      <Text style={styles.progressRemaining}>{remainingLabel}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 12,
    padding: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: '#E2EBDD',
    ...shadows.soft,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sageLight,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundElevated,
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statBlock: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },
  statValue: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.forest,
  },
  statLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  notice: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: 10,
  },
  section: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 8,
  },
  phasePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.full,
    backgroundColor: colors.skyLight,
  },
  phasePillMet: {
    backgroundColor: colors.sageLight,
  },
  phasePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.skyDark,
  },
  phasePillTextMet: {
    color: colors.forest,
  },
  cooldownCount: {
    fontSize: 10,
    color: colors.textMuted,
  },
  nextTarget: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.forest,
  },
  nextTargetMuted: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  progressBlock: {
    marginTop: 8,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  progressLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  progressValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.forest,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#EAE6DC',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.forest,
    borderRadius: 3,
  },
  progressRemaining: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 3,
  },
  footer: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 14,
  },
});
