import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ShieldCheck,
  Award,
  Sunrise,
  Sunset,
  Flame,
} from 'lucide-react-native';
import { colors, radii, shadows } from '../../src/theme/tokens';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { usePrototypeStore } from '../../src/store/usePrototypeStore';

export default function InsightsScreen() {
  const insightMetrics = usePrototypeStore((s) => s.insightMetrics);

  const maxMinutes = Math.max(...insightMetrics.weeklyTrend.map((t) => t.protectedMinutes + t.riskMinutes));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Insights"
        showWaveLogo={true}
        subtitle="Understand your digital rhythm and time returned to life."
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Highlight Banner */}
        <View style={styles.highlightCard}>
          <View style={styles.highlightHeader}>
            <View style={styles.iconCircle}>
              <ShieldCheck size={24} color={colors.forest} />
            </View>
            <View>
              <Text style={styles.highlightLabel}>Protected Attention</Text>
              <Text style={styles.highlightNumber}>11.5 hrs</Text>
            </View>
          </View>
          <Text style={styles.highlightSubtext}>
            You reclaimed 11.5 hours of uninterrupted focus and presence this week through morning
            buffers and recovery cooldowns.
          </Text>
        </View>

        {/* 2x2 Metrics Grid */}
        <View style={styles.metricsGrid}>
          {/* Card 1: Avg Risk Session */}
          <View style={styles.metricCard}>
            <View style={[styles.smallIconCircle, { backgroundColor: colors.coralLight }]}>
              <Flame size={18} color={colors.coralDark} />
            </View>
            <Text style={styles.metricVal}>{insightMetrics.averageRiskSessionMinutes} min</Text>
            <Text style={styles.metricLabel}>Average Risk Session</Text>
            <Text style={styles.metricSub}>Well under 30m limit</Text>
          </View>

          {/* Card 2: Cooldown Triggers */}
          <View style={styles.metricCard}>
            <View style={[styles.smallIconCircle, { backgroundColor: colors.skyLight }]}>
              <Award size={18} color={colors.skyDark} />
            </View>
            <Text style={styles.metricVal}>{insightMetrics.cooldownTriggersCount}</Text>
            <Text style={styles.metricLabel}>Cooldown Triggers</Text>
            <Text style={styles.metricSub}>Breathers taken today</Text>
          </View>

          {/* Card 3: First Risk App Use */}
          <View style={styles.metricCard}>
            <View style={[styles.smallIconCircle, { backgroundColor: colors.amberLight }]}>
              <Sunrise size={18} color={colors.amberDark} />
            </View>
            <Text style={styles.metricVal}>{insightMetrics.firstRiskAppUseTime}</Text>
            <Text style={styles.metricLabel}>First Risk App Use</Text>
            <Text style={styles.metricSub}>Buffer held until 08:00</Text>
          </View>

          {/* Card 4: Final Risk App Use */}
          <View style={styles.metricCard}>
            <View style={[styles.smallIconCircle, { backgroundColor: colors.lavenderLight }]}>
              <Sunset size={18} color={colors.lavenderDark} />
            </View>
            <Text style={styles.metricVal}>{insightMetrics.finalRiskAppUseTime}</Text>
            <Text style={styles.metricLabel}>Final Risk App Use</Text>
            <Text style={styles.metricSub}>Wind-Down respected</Text>
          </View>
        </View>

        {/* 7-Day Rhythm Trend Chart */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>7-Day Rhythm Trend</Text>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.forest }]} />
                <Text style={styles.legendText}>Protected</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.coralDark }]} />
                <Text style={styles.legendText}>Risk</Text>
              </View>
            </View>
          </View>

          {/* Bar Chart Visualization */}
          <View style={styles.barsContainer}>
            {insightMetrics.weeklyTrend.map((item) => {
              const totalHeight = 120;
              const protHeight = (item.protectedMinutes / maxMinutes) * totalHeight;
              const riskHeight = (item.riskMinutes / maxMinutes) * totalHeight;

              return (
                <View key={item.day} style={styles.barCol}>
                  <View style={[styles.barTrack, { height: totalHeight }]}>
                    <View
                      style={[
                        styles.barSegment,
                        {
                          height: riskHeight,
                          backgroundColor: colors.coral,
                          borderTopLeftRadius: 4,
                          borderTopRightRadius: 4,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.barSegment,
                        {
                          height: protHeight,
                          backgroundColor: colors.forest,
                          borderBottomLeftRadius: 4,
                          borderBottomRightRadius: 4,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.dayLabel}>{item.day}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Mindful Takeaway Card */}
        <View style={styles.reflectionCard}>
          <Text style={styles.reflectionTitle}>Weekly Rhythm Takeaway 🌿</Text>
          <Text style={styles.reflectionBody}>
            Your morning buffer consistency reached 92% this week. By postponing doomscrolling until
            after breakfast, you unlocked an average of 45 extra morning minutes for exercise and
            coffee.
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  highlightCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    marginTop: 8,
    marginBottom: 16,
    ...shadows.card,
  },
  highlightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 10,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.sageLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  highlightNumber: {
    fontSize: 28,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.forestDark,
  },
  highlightSubtext: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  metricCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xl,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    ...shadows.soft,
  },
  smallIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  metricVal: {
    fontSize: 20,
    fontFamily: 'serif',
    fontWeight: '700',
    color: colors.text,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 2,
  },
  metricSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    marginBottom: 16,
    ...shadows.card,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 150,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  barCol: {
    alignItems: 'center',
  },
  barTrack: {
    width: 22,
    justifyContent: 'flex-end',
    marginBottom: 6,
    gap: 2,
  },
  barSegment: {
    width: 22,
  },
  dayLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  reflectionCard: {
    backgroundColor: '#FAF5EA',
    borderRadius: radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFE2CC',
  },
  reflectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.forestDark,
    marginBottom: 6,
  },
  reflectionBody: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
});
