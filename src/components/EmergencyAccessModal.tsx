import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { HeartHandshake, ShieldAlert } from 'lucide-react-native';
import { colors, radii, shadows } from '../theme/tokens';
import { usePrototypeStore } from '../store/usePrototypeStore';
import { getPlatformAccessLeasePolicy } from '../types/domain';

export const EmergencyAccessModal: React.FC = () => {
  const visible = usePrototypeStore((s) => s.emergencyModalVisible);
  const setVisible = usePrototypeStore((s) => s.setEmergencyModalVisible);
  const startAccessLease = usePrototypeStore((s) => s.startAccessLease);
  const riskGroups = usePrototypeStore((s) => s.riskGroups);
  const activeRiskGroupId = usePrototypeStore((s) => s.activeRiskGroupId);

  if (!visible) return null;

  const policy = getPlatformAccessLeasePolicy(Platform.OS);
  const durationMinutes = policy.defaultMinutes;
  const targetGroup = riskGroups.find((g) => g.id === activeRiskGroupId) || riskGroups[0];

  const handleGrantOverride = async () => {
    const groupId = targetGroup?.id || 'social';
    await startAccessLease(groupId, durationMinutes);
  };

  return (
    <View style={styles.overlay}>
      <TouchableWithoutFeedback onPress={() => setVisible(false)}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>

      <View style={styles.modalCard}>
        <View style={styles.iconCircle}>
          <HeartHandshake size={28} color={colors.forest} />
        </View>

        <Text style={styles.title}>Need emergency access?</Text>

        <Text style={styles.message}>
          Take a gentle breath. Rhythm is here to protect your attention, not to lock you out.
          {'\n\n'}
          You will receive <Text style={styles.bold}>{durationMinutes} minutes</Text> of temporary access to <Text style={styles.bold}>{targetGroup?.name ?? 'your apps'}</Text>.
          {'\n\n'}
          Your active cooldown will continue running in the background and restrictions will resume automatically when the lease expires.
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => setVisible(false)}
            activeOpacity={0.8}
          >
            <Text style={styles.cancelBtnText}>Stay in Rhythm</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.unlockBtn}
            onPress={handleGrantOverride}
            activeOpacity={0.8}
          >
            <View style={styles.unlockRow}>
              <ShieldAlert size={16} color={colors.amberDark} />
              <Text style={styles.unlockBtnText}>Grant {durationMinutes}-Min Override</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(22, 75, 56, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 9999,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 24,
    alignItems: 'center',
    zIndex: 10000,
    ...shadows.elevated,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.sageLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  message: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  bold: {
    fontWeight: '700',
    color: colors.text,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  cancelBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: radii.full,
    backgroundColor: colors.forest,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  unlockBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: radii.full,
    backgroundColor: '#F7EFE9',
    alignItems: 'center',
  },
  unlockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unlockBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.amberDark,
  },
});
