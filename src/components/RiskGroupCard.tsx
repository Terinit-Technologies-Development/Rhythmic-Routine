import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Film, ChevronRight, Smartphone, Flame } from 'lucide-react-native';
import { RiskGroup } from '../types/domain';
import { colors, radii, shadows } from '../theme/tokens';
import { useRouter } from 'expo-router';
import { usePrototypeStore } from '../store/usePrototypeStore';
import { resolveGroupAllowanceMinutes, getRiskGroupStatus } from '../domain/rhythm/allowance';
import { useNow } from '../domain/timer';

export interface RiskGroupCardProps {
  group: RiskGroup;
}

export const RiskGroupCard: React.FC<RiskGroupCardProps> = ({ group }) => {
  const router = useRouter();
  const now = useNow(5000);
  const rhythmState = usePrototypeStore((s) => s.rhythmState);
  const activeRiskGroupId = usePrototypeStore((s) => s.activeRiskGroupId);
  const activeTimerEndsAt = usePrototypeStore((s) => s.activeTimerEndsAt);
  const groupSnapshots = usePrototypeStore((s) => s.groupUsageSnapshots);
  const dailyUsageError = usePrototypeStore((s) => s.dailyUsageError);

  const getIcon = () => {
    switch (group.id) {
      case 'social':
        return <Smartphone size={22} color={colors.forest} />;
      case 'entertainment':
        return <Film size={22} color={colors.amberDark} />;
      default:
        return <Flame size={22} color={colors.forest} />;
    }
  };

  const allowanceMinutes = resolveGroupAllowanceMinutes(group);
  const snapshot = groupSnapshots?.[group.id];
  const cooldownEndsAt =
    snapshot?.cooldownEndsAt ??
    (activeRiskGroupId === group.id && rhythmState === 'cooldown' ? activeTimerEndsAt : undefined);

  const status = getRiskGroupStatus({
    snapshot,
    cooldownEndsAt,
    usageAvailable: !dailyUsageError,
    now,
  });

  const renderUsageContent = () => {
    switch (status.kind) {
      case 'unavailable':
        return (
          <View style={styles.usageContainer}>
            <Text style={[styles.usageText, styles.usageUnavailable]}>Usage unavailable</Text>
            <Text style={styles.subtext}>{allowanceMinutes} min allowance</Text>
          </View>
        );
      case 'cooldown': {
        const cooldownMinsRemaining = Math.max(1, Math.ceil((status.endsAt - now) / 60000));
        return (
          <View style={styles.usageContainer}>
            <Text style={styles.usageText}>
              <Text style={[styles.usageBold, styles.usageCooldown]}>
                {allowanceMinutes}
              </Text>{' '}
              / {allowanceMinutes} min used
            </Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: '100%', backgroundColor: colors.coralDark }]} />
            </View>
            <Text style={[styles.subtext, styles.usageCooldown]}>
              Cooldown · {cooldownMinsRemaining} min remaining
            </Text>
          </View>
        );
      }
      case 'fresh': {
        const isZeroAllowance = allowanceMinutes <= 0;
        return (
          <View style={styles.usageContainer}>
            <Text style={styles.usageText}>
              <Text style={styles.usageBold}>0</Text> / {allowanceMinutes} min used
            </Text>
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: isZeroAllowance ? '100%' : '0%',
                    backgroundColor: isZeroAllowance ? colors.coralDark : colors.forest,
                  },
                ]}
              />
            </View>
            <Text style={styles.subtext}>
              {isZeroAllowance ? 'Allowance complete' : `${allowanceMinutes} min remaining in this cycle`}
            </Text>
          </View>
        );
      }
      case 'active': {
        const usedMinutes = Math.floor(status.snapshot.usedSeconds / 60);
        const remainingMinutes = Math.ceil(status.snapshot.remainingSeconds / 60);
        const progressRatio = allowanceMinutes > 0 ? Math.min(1, usedMinutes / allowanceMinutes) : 1;
        return (
          <View style={styles.usageContainer}>
            <Text style={styles.usageText}>
              <Text style={styles.usageBold}>{usedMinutes}</Text> / {allowanceMinutes} min used
            </Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progressRatio * 100}%` }]} />
            </View>
            <Text style={styles.subtext}>{remainingMinutes} min remaining in this cycle</Text>
          </View>
        );
      }
    }
  };

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={() => router.push(`/risk-groups/${group.id}` as any)}
    >
      <View style={styles.topRow}>
        {/* Left Icon Badge */}
        <View style={[styles.iconCircle, { backgroundColor: group.iconBg }]}>
          {getIcon()}
        </View>

        {/* Right Chevron */}
        <ChevronRight size={18} color={colors.textMuted} />
      </View>

      {/* Group Name */}
      <Text style={styles.groupName}>{group.name}</Text>

      {/* Usage Info & Progress */}
      {renderUsageContent()}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    minHeight: 140,
    justifyContent: 'space-between',
    ...shadows.soft,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  usageContainer: {
    marginTop: 4,
  },
  usageText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  usageBold: {
    fontWeight: '700',
    color: colors.forest,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#EAE6DC',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.forest,
    borderRadius: 3,
  },
  subtext: {
    fontSize: 11,
    color: colors.textMuted,
  },
  statusAvailable: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  usageUnavailable: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  usageCooldown: {
    color: colors.coralDark,
    fontWeight: '700',
  },
});
