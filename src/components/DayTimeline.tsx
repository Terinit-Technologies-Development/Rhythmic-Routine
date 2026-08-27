import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Sprout, Sun, Waves, Moon } from 'lucide-react-native';
import { RhythmState } from '../types/domain';
import { colors } from '../theme/tokens';
import { usePrototypeStore } from '../store/usePrototypeStore';
import { getRoutineWindow } from '../domain/selectors';

interface Props {
  currentState?: RhythmState;
}

export const DayTimeline: React.FC<Props> = ({ currentState }) => {
  const storeState = usePrototypeStore((s) => s.rhythmState);
  const setRhythmState = usePrototypeStore((s) => s.setRhythmState);
  const routineWindows = usePrototypeStore((s) => s.routineWindows);

  const activeState = currentState || storeState;

  const morning = getRoutineWindow(routineWindows, 'morning-buffer');
  const openDay = getRoutineWindow(routineWindows, 'open-day');
  const evening = getRoutineWindow(routineWindows, 'evening-wind-down');

  const morningTime = `${morning?.startTime ?? '06:30'} – ${morning?.endTime ?? '08:00'}`;
  const openTime = `${openDay?.startTime ?? '08:00'} – ${openDay?.endTime ?? '21:30'}`;
  const recoveryTime = '13:00 – 18:00';
  const eveningTime = `${evening?.startTime ?? '21:30'} – ${evening?.endTime ?? '23:30'}`;

  const phases = [
    {
      id: 'morning-buffer',
      label: 'Morning Buffer',
      time: morningTime,
      icon: Sprout,
      activeColor: colors.forest,
      badgeBg: colors.sageLight,
      dotColor: colors.forest,
    },
    {
      id: 'available',
      label: 'Open',
      time: openTime,
      icon: Sun,
      activeColor: colors.amberDark,
      badgeBg: colors.amberLight,
      dotColor: colors.amber,
    },
    {
      id: 'cooldown',
      label: 'Recovery',
      time: recoveryTime,
      icon: Waves,
      activeColor: colors.skyDark,
      badgeBg: colors.skyLight,
      dotColor: colors.sky,
    },
    {
      id: 'evening-wind-down',
      label: 'Evening Wind-Down',
      time: eveningTime,
      icon: Moon,
      activeColor: colors.lavenderDark,
      badgeBg: colors.lavenderLight,
      dotColor: colors.lavender,
    },
  ];

  const getActiveIndex = () => {
    switch (activeState) {
      case 'morning-buffer':
        return 0;
      case 'available':
      case 'risk-session':
        return 1;
      case 'cooldown':
        return 2;
      case 'evening-wind-down':
        return 3;
      default:
        return 0;
    }
  };

  const activeIndex = getActiveIndex();

  return (
    <View style={styles.container}>
      {/* Connecting Horizontal Line */}
      <View style={styles.trackContainer}>
        <View style={styles.trackLine} />
        {/* Active Progress Overlay */}
        <View
          style={[
            styles.activeTrackLine,
            { width: `${(activeIndex / (phases.length - 1)) * 100}%` },
          ]}
        />
      </View>

      {/* Nodes */}
      <View style={styles.nodesRow}>
        {phases.map((phase, index) => {
          const isActive = index === activeIndex;
          const isPassed = index < activeIndex;
          const IconComponent = phase.icon;

          return (
            <TouchableOpacity
              key={phase.id}
              style={styles.nodeItem}
              activeOpacity={0.7}
              onPress={() => setRhythmState(phase.id as RhythmState)}
            >
              {/* Icon Circle */}
              <View
                style={[
                  styles.iconCircle,
                  {
                    backgroundColor: isActive || isPassed ? phase.badgeBg : '#F2EFE8',
                    borderColor: isActive ? phase.activeColor : '#E5DFD3',
                    borderWidth: isActive ? 2 : 1,
                  },
                ]}
              >
                <IconComponent
                  size={18}
                  color={isActive || isPassed ? phase.activeColor : colors.textMuted}
                  strokeWidth={isActive ? 2.3 : 1.8}
                />
              </View>

              {/* Text Labels */}
              <Text
                style={[
                  styles.nodeLabel,
                  {
                    color: isActive ? phase.activeColor : colors.textSecondary,
                    fontWeight: isActive ? '700' : '500',
                  },
                ]}
                numberOfLines={1}
              >
                {phase.label}
              </Text>
              <Text style={styles.nodeTime}>{phase.time}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 14,
    paddingHorizontal: 6,
    position: 'relative',
  },
  trackContainer: {
    position: 'absolute',
    top: 32,
    left: 42,
    right: 42,
    height: 3,
    zIndex: 1,
  },
  trackLine: {
    height: 3,
    backgroundColor: '#E6E0D3',
    borderRadius: 2,
  },
  activeTrackLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 3,
    backgroundColor: colors.forest,
    borderRadius: 2,
  },
  nodesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  nodeItem: {
    alignItems: 'center',
    width: 82,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  nodeLabel: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 2,
  },
  nodeTime: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
