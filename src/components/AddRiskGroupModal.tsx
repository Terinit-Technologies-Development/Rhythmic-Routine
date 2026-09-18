import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FolderPlus, X, Minus, Plus } from 'lucide-react-native';
import { colors, radii, shadows } from '../theme/tokens';
import { usePrototypeStore } from '../store/usePrototypeStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export const AddRiskGroupModal: React.FC<Props> = ({ visible, onClose }) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [allowanceMinutes, setAllowanceMinutes] = useState(30);
  const [cooldownMinutes, setCooldownMinutes] = useState(60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestProtectedMutation = usePrototypeStore((s) => s.requestProtectedMutation);

  if (!visible) return null;

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || isSubmitting) return;

    try {
      setIsSubmitting(true);
      setError(null);

      const summary = `Create Risk Group “${trimmed}” · ${allowanceMinutes} min session · ${cooldownMinutes} min cooldown`;
      const result = await requestProtectedMutation({
        operation: 'create-risk-group',
        summary,
        payload: {
          name: trimmed,
          description: description.trim() || undefined,
          allowanceMinutes,
          cooldownMinutes,
        },
      });

      setName('');
      setDescription('');
      setAllowanceMinutes(30);
      setCooldownMinutes(60);
      onClose();

      if (result.status === 'executed' && typeof result.result === 'string') {
        router.push(`/risk-groups/${result.result}` as any);
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to create risk group. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={StyleSheet.absoluteFill}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View
          style={[
            styles.modalCard,
            { paddingBottom: Math.max(20, insets.bottom + 12) },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <FolderPlus size={20} color={colors.forest} />
              <Text style={styles.title}>Create Protected Group</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <X size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Group related distracting apps together to manage their usage rhythm collectively.
          </Text>

          <ScrollView style={styles.scrollBody} showsVerticalScrollIndicator={false}>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Group Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Gaming, Shopping, Short Video"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                autoFocus={true}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Description (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Video feeds and quick clips"
                placeholderTextColor={colors.textMuted}
                value={description}
                onChangeText={setDescription}
              />
            </View>

            <View style={styles.configRow}>
              {/* Group Allowance Control */}
              <View style={styles.configCol}>
                <Text style={styles.label}>Group Allowance</Text>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setAllowanceMinutes((m) => Math.max(15, m - 15))}
                  >
                    <Minus size={16} color={colors.forest} />
                  </TouchableOpacity>
                  <Text style={styles.stepValue}>{allowanceMinutes}m</Text>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setAllowanceMinutes((m) => Math.min(180, m + 15))}
                  >
                    <Plus size={16} color={colors.forest} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Cooldown Duration Control */}
              <View style={styles.configCol}>
                <Text style={styles.label}>Cooldown</Text>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setCooldownMinutes((m) => Math.max(15, m - 15))}
                  >
                    <Minus size={16} color={colors.forest} />
                  </TouchableOpacity>
                  <Text style={styles.stepValue}>{cooldownMinutes}m</Text>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setCooldownMinutes((m) => Math.min(240, m + 15))}
                  >
                    <Plus size={16} color={colors.forest} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.createBtn, (!name.trim() || isSubmitting) && styles.createBtnDisabled]}
              disabled={!name.trim() || isSubmitting}
              onPress={handleCreate}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.createBtnText}>Create Group</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(22, 75, 56, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    paddingHorizontal: 22,
    paddingTop: 22,
    zIndex: 10000,
    ...shadows.elevated,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: colors.backgroundMuted,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  scrollBody: {
    flexShrink: 1,
  },
  formGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#FAF8F4',
    borderWidth: 1,
    borderColor: '#EAE5DB',
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },
  configRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  configCol: {
    flex: 1,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF8F4',
    borderWidth: 1,
    borderColor: '#EAE5DB',
    borderRadius: radii.md,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  stepBtn: {
    padding: 4,
    borderRadius: radii.sm,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E3D7',
  },
  stepValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.forestDark,
  },
  errorBox: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#F8B4B4',
    borderRadius: radii.md,
    padding: 10,
    marginBottom: 10,
  },
  errorText: {
    fontSize: 12,
    color: '#9B1C1C',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    paddingTop: 10,
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
  createBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: radii.full,
    backgroundColor: colors.forest,
    alignItems: 'center',
  },
  createBtnDisabled: {
    opacity: 0.5,
  },
  createBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
