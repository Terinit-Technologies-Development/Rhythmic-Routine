import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { ShieldAlert } from 'lucide-react-native';
import { colors, radii, shadows } from '../theme/tokens';
import { ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT } from '../constants/accessibilityDisclosure';

export { ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT };

export interface AndroidAccessibilityDisclosureProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export const AndroidAccessibilityDisclosure: React.FC<AndroidAccessibilityDisclosureProps> = ({
  visible,
  onCancel,
  onConfirm,
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <ShieldAlert size={28} color={colors.forestDark} />
            <Text style={styles.modalTitle}>{ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.title}</Text>
          </View>
          <Text style={styles.modalBody}>
            {ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.nonAssistiveNotice}
          </Text>
          <View style={styles.bulletList}>
            {ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.bullets.map((bullet, index) => (
              <Text key={index} style={styles.bulletItem}>
                • {bullet}
              </Text>
            ))}
          </View>
          <TouchableOpacity
            style={styles.confirmConsentBtn}
            activeOpacity={0.85}
            onPress={onConfirm}
          >
            <Text style={styles.confirmConsentText}>
              {ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.confirmLabel}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelConsentBtn}
            activeOpacity={0.7}
            onPress={onCancel}
          >
            <Text style={styles.cancelConsentText}>
              {ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.cancelLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 22,
    width: '100%',
    maxWidth: 380,
    ...shadows.card,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.forestDark,
    flex: 1,
  },
  modalBody: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 19,
    marginBottom: 12,
  },
  bulletList: {
    gap: 8,
    marginBottom: 18,
  },
  bulletItem: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  confirmConsentBtn: {
    backgroundColor: colors.forest,
    paddingVertical: 14,
    borderRadius: radii.xl,
    alignItems: 'center',
    marginBottom: 8,
  },
  confirmConsentText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  cancelConsentBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelConsentText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
});
