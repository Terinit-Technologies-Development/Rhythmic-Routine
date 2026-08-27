import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  Platform,
} from 'react-native';
import {
  Sprout,
  Sun,
  Flame,
  Waves,
  Moon,
  RotateCcw,
  Sparkles,
  X,
  Compass,
  Zap,
} from 'lucide-react-native';
import { usePrototypeStore } from '../store/usePrototypeStore';
import { RhythmState } from '../types/domain';
import { colors, radii, shadows } from '../theme/tokens';
import { useRouter } from 'expo-router';

export const DemoStateSwitcher: React.FC = () => {
  const router = useRouter();
  const visible = usePrototypeStore((s) => s.demoSwitcherVisible);
  const setVisible = usePrototypeStore((s) => s.setDemoSwitcherVisible);
  const rhythmState = usePrototypeStore((s) => s.rhythmState);
  const setRhythmState = usePrototypeStore((s) => s.setRhythmState);
  const simulateCooldown = usePrototypeStore((s) => s.simulateCooldown);
  const simulateRiskSession = usePrototypeStore((s) => s.simulateRiskSession);
  const resetDemo = usePrototypeStore((s) => s.resetDemo);

  if (!visible) return null;

  const states: {
    id: RhythmState;
    label: string;
    description: string;
    icon: any;
    color: string;
    bg: string;
    action: () => void;
  }[] = [
    {
      id: 'morning-buffer',
      label: 'Morning Buffer',
      description: 'Social apps locked until 08:00 AM (01:18:24 countdown)',
      icon: Sprout,
      color: colors.forest,
      bg: colors.sageLight,
      action: () => setRhythmState('morning-buffer'),
    },
    {
      id: 'available',
      label: 'Open Day (Available)',
      description: 'Normal mindful phone usage with continuous protection',
      icon: Sun,
      color: colors.amberDark,
      bg: colors.amberLight,
      action: () => setRhythmState('available'),
    },
    {
      id: 'risk-session',
      label: 'Active Risk Session',
      description: '18 min elapsed of 30 min session limit in Social Feeds',
      icon: Flame,
      color: colors.coralDark,
      bg: colors.coralLight,
      action: () => simulateRiskSession('social'),
    },
    {
      id: 'cooldown',
      label: 'Touch Grass Cooldown',
      description: '30 min threshold reached, 90 min recovery countdown',
      icon: Waves,
      color: colors.skyDark,
      bg: colors.skyLight,
      action: () => simulateCooldown('social'),
    },
    {
      id: 'evening-wind-down',
      label: 'Evening Wind-Down',
      description: 'Evening rest protection active from 21:30 PM',
      icon: Moon,
      color: colors.lavenderDark,
      bg: colors.lavenderLight,
      action: () => setRhythmState('evening-wind-down'),
    },
  ];

  const handleSelect = (item: (typeof states)[0]) => {
    item.action();
    setVisible(false);
  };

  return (
    <View style={styles.overlay}>
      <TouchableWithoutFeedback onPress={() => setVisible(false)}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>

      <View style={styles.modalCard}>
        {/* Modal Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.badge}>
              <Zap size={14} color={colors.forest} />
              <Text style={styles.badgeText}>Prototype Controls</Text>
            </View>
            <Text style={styles.title}>Switch Rhythm State</Text>
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => setVisible(false)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.subtitle}>
          Preview any Rhythm state instantly to evaluate UI adaptations and countdowns.
        </Text>

        {/* State List */}
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {states.map((item) => {
            const isSelected = rhythmState === item.id;
            const Icon = item.icon;

            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.stateItem,
                  isSelected && { borderColor: item.color, backgroundColor: '#FAF8F4' },
                ]}
                activeOpacity={0.8}
                onPress={() => handleSelect(item)}
              >
                <View style={[styles.iconBox, { backgroundColor: item.bg }]}>
                  <Icon size={20} color={item.color} />
                </View>
                <View style={styles.stateContent}>
                  <View style={styles.stateTitleRow}>
                    <Text style={styles.stateLabel}>{item.label}</Text>
                    {isSelected && (
                      <View style={[styles.activeTag, { backgroundColor: item.bg }]}>
                        <Text style={[styles.activeTagText, { color: item.color }]}>
                          ACTIVE
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.stateDesc}>{item.description}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Additional Quick Actions */}
          <View style={styles.divider} />
          <Text style={styles.sectionHeader}>Prototype Navigation & Reset</Text>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              setVisible(false);
              router.push('/touch-grass');
            }}
          >
            <Compass size={18} color={colors.forest} />
            <Text style={styles.actionBtnText}>Open Dedicated "Touch Grass" Screen</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              setVisible(false);
              router.push('/onboarding');
            }}
          >
            <Sparkles size={18} color={colors.forest} />
            <Text style={styles.actionBtnText}>Revisit Onboarding Flow</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.resetBtn]}
            onPress={() => {
              resetDemo();
              setVisible(false);
            }}
          >
            <RotateCcw size={18} color={colors.coralDark} />
            <Text style={[styles.actionBtnText, { color: colors.coralDark }]}>
              Reset All Demo Data & Timers
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(22, 75, 56, 0.45)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 9999,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 32,
    zIndex: 10000,
    ...shadows.elevated,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  headerLeft: {
    flex: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sageLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
    gap: 4,
    marginBottom: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.forest,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: colors.backgroundMuted,
  },
  list: {
    maxHeight: 460,
  },
  stateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: '#EFEAE0',
    marginBottom: 10,
    backgroundColor: '#FFFFFF',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stateContent: {
    flex: 1,
  },
  stateTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  stateLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  activeTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.full,
  },
  activeTagText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  stateDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#EBE6DC',
    marginVertical: 14,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: '#F7F4EC',
    marginBottom: 8,
    gap: 10,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  resetBtn: {
    backgroundColor: colors.coralLight,
  },
});
