import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BookOpen, Sprout, Timer, Moon } from 'lucide-react-native';
import { colors, radii, shadows } from '../theme/tokens';
import type { RestorativeStatusView, RestorativeProvider } from '../domain/rhythm/restorativeGate';

/**
 * Restorative Choice (Pass 3) — the discrete CD4+ requirement.
 *
 * Presents ONE restorative path choice:
 *   Meditation — 30 min quiet session
 *   Reading    — 30 min + 11 pages
 *
 * Cooldown time is shown SEPARATELY and is never shortened by either path.
 * Meditation paths remaining (2/Attention Day cap) is shown separately too.
 *
 * Language rules (deliberate): never "Meditate to remove 60 min", "Earn
 * access", or "Unlock 30 minutes" — meditation never buys screen time.
 */

export interface RestorativeChoiceCardProps {
  view: RestorativeStatusView;
  /** Provider selection (binds an opaque provider session before launch). */
  onSelectProvider: (provider: RestorativeProvider) => void;
  /** Begin/resume the selected provider flow. */
  onBeginProvider: (provider: RestorativeProvider) => void;
  /** Optional provider availability, e.g. 'not-installed' | 'untrusted-signature'. */
  meditationUnavailableReason?: string;
  readerUnavailable?: boolean;
}

function formatCooldown(remainingSeconds: number): string {
  const total = Math.max(0, Math.floor(remainingSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} hr ${minutes.toString().padStart(2, '0')} min`;
  return `${minutes} min`;
}

function statusLabel(view: RestorativeStatusView): string {
  switch (view.phase) {
    case 'separation-only':
      return 'Separation only';
    case 'baseline-reading-required':
      return 'Daily Reader baseline required';
    case 'pending-selection':
      return 'Choose a restorative path';
    case 'meditation-in-progress':
      return 'Meditation in progress';
    case 'reader-in-progress':
      return 'Reading in progress';
    case 'restorative-complete-cooldown-active':
      return 'Restorative requirement complete · Cooldown remains active';
    case 'cooldown-complete-restorative-remains':
      return 'Cooldown complete · Restorative requirement remains';
    case 'complete':
      return 'Cooldown + Restorative requirement complete · Eligible';
    case 'meditation-unavailable':
      return 'Meditation unavailable — reading remains available';
    case 'reader-unavailable':
      return 'Reading unavailable — please retry';
    case 'reader-incompatible':
      return 'Reading provider incompatible';
    case 'meditation-incompatible':
      return 'Meditation provider incompatible';
    default:
      return '';
  }
}

export function RestorativeChoiceCard({
  view,
  onSelectProvider,
  onBeginProvider,
  meditationUnavailableReason,
  readerUnavailable,
}: RestorativeChoiceCardProps) {
  const gateOpen = !view.gateSatisfied;
  const meditationSelectable =
    gateOpen && view.meditationPathsRemaining > 0 && !meditationUnavailableReason;
  const readerSelectable = gateOpen && !readerUnavailable;

  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>{statusLabel(view)}</Text>
      </View>

      {view.requirementKind === 'restorative-choice' && gateOpen ? (
        <>
          <Text style={styles.title}>Choose a restorative path</Text>
          <Text style={styles.subtitle}>
            One quiet practice completes this restorative requirement.
          </Text>

          <View style={styles.pathsRow}>
            <View style={[styles.pathCard, styles.pathMeditation]}>
              <View style={styles.pathIcon}>
                <Sprout size={22} color={colors.forest} />
              </View>
              <Text style={styles.pathTitle}>Meditation</Text>
              <Text style={styles.pathDetail}>30 min quiet session</Text>
              {meditationUnavailableReason ? (
                <Text style={styles.pathUnavailable}>
                  Unavailable ({meditationUnavailableReason})
                </Text>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.pathButton,
                  styles.pathButtonPrimary,
                  !meditationSelectable && styles.pathButtonDisabled,
                ]}
                disabled={!meditationSelectable}
                onPress={() => {
                  onSelectProvider('meditation');
                  onBeginProvider('meditation');
                }}
              >
                <Text style={styles.pathButtonPrimaryLabel}>Begin Meditation</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.pathCard, styles.pathReading]}>
              <View style={styles.pathIcon}>
                <BookOpen size={22} color={colors.textSecondary} />
              </View>
              <Text style={styles.pathTitle}>Reading</Text>
              <Text style={styles.pathDetail}>30 min + 11 pages</Text>
              {readerUnavailable ? (
                <Text style={styles.pathUnavailable}>Unavailable</Text>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.pathButton,
                  styles.pathButtonSecondary,
                  !readerSelectable && styles.pathButtonDisabled,
                ]}
                disabled={!readerSelectable}
                onPress={() => {
                  onSelectProvider('reader');
                  onBeginProvider('reader');
                }}
              >
                <Text style={styles.pathButtonSecondaryLabel}>Open Reader</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Moon size={16} color={colors.textSecondary} />
              <Text style={styles.metaText}>
                Meditation paths remaining {view.meditationPathsRemaining} of 2
              </Text>
            </View>
          </View>
        </>
      ) : null}

      <View style={styles.cooldownRow}>
        <Timer size={16} color={colors.textSecondary} />
        <Text style={styles.cooldownText}>
          Cooldown {formatCooldown(view.cooldownRemainingSeconds)} remaining
        </Text>
      </View>
      <Text style={styles.cooldownNote}>
        Neither meditation nor reading shortens the cooldown.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.backgroundCard,
    borderRadius: radii.lg,
    padding: 18,
    ...shadows.soft,
  },
  statusRow: { marginBottom: 8 },
  statusLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    fontFamily: 'serif',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: colors.textSecondary,
  },
  pathsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  pathCard: {
    flex: 1,
    borderRadius: radii.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pathMeditation: { backgroundColor: colors.backgroundMuted },
  pathReading: { backgroundColor: colors.backgroundCard },
  pathIcon: { marginBottom: 8 },
  pathTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    fontFamily: 'serif',
  },
  pathDetail: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textSecondary,
  },
  pathUnavailable: {
    marginTop: 6,
    fontSize: 12,
    color: colors.badgeRedText,
  },
  pathButton: {
    marginTop: 12,
    borderRadius: radii.full,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pathButtonPrimary: { backgroundColor: colors.forest },
  pathButtonSecondary: {
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pathButtonDisabled: { opacity: 0.5 },
  pathButtonPrimaryLabel: {
    color: colors.textLight,
    fontWeight: '600',
    fontSize: 14,
  },
  pathButtonSecondaryLabel: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  metaRow: { marginTop: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, color: colors.textSecondary },
  cooldownRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cooldownText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  cooldownNote: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
  },
});
