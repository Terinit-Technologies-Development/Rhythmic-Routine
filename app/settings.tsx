import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
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
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { colors, radii, shadows } from '../src/theme/tokens';
import { usePrototypeStore } from '../src/store/usePrototypeStore';

export default function SettingsScreen() {
  const router = useRouter();
  const resetDemo = usePrototypeStore((s) => s.resetDemo);
  const rhythmState = usePrototypeStore((s) => s.rhythmState);
  const setDemoSwitcherVisible = usePrototypeStore((s) => s.setDemoSwitcherVisible);
  const permissionState = usePrototypeStore((s) => s.permissionState);
  const checkPermissions = usePrototypeStore((s) => s.checkPermissions);
  const requestUsagePermission = usePrototypeStore((s) => s.requestUsagePermission);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

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
        {/* Pass 02 Architecture Banner */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.iconCircle}>
              <Cpu size={22} color={colors.forest} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Pass 02: Native Rhythm Engine</Text>
              <Text style={styles.cardSub}>Local-First Native Foundation</Text>
            </View>
          </View>
          <Text style={styles.cardText}>
            Operates on a pure TypeScript Rhythm Engine, continuous Risk Group session accounting,
            cross-midnight routine evaluation, local persistence, and platform service composition.
          </Text>
        </View>

        {/* Device Permissions & Authorization */}
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>Platform Authorization</Text>

          <View style={styles.checkItem}>
            <Key size={18} color={permissionState.usageAccess === 'granted' ? colors.forest : colors.amberDark} />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkTitle}>Usage Access</Text>
              <Text style={styles.checkText}>Status: {permissionState.usageAccess.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.checkItem}>
            <Lock size={18} color={permissionState.restrictionAccess === 'granted' ? colors.forest : colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkTitle}>Restriction Shielding</Text>
              <Text style={styles.checkText}>Status: {permissionState.restrictionAccess.toUpperCase()}</Text>
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
        </View>

        {/* Boundary Integrity & Battery Discipline */}
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>Engine Architecture & Battery Discipline</Text>

          <View style={styles.checkItem}>
            <ShieldCheck size={18} color={colors.forest} />
            <Text style={styles.checkText}>Pure RhythmEngine state machine active</Text>
          </View>

          <View style={styles.checkItem}>
            <BatteryCharging size={18} color={colors.forest} />
            <Text style={styles.checkText}>Bounded 15s sampling (no battery-draining tight loops)</Text>
          </View>

          <View style={styles.checkItem}>
            <ShieldCheck size={18} color={colors.forest} />
            <Text style={styles.checkText}>100% Local Persistence (Zero backend / Zero cloud auth)</Text>
          </View>

          <View style={styles.checkItem}>
            <ShieldCheck size={18} color={colors.forest} />
            <Text style={styles.checkText}>Current active engine state: {rhythmState}</Text>
          </View>
        </View>

        {/* Prototype Actions */}
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>Quick Actions</Text>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => setDemoSwitcherVisible(true)}
          >
            <Sparkles size={18} color={colors.forest} />
            <Text style={styles.actionText}>Open Rhythm State Switcher</Text>
          </TouchableOpacity>

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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.sageLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  cardSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
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
    marginBottom: 10,
  },
  checkTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  checkText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  permissionBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: radii.lg,
    backgroundColor: colors.sageLight,
    borderWidth: 1,
    borderColor: colors.sage,
    alignItems: 'center',
  },
  permissionBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.forestDark,
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
});
