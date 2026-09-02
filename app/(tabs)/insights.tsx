import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  ShieldCheck,
  Award,
  Sunrise,
  Sunset,
  Flame,
  Sparkles,
  Layers,
  Clock,
  ShieldAlert,
} from 'lucide-react-native';
import { colors, radii, shadows } from '../../src/theme/tokens';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { usePrototypeStore } from '../../src/store/usePrototypeStore';
import { formatMinutesToHumanReadable, getInsightSource } from '../../src/domain/insights/metrics';

export default function InsightsScreen() {
  const insightMetrics = usePrototypeStore((s) => s.insightMetrics);
  const weeklySummary = usePrototypeStore((s) => s.weeklySummary);
  const riskGroups = usePrototypeStore((s) => s.riskGroups);
  const apps = usePrototypeStore((s) => s.apps);
  const dailyUsageSnapshot = usePrototypeStore((s) => s.dailyUsageSnapshot);
  const insightDataState = usePrototypeStore((s) => s.insightDataState);
  const refreshInsights = usePrototypeStore((s) => s.refreshInsights);
  const refreshDailyUsage = usePrototypeStore((s) => s.refreshDailyUsage);
  const requestUsagePermission = usePrototypeStore((s) => s.requestUsagePermission);

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        refreshDailyUsage(),
        refreshInsights(),
      ]).catch(() => {});
    }, [refreshDailyUsage, refreshInsights])
  );

  const source = getInsightSource(Platform.OS);
  const sourceLabel =
    source === 'android-observed'
      ? 'Android UsageStats'
      : source === 'ios-device-activity'
      ? 'iOS Screen Time'
      : 'Local Rhythm Engine';

  const isWeb = Platform.OS === 'web';
  const hasRealData = !!weeklySummary?.hasData;
  const showDemo = isWeb && !hasRealData;

  const displayProtectedMinutes = hasRealData && weeklySummary
    ? weeklySummary.totalProtectedMinutes
    : showDemo
    ? Math.round(insightMetrics.protectedTimeWeeklyHours * 60)
    : 0;

  const consistencyScore = hasRealData && weeklySummary
    ? weeklySummary.routineConsistencyScore
    : showDemo
    ? 85
    : 0;

  const maxMinutes = Math.max(
    60,
    ...insightMetrics.weeklyTrend.map((t) => t.protectedMinutes + t.riskMinutes)
  );

  // Today's Risk Allowances: strictly for Risk apps, sorted exhausted first, then most-used
  const riskApps = apps.filter((a) => a.classification === 'risk');
  const riskAppsWithAllowance = riskApps
    .map((app) => {
      const allowanceMinutes = app.dailyRiskAllowance?.allowanceMinutes ?? 30;
      const snap = dailyUsageSnapshot?.apps.find((a) => a.packageName === app.id);
      const usedSeconds = snap?.usedSeconds ?? app.usageTodayMinutes * 60;
      const usedMinutes = Math.floor(usedSeconds / 60);
      const remainingSeconds =
        snap?.remainingSeconds ?? Math.max(0, allowanceMinutes * 60 - usedSeconds);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
      const isExhausted =
        snap?.exhausted ?? (allowanceMinutes > 0 && usedMinutes >= allowanceMinutes);

      let statusText = '';
      if (allowanceMinutes === 0) {
        statusText = '0 min planned';
      } else if (isExhausted || remainingMinutes <= 0) {
        statusText = 'Allowance complete';
      } else {
        statusText = `${remainingMinutes} min remaining`;
      }

      return {
        id: app.id,
        name: app.name,
        allowanceMinutes,
        usedMinutes,
        remainingMinutes,
        isExhausted,
        statusText,
      };
    })
    .sort((a, b) => {
      if (a.isExhausted && !b.isExhausted) return -1;
      if (!a.isExhausted && b.isExhausted) return 1;
      return b.usedMinutes - a.usedMinutes;
    });

  if (insightDataState === 'permission-required') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Insights"
          showWaveLogo={true}
          subtitle="Understand your digital rhythm and time returned to life."
        />
        <View style={styles.stateCenterContainer}>
          <View style={[styles.stateIconCircle, { backgroundColor: colors.coralLight }]}>
            <ShieldAlert size={36} color={colors.coralDark} />
          </View>
          <Text style={styles.stateTitle}>Usage Access needed</Text>
          <Text style={styles.stateSubtitle}>
            Rhythm can still protect your routine, but usage Insights need Android Usage Access.
          </Text>
          <TouchableOpacity
            style={styles.statePrimaryBtn}
            onPress={() => requestUsagePermission()}
          >
            <Text style={styles.statePrimaryBtnText}>Grant Usage Access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (insightDataState === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Insights"
          showWaveLogo={true}
          subtitle="Understand your digital rhythm and time returned to life."
        />
        <View style={styles.stateCenterContainer}>
          <View style={[styles.stateIconCircle, { backgroundColor: colors.coralLight }]}>
            <ShieldAlert size={36} color={colors.coralDark} />
          </View>
          <Text style={styles.stateTitle}>Insights temporarily unavailable</Text>
          <Text style={styles.stateSubtitle}>
            Unable to read local device telemetry right now.
          </Text>
          <TouchableOpacity
            style={styles.statePrimaryBtn}
            onPress={() => {
              refreshDailyUsage().catch(() => {});
              refreshInsights().catch(() => {});
            }}
          >
            <Text style={styles.statePrimaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (insightDataState === 'loading') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Insights"
          showWaveLogo={true}
          subtitle="Understand your digital rhythm and time returned to life."
        />
        <View style={styles.stateCenterContainer}>
          <ActivityIndicator size="large" color={colors.forest} style={{ marginBottom: 16 }} />
          <Text style={styles.stateSubtitle}>Reading your local rhythm…</Text>
        </View>
      </SafeAreaView>
    );
  }

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
        {/* Source Badge */}
        <View style={styles.sourceBadgeContainer}>
          <View style={styles.sourceDot} />
          <Text style={styles.sourceText}>Telemetry Source: {sourceLabel}</Text>
        </View>

        {/* Today's Risk Allowances Section */}
        {riskAppsWithAllowance.length > 0 && (
          <View style={styles.allowanceCard}>
            <View style={styles.allowanceCardHeader}>
              <Clock size={18} color={colors.forest} />
              <Text style={styles.allowanceCardTitle}>Today&apos;s Risk Allowances</Text>
            </View>
            {riskAppsWithAllowance.map((item) => (
              <View key={item.id} style={styles.allowanceRow}>
                <View style={styles.allowanceRowInfo}>
                  <Text style={styles.allowanceRowName}>{item.name}</Text>
                  <Text style={styles.allowanceRowSub}>
                    {item.allowanceMinutes === 0
                      ? '0 min planned today'
                      : `${item.usedMinutes} / ${item.allowanceMinutes} min`}
                  </Text>
                </View>
                <View style={styles.allowanceRowBadge}>
                  <Text
                    style={[
                      styles.allowanceStatusText,
                      item.isExhausted && styles.allowanceStatusExhausted,
                    ]}
                  >
                    {item.statusText}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Highlight Banner */}
        <View style={styles.highlightCard}>
          <View style={styles.highlightHeader}>
            <View style={styles.iconCircle}>
              <ShieldCheck size={24} color={colors.forest} />
            </View>
            <View>
              <Text style={styles.highlightLabel}>Protected Time This Week</Text>
              <Text style={styles.highlightNumber}>
                {formatMinutesToHumanReadable(displayProtectedMinutes)}
              </Text>
            </View>
          </View>
          <Text style={styles.highlightSubtext}>
            {hasRealData
              ? 'Uninterrupted focus protected through active morning buffers and recovery cooldowns.'
              : showDemo
              ? 'Demo preview: Uninterrupted focus and calm reclaimed through intentional buffers.'
              : 'No observed protected time yet this week. Protect time by keeping your routines active.'}
          </Text>
        </View>

        {/* 2x2 Metrics Grid (Factual copy) */}
        <View style={styles.metricsGrid}>
          {/* Card 1: Avg Risk Session */}
          <View style={styles.metricCard}>
            <View style={[styles.smallIconCircle, { backgroundColor: colors.coralLight }]}>
              <Flame size={18} color={colors.coralDark} />
            </View>
            <Text style={styles.metricVal}>{insightMetrics.averageRiskSessionMinutes} min</Text>
            <Text style={styles.metricLabel}>Avg Risk Session</Text>
            <Text style={styles.metricSub}>
              {hasRealData ? 'Observed this week' : showDemo ? 'Demo preview' : 'No observed data yet'}
            </Text>
          </View>

          {/* Card 2: Cooldown Triggers */}
          <View style={styles.metricCard}>
            <View style={[styles.smallIconCircle, { backgroundColor: colors.skyLight }]}>
              <Award size={18} color={colors.skyDark} />
            </View>
            <Text style={styles.metricVal}>{insightMetrics.cooldownTriggersCount}</Text>
            <Text style={styles.metricLabel}>Recovery Breaks</Text>
            <Text style={styles.metricSub}>
              {hasRealData ? 'Triggered this week' : showDemo ? 'Completed this week' : 'None triggered yet'}
            </Text>
          </View>

          {/* Card 3: Routine Consistency */}
          <View style={styles.metricCard}>
            <View style={[styles.smallIconCircle, { backgroundColor: colors.amberLight }]}>
              <Sunrise size={18} color={colors.amberDark} />
            </View>
            <Text style={styles.metricVal}>{consistencyScore}%</Text>
            <Text style={styles.metricLabel}>Routine Consistency</Text>
            <Text style={styles.metricSub}>Days buffers kept</Text>
          </View>

          {/* Card 4: Final Risk App Use */}
          <View style={styles.metricCard}>
            <View style={[styles.smallIconCircle, { backgroundColor: colors.lavenderLight }]}>
              <Sunset size={18} color={colors.lavenderDark} />
            </View>
            <Text style={styles.metricVal}>{insightMetrics.finalRiskAppUseTime}</Text>
            <Text style={styles.metricLabel}>Final Risk App Use</Text>
            <Text style={styles.metricSub}>
              {hasRealData ? 'Latest observed today' : showDemo ? 'Wind-Down respected' : 'No evening use observed'}
            </Text>
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
                          height: Math.max(0, riskHeight),
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
                          height: Math.max(4, protHeight),
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

        {/* Risk Groups Breakdown (Factual observed breakdown) */}
        {riskGroups.length > 0 && (
          <View style={styles.groupBreakdownCard}>
            <View style={styles.groupHeader}>
              <Layers size={18} color={colors.forest} />
              <Text style={styles.groupBreakdownTitle}>Risk Group Activity</Text>
            </View>
            {riskGroups.map((group) => {
              const mins = weeklySummary?.groupUsageMinutes?.[group.id];
              const displayMins =
                mins != null && mins > 0
                  ? formatMinutesToHumanReadable(mins)
                  : mins === 0
                  ? '0m'
                  : '—';

              return (
                <View key={group.id} style={styles.groupRow}>
                  <View style={styles.groupInfo}>
                    <Text style={styles.groupName}>{group.name}</Text>
                    <Text style={styles.groupSub}>
                      {group.appIds.length} app{group.appIds.length === 1 ? '' : 's'} · {group.sessionThresholdMinutes}m session threshold
                    </Text>
                  </View>
                  <Text style={styles.groupUsageVal}>{displayMins}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Mindful Takeaway / Empty State */}
        {!hasRealData ? (
          <View style={styles.reflectionCard}>
            <View style={styles.takeawayHeader}>
              <Sparkles size={16} color={colors.forest} />
              <Text style={styles.reflectionTitle}>Your rhythm is just getting started 🌱</Text>
            </View>
            <Text style={styles.reflectionBody}>
              Use Rhythm as you normally do throughout your week. As you experience morning focus buffers and recovery cooldowns, your real patterns will automatically appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.reflectionCard}>
            <View style={styles.takeawayHeader}>
              <Sparkles size={16} color={colors.forest} />
              <Text style={styles.reflectionTitle}>Weekly Rhythm Takeaway 🌿</Text>
            </View>
            <Text style={styles.reflectionBody}>
              Your routine consistency reached {consistencyScore}% this week. By postponing doomscrolling and taking mindful breaks, you reclaimed hours of uninterrupted presence.
            </Text>
          </View>
        )}
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
  sourceBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.full,
    backgroundColor: '#EAE5DB',
    alignSelf: 'flex-start',
    marginTop: 4,
    marginBottom: 8,
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.forest,
  },
  sourceText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.forestDark,
  },
  highlightCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    marginTop: 4,
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
  groupBreakdownCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    marginBottom: 16,
    ...shadows.card,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  groupBreakdownTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  groupRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3EFE6',
  },
  groupInfo: {
    gap: 2,
  },
  groupName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  groupSub: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  groupUsageVal: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.forest,
  },
  reflectionCard: {
    backgroundColor: '#FAF5EA',
    borderRadius: radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFE2CC',
  },
  takeawayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  reflectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.forestDark,
  },
  reflectionBody: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  allowanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.xxl,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFEAE0',
    marginBottom: 16,
    ...shadows.card,
  },
  allowanceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  allowanceCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  allowanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3EFE6',
  },
  allowanceRowInfo: {
    gap: 2,
    flex: 1,
  },
  allowanceRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  allowanceRowSub: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  allowanceRowBadge: {
    alignItems: 'flex-end',
  },
  allowanceStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.forest,
  },
  allowanceStatusExhausted: {
    color: colors.coralDark,
    fontWeight: '700',
  },
  stateCenterContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  stateIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.amberLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  stateSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  statePrimaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: radii.full,
    backgroundColor: colors.forest,
  },
  statePrimaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

