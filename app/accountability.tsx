import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Modal,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Eye,
  EyeOff,
  MoreVertical,
  Edit2,
  KeyRound,
  Trash2,
  X,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react-native';
import { colors, radii, shadows } from '../src/theme/tokens';
import { usePrototypeStore } from '../src/store/usePrototypeStore';
import { AccountabilityPartner } from '../src/domain/accountability/types';
import { validatePartnerPassword, getEnabledPartners } from '../src/domain/accountability/policy';

const cream = colors.textLight;

export default function AccountabilityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const accountability = usePrototypeStore((s) => s.accountability);
  const enableAccountability = usePrototypeStore((s) => s.enableAccountability);
  const requestProtectedMutation = usePrototypeStore((s) => s.requestProtectedMutation);
  const createAccountabilityPartner = usePrototypeStore((s) => s.createAccountabilityPartner);
  const updateAccountabilityPartner = usePrototypeStore((s) => s.updateAccountabilityPartner);
  const deleteAccountabilityPartner = usePrototypeStore((s) => s.deleteAccountabilityPartner);
  const replaceAccountabilityPartnerPassword = usePrototypeStore((s) => s.replaceAccountabilityPartnerPassword);

  const isModeEnabled = accountability?.enabled ?? false;
  const partners = accountability?.partners ?? [];
  const enabledPartners = getEnabledPartners(accountability);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showEnableModal, setShowEnableModal] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<AccountabilityPartner | null>(null);

  // Add Partner form
  const [addName, setAddName] = useState('');
  const [addRelationship, setAddRelationship] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addConfirmPassword, setAddConfirmPassword] = useState('');
  const [showAddPw, setShowAddPw] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);

  // Edit Partner form
  const [editName, setEditName] = useState('');
  const [editRelationship, setEditRelationship] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Change Password form
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [isSubmittingPw, setIsSubmittingPw] = useState(false);

  // Enable Mode verification form
  const [verifyPartnerId, setVerifyPartnerId] = useState<string>('');
  const [verifyPassword, setVerifyPassword] = useState('');
  const [showVerifyPw, setShowVerifyPw] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isSubmittingVerify, setIsSubmittingVerify] = useState(false);

  // Action sheet / options state
  const [actionPartner, setActionPartner] = useState<AccountabilityPartner | null>(null);

  // ---------------------------------------------------------------------------
  // Add Partner Handlers
  // ---------------------------------------------------------------------------
  const handleOpenAddPartner = () => {
    setAddName('');
    setAddRelationship('');
    setAddPassword('');
    setAddConfirmPassword('');
    setShowAddPw(false);
    setAddError(null);
    setShowAddModal(true);
  };

  const handleSaveAddPartner = async () => {
    const trimmedName = addName.trim();
    if (!trimmedName) {
      setAddError('Please enter a partner name.');
      return;
    }
    const pwCheck = validatePartnerPassword(addPassword);
    if (!pwCheck.valid) {
      if (pwCheck.reason === 'too-short') {
        setAddError('Password must be at least 6 characters long.');
      } else {
        setAddError('Password cannot be empty.');
      }
      return;
    }
    if (addPassword !== addConfirmPassword) {
      setAddError('Passwords do not match.');
      return;
    }

    try {
      setIsSubmittingAdd(true);
      setAddError(null);
      await createAccountabilityPartner({
        name: trimmedName,
        relationshipLabel: addRelationship.trim() || undefined,
        password: addPassword,
      });
      setShowAddModal(false);
    } catch (err: any) {
      setAddError(err.message || 'Failed to add partner.');
    } finally {
      setIsSubmittingAdd(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Edit Partner Handlers
  // ---------------------------------------------------------------------------
  const handleOpenEditPartner = (partner: AccountabilityPartner) => {
    setSelectedPartner(partner);
    setEditName(partner.name);
    setEditRelationship(partner.relationshipLabel || '');
    setEditEnabled(partner.enabled);
    setEditError(null);
    setActionPartner(null);
    setShowEditModal(true);
  };

  const handleSaveEditPartner = async () => {
    if (!selectedPartner) return;
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Please enter a partner name.');
      return;
    }

    if (isModeEnabled && !editEnabled && selectedPartner.enabled) {
      const otherEnabled = enabledPartners.filter((p) => p.id !== selectedPartner.id);
      if (otherEnabled.length === 0) {
        setEditError('Cannot disable the last active partner while Accountability Mode is active.');
        return;
      }
    }

    try {
      setIsSubmittingEdit(true);
      setEditError(null);
      await updateAccountabilityPartner(selectedPartner.id, {
        name: trimmedName,
        relationshipLabel: editRelationship.trim() || undefined,
        enabled: editEnabled,
      });
      setShowEditModal(false);
      setSelectedPartner(null);
    } catch (err: any) {
      setEditError(err.message || 'Failed to update partner.');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Change Password Handlers
  // ---------------------------------------------------------------------------
  const handleOpenChangePassword = (partner: AccountabilityPartner) => {
    setSelectedPartner(partner);
    setNewPassword('');
    setConfirmNewPassword('');
    setShowNewPw(false);
    setPwError(null);
    setActionPartner(null);
    setShowPasswordModal(true);
  };

  const handleSaveChangePassword = async () => {
    if (!selectedPartner) return;
    const pwCheck = validatePartnerPassword(newPassword);
    if (!pwCheck.valid) {
      if (pwCheck.reason === 'too-short') {
        setPwError('Password must be at least 6 characters long.');
      } else {
        setPwError('Password cannot be empty.');
      }
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwError('Passwords do not match.');
      return;
    }

    try {
      setIsSubmittingPw(true);
      setPwError(null);
      await replaceAccountabilityPartnerPassword(selectedPartner.id, newPassword);
      setShowPasswordModal(false);
      setSelectedPartner(null);
    } catch (err: any) {
      setPwError(err.message || 'Failed to change password.');
    } finally {
      setIsSubmittingPw(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Remove Partner Handler
  // ---------------------------------------------------------------------------
  const handleDeletePartner = async (partner: AccountabilityPartner) => {
    setActionPartner(null);
    if (isModeEnabled && partner.enabled) {
      const otherEnabled = enabledPartners.filter((p) => p.id !== partner.id);
      if (otherEnabled.length === 0) {
        Alert.alert(
          'Cannot Remove Partner',
          'Accountability Mode is active and this is your only active partner. Disable Accountability Mode first or add another partner.'
        );
        return;
      }
    }

    const doDelete = async () => {
      try {
        await deleteAccountabilityPartner(partner.id);
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to remove partner.');
      }
    };

    if (isModeEnabled) {
      // In active mode, store deleteAccountabilityPartner will route through requestProtectedMutation
      await doDelete();
    } else {
      Alert.alert(
        'Remove Partner',
        `Are you sure you want to remove "${partner.name}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

  // ---------------------------------------------------------------------------
  // Mode Enable / Disable Handlers
  // ---------------------------------------------------------------------------
  const handleToggleModePress = async () => {
    if (isModeEnabled) {
      // Prompt partner verification to disable
      await requestProtectedMutation({
        operation: 'disable-accountability',
        summary: 'Disable Accountability Mode',
        payload: {},
      });
    } else {
      // Check if partners exist
      if (enabledPartners.length === 0) {
        Alert.alert(
          'Active Partner Required',
          'You need at least one active accountability partner before enabling Accountability Mode.'
        );
        return;
      }
      setVerifyPartnerId(enabledPartners[0].id);
      setVerifyPassword('');
      setShowVerifyPw(false);
      setVerifyError(null);
      setShowEnableModal(true);
    }
  };

  const handleConfirmEnableMode = async () => {
    if (!verifyPartnerId) {
      setVerifyError('Please select a partner.');
      return;
    }
    if (!verifyPassword) {
      setVerifyError('Please enter partner password.');
      return;
    }

    try {
      setIsSubmittingVerify(true);
      setVerifyError(null);
      const res = await enableAccountability(verifyPartnerId, verifyPassword);
      if (res.ok) {
        setShowEnableModal(false);
        setVerifyPassword('');
      } else {
        if (res.reason === 'rate-limited') {
          const secs = res.lockoutEndsAt ? Math.ceil((res.lockoutEndsAt - Date.now()) / 1000) : 60;
          setVerifyError(`Too many incorrect attempts. Locked for ${Math.max(1, secs)}s.`);
        } else if (res.reason === 'invalid-password') {
          const rem = res.remainingAttempts ?? 5;
          setVerifyError(`Incorrect password. ${rem} attempt${rem === 1 ? '' : 's'} remaining.`);
        } else {
          setVerifyError('Verification failed. Please try again.');
        }
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Failed to enable accountability mode.');
    } finally {
      setIsSubmittingVerify(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.circleBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={colors.forestDark} strokeWidth={2.3} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Accountability Partners</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Mode Status Card */}
        <View style={[styles.card, isModeEnabled && styles.cardActiveMode]}>
          <View style={styles.cardHeaderRow}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: isModeEnabled ? '#E8F5E9' : '#F4EFE6' },
              ]}
            >
              {isModeEnabled ? (
                <ShieldCheck size={24} color={colors.forest} />
              ) : (
                <ShieldAlert size={24} color={colors.textMuted} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.modeBadgeRow}>
                <Text style={styles.cardTitle}>Accountability Mode</Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: isModeEnabled ? '#E8F5E9' : '#EDE8DF' },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      { color: isModeEnabled ? colors.forestDark : colors.textMuted },
                    ]}
                  >
                    {isModeEnabled ? 'ACTIVE' : 'OFF'}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardSub}>
                {isModeEnabled
                  ? 'All protected settings require partner verification'
                  : 'Settings changes do not currently require partner approval'}
              </Text>
            </View>
          </View>

          <Text style={styles.cardText}>
            When Accountability Mode is active, routine windows, risk group allowances,
            custom groups, and accountability partner changes are securely locked until an
            active partner enters their password.
          </Text>

          <TouchableOpacity
            style={[
              styles.modeToggleBtn,
              isModeEnabled ? styles.modeToggleBtnActive : styles.modeToggleBtnInactive,
            ]}
            activeOpacity={0.8}
            onPress={handleToggleModePress}
          >
            <Text
              style={[
                styles.modeToggleBtnText,
                isModeEnabled ? styles.modeToggleBtnTextActive : styles.modeToggleBtnTextInactive,
              ]}
            >
              {isModeEnabled ? 'Disable Accountability Mode' : 'Enable Accountability Mode'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Partners Section Header */}
        <View style={styles.sectionHeaderRow}>
          <View>
            <Text style={styles.sectionTitle}>Configured Partners</Text>
            <Text style={styles.sectionSubtitle}>
              {partners.length === 0
                ? 'No partners added yet'
                : `${partners.length} partner${partners.length === 1 ? '' : 's'} (${enabledPartners.length} active)`}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.addPartnerBtn}
            activeOpacity={0.8}
            onPress={handleOpenAddPartner}
          >
            <UserPlus size={16} color={cream} />
            <Text style={styles.addPartnerBtnText}>Add Partner</Text>
          </TouchableOpacity>
        </View>

        {/* Partners List */}
        {partners.length === 0 ? (
          <View style={styles.emptyCard}>
            <Users size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No Accountability Partners</Text>
            <Text style={styles.emptySub}>
              Add a trusted friend, partner, or mentor to hold you accountable to your daily rhythms.
            </Text>
            <TouchableOpacity
              style={styles.emptyActionBtn}
              activeOpacity={0.8}
              onPress={handleOpenAddPartner}
            >
              <Text style={styles.emptyActionBtnText}>Add First Partner</Text>
            </TouchableOpacity>
          </View>
        ) : (
          partners.map((partner) => {
            const initials = partner.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2);

            return (
              <View key={partner.id} style={styles.partnerCard}>
                <View style={styles.partnerAvatar}>
                  <Text style={styles.partnerAvatarText}>{initials}</Text>
                </View>

                <View style={styles.partnerInfo}>
                  <View style={styles.partnerTitleRow}>
                    <Text style={styles.partnerName}>{partner.name}</Text>
                    <View
                      style={[
                        styles.partnerPill,
                        { backgroundColor: partner.enabled ? '#E8F5E9' : '#EDE8DF' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.partnerPillText,
                          { color: partner.enabled ? colors.forestDark : colors.textMuted },
                        ]}
                      >
                        {partner.enabled ? 'Active' : 'Disabled'}
                      </Text>
                    </View>
                  </View>

                  {partner.relationshipLabel ? (
                    <Text style={styles.partnerRole}>{partner.relationshipLabel}</Text>
                  ) : (
                    <Text style={styles.partnerRoleDefault}>Accountability Partner</Text>
                  )}
                </View>

                <TouchableOpacity
                  style={styles.partnerOptionsBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => setActionPartner(partner)}
                >
                  <MoreVertical size={20} color={colors.forestDark} />
                </TouchableOpacity>
              </View>
            );
          })
        )}

        {/* Architecture Note */}
        <View style={styles.infoCard}>
          <Shield size={18} color={colors.forest} />
          <Text style={styles.infoCardText}>
            Partner passwords are never stored in plaintext or sent to any server. Verifiers are
            salted and hashed on-device using PBKDF2 with 150,000 rounds and stored in secure
            hardware storage.
          </Text>
        </View>

        {/* Security Boundary Note */}
        <View style={styles.boundaryCard}>
          <AlertCircle size={18} color={colors.amberDark} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.boundaryTitle}>Security Boundary</Text>
            <Text style={styles.boundaryText}>
              Accountability Mode is an intentional in-app behavioral guard designed to slow down impulsive changes. It cannot prevent operating system-level uninstallation, app data clearing, system permission revocation, or device wiping/rooting.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Partner Options Sheet / Modal */}
      {actionPartner && (
        <Modal
          visible={!!actionPartner}
          transparent
          animationType="fade"
          onRequestClose={() => setActionPartner(null)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setActionPartner(null)}
          >
            <View style={styles.sheetContent}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{actionPartner.name}</Text>
                <TouchableOpacity onPress={() => setActionPartner(null)}>
                  <X size={20} color={colors.forestDark} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.sheetActionRow}
                onPress={() => handleOpenEditPartner(actionPartner)}
              >
                <Edit2 size={18} color={colors.forestDark} />
                <Text style={styles.sheetActionText}>Edit Details & Status</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetActionRow}
                onPress={() => handleOpenChangePassword(actionPartner)}
              >
                <KeyRound size={18} color={colors.forestDark} />
                <Text style={styles.sheetActionText}>Change Password</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sheetActionRow, styles.sheetActionRowDestructive]}
                onPress={() => handleDeletePartner(actionPartner)}
              >
                <Trash2 size={18} color={colors.coralDark} />
                <Text style={[styles.sheetActionText, { color: colors.coralDark }]}>
                  Remove Partner
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Add Partner Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBackdrop}
        >
          <View style={styles.formModal}>
            <View style={styles.formModalHeader}>
              <Text style={styles.formModalTitle}>Add Accountability Partner</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <X size={20} color={colors.forestDark} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>Partner Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Alex, Morgan"
                placeholderTextColor={colors.textMuted}
                value={addName}
                onChangeText={setAddName}
                autoFocus
              />

              <Text style={styles.fieldLabel}>Relationship / Label (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Spouse, Best Friend, Coach"
                placeholderTextColor={colors.textMuted}
                value={addRelationship}
                onChangeText={setAddRelationship}
              />

              <Text style={styles.fieldLabel}>Partner Password or PIN *</Text>
              <View style={styles.passwordInputRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Min. 6 characters"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showAddPw}
                  value={addPassword}
                  onChangeText={setAddPassword}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowAddPw(!showAddPw)}
                >
                  {showAddPw ? (
                    <EyeOff size={18} color={colors.textMuted} />
                  ) : (
                    <Eye size={18} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Confirm Password *</Text>
              <TextInput
                style={styles.input}
                placeholder="Re-enter password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showAddPw}
                value={addConfirmPassword}
                onChangeText={setAddConfirmPassword}
              />

              <Text style={styles.formHint}>
                Have your partner enter a secure password that only they know. You will need them
                to enter this password whenever you want to change protected routine settings.
              </Text>

              {addError && (
                <View style={styles.errorBanner}>
                  <AlertCircle size={16} color={colors.coralDark} />
                  <Text style={styles.errorBannerText}>{addError}</Text>
                </View>
              )}

              <View style={styles.formBtnRow}>
                <TouchableOpacity
                  style={styles.formCancelBtn}
                  onPress={() => setShowAddModal(false)}
                >
                  <Text style={styles.formCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.formSaveBtn, isSubmittingAdd && styles.btnDisabled]}
                  disabled={isSubmittingAdd}
                  onPress={handleSaveAddPartner}
                >
                  {isSubmittingAdd ? (
                    <ActivityIndicator size="small" color={cream} />
                  ) : (
                    <Text style={styles.formSaveBtnText}>Save Partner</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Partner Modal */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBackdrop}
        >
          <View style={styles.formModal}>
            <View style={styles.formModalHeader}>
              <Text style={styles.formModalTitle}>Edit Partner</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <X size={20} color={colors.forestDark} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>Partner Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="Partner Name"
                placeholderTextColor={colors.textMuted}
                value={editName}
                onChangeText={setEditName}
              />

              <Text style={styles.fieldLabel}>Relationship / Label</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Spouse, Friend"
                placeholderTextColor={colors.textMuted}
                value={editRelationship}
                onChangeText={setEditRelationship}
              />

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>Active Partner Status</Text>
                  <Text style={styles.switchSub}>
                    Active partners can authorize changes.
                  </Text>
                </View>
                <Switch
                  value={editEnabled}
                  onValueChange={setEditEnabled}
                  trackColor={{ false: '#D9D3C7', true: colors.forest }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {editError && (
                <View style={styles.errorBanner}>
                  <AlertCircle size={16} color={colors.coralDark} />
                  <Text style={styles.errorBannerText}>{editError}</Text>
                </View>
              )}

              <View style={styles.formBtnRow}>
                <TouchableOpacity
                  style={styles.formCancelBtn}
                  onPress={() => setShowEditModal(false)}
                >
                  <Text style={styles.formCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.formSaveBtn, isSubmittingEdit && styles.btnDisabled]}
                  disabled={isSubmittingEdit}
                  onPress={handleSaveEditPartner}
                >
                  {isSubmittingEdit ? (
                    <ActivityIndicator size="small" color={cream} />
                  ) : (
                    <Text style={styles.formSaveBtnText}>Save Changes</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Change Password Modal */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBackdrop}
        >
          <View style={styles.formModal}>
            <View style={styles.formModalHeader}>
              <Text style={styles.formModalTitle}>
                Change Password for {selectedPartner?.name}
              </Text>
              <TouchableOpacity onPress={() => setShowPasswordModal(false)}>
                <X size={20} color={colors.forestDark} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>New Password *</Text>
              <View style={styles.passwordInputRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Min. 6 characters"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showNewPw}
                  value={newPassword}
                  onChangeText={setNewPassword}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowNewPw(!showNewPw)}
                >
                  {showNewPw ? (
                    <EyeOff size={18} color={colors.textMuted} />
                  ) : (
                    <Eye size={18} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Confirm New Password *</Text>
              <TextInput
                style={styles.input}
                placeholder="Re-enter new password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showNewPw}
                value={confirmNewPassword}
                onChangeText={setConfirmNewPassword}
              />

              {pwError && (
                <View style={styles.errorBanner}>
                  <AlertCircle size={16} color={colors.coralDark} />
                  <Text style={styles.errorBannerText}>{pwError}</Text>
                </View>
              )}

              <View style={styles.formBtnRow}>
                <TouchableOpacity
                  style={styles.formCancelBtn}
                  onPress={() => setShowPasswordModal(false)}
                >
                  <Text style={styles.formCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.formSaveBtn, isSubmittingPw && styles.btnDisabled]}
                  disabled={isSubmittingPw}
                  onPress={handleSaveChangePassword}
                >
                  {isSubmittingPw ? (
                    <ActivityIndicator size="small" color={cream} />
                  ) : (
                    <Text style={styles.formSaveBtnText}>Update Password</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Enable Accountability Mode Verification Modal */}
      <Modal
        visible={showEnableModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEnableModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBackdrop}
        >
          <View style={styles.formModal}>
            <View style={styles.formModalHeader}>
              <Text style={styles.formModalTitle}>Enable Accountability Mode</Text>
              <TouchableOpacity onPress={() => setShowEnableModal(false)}>
                <X size={20} color={colors.forestDark} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.handOffNotice}>
                <ShieldCheck size={18} color={colors.forest} />
                <Text style={styles.handOffNoticeText}>
                  Hand your device to your partner. They must confirm their password to activate
                  Accountability Mode.
                </Text>
              </View>

              {enabledPartners.length > 1 && (
                <>
                  <Text style={styles.fieldLabel}>Verifying Partner</Text>
                  <View style={styles.partnerSelectorList}>
                    {enabledPartners.map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        style={[
                          styles.partnerSelectOption,
                          verifyPartnerId === p.id && styles.partnerSelectOptionActive,
                        ]}
                        onPress={() => setVerifyPartnerId(p.id)}
                      >
                        <Text
                          style={[
                            styles.partnerSelectOptionText,
                            verifyPartnerId === p.id && styles.partnerSelectOptionTextActive,
                          ]}
                        >
                          {p.name}
                        </Text>
                        {verifyPartnerId === p.id && (
                          <CheckCircle2 size={16} color={colors.forest} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.fieldLabel}>Partner Password</Text>
              <View style={styles.passwordInputRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Enter partner password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showVerifyPw}
                  value={verifyPassword}
                  onChangeText={setVerifyPassword}
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowVerifyPw(!showVerifyPw)}
                >
                  {showVerifyPw ? (
                    <EyeOff size={18} color={colors.textMuted} />
                  ) : (
                    <Eye size={18} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              </View>

              {verifyError && (
                <View style={styles.errorBanner}>
                  <AlertCircle size={16} color={colors.coralDark} />
                  <Text style={styles.errorBannerText}>{verifyError}</Text>
                </View>
              )}

              <View style={styles.formBtnRow}>
                <TouchableOpacity
                  style={styles.formCancelBtn}
                  onPress={() => setShowEnableModal(false)}
                >
                  <Text style={styles.formCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.formSaveBtn, isSubmittingVerify && styles.btnDisabled]}
                  disabled={isSubmittingVerify}
                  onPress={handleConfirmEnableMode}
                >
                  {isSubmittingVerify ? (
                    <ActivityIndicator size="small" color={cream} />
                  ) : (
                    <Text style={styles.formSaveBtnText}>Confirm & Enable</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9D3C7',
    backgroundColor: colors.background,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: '#EBE5D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.forestDark,
    letterSpacing: -0.2,
  },
  scrollContent: {
    padding: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.md,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E6E0D4',
    ...shadows.card,
  },
  cardActiveMode: {
    borderColor: '#C8E6C9',
    backgroundColor: '#FBFDFB',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.forestDark,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  cardSub: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  cardText: {
    fontSize: 13,
    color: colors.forestDark,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 14,
  },
  modeToggleBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeToggleBtnInactive: {
    backgroundColor: colors.forest,
  },
  modeToggleBtnActive: {
    backgroundColor: '#FDEEE9',
    borderWidth: 1,
    borderColor: '#F5C6BA',
  },
  modeToggleBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  modeToggleBtnTextInactive: {
    color: cream,
  },
  modeToggleBtnTextActive: {
    color: colors.coralDark,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.forestDark,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  addPartnerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.forest,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.full,
  },
  addPartnerBtnText: {
    color: cream,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.md,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E6E0D4',
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.forestDark,
    marginTop: 12,
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  emptyActionBtn: {
    backgroundColor: colors.forest,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.full,
  },
  emptyActionBtnText: {
    color: cream,
    fontSize: 13,
    fontWeight: '700',
  },
  partnerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.md,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E6E0D4',
    ...shadows.card,
  },
  partnerAvatar: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: '#EAE5DB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  partnerAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.forestDark,
  },
  partnerInfo: {
    flex: 1,
  },
  partnerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  partnerName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.forestDark,
  },
  partnerPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  partnerPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  partnerRole: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  partnerRoleDefault: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    fontStyle: 'italic',
  },
  partnerOptionsBtn: {
    padding: 6,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#F3EFE6',
    borderRadius: radii.md,
    padding: 14,
    marginTop: 10,
  },
  infoCardText: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EDE8DF',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.forestDark,
  },
  sheetActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0ECE4',
  },
  sheetActionRowDestructive: {
    borderBottomWidth: 0,
  },
  sheetActionText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.forestDark,
  },
  formModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  formModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EDE8DF',
  },
  formModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.forestDark,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.forestDark,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#F7F5F0',
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.forestDark,
    borderWidth: 1,
    borderColor: '#E6E0D4',
  },
  passwordInputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 44,
  },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  formHint: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: 10,
    marginBottom: 12,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#EDE8DF',
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.forestDark,
  },
  switchSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDEEE9',
    padding: 10,
    borderRadius: 8,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#F5C6BA',
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    color: colors.coralDark,
    fontWeight: '600',
  },
  formBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    marginBottom: 8,
  },
  formCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EBE5D8',
  },
  formCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.forestDark,
  },
  formSaveBtn: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.forest,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  formSaveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: cream,
  },
  handOffNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: radii.md,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  handOffNoticeText: {
    flex: 1,
    fontSize: 13,
    color: colors.forestDark,
    lineHeight: 18,
  },
  partnerSelectorList: {
    gap: 6,
    marginBottom: 10,
  },
  partnerSelectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: '#F7F5F0',
    borderWidth: 1,
    borderColor: '#E6E0D4',
  },
  partnerSelectOptionActive: {
    borderColor: colors.forest,
    backgroundColor: '#F0F9F1',
  },
  partnerSelectOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.forestDark,
  },
  partnerSelectOptionTextActive: {
    color: colors.forest,
    fontWeight: '700',
  },
  boundaryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FAF5EE',
    borderRadius: radii.lg,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#EFE7D8',
  },
  boundaryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.amberDark,
    marginBottom: 4,
  },
  boundaryText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});
