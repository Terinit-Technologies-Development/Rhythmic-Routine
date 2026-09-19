import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Shield, ShieldAlert, X, Check, Lock, UserCheck } from 'lucide-react-native';
import { colors, radii, shadows } from '../theme/tokens';
import { usePrototypeStore } from '../store/usePrototypeStore';
import { getEnabledPartners } from '../domain/accountability/policy';
import { PendingApproval } from '../domain/accountability/types';

function getLockoutSecondsRemaining(lockoutEndsAt?: number): number {
  if (!lockoutEndsAt) return 60;
  return Math.max(1, Math.ceil((lockoutEndsAt - Date.now()) / 1000));
}

export const AccountabilityApprovalModal: React.FC = () => {
  const pendingApproval = usePrototypeStore((s) => s.pendingApproval);
  if (!pendingApproval) {
    return null;
  }
  return <AccountabilityApprovalModalInner key={pendingApproval.id} pendingApproval={pendingApproval} />;
};

interface InnerModalProps {
  pendingApproval: PendingApproval;
}

const AccountabilityApprovalModalInner: React.FC<InnerModalProps> = ({ pendingApproval }) => {
  const insets = useSafeAreaInsets();
  const accountability = usePrototypeStore((s) => s.accountability);
  const approveProtectedMutation = usePrototypeStore((s) => s.approveProtectedMutation);
  const cancelPendingApproval = usePrototypeStore((s) => s.cancelPendingApproval);

  const enabledPartners = getEnabledPartners(accountability);
  const defaultPartnerId = enabledPartners[0]?.id || '';

  const [partnerId, setPartnerId] = useState(defaultPartnerId);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedPartner = enabledPartners.find((p) => p.id === partnerId) || enabledPartners[0];

  const handleApprove = async () => {
    if (!password) {
      setError('Partner password is required');
      return;
    }
    if (!selectedPartner) {
      setError('No partner selected');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await approveProtectedMutation(selectedPartner.id, password);
      if (!result.ok) {
        if (result.reason === 'rate-limited') {
          const secs = getLockoutSecondsRemaining(result.lockoutEndsAt);
          setError(`Too many failed attempts. Locked out for ${secs}s.`);
        } else if (result.reason === 'invalid-password') {
          const rem = result.remainingAttempts;
          if (rem !== undefined) {
            setError(`Incorrect password. ${rem} attempt${rem === 1 ? '' : 's'} remaining.`);
          } else {
            setError('Incorrect password. Please verify and try again.');
          }
        } else if (result.reason === 'partner-disabled') {
          setError('Selected partner is currently disabled.');
        } else {
          setError('Authorization failed. Please try again.');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Approval failed');
    } finally {
      setPassword('');
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setPassword('');
    setError(null);
    cancelPendingApproval();
  };

  return (
    <Modal
      visible={Boolean(pendingApproval)}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <TouchableWithoutFeedback onPress={handleCancel}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.keyboardAvoid}
            >
              <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 24) }]}>
                {/* Header */}
                <View style={styles.header}>
                  <View style={styles.iconCircle}>
                    <Shield size={24} color={colors.forest} />
                  </View>
                  <View style={styles.headerText}>
                    <Text style={styles.title}>Partner Approval</Text>
                    <Text style={styles.subtitle}>Protected Action Verification</Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleCancel}
                    style={styles.closeButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <X size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={styles.scrollContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Summary Box */}
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>REQUESTED CHANGE</Text>
                    <Text style={styles.summaryText}>{pendingApproval.summary}</Text>
                  </View>

                  {/* Partner Selection */}
                  {enabledPartners.length > 1 ? (
                    <View style={styles.section}>
                      <Text style={styles.sectionLabel}>Select Approving Partner</Text>
                      <View style={styles.partnerList}>
                        {enabledPartners.map((partner) => {
                          const isSelected = partner.id === (selectedPartner?.id ?? '');
                          return (
                            <TouchableOpacity
                              key={partner.id}
                              style={[styles.partnerOption, isSelected && styles.partnerOptionSelected]}
                              onPress={() => {
                                setPartnerId(partner.id);
                                setError(null);
                              }}
                            >
                              <View style={styles.partnerInfo}>
                                <Text style={[styles.partnerName, isSelected && styles.partnerNameSelected]}>
                                  {partner.name}
                                </Text>
                                {partner.relationshipLabel ? (
                                  <Text style={styles.partnerRelation}>{partner.relationshipLabel}</Text>
                                ) : null}
                              </View>
                              <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                                {isSelected && <View style={styles.radioDot} />}
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  ) : (
                    <View style={styles.singlePartnerRow}>
                      <UserCheck size={18} color={colors.forest} />
                      <Text style={styles.singlePartnerText}>
                        Approving as <Text style={styles.boldText}>{selectedPartner?.name}</Text>
                        {selectedPartner?.relationshipLabel ? ` (${selectedPartner.relationshipLabel})` : ''}
                      </Text>
                    </View>
                  )}

                  {/* Hand-off Notice */}
                  <View style={styles.handoffBox}>
                    <Lock size={16} color={colors.forestLight} />
                    <Text style={styles.handoffText}>
                      Hand your device to {selectedPartner?.name || 'your partner'} to enter their password.
                    </Text>
                  </View>

                  {/* Password Input */}
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Partner Password</Text>
                    <TextInput
                      style={[styles.input, error ? styles.inputError : null]}
                      placeholder="Enter partner password"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry
                      value={password}
                      onChangeText={(text) => {
                        setPassword(text);
                        if (error) setError(null);
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  {/* Neutral Error State */}
                  {error ? (
                    <View style={styles.errorContainer}>
                      <ShieldAlert size={16} color={colors.coral} />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  ) : null}
                </ScrollView>

                {/* Actions */}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={handleCancel}
                    disabled={loading}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.approveButton, loading && styles.buttonDisabled]}
                    onPress={handleApprove}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Check size={18} color="#FFFFFF" style={styles.buttonIcon} />
                        <Text style={styles.approveButtonText}>Approve Change</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(14, 51, 38, 0.45)',
    justifyContent: 'flex-end',
  },
  keyboardAvoid: {
    width: '100%',
  },
  container: {
    backgroundColor: colors.backgroundCard,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '90%',
    ...shadows.elevated,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    backgroundColor: colors.forestSurface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeButton: {
    padding: 6,
    borderRadius: radii.full,
    backgroundColor: colors.backgroundMuted,
  },
  scroll: {
    maxHeight: 400,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  summaryCard: {
    backgroundColor: colors.backgroundElevated,
    borderRadius: radii.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  summaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 20,
  },
  section: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  partnerList: {
    gap: 8,
  },
  partnerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElevated,
  },
  partnerOptionSelected: {
    borderColor: colors.forest,
    backgroundColor: colors.forestSurface,
  },
  partnerInfo: {
    flex: 1,
  },
  partnerName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  partnerNameSelected: {
    color: colors.forestDark,
  },
  partnerRelation: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleSelected: {
    borderColor: colors.forest,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.forest,
  },
  singlePartnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.forestSurface,
    padding: 12,
    borderRadius: radii.md,
    marginBottom: 14,
    gap: 8,
  },
  singlePartnerText: {
    fontSize: 13,
    color: colors.forestDark,
    flex: 1,
  },
  boldText: {
    fontWeight: '700',
  },
  handoffBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundMuted,
    padding: 12,
    borderRadius: radii.md,
    marginBottom: 16,
    gap: 8,
  },
  handoffText: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 16,
  },
  input: {
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.coral,
    backgroundColor: colors.coralSoft,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.coralLight,
    padding: 10,
    borderRadius: radii.md,
    gap: 8,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 12,
    color: colors.coralDark,
    flex: 1,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.borderDark,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundCard,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  approveButton: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: radii.full,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonIcon: {
    marginRight: 6,
  },
  approveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
