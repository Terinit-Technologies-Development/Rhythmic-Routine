import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { colors, radii, shadows } from '../../src/theme/tokens';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { RhythmStateHeroCard } from '../../src/components/RhythmStateHeroCard';
import { DayTimeline } from '../../src/components/DayTimeline';
import { RiskGroupCard } from '../../src/components/RiskGroupCard';
import { usePrototypeStore } from '../../src/store/usePrototypeStore';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Rect, G } from 'react-native-svg';

export default function TodayScreen() {
  const router = useRouter();
  const riskGroups = usePrototypeStore((s) => s.riskGroups);
  const insightMetrics = usePrototypeStore((s) => s.insightMetrics);

  const hours = Math.floor(insightMetrics.protectedTimeTodayMinutes / 60);
  const minutes = insightMetrics.protectedTimeTodayMinutes % 60;
  const protectedTimeFormatted = `${hours > 0 ? `${hours}h ` : ''}${minutes}m`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top Header */}
      <ScreenHeader title="Rhythm" showWaveLogo={true} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* User Greeting */}
        <View style={styles.greetingSection}>
          <Text style={styles.greetingTitle}>Good morning, Alex ⛅</Text>
          <Text style={styles.greetingSubtitle}>Find your rhythm. Protect your day.</Text>
        </View>

        {/* Centerpiece Hero Countdown Card */}
        <RhythmStateHeroCard />

        {/* 4-Phase Day Timeline Stepper */}
        <View style={styles.timelineSection}>
          <DayTimeline />
        </View>

        {/* Risk Groups Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Risk groups</Text>
          <TouchableOpacity
            style={styles.manageLink}
            onPress={() => router.push('/(tabs)/apps')}
            activeOpacity={0.7}
          >
            <Text style={styles.manageLinkText}>Manage</Text>
            <ChevronRight size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.riskGroupsGrid}>
          {riskGroups.slice(0, 2).map((group) => (
            <RiskGroupCard key={group.id} group={group} />
          ))}
        </View>

        {/* Protected Today Card */}
        <TouchableOpacity
          style={styles.protectedCard}
          activeOpacity={0.85}
          onPress={() => router.push('/(tabs)/insights')}
        >
          {/* Subtle Scenic Backdrop */}
          <View style={styles.cardBackdrop}>
            <Svg width="100%" height="100%" viewBox="0 0 400 120" preserveAspectRatio="none">
              <Defs>
                <LinearGradient id="protBg" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0%" stopColor="#EFF6EE" />
                  <Stop offset="100%" stopColor="#DFECE0" />
                </LinearGradient>
              </Defs>
              <Rect width="400" height="120" fill="url(#protBg)" />
              {/* Subtle distant sun and hills */}
              <Circle cx="300" cy="30" r="14" fill="#FDE1AC" opacity="0.8" />
              <Path
                d="M 120 80 C 220 50, 320 70, 400 55 L 400 120 L 120 120 Z"
                fill="#C4D7BC"
                opacity="0.6"
              />
              <Path
                d="M 160 95 C 250 70, 350 85, 400 70 L 400 120 L 160 120 Z"
                fill="#9EBA93"
                opacity="0.75"
              />
            </Svg>
          </View>

          <View style={styles.protectedContent}>
            <View>
              <Text style={styles.protectedLabel}>Protected today</Text>
              <Text style={styles.protectedTime}>{protectedTimeFormatted}</Text>
              <Text style={styles.protectedSub}>returned to you ✨</Text>
            </View>

            <View style={styles.chevronCircle}>
              <ChevronRight size={18} color={colors.forestDark} />
            </View>
          </View>
        </TouchableOpacity>

        {/* Try Instead / Offline Suggestion Card */}
        <TouchableOpacity
          style={styles.tryInsteadCard}
          activeOpacity={0.85}
          onPress={() => router.push('/touch-grass')}
        >
          {/* Subtle Warm Backdrop */}
          <View style={styles.cardBackdrop}>
            <Svg width="100%" height="100%" viewBox="0 0 400 120" preserveAspectRatio="none">
              <Defs>
                <LinearGradient id="tryBg" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0%" stopColor="#FFF9EE" />
                  <Stop offset="100%" stopColor="#F8ECD4" />
                </LinearGradient>
              </Defs>
              <Rect width="400" height="120" fill="url(#tryBg)" />
            </Svg>
          </View>

          <View style={styles.tryContent}>
            {/* Coffee Cup Graphic on Left */}
            <View style={styles.coffeeCircle}>
              <Svg width="36" height="36" viewBox="0 0 36 36">
                {/* Coffee Cup */}
                <G transform="translate(6, 8)">
                  {/* Steam */}
                  <Path d="M 6 0 Q 7 3, 6 5 M 11 0 Q 12 3, 11 5" stroke="#B68853" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                  {/* Mug */}
                  <Path d="M 2 7 L 16 7 C 16 16, 2 16, 2 7 Z" fill="#8C5E35" />
                  {/* Mug Handle */}
                  <Path d="M 16 9 C 20 9, 20 14, 16 14" stroke="#8C5E35" strokeWidth="2.2" fill="none" />
                  {/* Saucer */}
                  <Path d="M 0 17 L 18 17" stroke="#B68853" strokeWidth="2" strokeLinecap="round" />
                </G>
              </Svg>
            </View>

            <View style={styles.tryTextCol}>
              <Text style={styles.tryTitle}>Try instead</Text>
              <Text style={styles.trySubtitle}>Make coffee, stretch, or read.</Text>
              <Text style={styles.tryTagline}>Small choices, big impact.</Text>
            </View>

            <View style={styles.chevronCircle}>
              <ChevronRight size={18} color={colors.amberDark} />
            </View>
          </View>
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
    paddingBottom: 32,
  },
  greetingSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  greetingTitle: {
    fontSize: 24,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
  },
  greetingSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  timelineSection: {
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  manageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  manageLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  riskGroupsGrid: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 16,
  },
  protectedCard: {
    marginHorizontal: 20,
    borderRadius: radii.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2EBDD',
    overflow: 'hidden',
    marginBottom: 12,
    position: 'relative',
    minHeight: 105,
    ...shadows.soft,
  },
  cardBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  protectedContent: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 2,
  },
  protectedLabel: {
    fontSize: 13,
    color: colors.forestDark,
    fontWeight: '600',
  },
  protectedTime: {
    fontSize: 28,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
    marginVertical: 2,
  },
  protectedSub: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  tryInsteadCard: {
    marginHorizontal: 20,
    borderRadius: radii.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE2CC',
    overflow: 'hidden',
    marginBottom: 16,
    position: 'relative',
    minHeight: 105,
    ...shadows.soft,
  },
  tryContent: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 2,
  },
  coffeeCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F7E7CD',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  tryTextCol: {
    flex: 1,
  },
  tryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  trySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  tryTagline: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  chevronCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
