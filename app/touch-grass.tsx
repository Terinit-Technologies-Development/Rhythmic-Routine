import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sprout, Lock, ChevronRight, Sparkles, Sun } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { colors, radii, shadows } from '../src/theme/tokens';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { TouchGrassMeadowLandscape } from '../src/components/Artwork';
import { OfflineActivityCard } from '../src/components/OfflineActivityCard';
import { usePrototypeStore } from '../src/store/usePrototypeStore';

export default function TouchGrassScreen() {
  const router = useRouter();
  const countdownSeconds = usePrototypeStore((s) => s.countdownSeconds);
  const tickCountdown = usePrototypeStore((s) => s.tickCountdown);
  const offlineActivities = usePrototypeStore((s) => s.offlineActivities);
  const setEmergencyModalVisible = usePrototypeStore((s) => s.setEmergencyModalVisible);
  const riskGroups = usePrototypeStore((s) => s.riskGroups);
  const activeRiskGroupId = usePrototypeStore((s) => s.activeRiskGroupId);

  const group = riskGroups.find((g) => g.id === activeRiskGroupId) || riskGroups[0];

  useEffect(() => {
    const timer = setInterval(() => {
      tickCountdown();
    }, 1000);
    return () => clearInterval(timer);
  }, [tickCountdown]);

  const hrs = Math.floor(countdownSeconds / 3600);
  const mins = Math.floor((countdownSeconds % 3600) / 60);
  const secs = countdownSeconds % 60;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Rhythm" showWaveLogo={true} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Header Motif & Title */}
        <View style={styles.headerSection}>
          <View style={styles.topIconCircle}>
            <Sprout size={24} color={colors.forest} strokeWidth={2.3} />
          </View>

          <Text style={styles.title}>Touch grass 🌱</Text>
          <Text style={styles.subtitle}>
            You’ve been in {group.name} for {group.sessionThresholdMinutes} minutes.{'\n'}
            Come back in {hrs > 0 ? `${hrs}h ` : ''}{mins}m.
          </Text>
        </View>

        {/* Hero Illustration & Live Timer Card */}
        <View style={styles.heroCard}>
          {/* Scenic Meadow Background with Wildflowers and Rabbit */}
          <View style={styles.artworkWrapper}>
            <TouchGrassMeadowLandscape height={260} />
          </View>

          {/* Floating Frosted Glass Card */}
          <View style={styles.timerCard}>
            <View style={styles.cooldownBadge}>
              <Lock size={12} color={colors.forestDark} strokeWidth={2.5} />
              <Text style={styles.cooldownBadgeText}>Cooldown in progress</Text>
            </View>

            {/* Giant Countdown Digits */}
            <View style={styles.digitsRow}>
              <View style={styles.digitCol}>
                <Text style={styles.digitNumber}>{hrs.toString().padStart(2, '0')}</Text>
                <Text style={styles.digitUnit}>HRS</Text>
              </View>

              <Text style={styles.digitColon}>:</Text>

              <View style={styles.digitCol}>
                <Text style={styles.digitNumber}>{mins.toString().padStart(2, '0')}</Text>
                <Text style={styles.digitUnit}>MIN</Text>
              </View>

              <Text style={styles.digitColon}>:</Text>

              <View style={styles.digitCol}>
                <Text style={styles.digitNumber}>{secs.toString().padStart(2, '0')}</Text>
                <Text style={styles.digitUnit}>SEC</Text>
              </View>
            </View>
          </View>
        </View>

        {/* While You're Away Section */}
        <View style={styles.awaySection}>
          <View style={styles.awayHeader}>
            <Sparkles size={16} color={colors.amberDark} />
            <Text style={styles.awayTitle}>While you’re away</Text>
          </View>
          <Text style={styles.awaySubtitle}>Try one of these feel-good things.</Text>

          <View style={styles.activitiesList}>
            {offlineActivities.slice(0, 4).map((activity) => (
              <OfflineActivityCard
                key={activity.id}
                activity={activity}
                onPress={() => {}}
              />
            ))}
          </View>
        </View>

        {/* Encouraging Affirmation Card */}
        <View style={styles.encouragementCard}>
          <View style={styles.encouragementIcon}>
            <Sprout size={18} color={colors.forest} />
          </View>
          <View style={styles.encouragementTextCol}>
            <Text style={styles.encouragementTitle}>
              You’ll feel better on the other side.
            </Text>
            <Text style={styles.encouragementSub}>See you soon. ☀️</Text>
          </View>
        </View>

        {/* Need Emergency Access Link */}
        <TouchableOpacity
          style={styles.emergencyLink}
          onPress={() => setEmergencyModalVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.emergencyLinkText}>Need emergency access?</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  headerSection: {
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  topIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.sageLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 30,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  heroCard: {
    borderRadius: radii.xxl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EFEAE0',
    backgroundColor: '#FFFFFF',
    marginBottom: 24,
    position: 'relative',
    height: 280,
    ...shadows.card,
  },
  artworkWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  timerCard: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: radii.xl,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    ...shadows.soft,
  },
  cooldownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.sageLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.full,
    marginBottom: 10,
  },
  cooldownBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.forestDark,
  },
  digitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  digitCol: {
    alignItems: 'center',
    minWidth: 60,
  },
  digitNumber: {
    fontSize: 42,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
  },
  digitUnit: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  digitColon: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.forest,
    marginBottom: 14,
  },
  awaySection: {
    marginBottom: 16,
  },
  awayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  awayTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  awaySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  activitiesList: {
    gap: 4,
  },
  encouragementCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF5EA',
    borderRadius: radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFE2CC',
    marginBottom: 20,
  },
  encouragementIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.sageLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  encouragementTextCol: {
    flex: 1,
  },
  encouragementTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.forestDark,
  },
  encouragementSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  emergencyLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  emergencyLinkText: {
    fontSize: 13,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
});
