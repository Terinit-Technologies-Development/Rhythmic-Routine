import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Plus,
  ChevronRight,
  MessageSquare,
  PlaySquare,
  Sparkles,
  Check,
  RotateCcw,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { colors, radii, shadows } from '../../src/theme/tokens';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { RoutineWindowCard } from '../../src/components/RoutineWindowCard';
import { AddRiskGroupModal } from '../../src/components/AddRiskGroupModal';
import { usePrototypeStore } from '../../src/store/usePrototypeStore';

export default function RoutineScreen() {
  const router = useRouter();
  const routineWindows = usePrototypeStore((s) => s.routineWindows);
  const riskGroups = usePrototypeStore((s) => s.riskGroups);
  const toggleRoutineDay = usePrototypeStore((s) => s.toggleRoutineDay);

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [templateApplied, setTemplateApplied] = useState(false);

  const days = [
    { id: 1, label: 'Mon' },
    { id: 2, label: 'Tue' },
    { id: 3, label: 'Wed' },
    { id: 4, label: 'Thu' },
    { id: 5, label: 'Fri' },
    { id: 6, label: 'Sat' },
    { id: 7, label: 'Sun' },
  ];

  const morningWindow = routineWindows.find((w) => w.type === 'morning-buffer') || routineWindows[0];
  const activeDays = morningWindow ? morningWindow.activeDays : [1, 2, 3, 4, 5, 6, 7];

  const applyTemplate = () => {
    setTemplateApplied(true);
    setTimeout(() => setTemplateApplied(false), 3000);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Routine"
        showWaveLogo={true}
        subtitle="Design your day with intention. Set boundaries that help you focus and unwind."
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Main Routine Container Card */}
        <View style={styles.mainCard}>
          {/* Active Days Selector */}
          <View style={styles.daysRow}>
            <Text style={styles.activeOnLabel}>Active on</Text>
            <View style={styles.daysChipsContainer}>
              {days.map((day) => {
                const isActive = activeDays.includes(day.id);
                return (
                  <TouchableOpacity
                    key={day.id}
                    style={[
                      styles.dayChip,
                      isActive && styles.dayChipActive,
                    ]}
                    onPress={() => toggleRoutineDay(day.id)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.dayChipText,
                        isActive && styles.dayChipTextActive,
                      ]}
                    >
                      {day.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Routine Windows Vertical Sequence */}
          <View style={styles.windowsSequence}>
            {routineWindows.map((win) => {
              const timeLabel =
                win.type === 'open-day'
                  ? `${win.startTime} – ${win.endTime || '21:30'}`
                  : win.startTime;

              return (
                <RoutineWindowCard
                  key={win.id}
                  window={win}
                  timeLabel={timeLabel}
                />
              );
            })}
          </View>
        </View>

        {/* Protected Groups Section */}
        <View style={styles.protectedSection}>
          <View style={styles.protectedHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>Protected groups</Text>
              <Text style={styles.sectionSub}>These app groups follow your routine</Text>
            </View>
          </View>

          <View style={styles.groupsList}>
            {riskGroups.map((group) => {
              const isSocial = group.id === 'social';
              const statusTag = isSocial
                ? 'Limited during focus times'
                : 'Paused during Wind-Down';

              return (
                <TouchableOpacity
                  key={group.id}
                  style={styles.groupRow}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/risk-groups/${group.id}` as any)}
                >
                  <View style={[styles.groupIconCircle, { backgroundColor: group.iconBg }]}>
                    {isSocial ? (
                      <MessageSquare size={20} color={group.iconColor} />
                    ) : (
                      <PlaySquare size={20} color={group.iconColor} />
                    )}
                  </View>

                  <View style={styles.groupInfo}>
                    <Text style={styles.groupName}>{group.name}</Text>
                    <Text style={styles.groupAppsList} numberOfLines={1}>
                      {group.id === 'social'
                        ? 'Instagram, Facebook, X, Reddit'
                        : 'YouTube Shorts, TikTok, Reels'}
                    </Text>
                  </View>

                  <View style={styles.groupStatusCol}>
                    <Text
                      style={[
                        styles.groupStatusText,
                        { color: isSocial ? colors.forest : colors.lavenderDark },
                      ]}
                    >
                      {statusTag}
                    </Text>
                    <ChevronRight size={16} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Add Protected Group Button */}
            <TouchableOpacity
              style={styles.addGroupBtn}
              activeOpacity={0.8}
              onPress={() => setAddModalVisible(true)}
            >
              <Plus size={16} color={colors.forest} />
              <Text style={styles.addGroupBtnText}>Add protected group</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Template Inspiration Banner */}
        <View style={styles.templateCard}>
          <View style={styles.templateInfo}>
            <Text style={styles.templateTitle}>Need inspiration?</Text>
            <Text style={styles.templateSub}>Explore simple routines that work.</Text>
          </View>

          <TouchableOpacity
            style={styles.templateBtn}
            activeOpacity={0.8}
            onPress={applyTemplate}
          >
            {templateApplied ? (
              <View style={styles.appliedRow}>
                <Check size={14} color={colors.forest} />
                <Text style={styles.templateBtnText}>Applied!</Text>
              </View>
            ) : (
              <Text style={styles.templateBtnText}>View templates</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Add Group Modal */}
      <AddRiskGroupModal
        visible={addModalVisible}
        onClose={() => setAddModalVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  mainCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    marginTop: 8,
    marginBottom: 20,
    ...shadows.card,
  },
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F2EDE3',
  },
  activeOnLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  daysChipsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  dayChip: {
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: radii.sm,
    backgroundColor: '#F8F6F0',
    borderWidth: 1,
    borderColor: '#EAE5D9',
  },
  dayChipActive: {
    backgroundColor: colors.sageLight,
    borderColor: colors.sage,
  },
  dayChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  dayChipTextActive: {
    color: colors.forestDark,
    fontWeight: '700',
  },
  windowsSequence: {
    marginTop: 6,
  },
  protectedSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    marginBottom: 16,
    ...shadows.card,
  },
  protectedHeaderRow: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  sectionSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  groupsList: {
    gap: 10,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FAF8F4',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#EFEAE0',
  },
  groupIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  groupAppsList: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  groupStatusCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  groupStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  addGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.sage,
    borderStyle: 'dashed',
    backgroundColor: '#FAFAF7',
    marginTop: 4,
    gap: 6,
  },
  addGroupBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.forest,
  },
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF5EA',
    borderRadius: radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFE2CC',
  },
  templateInfo: {
    flex: 1,
  },
  templateTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  templateSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  templateBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.full,
    backgroundColor: '#E8EFE5',
    borderWidth: 1,
    borderColor: '#D2E1CE',
  },
  appliedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  templateBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.forestDark,
  },
});
