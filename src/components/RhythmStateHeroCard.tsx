import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Sprout, Lock, Sun, Waves, Moon, Flame } from 'lucide-react-native';
import {
  MorningSunriseLandscape,
  OpenDayLandscape,
  EveningTwilightLandscape,
  TouchGrassMeadowLandscape,
} from './Artwork';
import { usePrototypeStore } from '../store/usePrototypeStore';
import { colors, radii, shadows } from '../theme/tokens';
import { useRouter } from 'expo-router';
import {
  formatSecondsToHHMMSS,
  getRiskGroup,
  getRoutineTargetTime,
  getRoutineWindow,
} from '../domain/selectors';
import { useRemainingSeconds } from '../domain/timer';

export const RhythmStateHeroCard: React.FC = () => {
  const router = useRouter();
  const rhythmState = usePrototypeStore((s) => s.rhythmState);
  const activeTimerEndsAt = usePrototypeStore((s) => s.activeTimerEndsAt);
  const routineWindows = usePrototypeStore((s) => s.routineWindows);
  const riskGroups = usePrototypeStore((s) => s.riskGroups);
  const activeRiskGroupId = usePrototypeStore((s) => s.activeRiskGroupId);
  const setDemoSwitcherVisible = usePrototypeStore((s) => s.setDemoSwitcherVisible);

  const remainingSeconds = useRemainingSeconds(activeTimerEndsAt);

  const morning = getRoutineWindow(routineWindows, 'morning-buffer');
  const activeGroup = getRiskGroup(riskGroups, activeRiskGroupId) || riskGroups[0];

  const morningUnlock = morning ? getRoutineTargetTime(morning) : '08:00';
  const threshold = activeGroup?.sessionThresholdMinutes ?? 30;
  const currentUsage = activeGroup?.currentSessionMinutes ?? 18;

  const getCardContent = () => {
    switch (rhythmState) {
      case 'morning-buffer':
        return {
          title: 'Morning Buffer',
          subtitle: `Social apps unlock at ${morningUnlock}`,
          badgeText: 'Buffering',
          badgeIcon: Lock,
          badgeBg: '#E8EFE5',
          badgeTextCol: colors.forest,
          footerText: 'Time until Open',
          timerDisplay: formatSecondsToHHMMSS(remainingSeconds),
          icon: Sprout,
          ArtworkComponent: MorningSunriseLandscape,
          onPress: () => setDemoSwitcherVisible(true),
        };
      case 'available':
        return {
          title: 'Open Day',
          subtitle: 'Use apps freely and mindfully',
          badgeText: 'Available',
          badgeIcon: Sun,
          badgeBg: colors.amberLight,
          badgeTextCol: colors.amberDark,
          footerText: 'Rhythm protection active',
          timerDisplay: '00:00:00',
          icon: Sun,
          ArtworkComponent: OpenDayLandscape,
          onPress: () => setDemoSwitcherVisible(true),
        };
      case 'risk-session':
        return {
          title: `${activeGroup.name} Active`,
          subtitle: `${currentUsage} min used of ${threshold} min limit`,
          badgeText: 'Session Active',
          badgeIcon: Flame,
          badgeBg: colors.coralLight,
          badgeTextCol: colors.coralDark,
          footerText: 'Time until Cooldown break',
          timerDisplay: formatSecondsToHHMMSS(remainingSeconds),
          icon: Flame,
          ArtworkComponent: OpenDayLandscape,
          onPress: () => router.push(`/risk-groups/${activeGroup.id}` as any),
        };
      case 'cooldown':
        return {
          title: 'Touch Grass 🌱',
          subtitle: `${threshold} min threshold reached`,
          badgeText: 'Cooldown in progress',
          badgeIcon: Lock,
          badgeBg: colors.skyLight,
          badgeTextCol: colors.skyDark,
          footerText: 'Recovery time remaining',
          timerDisplay: formatSecondsToHHMMSS(remainingSeconds),
          icon: Waves,
          ArtworkComponent: TouchGrassMeadowLandscape,
          onPress: () => router.push('/touch-grass'),
        };
      case 'evening-wind-down':
        return {
          title: 'Evening Wind-Down',
          subtitle: 'Protecting your sleep and rest',
          badgeText: 'Rest Mode',
          badgeIcon: Moon,
          badgeBg: colors.lavenderLight,
          badgeTextCol: colors.lavenderDark,
          footerText: `Until morning unlock (${morningUnlock})`,
          timerDisplay: formatSecondsToHHMMSS(remainingSeconds),
          icon: Moon,
          ArtworkComponent: EveningTwilightLandscape,
          onPress: () => setDemoSwitcherVisible(true),
        };
      case 'overnight-protected':
      default:
        return {
          title: 'Overnight Protection',
          subtitle: 'Apps stay protected until Morning Buffer',
          badgeText: 'Sleep Mode',
          badgeIcon: Moon,
          badgeBg: colors.lavenderLight,
          badgeTextCol: colors.lavenderDark,
          footerText: `Until morning unlock (${morningUnlock})`,
          timerDisplay: formatSecondsToHHMMSS(remainingSeconds),
          icon: Moon,
          ArtworkComponent: EveningTwilightLandscape,
          onPress: () => setDemoSwitcherVisible(true),
        };
    }
  };

  const config = getCardContent();
  const IconComp = config.icon;
  const BadgeIcon = config.badgeIcon;
  const Artwork = config.ArtworkComponent;

  return (
    <TouchableOpacity
      style={styles.cardContainer}
      activeOpacity={0.9}
      onPress={config.onPress}
    >
      {/* Background Scenic Artwork */}
      <View style={styles.artworkWrapper}>
        <Artwork height={220} />
      </View>

      {/* Foreground Content Card */}
      <View style={styles.contentOverlay}>
        {/* Top Header Row */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.stateIconCircle}>
              <IconComp size={20} color={colors.forest} strokeWidth={2.3} />
            </View>
            <View>
              <Text style={styles.stateTitle}>{config.title}</Text>
              <Text style={styles.stateSubtitle}>{config.subtitle}</Text>
            </View>
          </View>

          {/* Status Badge */}
          <View style={[styles.badge, { backgroundColor: config.badgeBg }]}>
            <BadgeIcon size={12} color={config.badgeTextCol} strokeWidth={2.5} />
            <Text style={[styles.badgeText, { color: config.badgeTextCol }]}>
              {config.badgeText}
            </Text>
          </View>
        </View>

        {/* Large Countdown Digits */}
        <View style={styles.timerSection}>
          <Text style={styles.timerText}>{config.timerDisplay}</Text>
          <Text style={styles.timerSublabel}>{config.footerText}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    borderRadius: radii.xxl,
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EFEAE0',
    minHeight: 220,
    position: 'relative',
    ...shadows.card,
  },
  artworkWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  contentOverlay: {
    padding: 18,
    flex: 1,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stateIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E8EFE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.forestDark,
  },
  stateSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
    gap: 5,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timerSection: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  timerText: {
    fontSize: 48,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
    letterSpacing: 2,
  },
  timerSublabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    fontWeight: '500',
  },
});
