import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  Edit3,
  Trash2,
  AlertTriangle,
} from 'lucide-react-native';
import { XLogoIcon } from '../../src/components/BrandIcons';
import { colors, radii, shadows } from '../../src/theme/tokens';
import { usePrototypeStore } from '../../src/store/usePrototypeStore';
import { resolveGroupAllowanceMinutes } from '../../src/domain/rhythm/allowance';
import { getLocalDateKey } from '../../src/domain/insights';
import { useNow } from '../../src/domain/timer';
import Svg, { Path, Circle } from 'react-native-svg';

export default function RiskGroupDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const riskGroups = usePrototypeStore((s) => s.riskGroups);
  const saveRiskGroup = usePrototypeStore((s) => s.saveRiskGroup);
  const deleteRiskGroup = usePrototypeStore((s) => s.deleteRiskGroup);
  const updateRiskGroupAllowance = usePrototypeStore((s) => s.updateRiskGroupAllowance);
  const updateRiskGroupRecoveryActivity = usePrototypeStore((s) => s.updateRiskGroupRecoveryActivity);
  const routineWindows = usePrototypeStore((s) => s.routineWindows);
  const toggleGroupProtection = usePrototypeStore((s) => s.toggleGroupProtection);
  const apps = usePrototypeStore((s) => s.apps);
  const offlineActivities = usePrototypeStore((s) => s.offlineActivities);
  const groupSnapshots = usePrototypeStore((s) => s.groupUsageSnapshots);
  const dailyUsageError = usePrototypeStore((s) => s.dailyUsageError);
  const rhythmState = usePrototypeStore((s) => s.rhythmState);
  const activeRiskGroupId = usePrototypeStore((s) => s.activeRiskGroupId);
  const activeTimerEndsAt = usePrototypeStore((s) => s.activeTimerEndsAt);
  const setDemoSwitcherVisible = usePrototypeStore((s) => s.setDemoSwitcherVisible);
  const selectIosRiskGroupApps = usePrototypeStore((s) => s.selectIosRiskGroupApps);

  const group = riskGroups.find((g) => g.id === id);
  const now = useNow();

  const currentAllowanceMinutes = group ? resolveGroupAllowanceMinutes(group) : 30;

  // Staged editing draft
  const [draft, setDraft] = useState(() => ({
    name: group?.name ?? '',
    description: group?.description ?? '',
    sessionThresholdMinutes: currentAllowanceMinutes,
    cooldownMinutes: group?.cooldownMinutes ?? 60,
  }));

  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Deletion modal state
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [selectedReplacementId, setSelectedReplacementId] = useState<string>(() => {
    return riskGroups.find((g) => g.id !== id)?.id ?? '';
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isDirty = Boolean(
    group &&
      (draft.name.trim() !== group.name ||
        draft.description.trim() !== group.description ||
        draft.sessionThresholdMinutes !== currentAllowanceMinutes ||
        draft.cooldownMinutes !== group.cooldownMinutes)
  );

  if (!group) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.circleBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={22} color={colors.forestDark} strokeWidth={2.3} />
          </TouchableOpacity>
        </View>
        <View style={styles.notFoundContainer}>
          <Text style={styles.notFoundTitle}>Risk Group not found</Text>
          <Text style={styles.notFoundSub}>
            This group does not exist or was deleted.
          </Text>
          <TouchableOpacity
            style={styles.returnBtn}
            onPress={() => router.replace('/(tabs)/routine')}
          >
            <Text style={styles.returnBtnText}>Return to Routine</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isAllowanceEditLocked = group.lastAllowanceEditedDateKey === getLocalDateKey();

  const snapshot = groupSnapshots?.[group.id];
  const cooldownEndsAt =
    snapshot?.cooldownEndsAt ??
    (activeRiskGroupId === group.id && rhythmState === 'cooldown' ? activeTimerEndsAt : undefined);
  const coolingDown = Boolean(cooldownEndsAt && cooldownEndsAt > now);
  const usedMinutes = snapshot ? Math.floor(snapshot.usedSeconds / 60) : 0;
  const remainingMinutes = snapshot
    ? Math.ceil(snapshot.remainingSeconds / 60)
    : Math.max(0, currentAllowanceMinutes - usedMinutes);
  const isUsageUnavailable = Boolean(dailyUsageError);

  const cooldownOptions = [30, 60, 90, 120, 180];

  const morningWin = routineWindows.find((w) => w.type === 'morning-buffer');
  const eveningWin = routineWindows.find((w) => w.type === 'evening-wind-down');

  const morningBufferEnabled = morningWin?.protectedGroupIds.includes(group.id) ?? false;
  const eveningWindDownEnabled = eveningWin?.protectedGroupIds.includes(group.id) ?? false;

  const memberApps = apps.filter((a) => a.riskGroupId === group.id || group.appIds.includes(a.id));
  const resolvedRecoveryActivity =
    offlineActivities.find((a) => a.id === group.recoveryActivityId) ??
    offlineActivities.find((a) => a.id === 'walk');
  const resolvedRecoveryActivityId = resolvedRecoveryActivity?.id ?? 'walk';

  const isCustomGroup =
    group.origin === 'custom' ||
    (!['social', 'entertainment'].includes(group.id) && group.origin !== 'seeded');

  const otherGroups = riskGroups.filter((g) => g.id !== group.id);

  const handleAdjustCooldown = (delta: number) => {
    const currentIndex = cooldownOptions.indexOf(draft.cooldownMinutes);
    if (currentIndex !== -1) {
      const nextIndex = Math.max(
        0,
        Math.min(cooldownOptions.length - 1, currentIndex + delta)
      );
      setDraft((d) => ({ ...d, cooldownMinutes: cooldownOptions[nextIndex] }));
    } else {
      setDraft((d) => ({
        ...d,
        cooldownMinutes: Math.max(15, d.cooldownMinutes + delta * 15),
      }));
    }
  };

  const handleSaveAll = async () => {
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setSaveError('Risk Group name cannot be empty.');
      return;
    }

    try {
      setIsSaving(true);
      setSaveError(null);

      // If allowance changed, update through updateRiskGroupAllowance
      if (draft.sessionThresholdMinutes !== currentAllowanceMinutes) {
        const res = await updateRiskGroupAllowance(group.id, draft.sessionThresholdMinutes);
        if (!res.ok) {
          const msgs: Record<string, string> = {
            'already-edited-today': 'Allowance already edited today. Editable again tomorrow.',
            'increase-too-large': 'Group allowance increase cannot exceed 15 minutes at a time.',
            'invalid-step': 'Group allowance must be adjusted in 15-minute intervals.',
            'below-minimum': 'Group allowance cannot be negative.',
            'group-not-found': 'Risk Group not found.',
          };
          setSaveError(msgs[res.reason || ''] || 'Unable to update group allowance.');
          setIsSaving(false);
          return;
        }
      }

      await saveRiskGroup(group.id, {
        name: trimmedName,
        description: draft.description.trim(),
        sessionThresholdMinutes: draft.sessionThresholdMinutes,
        cooldownMinutes: draft.cooldownMinutes,
      });

      setIsEditingDetails(false);
    } catch {
      setSaveError('Failed to save group changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft({
      name: group.name,
      description: group.description,
      sessionThresholdMinutes: currentAllowanceMinutes,
      cooldownMinutes: group.cooldownMinutes,
    });
    setIsEditingDetails(false);
    setSaveError(null);
  };

  const handleConfirmDelete = async () => {
    try {
      setIsDeleting(true);
      setDeleteError(null);
      const res = await deleteRiskGroup(
        group.id,
        memberApps.length > 0 ? selectedReplacementId : undefined
      );

      if (res.ok) {
        setDeleteModalVisible(false);
        router.replace('/(tabs)/routine');
      } else {
        const msgs: Record<string, string> = {
          'replacement-required': 'Please select a replacement group for member apps.',
          'invalid-replacement-group': 'Selected replacement group is invalid.',
          'cannot-delete-seeded-group': 'Starter risk groups cannot be deleted.',
          'group-not-found': 'Group not found.',
        };
        setDeleteError(msgs[res.reason || ''] || 'Failed to delete risk group.');
      }
    } catch {
      setDeleteError('An unexpected error occurred during deletion.');
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleMorning = (val: boolean) => {
    if (morningWin) {
      toggleGroupProtection(morningWin.id, group.id, val);
    }
  };

  const toggleEvening = (val: boolean) => {
    if (eveningWin) {
      toggleGroupProtection(eveningWin.id, group.id, val);
    }
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
        contentContainerStyle={[
          styles.scrollContent,
          isDirty && { paddingBottom: 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title Header with Floating Bubble Graphic */}
        <View style={styles.titleSection}>
          {isEditingDetails ? (
            <View style={styles.titleEditBox}>
              <Text style={styles.editLabel}>Group Name</Text>
              <TextInput
                style={styles.titleInput}
                value={draft.name}
                onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
                placeholder="Group Name"
                placeholderTextColor={colors.textMuted}
                autoFocus={true}
              />

              <Text style={[styles.editLabel, { marginTop: 10 }]}>Description</Text>
              <TextInput
                style={[styles.titleInput, styles.descInput]}
                value={draft.description}
                onChangeText={(description) => setDraft((d) => ({ ...d, description }))}
                placeholder="Description"
                placeholderTextColor={colors.textMuted}
                multiline={true}
              />

              <TouchableOpacity
                style={styles.doneDetailsBtn}
                onPress={() => setIsEditingDetails(false)}
              >
                <Text style={styles.doneDetailsBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.titleCol}>
              <View style={styles.titleTopRow}>
                <Text style={styles.overheadLabel}>
                  {isCustomGroup ? 'Custom Risk Group' : 'Starter Risk Group'}
                </Text>
                <TouchableOpacity
                  style={styles.editInfoBtn}
                  onPress={() => setIsEditingDetails(true)}
                >
                  <Edit3 size={13} color={colors.forest} />
                  <Text style={styles.editInfoBtnText}>Edit info</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.mainTitle}>{draft.name}</Text>
              <Text style={styles.description}>{draft.description}</Text>
            </View>
          )}

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

        {/* Section 1: Member Apps / Screen Time selection */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Protected apps</Text>
              <Text style={styles.cardSubtitle}>
                {Platform.OS === 'ios'
                  ? 'Screen Time shields applications and categories in this group.'
                  : 'Apps in this group are monitored together.'}
              </Text>
            </View>
            {Platform.OS !== 'ios' && (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => router.push('/(tabs)/apps')}
              >
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {Platform.OS === 'ios' ? (
            <View style={styles.iosSelectionContainer}>
              <TouchableOpacity
                style={styles.iosPickerButton}
                onPress={() => selectIosRiskGroupApps(group.id)}
                activeOpacity={0.8}
              >
                <Text style={styles.iosPickerButtonText}>Select / Edit with Screen Time</Text>
              </TouchableOpacity>
              <Text style={styles.iosSelectionSummary}>
                {group.nativeSelectionCount !== undefined && group.nativeSelectionCount > 0
                  ? `${group.nativeSelectionCount} selection${group.nativeSelectionCount === 1 ? '' : 's'} configured`
                  : group.nativeSelectionRef
                  ? 'Configured in Screen Time'
                  : 'No apps or categories selected yet'}
              </Text>
            </View>
          ) : (
            <View style={styles.memberAppsList}>
              {memberApps.length > 0 ? (
                memberApps.map((app) => (
                  <View key={app.id} style={styles.memberAppRow}>
                    <View style={styles.appLeft}>
                      {renderAppIcon(app.id)}
                      <Text style={styles.appRowName}>{app.name}</Text>
                    </View>
                    <Check size={18} color={colors.forest} strokeWidth={2.5} />
                  </View>
                ))
              ) : (
                <Text style={styles.noAppsText}>No apps assigned to this group yet.</Text>
              )}
            </View>
          )}
        </View>

        {/* Section 2: Group Allowance */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Group Allowance</Text>
          <Text style={styles.cardSubtitle}>
            Shared daily usage limit for all apps in this Risk Group before recovery cooldown begins.
          </Text>

          {/* Cycle Stats */}
          <View style={styles.allowanceStatsRow}>
            <View style={styles.allowanceStatCol}>
              <Text style={styles.allowanceStatLabel}>Used in cycle</Text>
              <Text style={styles.allowanceStatValue}>
                {isUsageUnavailable ? '—' : `${usedMinutes} min`}
              </Text>
            </View>
            <View style={styles.allowanceStatCol}>
              <Text style={styles.allowanceStatLabel}>Allowance</Text>
              <Text style={styles.allowanceStatValue}>{draft.sessionThresholdMinutes} min</Text>
            </View>
            <View style={styles.allowanceStatCol}>
              <Text style={styles.allowanceStatLabel}>Remaining</Text>
              <Text style={[styles.allowanceStatValue, coolingDown && styles.statCooldown]}>
                {isUsageUnavailable
                  ? '—'
                  : coolingDown
                  ? `Cooling · ${Math.max(1, Math.ceil((cooldownEndsAt! - now) / 60000))}m`
                  : `${remainingMinutes} min`}
              </Text>
            </View>
          </View>

          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={[
                styles.stepBtn,
                (isAllowanceEditLocked || draft.sessionThresholdMinutes <= 0) && styles.stepBtnDisabled,
              ]}
              disabled={isAllowanceEditLocked || draft.sessionThresholdMinutes <= 0}
              onPress={() =>
                setDraft((d) => ({
                  ...d,
                  sessionThresholdMinutes: Math.max(0, d.sessionThresholdMinutes - 15),
                }))
              }
            >
              <Minus
                size={20}
                color={isAllowanceEditLocked || draft.sessionThresholdMinutes <= 0 ? colors.textMuted : colors.forest}
                strokeWidth={2.5}
              />
            </TouchableOpacity>

            <Text style={styles.stepperNumber}>
              {draft.sessionThresholdMinutes} <Text style={styles.stepperUnit}>min</Text>
            </Text>

            <TouchableOpacity
              style={[
                styles.stepBtn,
                (isAllowanceEditLocked || draft.sessionThresholdMinutes >= currentAllowanceMinutes + 15) &&
                  styles.stepBtnDisabled,
              ]}
              disabled={isAllowanceEditLocked || draft.sessionThresholdMinutes >= currentAllowanceMinutes + 15}
              onPress={() =>
                setDraft((d) => ({
                  ...d,
                  sessionThresholdMinutes: Math.min(currentAllowanceMinutes + 15, d.sessionThresholdMinutes + 15),
                }))
              }
            >
              <Plus
                size={20}
                color={
                  isAllowanceEditLocked || draft.sessionThresholdMinutes >= currentAllowanceMinutes + 15
                    ? colors.textMuted
                    : colors.forest
                }
                strokeWidth={2.5}
              />
            </TouchableOpacity>
          </View>

          {isAllowanceEditLocked && (
            <View style={styles.lockNoticeBox}>
              <Text style={styles.lockNoticeTitle}>Allowance set for today</Text>
              <Text style={styles.lockNoticeSub}>Editable again tomorrow</Text>
            </View>
          )}

          {saveError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{saveError}</Text>
            </View>
          )}
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
              {draft.cooldownMinutes} <Text style={styles.stepperUnit}>min</Text>
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
                const isSelected = draft.cooldownMinutes === val;
                return (
                  <TouchableOpacity
                    key={val}
                    style={styles.notchItem}
                    onPress={() => setDraft((d) => ({ ...d, cooldownMinutes: val }))}
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

        {/* Section 4: Recovery Activity Selector */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recovery activity</Text>
          <Text style={styles.cardSubtitle}>
            Chosen offline activity suggested during recovery cooldown.
          </Text>

          <View style={styles.activitiesList}>
            {offlineActivities.map((act) => {
              const isChosen = act.id === resolvedRecoveryActivityId;
              return (
                <TouchableOpacity
                  key={act.id}
                  style={[styles.activityOption, isChosen && styles.activityOptionSelected]}
                  onPress={() => updateRiskGroupRecoveryActivity(group.id, act.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.activityEmoji}>{act.iconEmoji}</Text>
                  <View style={styles.activityInfo}>
                    <Text style={[styles.activityTitle, isChosen && styles.activityTitleSelected]}>
                      {act.title}
                    </Text>
                    <Text style={styles.activitySub}>{act.subtitle}</Text>
                  </View>
                  {isChosen && <Check size={18} color={colors.forest} strokeWidth={2.5} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Section 5: Protected in (Routine Window Toggles) */}
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
                <Text style={styles.toggleTime}>
                  {morningWin ? `${morningWin.startTime} – ${morningWin.endTime || '08:00'}` : '06:30 – 08:00'}
                </Text>
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
                <Text style={styles.toggleTime}>
                  {eveningWin ? `${eveningWin.startTime} – ${eveningWin.endTime || '23:30'}` : '21:30 – 23:30'}
                </Text>
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

        {/* Section 6: Trigger Logic Preview */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Trigger logic preview</Text>
          <Text style={styles.cardSubtitle}>How protection works for this group.</Text>

          <View style={styles.logicPreviewRow}>
            <View style={styles.logicBoxOnline}>
              <Clock size={16} color={colors.amberDark} />
              <View style={{ marginTop: 6 }}>
                <Text style={styles.logicBoxTitle}>
                  {draft.sessionThresholdMinutes} min online
                </Text>
                <Text style={styles.logicBoxSub}>Group Allowance</Text>
              </View>
            </View>

            <ArrowRight size={18} color={colors.textMuted} />

            <View style={styles.logicBoxOffline}>
              <Moon size={16} color={colors.lavenderDark} />
              <View style={{ marginTop: 6 }}>
                <Text style={styles.logicBoxTitle}>
                  {draft.cooldownMinutes} min offline
                </Text>
                <Text style={styles.logicBoxSub}>Recovery cooldown</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Section 7: Danger Zone / Delete Group (Custom groups only) */}
        {isCustomGroup ? (
          <View style={[styles.card, styles.deleteCard]}>
            <Text style={styles.deleteTitle}>Delete Risk Group</Text>
            <Text style={styles.deleteSubtitle}>
              Permanently remove this custom group. If member apps are assigned, they must be reassigned.
            </Text>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => {
                setDeleteError(null);
                setSelectedReplacementId(otherGroups[0]?.id ?? '');
                setDeleteModalVisible(true);
              }}
            >
              <Trash2 size={16} color="#DC2626" />
              <Text style={styles.deleteBtnText}>Delete {group.name}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.seededNote}>
            <Text style={styles.seededNoteText}>
              Starter Risk Group · Built-in protected groups cannot be deleted.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky Bottom Action Bar when Draft is Dirty */}
      {isDirty && (
        <View style={[styles.dirtyBar, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>
          <View style={styles.dirtyBarInfo}>
            <Text style={styles.dirtyBarTitle}>Unsaved changes</Text>
            <Text style={styles.dirtyBarSubtitle}>Staged group configuration</Text>
          </View>
          <View style={styles.dirtyBarActions}>
            <TouchableOpacity
              style={styles.discardBtn}
              onPress={handleDiscard}
              disabled={isSaving}
            >
              <Text style={styles.discardBtnText}>Discard</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSaveAll}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.saveBtnText}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Delete Confirmation & Reassignment Modal */}
      <Modal
        visible={deleteModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalCard}>
            <View style={styles.deleteModalHeader}>
              <View style={styles.alertIconCircle}>
                <AlertTriangle size={22} color="#DC2626" />
              </View>
              <Text style={styles.deleteModalTitle}>Delete {group.name}?</Text>
            </View>

            {memberApps.length > 0 ? (
              <View style={styles.deleteModalBody}>
                <Text style={styles.deleteModalDesc}>
                  This group contains <Text style={{ fontWeight: '700' }}>{memberApps.length}</Text> protected app{memberApps.length === 1 ? '' : 's'}. Choose a replacement group to receive them:
                </Text>

                <View style={styles.replacementList}>
                  {otherGroups.map((rg) => {
                    const isSelected = selectedReplacementId === rg.id;
                    return (
                      <TouchableOpacity
                        key={rg.id}
                        style={[
                          styles.replacementOption,
                          isSelected && styles.replacementOptionSelected,
                        ]}
                        onPress={() => setSelectedReplacementId(rg.id)}
                      >
                        <View style={styles.replacementLeft}>
                          <View
                            style={[
                              styles.radioCircle,
                              isSelected && styles.radioCircleSelected,
                            ]}
                          >
                            {isSelected && <View style={styles.radioInner} />}
                          </View>
                          <Text
                            style={[
                              styles.replacementName,
                              isSelected && styles.replacementNameSelected,
                            ]}
                          >
                            {rg.name}
                          </Text>
                        </View>
                        <Text style={styles.replacementAppCount}>
                          {rg.appIds.length} apps
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : (
              <Text style={styles.deleteModalDesc}>
                Are you sure you want to delete this custom Risk Group? This action cannot be undone.
              </Text>
            )}

            {deleteError && (
              <View style={styles.deleteErrorBox}>
                <Text style={styles.deleteErrorText}>{deleteError}</Text>
              </View>
            )}

            <View style={styles.deleteModalActions}>
              <TouchableOpacity
                style={styles.cancelDeleteBtn}
                onPress={() => {
                  setDeleteModalVisible(false);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
              >
                <Text style={styles.cancelDeleteBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.confirmDeleteBtn,
                  (isDeleting || (memberApps.length > 0 && !selectedReplacementId)) &&
                    styles.confirmDeleteBtnDisabled,
                ]}
                disabled={isDeleting || (memberApps.length > 0 && !selectedReplacementId)}
                onPress={handleConfirmDelete}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmDeleteBtnText}>Delete Group</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  titleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  overheadLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  editInfoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    backgroundColor: '#E8EFE5',
  },
  editInfoBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.forestDark,
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
  titleEditBox: {
    flex: 1,
    paddingRight: 10,
  },
  editLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  titleInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D4CDBD',
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    fontWeight: '600',
    color: colors.forestDark,
  },
  descInput: {
    fontSize: 13,
    fontWeight: '400',
    height: 54,
  },
  doneDetailsBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: colors.forest,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
  doneDetailsBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  noAppsText: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  iosSelectionContainer: {
    gap: 8,
  },
  iosPickerButton: {
    backgroundColor: colors.forest,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radii.full,
    alignItems: 'center',
  },
  iosPickerButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  iosSelectionSummary: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  allowanceStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FAF8F4',
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
    marginBottom: 16,
  },
  allowanceStatCol: {
    alignItems: 'center',
  },
  allowanceStatLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 2,
  },
  allowanceStatValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.forestDark,
  },
  statCooldown: {
    color: colors.coralDark,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginVertical: 12,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3EFE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  stepperNumber: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.forestDark,
    minWidth: 90,
    textAlign: 'center',
  },
  stepperUnit: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  lockNoticeBox: {
    backgroundColor: '#FBF3E2',
    borderRadius: radii.md,
    padding: 10,
    marginTop: 10,
    alignItems: 'center',
  },
  lockNoticeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B27D2B',
  },
  lockNoticeSub: {
    fontSize: 11,
    color: '#8A5D19',
    marginTop: 1,
  },
  errorBox: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#F8B4B4',
    borderRadius: radii.md,
    padding: 10,
    marginTop: 10,
  },
  errorText: {
    fontSize: 12,
    color: '#9B1C1C',
    textAlign: 'center',
  },
  sliderTrack: {
    marginTop: 14,
    marginBottom: 8,
    position: 'relative',
  },
  sliderLine: {
    position: 'absolute',
    top: 6,
    left: 10,
    right: 10,
    height: 2,
    backgroundColor: '#E8E3D7',
  },
  notchesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  notchItem: {
    alignItems: 'center',
  },
  notchDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#D4CDBD',
    marginBottom: 6,
  },
  notchDotSelected: {
    borderColor: colors.forest,
    backgroundColor: colors.forest,
  },
  notchLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  notchLabelSelected: {
    fontWeight: '700',
    color: colors.forestDark,
  },
  activitiesList: {
    gap: 8,
    marginTop: 12,
  },
  activityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    backgroundColor: '#FAF8F4',
    gap: 12,
  },
  activityOptionSelected: {
    borderColor: colors.forest,
    backgroundColor: colors.sageLight,
  },
  activityEmoji: {
    fontSize: 24,
  },
  activityInfo: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  activityTitleSelected: {
    fontWeight: '700',
    color: colors.forestDark,
  },
  activitySub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFEAE0',
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
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  logicPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  logicBoxOnline: {
    flex: 1,
    backgroundColor: colors.amberLight,
    borderRadius: radii.lg,
    padding: 14,
    marginRight: 8,
  },
  logicBoxOffline: {
    flex: 1,
    backgroundColor: colors.lavenderLight,
    borderRadius: radii.lg,
    padding: 14,
    marginLeft: 8,
  },
  logicBoxTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.forestDark,
  },
  logicBoxSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  deleteCard: {
    borderColor: '#FEE2E2',
    backgroundColor: '#FFFBFB',
  },
  deleteTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#991B1B',
  },
  deleteSubtitle: {
    fontSize: 12,
    color: '#7F1D1D',
    marginTop: 2,
    marginBottom: 14,
    lineHeight: 16,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  deleteBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },
  seededNote: {
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: '#FAF8F4',
    borderWidth: 1,
    borderColor: '#EFEAE0',
    alignItems: 'center',
    marginBottom: 14,
  },
  seededNoteText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  dirtyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2DCD1',
    paddingTop: 12,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shadows.elevated,
  },
  dirtyBarInfo: {
    flex: 1,
  },
  dirtyBarTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.forestDark,
  },
  dirtyBarSubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  dirtyBarActions: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  discardBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.full,
    backgroundColor: '#F3EFE6',
  },
  discardBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: radii.full,
    backgroundColor: colors.forest,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(22, 75, 56, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  deleteModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 22,
    ...shadows.elevated,
  },
  deleteModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  alertIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#991B1B',
  },
  deleteModalBody: {
    marginBottom: 14,
  },
  deleteModalDesc: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  replacementList: {
    gap: 8,
    maxHeight: 180,
  },
  replacementOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    backgroundColor: '#FAF8F4',
  },
  replacementOptionSelected: {
    borderColor: colors.forest,
    backgroundColor: colors.sageLight,
  },
  replacementLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: colors.forest,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.forest,
  },
  replacementName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  replacementNameSelected: {
    color: colors.forestDark,
    fontWeight: '700',
  },
  replacementAppCount: {
    fontSize: 11,
    color: colors.textMuted,
  },
  deleteErrorBox: {
    backgroundColor: '#FEE2E2',
    padding: 10,
    borderRadius: radii.md,
    marginBottom: 12,
  },
  deleteErrorText: {
    fontSize: 12,
    color: '#991B1B',
  },
  deleteModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  cancelDeleteBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.full,
    backgroundColor: '#F3EFE6',
    alignItems: 'center',
  },
  cancelDeleteBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  confirmDeleteBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.full,
    backgroundColor: '#DC2626',
    alignItems: 'center',
  },
  confirmDeleteBtnDisabled: {
    opacity: 0.5,
  },
  confirmDeleteBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  notFoundContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  notFoundTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  notFoundSub: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  returnBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: colors.forest,
    borderRadius: radii.full,
  },
  returnBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
