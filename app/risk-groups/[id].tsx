import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  MoreHorizontal,
  Plus,
  Minus,
  Check,
  Clock,
  Moon,
  ArrowRight,
  Camera,
  AtSign,
  Music,
  Flame,
  MessageCircle,
} from 'lucide-react-native';
import { XLogoIcon } from '../../src/components/BrandIcons';
import { colors, radii, shadows } from '../../src/theme/tokens';
import { usePrototypeStore } from '../../src/store/usePrototypeStore';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';

export default function RiskGroupDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const riskGroups = usePrototypeStore((s) => s.riskGroups);
  const updateRiskGroup = usePrototypeStore((s) => s.updateRiskGroup);
  const apps = usePrototypeStore((s) => s.apps);
  const setDemoSwitcherVisible = usePrototypeStore((s) => s.setDemoSwitcherVisible);

  const group = riskGroups.find((g) => g.id === id) || riskGroups[0];

  const sessionThresholds = [15, 30, 45, 60];
  const cooldownOptions = [30, 60, 90, 120, 180];

  const [morningBufferEnabled, setMorningBufferEnabled] = useState(
    group.routineWindowIds.includes('morning-buffer')
  );
  const [eveningWindDownEnabled, setEveningWindDownEnabled] = useState(
    group.routineWindowIds.includes('evening-wind-down')
  );

  const memberApps = apps.filter((a) => group.appIds.includes(a.id));

  const handleAdjustSession = (delta: number) => {
    const currentIndex = sessionThresholds.indexOf(group.sessionThresholdMinutes);
    if (currentIndex !== -1) {
      const nextIndex = Math.max(
        0,
        Math.min(sessionThresholds.length - 1, currentIndex + delta)
      );
      updateRiskGroup(group.id, {
        sessionThresholdMinutes: sessionThresholds[nextIndex],
      });
    } else {
      updateRiskGroup(group.id, {
        sessionThresholdMinutes: Math.max(10, group.sessionThresholdMinutes + delta * 5),
      });
    }
  };

  const handleAdjustCooldown = (delta: number) => {
    const currentIndex = cooldownOptions.indexOf(group.cooldownMinutes);
    if (currentIndex !== -1) {
      const nextIndex = Math.max(
        0,
        Math.min(cooldownOptions.length - 1, currentIndex + delta)
      );
      updateRiskGroup(group.id, { cooldownMinutes: cooldownOptions[nextIndex] });
    } else {
      updateRiskGroup(group.id, {
        cooldownMinutes: Math.max(15, group.cooldownMinutes + delta * 15),
      });
    }
  };

  const toggleMorning = (val: boolean) => {
    setMorningBufferEnabled(val);
    const newWindows = val
      ? [...group.routineWindowIds, 'morning-buffer']
      : group.routineWindowIds.filter((w) => w !== 'morning-buffer');
    updateRiskGroup(group.id, { routineWindowIds: newWindows });
  };

  const toggleEvening = (val: boolean) => {
    setEveningWindDownEnabled(val);
    const newWindows = val
      ? [...group.routineWindowIds, 'evening-wind-down']
      : group.routineWindowIds.filter((w) => w !== 'evening-wind-down');
    updateRiskGroup(group.id, { routineWindowIds: newWindows });
  };

  const renderAppIcon = (appId: string) => {
    switch (appId) {
      case 'x':
        return (
          <View style={[styles.appIconTile, { backgroundColor: '#000000' }]}>
            <XLogoIcon size={18} color="#FFFFFF" />
          </View>
        );
      case 'instagram':
        return (
          <View style={[styles.appIconTile, { backgroundColor: '#E1306C' }]}>
            <Camera size={18} color="#FFFFFF" />
          </View>
        );
      case 'threads':
        return (
          <View style={[styles.appIconTile, { backgroundColor: '#111111' }]}>
            <AtSign size={18} color="#FFFFFF" />
          </View>
        );
      case 'tiktok':
        return (
          <View style={[styles.appIconTile, { backgroundColor: '#FE2C55' }]}>
            <Music size={18} color="#FFFFFF" />
          </View>
        );
      case 'reddit':
        return (
          <View style={[styles.appIconTile, { backgroundColor: '#FF4500' }]}>
            <Flame size={18} color="#FFFFFF" />
          </View>
        );
      default:
        return (
          <View style={[styles.appIconTile, { backgroundColor: colors.forest }]}>
            <MessageCircle size={18} color="#FFFFFF" />
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.circleBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={colors.forestDark} strokeWidth={2.3} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.circleBtn}
          onPress={() => setDemoSwitcherVisible(true)}
        >
          <MoreHorizontal size={20} color={colors.forestDark} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title Header with Floating Bubble Graphic */}
        <View style={styles.titleSection}>
          <View style={styles.titleCol}>
            <Text style={styles.overheadLabel}>Risk Group</Text>
            <Text style={styles.mainTitle}>{group.name}</Text>
            <Text style={styles.description}>{group.description}</Text>
          </View>

          {/* Chat Bubble Motif Graphic */}
          <View style={styles.bubbleGraphic}>
            <Svg width="70" height="60" viewBox="0 0 70 60">
              <Path
                d="M 10 5 C 2 5, 2 40, 10 42 C 15 43, 20 44, 25 44 L 20 54 L 34 44 C 55 44, 65 38, 65 24 C 65 12, 55 5, 34 5 Z"
                fill="#D4E2CD"
              />
              <Circle cx="24" cy="24" r="3.5" fill="#3B6349" />
              <Circle cx="34" cy="24" r="3.5" fill="#3B6349" />
              <Circle cx="44" cy="24" r="3.5" fill="#3B6349" />
            </Svg>
          </View>
        </View>

        {/* Section 1: Member Apps */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Member apps</Text>
              <Text style={styles.cardSubtitle}>Apps in this group are monitored together.</Text>
            </View>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => router.push('/(tabs)/apps')}
            >
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.memberAppsList}>
            {memberApps.map((app) => (
              <View key={app.id} style={styles.memberAppRow}>
                <View style={styles.appLeft}>
                  {renderAppIcon(app.id)}
                  <Text style={styles.appRowName}>{app.name}</Text>
                </View>
                <Check size={18} color={colors.forest} strokeWidth={2.5} />
              </View>
            ))}
          </View>
        </View>

        {/* Section 2: Session Threshold */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Session threshold</Text>
          <Text style={styles.cardSubtitle}>
            Time online in this group before a break is triggered.
          </Text>

          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => handleAdjustSession(-1)}
            >
              <Minus size={20} color={colors.forest} strokeWidth={2.5} />
            </TouchableOpacity>

            <Text style={styles.stepperNumber}>
              {group.sessionThresholdMinutes} <Text style={styles.stepperUnit}>min</Text>
            </Text>

            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => handleAdjustSession(1)}
            >
              <Plus size={20} color={colors.forest} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* Notch Line Slider */}
          <View style={styles.sliderTrack}>
            <View style={styles.sliderLine} />
            <View style={styles.notchesRow}>
              {sessionThresholds.map((val) => {
                const isSelected = group.sessionThresholdMinutes === val;
                return (
                  <TouchableOpacity
                    key={val}
                    style={styles.notchItem}
                    onPress={() =>
                      updateRiskGroup(group.id, { sessionThresholdMinutes: val })
                    }
                  >
                    <View
                      style={[
                        styles.notchDot,
                        isSelected && styles.notchDotSelected,
                      ]}
                    />
                    <Text
                      style={[
                        styles.notchLabel,
                        isSelected && styles.notchLabelSelected,
                      ]}
                    >
                      {val} min
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Section 3: Recovery Cooldown */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recovery cooldown</Text>
          <Text style={styles.cardSubtitle}>Time offline before access is restored.</Text>

          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => handleAdjustCooldown(-1)}
            >
              <Minus size={20} color={colors.forest} strokeWidth={2.5} />
            </TouchableOpacity>

            <Text style={styles.stepperNumber}>
              {group.cooldownMinutes} <Text style={styles.stepperUnit}>min</Text>
            </Text>

            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => handleAdjustCooldown(1)}
            >
              <Plus size={20} color={colors.forest} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* Notch Line Slider */}
          <View style={styles.sliderTrack}>
            <View style={styles.sliderLine} />
            <View style={styles.notchesRow}>
              {cooldownOptions.map((val) => {
                const isSelected = group.cooldownMinutes === val;
                return (
                  <TouchableOpacity
                    key={val}
                    style={styles.notchItem}
                    onPress={() => updateRiskGroup(group.id, { cooldownMinutes: val })}
                  >
                    <View
                      style={[
                        styles.notchDot,
                        isSelected && styles.notchDotSelected,
                      ]}
                    />
                    <Text
                      style={[
                        styles.notchLabel,
                        isSelected && styles.notchLabelSelected,
                      ]}
                    >
                      {val} min
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Section 4: Protected in (Routine Window Toggles) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Protected in</Text>
          <Text style={styles.cardSubtitle}>
            This group is automatically managed during these routines.
          </Text>

          <View style={styles.toggleRow}>
            <View style={styles.toggleLeft}>
              <View style={[styles.toggleIconCircle, { backgroundColor: colors.amberLight }]}>
                <Text style={{ fontSize: 16 }}>☀️</Text>
              </View>
              <View>
                <Text style={styles.toggleTitle}>Morning Buffer</Text>
                <Text style={styles.toggleTime}>06:30 – 08:00</Text>
              </View>
            </View>
            <Switch
              value={morningBufferEnabled}
              onValueChange={toggleMorning}
              trackColor={{ false: '#E2DCD1', true: colors.forest }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={[styles.toggleRow, { borderBottomWidth: 0 }]}>
            <View style={styles.toggleLeft}>
              <View style={[styles.toggleIconCircle, { backgroundColor: colors.lavenderLight }]}>
                <Text style={{ fontSize: 16 }}>🌙</Text>
              </View>
              <View>
                <Text style={styles.toggleTitle}>Evening Wind-Down</Text>
                <Text style={styles.toggleTime}>18:00 – 22:30</Text>
              </View>
            </View>
            <Switch
              value={eveningWindDownEnabled}
              onValueChange={toggleEvening}
              trackColor={{ false: '#E2DCD1', true: colors.forest }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* Section 5: Trigger Logic Preview */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Trigger logic preview</Text>
          <Text style={styles.cardSubtitle}>How protection works for this group.</Text>

          <View style={styles.logicPreviewRow}>
            {/* Online Session Box */}
            <View style={styles.logicBoxOnline}>
              <Clock size={16} color={colors.amberDark} />
              <View style={{ marginTop: 6 }}>
                <Text style={styles.logicBoxTitle}>
                  {group.sessionThresholdMinutes} min online
                </Text>
                <Text style={styles.logicBoxSub}>Session threshold</Text>
              </View>
            </View>

            <ArrowRight size={18} color={colors.textMuted} />

            {/* Offline Cooldown Box */}
            <View style={styles.logicBoxOffline}>
              <Moon size={16} color={colors.lavenderDark} />
              <View style={{ marginTop: 6 }}>
                <Text style={styles.logicBoxTitle}>
                  {group.cooldownMinutes} min offline
                </Text>
                <Text style={styles.logicBoxSub}>Recovery cooldown</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E3D7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  titleSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 10,
    marginBottom: 16,
  },
  titleCol: {
    flex: 1,
    paddingRight: 10,
  },
  overheadLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 2,
  },
  mainTitle: {
    fontSize: 28,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
    letterSpacing: -0.5,
  },
  description: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  bubbleGraphic: {
    width: 70,
    height: 60,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    marginBottom: 14,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radii.full,
    backgroundColor: '#FAF8F4',
    borderWidth: 1,
    borderColor: '#EAE5DB',
  },
  editBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  memberAppsList: {
    gap: 12,
  },
  memberAppRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  appIconTile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appRowName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 14,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: '#FAF8F4',
    borderWidth: 1,
    borderColor: '#EAE5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperNumber: {
    fontSize: 32,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
  },
  stepperUnit: {
    fontSize: 20,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  sliderTrack: {
    position: 'relative',
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 6,
  },
  sliderLine: {
    position: 'absolute',
    top: 6,
    left: 20,
    right: 20,
    height: 2,
    backgroundColor: '#EAE5DB',
  },
  notchesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  notchItem: {
    alignItems: 'center',
  },
  notchDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E2DCD1',
    marginBottom: 6,
  },
  notchDotSelected: {
    backgroundColor: colors.forest,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.2 }],
  },
  notchLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  notchLabelSelected: {
    color: colors.forestDark,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F4EFE6',
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  toggleTime: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  logicPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 8,
  },
  logicBoxOnline: {
    flex: 1,
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: '#F3E4C8',
    borderRadius: radii.lg,
    padding: 12,
  },
  logicBoxOffline: {
    flex: 1,
    backgroundColor: colors.lavenderSoft,
    borderWidth: 1,
    borderColor: '#E6DCF0',
    borderRadius: radii.lg,
    padding: 12,
  },
  logicBoxTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  logicBoxSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
