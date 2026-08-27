import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import { HeartHandshake } from 'lucide-react-native';
import { colors, radii, shadows } from '../theme/tokens';
import { usePrototypeStore } from '../store/usePrototypeStore';

export const EmergencyAccessModal: React.FC = () => {
  const visible = usePrototypeStore((s) => s.emergencyModalVisible);
  const setVisible = usePrototypeStore((s) => s.setEmergencyModalVisible);
  const triggerEmergencyBypass = usePrototypeStore((s) => s.triggerEmergencyBypass);

  if (!visible) return null;

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
          Take a gentle breath. Rhythm is here to protect your attention, not to punish you.
          {'\n\n'}
          If you have an urgent message, travel update, or emergency, you can unlock your apps
          immediately without penalty.
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => setVisible(false)}
          >
            <Text style={styles.cancelBtnText}>Stay in Rhythm</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.unlockBtn}
            onPress={triggerEmergencyBypass}
          >
            <Text style={styles.unlockBtnText}>Unlock Apps</Text>
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
    backgroundColor: '#F3EFE6',
    alignItems: 'center',
  },
  unlockBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
