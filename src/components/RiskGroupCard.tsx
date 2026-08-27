import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MessageSquare, Film, ChevronRight, FolderHeart } from 'lucide-react-native';
import { RiskGroup } from '../types/domain';
import { colors, radii, shadows } from '../theme/tokens';
import { useRouter } from 'expo-router';

interface Props {
  group: RiskGroup;
}

export const RiskGroupCard: React.FC<Props> = ({ group }) => {
  const router = useRouter();

  const getIcon = () => {
    switch (group.iconName) {
      case 'film':
        return <Film size={22} color={colors.amberDark} />;
      case 'message-square':
        return <MessageSquare size={22} color={colors.forest} />;
      default:
        return <FolderHeart size={22} color={colors.forest} />;
    }
  };

  const hasLimit = group.sessionThresholdMinutes > 0;
  const progressRatio = hasLimit
    ? Math.min(1, group.currentSessionMinutes / group.sessionThresholdMinutes)
    : 0;

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
      {hasLimit ? (
        <View style={styles.usageContainer}>
          <Text style={styles.usageText}>
            <Text style={styles.usageBold}>{group.currentSessionMinutes}</Text> / {group.sessionThresholdMinutes} min
          </Text>
          {/* Progress Bar */}
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progressRatio * 100}%` }]} />
          </View>
          <Text style={styles.subtext}>Today</Text>
        </View>
      ) : (
        <View style={styles.usageContainer}>
          <Text style={[styles.statusAvailable, { color: group.iconColor }]}>Available</Text>
          <Text style={styles.subtext}>No limit set</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
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
});
