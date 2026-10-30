import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Sprout } from 'lucide-react-native';
import { colors, radii, shadows } from '../theme/tokens';
import { RhythmCoordinator } from '../application/RhythmCoordinator';
import type { RhythmRuntime } from '../domain/rhythm/types';

/**
 * B1 minimal morning entry point. It launches the EXACT bound
 * `morning-<AttentionDayId>` session through Routine's verified IPC; the
 * generic Meditation home screen is deliberately not used.
 */
export function MorningMeditationCard() {
  const coordinator = RhythmCoordinator.getInstance();
  const [runtime, setRuntime] = useState<RhythmRuntime | null>(
    coordinator.getRuntimeSnapshot()
  );
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => coordinator.subscribe(setRuntime), [coordinator]);

  const requirement = runtime?.morningMeditation?.requirement;
  const active =
    runtime?.morningMeditation?.state === 'morning-meditation-required' ||
    (requirement !== undefined && requirement.satisfiedAt === undefined);
  if (!requirement || !active) return null;

  const launch = async () => {
    setLaunching(true);
    setError(null);
    try {
      const result = await coordinator.launchMorningMeditation();
      if (!result.ok) {
        setError(
          result.reason === 'launch-failed'
            ? 'Meditation could not be opened. Check the companion app and try again.'
            : 'The morning requirement is not available yet.'
        );
      } else {
        await coordinator.refreshMorningMeditationEvidence();
      }
    } catch {
      setError('Meditation could not be opened. Check the companion app and try again.');
    } finally {
      setLaunching(false);
    }
  };

  const diagnostics = coordinator.getMorningMeditationDiagnostics();
  const capabilityLimited =
    diagnostics.availability !== 'available' || !diagnostics.identityMetadataAvailable;

  return (
    <View style={styles.card}>
      <View style={styles.iconCircle}>
        <Sprout size={18} color={colors.forest} strokeWidth={2.3} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>Morning meditation required</Text>
        <Text style={styles.subtitle}>
          Complete the bound 30-minute morning session to reopen managed apps.
          Essential apps, Routine and Meditation stay available.
        </Text>
        {capabilityLimited ? (
          <Text style={styles.warning}>
            Meditation completion cannot be verified on this installation yet.
          </Text>
        ) : null}
        {error ? <Text style={styles.warning}>{error}</Text> : null}
        <TouchableOpacity
          style={styles.button}
          onPress={() => void launch()}
          disabled={launching}
          activeOpacity={0.85}
        >
          {launching ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Begin morning meditation</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: radii.lg,
    backgroundColor: colors.backgroundCard,
    ...shadows.card,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sageLight,
  },
  body: { flex: 1, gap: 6 },
  title: { fontSize: 16, fontWeight: '700', color: colors.forestDark },
  subtitle: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  warning: { fontSize: 12, lineHeight: 16, color: colors.amberDark },
  button: {
    marginTop: 8,
    minHeight: 42,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.forest,
  },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
