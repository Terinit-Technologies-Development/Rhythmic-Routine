import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  Smartphone,
  Cpu,
  Lock,
  BatteryCharging,
  Key,
  Info,
  ShieldAlert,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { colors, radii, shadows } from '../src/theme/tokens';
import { usePrototypeStore } from '../src/store/usePrototypeStore';
import { getPlatformServices } from '../src/platform/PlatformServices';
import RhythmDeviceModule from '../modules/rhythm-device';

export default function SettingsScreen() {
  const router = useRouter();
  const resetDemo = usePrototypeStore((s) => s.resetDemo);
  const rhythmState = usePrototypeStore((s) => s.rhythmState);
  const setDemoSwitcherVisible = usePrototypeStore((s) => s.setDemoSwitcherVisible);
  const permissionState = usePrototypeStore((s) => s.permissionState);
  const checkPermissions = usePrototypeStore((s) => s.checkPermissions);
  const requestUsagePermission = usePrototypeStore((s) => s.requestUsagePermission);

  const [showDisclosureModal, setShowDisclosureModal] = useState(false);
  const [isSelectingApps, setIsSelectingApps] = useState(false);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  const requestRestriction = async () => {
    const { permissions } = getPlatformServices();
    await permissions.requestRestrictionAccess();
    await checkPermissions();
  };

  const handleRestrictionPress = () => {
    if (Platform.OS === 'android') {
      setShowDisclosureModal(true);
    } else {
      requestRestriction();
    }
  };

  const handleConfirmAndroidConsent = async () => {
    setShowDisclosureModal(false);
    await requestRestriction();
  };

  const handleSelectIosApps = async () => {
    try {
      setIsSelectingApps(true);
      await RhythmDeviceModule.showFamilyActivityPicker('social');
      await checkPermissions();
    } catch {
      // User cancelled or unsupported
    } finally {
      setIsSelectingApps(false);
    }
  };

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
        <Text style={styles.headerTitle}>Settings & Native Engine</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Pass 03 Release Architecture Banner */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.iconCircle}>
              <Cpu size={22} color={colors.forest} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Release Candidate: Native Rhythm Engine</Text>
              <Text style={styles.cardSub}>Local-First SQLite & Multi-Cooldown State</Text>
            </View>
          </View>
          <Text style={styles.cardText}>
            Operates on a pure TypeScript Rhythm Engine, multi-group concurrent cooldowns,
            continuous Risk Group session accounting, SQLite persistence, and truthful platform capability reporting.
          </Text>
        </View>

        {/* Device Permissions & Authorization */}
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>Platform Authorization & Enforcement</Text>

          <View style={styles.checkItem}>
            <Key size={18} color={permissionState.usageAccess === 'granted' ? colors.forest : colors.amberDark} />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkTitle}>Usage Access Observation</Text>
              <Text style={styles.checkText}>Status: {permissionState.usageAccess.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.checkItem}>
            <Lock size={18} color={permissionState.restrictionAuthorization === 'granted' ? colors.forest : colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkTitle}>Screen Time & Shielding Authorization</Text>
              <Text style={styles.checkText}>Status: {permissionState.restrictionAuthorization.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.checkItem}>
            <Info size={18} color={permissionState.restrictionCapability === 'enforced' ? colors.forest : colors.amberDark} />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkTitle}>Restriction Capability</Text>
              <Text style={styles.checkText}>
                Status: {permissionState.restrictionCapability.toUpperCase().replace('-', ' ')}
              </Text>
            </View>
          </View>

          {permissionState.usageAccess !== 'granted' && (
            <TouchableOpacity
              style={styles.permissionBtn}
              activeOpacity={0.8}
              onPress={requestUsagePermission}
            >
              <Text style={styles.permissionBtnText}>Configure System Usage Access</Text>
            </TouchableOpacity>
          )}

          {permissionState.restrictionAuthorization !== 'granted' && (
            <TouchableOpacity
              style={[styles.permissionBtn, { marginTop: 8 }]}
              activeOpacity={0.8}
              onPress={handleRestrictionPress}
            >
              <Text style={styles.permissionBtnText}>
                {Platform.OS === 'ios' ? 'Request Family Controls Permission' : 'Configure Accessibility Intervention'}
              </Text>
            </TouchableOpacity>
          )}

          {Platform.OS === 'ios' && permissionState.restrictionAuthorization === 'granted' && (
            <TouchableOpacity
              style={[styles.permissionBtn, { marginTop: 8 }]}
              activeOpacity={0.8}
              onPress={handleSelectIosApps}
            >
              <Text style={styles.permissionBtnText}>
                {isSelectingApps ? 'Opening Picker...' : 'Select Protected Apps (FamilyActivityPicker)'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Android Privacy Disclosure */}
        {Platform.OS === 'android' && (
          <View style={styles.disclosureCard}>
            <View style={styles.disclosureHeader}>
              <ShieldAlert size={18} color={colors.forestDark} />
              <Text style={styles.disclosureTitle}>Privacy Notice (Android Accessibility)</Text>
            </View>
            <Text style={styles.disclosureText}>
              Rhythmic-Routine is not an accessibility tool for people with disabilities. We use Android&#39;s Window State Change observation solely to present the mindful Touch Grass intervention when a restricted app is opened during an active cooldown or buffer window. We never read screen text, passwords, or personal content.
            </Text>
          </View>
        )}

        {/* Boundary Integrity & Battery Discipline */}
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>Engine Architecture & Battery Discipline</Text>

          <View style={styles.checkItem}>
            <ShieldCheck size={18} color={colors.forest} />
            <Text style={styles.checkText}>Pure RhythmEngine state machine active</Text>
          </View>

          <View style={styles.checkItem}>
            <BatteryCharging size={18} color={colors.forest} />
            <Text style={styles.checkText}>Bounded 15s sampling & clock reconciliation (no battery drain)</Text>
          </View>

          <View style={styles.checkItem}>
            <ShieldCheck size={18} color={colors.forest} />
            <Text style={styles.checkText}>SQLite Native Persistence (Zero backend / Zero cloud auth)</Text>
          </View>

          <View style={styles.checkItem}>
            <ShieldCheck size={18} color={colors.forest} />
            <Text style={styles.checkText}>Current active engine state: {rhythmState}</Text>
          </View>
        </View>

        {/* Prototype Actions */}
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>Quick Actions</Text>

          {Platform.OS === 'web' && (
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => setDemoSwitcherVisible(true)}
            >
              <Sparkles size={18} color={colors.forest} />
              <Text style={styles.actionText}>Open Rhythm State Switcher</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => router.push('/onboarding')}
          >
            <Smartphone size={18} color={colors.forest} />
            <Text style={styles.actionText}>View Onboarding Presentation</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, styles.resetRow]}
            onPress={resetDemo}
          >
            <RotateCcw size={18} color={colors.coralDark} />
            <Text style={[styles.actionText, { color: colors.coralDark }]}>
              Reset Local Storage & Engine State
            </Text>
          </TouchableOpacity>
        </View>

        {/* Philosophy Card */}
        <View style={styles.philosophyCard}>
          <Text style={styles.philTitle}>Rhythmic-Routine Philosophy</Text>
          <Text style={styles.philQuote}>
            “Use your phone. Just don’t live in it.”
          </Text>
          <Text style={styles.philBody}>
            Built with calm nature palettes, generous curves, and gentle recovery breaks instead of
            daily quota punishments.
          </Text>
        </View>
      </ScrollView>

      {/* Affirmative Consent Disclosure Modal (Android) */}
      <Modal visible={showDisclosureModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <ShieldAlert size={28} color={colors.forestDark} />
              <Text style={styles.modalTitle}>Accessibility Permission & Privacy</Text>
            </View>
            <Text style={styles.modalBody}>
              Rhythmic-Routine is designed to support healthy digital routines and is NOT an assistive tool for people with disabilities.
            </Text>
            <View style={styles.bulletList}>
              <Text style={styles.bulletItem}>
                • Rhythm observes only the active app&#39;s package name using Window State Change events.
              </Text>
              <Text style={styles.bulletItem}>
                • It does NOT read screen text, passwords, messages, keystrokes, or form content.
              </Text>
              <Text style={styles.bulletItem}>
                • All observation is strictly local on your device. Zero data is shared with cloud servers or third parties.
              </Text>
              <Text style={styles.bulletItem}>
                • Purpose: Display the calm Touch Grass reminder when an app in an active routine or cooldown is opened.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.confirmConsentBtn}
              activeOpacity={0.85}
              onPress={handleConfirmAndroidConsent}
            >
              <Text style={styles.confirmConsentText}>I Understand — Enable Intervention</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelConsentBtn}
              activeOpacity={0.7}
              onPress={() => setShowDisclosureModal(false)}
            >
              <Text style={styles.cancelConsentText}>Cancel</Text>
            </TouchableOpacity>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
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
  headerTitle: {
    fontSize: 18,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
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
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.sageLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  cardSub: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  cardText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  checkTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  checkText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  permissionBtn: {
    backgroundColor: colors.forest,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radii.xl,
    alignItems: 'center',
    marginTop: 4,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  disclosureCard: {
    backgroundColor: '#F7F3EB',
    borderRadius: radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E8E0D2',
    marginBottom: 14,
  },
  disclosureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  disclosureTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.forestDark,
  },
  disclosureText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FAF8F4',
    borderRadius: radii.lg,
    marginBottom: 8,
    gap: 10,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  resetRow: {
    backgroundColor: colors.coralLight,
  },
  philosophyCard: {
    backgroundColor: '#FAF5EA',
    borderRadius: radii.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFE2CC',
    alignItems: 'center',
  },
  philTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.forest,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  philQuote: {
    fontSize: 18,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
    marginVertical: 6,
    textAlign: 'center',
  },
  philBody: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
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
