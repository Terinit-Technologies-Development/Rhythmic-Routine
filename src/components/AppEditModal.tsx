import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import { Check, X, ShieldAlert, CheckCircle2, Scale, HelpCircle, Plus, Minus } from 'lucide-react-native';
import { AppClassification, DeviceApp } from '../types/domain';
import { colors, radii, shadows } from '../theme/tokens';
import { usePrototypeStore } from '../store/usePrototypeStore';
import { getLocalDateKey } from '../domain/insights';

interface FormProps {
  selectedApp: DeviceApp;
  onClose: () => void;
}

const AppEditForm: React.FC<FormProps> = ({ selectedApp, onClose }) => {
  const riskGroups = usePrototypeStore((s) => s.riskGroups);
  const updateAppClassification = usePrototypeStore((s) => s.updateAppClassification);
  const updateDailyRiskAllowance = usePrototypeStore((s) => s.updateDailyRiskAllowance);
  const refreshDailyUsage = usePrototypeStore((s) => s.refreshDailyUsage);
  const dailyUsageSnapshot = usePrototypeStore((s) => s.dailyUsageSnapshot);

  const [classification, setClassification] = useState<AppClassification>(
    selectedApp.classification
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string>(
    selectedApp.riskGroupId || 'social'
  );

  const persistedMinutes = selectedApp.dailyRiskAllowance?.allowanceMinutes ?? 30;
  const [draftMinutes, setDraftMinutes] = useState(persistedMinutes);
  const [allowanceError, setAllowanceError] = useState<string | null>(null);

  const isLocked = selectedApp.dailyRiskAllowance?.lastEditedDateKey === getLocalDateKey();

  const snapshotApp = dailyUsageSnapshot?.apps.find((a) => a.packageName === selectedApp.id);
  const usedTodayMinutes = snapshotApp
    ? Math.floor(snapshotApp.usedSeconds / 60)
    : (selectedApp.usageTodayMinutes || 0);
  const remainingMinutes = snapshotApp
    ? Math.ceil(snapshotApp.remainingSeconds / 60)
    : Math.max(0, persistedMinutes - usedTodayMinutes);

  const handleSave = async () => {
    setAllowanceError(null);

    // 1. Classification & group updates
    updateAppClassification(
      selectedApp.id,
      classification,
      classification === 'risk' ? selectedGroupId : undefined
    );

    // 2. If already a Risk app and allowance was edited
    if (selectedApp.classification === 'risk' && draftMinutes !== persistedMinutes) {
      if (isLocked) {
        setAllowanceError('Allowance already edited today. Editable again tomorrow.');
        return;
      }

      const result = await updateDailyRiskAllowance(selectedApp.id, draftMinutes);
      if (!result.allowed) {
        const errorMessages: Record<string, string> = {
          'already-edited-today': 'Allowance already edited today. Editable again tomorrow.',
          'increase-too-large': 'Daily allowance increase cannot exceed 15 minutes at a time.',
          'invalid-step': 'Daily allowance must be adjusted in 15-minute intervals.',
          'below-minimum': 'Daily allowance cannot be negative.',
          'not-risk-app': 'Only Risk apps can have a daily allowance.',
          'app-not-found': 'Application not found.',
        };
        setAllowanceError(errorMessages[result.reason || ''] || 'Unable to update allowance.');
        return;
      }

      await refreshDailyUsage();
    }

    onClose();
  };

  const classifications: {
    id: AppClassification;
    title: string;
    description: string;
    icon: any;
    color: string;
    bg: string;
  }[] = [
    {
      id: 'essential',
      title: 'Essential',
      description: 'Always available. Never paused by routines or cooldowns (Phone, Maps, etc.)',
      icon: CheckCircle2,
      color: colors.badgeGreenText,
      bg: colors.badgeGreenBg,
    },
    {
      id: 'normal',
      title: 'Normal',
      description: 'Standard mindful apps with no automated session limits (Spotify, Books)',
      icon: Scale,
      color: colors.badgeAmberText,
      bg: colors.badgeAmberBg,
    },
    {
      id: 'risk',
      title: 'Risk App',
      description: 'Monitored with continuous session thresholds, morning buffers, and cooldowns',
      icon: ShieldAlert,
      color: colors.coralDark,
      bg: colors.coralLight,
    },
    {
      id: 'unclassified',
      title: 'Unclassified',
      description: 'Newly installed or pending attention classification',
      icon: HelpCircle,
      color: colors.badgeGrayText,
      bg: colors.badgeGrayBg,
    },
  ];

  return (
    <View style={styles.modalCard}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>{selectedApp.name}</Text>
          <Text style={styles.categorySub}>{selectedApp.defaultCategory}</Text>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <X size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Daily Allowance Section (for persisted Risk apps) */}
        {selectedApp.classification === 'risk' && (
          <View style={styles.allowanceSection}>
            <Text style={styles.sectionTitle}>Daily allowance</Text>

            {/* Metrics: Used today / Planned / Remaining */}
            <View style={styles.allowanceStatsRow}>
              <View style={styles.allowanceStatCol}>
                <Text style={styles.allowanceStatLabel}>Used today</Text>
                <Text style={styles.allowanceStatValue}>{usedTodayMinutes} min</Text>
              </View>
              <View style={styles.allowanceStatCol}>
                <Text style={styles.allowanceStatLabel}>Planned</Text>
                <Text style={styles.allowanceStatValue}>{persistedMinutes} min</Text>
              </View>
              <View style={styles.allowanceStatCol}>
                <Text style={styles.allowanceStatLabel}>Remaining</Text>
                <Text style={styles.allowanceStatValue}>{remainingMinutes} min</Text>
              </View>
            </View>

            {/* Stepper: [ −15 ]   {draftMinutes} min   [ +15 ] */}
            <View style={styles.stepperContainer}>
              <TouchableOpacity
                style={[
                  styles.allowanceStepBtn,
                  (isLocked || draftMinutes <= 0) && styles.stepBtnDisabled,
                ]}
                disabled={isLocked || draftMinutes <= 0}
                onPress={() => setDraftMinutes((prev) => Math.max(0, prev - 15))}
              >
                <Minus
                  size={16}
                  color={isLocked || draftMinutes <= 0 ? colors.textMuted : colors.forest}
                  strokeWidth={2.5}
                />
                <Text
                  style={[
                    styles.stepBtnText,
                    (isLocked || draftMinutes <= 0) && styles.stepBtnTextDisabled,
                  ]}
                >
                  −15
                </Text>
              </TouchableOpacity>

              <View style={styles.allowanceValueBox}>
                <Text style={styles.allowanceNumber}>{draftMinutes}</Text>
                <Text style={styles.allowanceUnit}>min</Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.allowanceStepBtn,
                  (isLocked || draftMinutes >= persistedMinutes + 15) && styles.stepBtnDisabled,
                ]}
                disabled={isLocked || draftMinutes >= persistedMinutes + 15}
                onPress={() =>
                  setDraftMinutes((prev) => Math.min(persistedMinutes + 15, prev + 15))
                }
              >
                <Plus
                  size={16}
                  color={
                    isLocked || draftMinutes >= persistedMinutes + 15
                      ? colors.textMuted
                      : colors.forest
                  }
                  strokeWidth={2.5}
                />
                <Text
                  style={[
                    styles.stepBtnText,
                    (isLocked || draftMinutes >= persistedMinutes + 15) && styles.stepBtnTextDisabled,
                  ]}
                >
                  +15
                </Text>
              </TouchableOpacity>
            </View>

            {/* Lock notice */}
            {isLocked && (
              <View style={styles.lockNoticeBox}>
                <Text style={styles.lockNoticeTitle}>Allowance set for today</Text>
                <Text style={styles.lockNoticeSub}>Editable again tomorrow</Text>
              </View>
            )}

            {/* Allowance Error Banner */}
            {allowanceError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{allowanceError}</Text>
              </View>
            )}
          </View>
        )}

        {/* Note when user newly selects Risk in this modal session */}
        {selectedApp.classification !== 'risk' && classification === 'risk' && (
          <View style={styles.newRiskNoticeBox}>
            <Text style={styles.newRiskNoticeText}>
              Daily allowance starts at 30 min/day. Save the Risk classification first. You can then customize the allowance.
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Select Classification</Text>

        {classifications.map((item) => {
          const isSelected = classification === item.id;
          const Icon = item.icon;

          return (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.classCard,
                isSelected && { borderColor: item.color, backgroundColor: '#FAF8F4' },
              ]}
              activeOpacity={0.8}
              onPress={() => setClassification(item.id)}
            >
              <View style={[styles.iconBox, { backgroundColor: item.bg }]}>
                <Icon size={20} color={item.color} />
              </View>
              <View style={styles.classInfo}>
                <Text style={styles.classTitle}>{item.title}</Text>
                <Text style={styles.classDesc}>{item.description}</Text>
              </View>
              {isSelected && (
                <View style={[styles.checkCircle, { backgroundColor: item.color }]}>
                  <Check size={14} color="#FFFFFF" strokeWidth={3} />
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {/* Risk Group Selection (when Risk is selected) */}
        {classification === 'risk' && (
          <View style={styles.groupSection}>
            <Text style={styles.sectionTitle}>Assign to Risk Group</Text>
            <Text style={styles.groupHelpText}>
              Apps in the same Risk Group share session timers and cooldowns.
            </Text>

            {riskGroups.map((group) => {
              const isGroupSelected = selectedGroupId === group.id;

              return (
                <TouchableOpacity
                  key={group.id}
                  style={[
                    styles.groupOption,
                    isGroupSelected && styles.groupOptionSelected,
                  ]}
                  onPress={() => setSelectedGroupId(group.id)}
                >
                  <Text
                    style={[
                      styles.groupOptionText,
                      isGroupSelected && styles.groupOptionTextSelected,
                    ]}
                  >
                    {group.name}
                  </Text>
                  <Text style={styles.groupLimitTag}>
                    {group.sessionThresholdMinutes}m session → {group.cooldownMinutes}m rest
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Bottom Actions */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveBtnText}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const AppEditModal: React.FC = () => {
  const appEdit = usePrototypeStore((s) => s.appEdit);
  const closeAppEdit = usePrototypeStore((s) => s.closeAppEdit);
  const apps = usePrototypeStore((s) => s.apps);

  const selectedApp = apps.find((a) => a.id === appEdit.appId);

  if (!appEdit.visible || !selectedApp) return null;

  return (
    <View style={styles.overlay}>
      <TouchableWithoutFeedback onPress={closeAppEdit}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>

      <AppEditForm
        key={selectedApp.id}
        selectedApp={selectedApp}
        onClose={closeAppEdit}
      />
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
    maxHeight: '90%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 28,
    zIndex: 10000,
    ...shadows.elevated,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFEAE0',
  },
  appName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  categorySub: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: colors.backgroundMuted,
  },
  body: {
    maxHeight: 460,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  classCard: {
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
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  classInfo: {
    flex: 1,
    paddingRight: 8,
  },
  classTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  classDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupSection: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#EFEAE0',
  },
  groupHelpText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  groupOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    marginBottom: 8,
    backgroundColor: '#FAF8F4',
  },
  groupOptionSelected: {
    borderColor: colors.forest,
    backgroundColor: colors.sageLight,
  },
  groupOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  groupOptionTextSelected: {
    color: colors.forestDark,
    fontWeight: '700',
  },
  groupLimitTag: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#EFEAE0',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radii.full,
    backgroundColor: '#F3EFE6',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  saveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: radii.full,
    backgroundColor: colors.forest,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  allowanceSection: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EFEAE0',
  },
  allowanceStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FAF8F4',
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EFEAE0',
  },
  allowanceStatCol: {
    alignItems: 'center',
    flex: 1,
  },
  allowanceStatLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
    fontWeight: '500',
  },
  allowanceStatValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 12,
  },
  allowanceStepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radii.full,
    backgroundColor: '#E8EFE5',
    gap: 4,
  },
  stepBtnDisabled: {
    backgroundColor: '#F3EFE6',
    opacity: 0.6,
  },
  stepBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.forest,
  },
  stepBtnTextDisabled: {
    color: colors.textMuted,
  },
  allowanceValueBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    minWidth: 80,
    gap: 4,
  },
  allowanceNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  allowanceUnit: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  lockNoticeBox: {
    backgroundColor: '#E8EFE5',
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  lockNoticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.forestDark,
  },
  lockNoticeSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  errorBox: {
    backgroundColor: colors.coralLight,
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.coralDark,
    textAlign: 'center',
  },
  newRiskNoticeBox: {
    backgroundColor: '#FAF8F4',
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EFEAE0',
  },
  newRiskNoticeText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
