import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BookOpen, Sprout, Timer, Moon } from 'lucide-react-native';
import { colors, radii, shadows } from '../theme/tokens';
import type { RestorativeStatusView, RestorativeProvider } from '../domain/rhythm/restorativeGate';
import {
  deriveRestorativeCardCopy,
  type MeditationProviderDiagnostic,
} from '../domain/rhythm/restorativePresentation';

/**
 * Restorative Choice (Pass 3) — the discrete CD4+ requirement.
 *
 * Shows the separation cooldown separately from the selected obligation,
 * remaining evidence and the next action. The cooldown is never shortened by
 * either provider. Provider failures are reported as unknown/check connection
 * unless a typed provider result positively identifies the cause.
 */

export interface RestorativeChoiceCardProps {
  view: RestorativeStatusView;
  /** Provider selection (binds an opaque provider session before launch). */
  onSelectProvider: (provider: RestorativeProvider) => void | Promise<void>;
  /** Begin/resume the selected provider flow. */
  onBeginProvider: (provider: RestorativeProvider) => void | Promise<void>;
  /** Typed read-only provider diagnostics from the store. */
  providerDiagnostics?: {
    meditation?: MeditationProviderDiagnostic;
  };
  /** @deprecated Use providerDiagnostics. Kept for older callers. */
  meditationUnavailableReason?: string;
  readerUnavailable?: boolean;
}

export function RestorativeChoiceCard({
  view,
  onSelectProvider,
  onBeginProvider,
  providerDiagnostics,
  readerUnavailable,
}: RestorativeChoiceCardProps) {
  const copy = deriveRestorativeCardCopy(view, providerDiagnostics?.meditation);
  const meditationPath = copy.meditationPath;
  const readerPath = readerUnavailable
    ? {
        ...copy.readerPath,
        label: 'Check connection — status unknown',
        detail: 'Reader availability was not positively confirmed.',
        selectable: false,
      }
    : copy.readerPath;

  const startPath = async (provider: RestorativeProvider) => {
    if (view.selectedProvider !== provider) {
      await onSelectProvider(provider);
    }
    await onBeginProvider(provider);
  };

  const obligationProvider = view.obligation?.provider;
  const selectedProvider =
    copy.selectedProvider ??
    (obligationProvider === 'reader' || obligationProvider === 'meditation'
      ? obligationProvider
      : undefined);
  const selectedStatus =
    selectedProvider === 'meditation' ? meditationPath : readerPath;

  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>{copy.statusLabel}</Text>
      </View>

      {copy.carriedLabel ? (
        <Text style={styles.carriedLabel}>{copy.carriedLabel}</Text>
      ) : null}

      {copy.showChoice ? (
        <>
          <Text style={styles.title}>Choose a restorative path</Text>
          <Text style={styles.subtitle}>
            One quiet practice completes this restorative requirement. Progress cannot be combined.
          </Text>

          <View style={styles.pathsRow}>
            <View style={[styles.pathCard, styles.pathMeditation]}>
              <View style={styles.pathIcon}>
                <Sprout size={22} color={colors.forest} />
              </View>
              <Text style={styles.pathTitle}>Meditation</Text>
              <Text style={styles.pathDetail}>30 min quiet session</Text>
              <Text
                style={[
                  styles.pathStatus,
                  meditationPath.selectable ? styles.pathStatusNeutral : styles.pathStatusWarning,
                ]}
              >
                {meditationPath.label}
              </Text>
              <TouchableOpacity
                style={[
                  styles.pathButton,
                  styles.pathButtonPrimary,
                  !meditationPath.selectable && styles.pathButtonDisabled,
                ]}
                disabled={!meditationPath.selectable}
                onPress={() => {
                  void startPath('meditation');
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
              <Text
                style={[
                  styles.pathStatus,
                  readerPath.selectable ? styles.pathStatusNeutral : styles.pathStatusWarning,
                ]}
              >
                {readerPath.label}
              </Text>
              <TouchableOpacity
                style={[
                  styles.pathButton,
                  styles.pathButtonSecondary,
                  !readerPath.selectable && styles.pathButtonDisabled,
                ]}
                disabled={!readerPath.selectable}
                onPress={() => {
                  void startPath('reader');
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

      {copy.showSelectedObligation && selectedProvider ? (
        <View style={styles.selectedPanel}>
          <Text style={styles.sectionLabel}>Selected obligation</Text>
          <Text style={styles.selectedTitle}>{copy.obligationTitle}</Text>
          <Text style={styles.progressText}>{copy.progressLabel}</Text>
          <View style={styles.providerRow}>
            <Text
              style={[
                styles.providerStatus,
                selectedStatus.selectable ? styles.pathStatusNeutral : styles.pathStatusWarning,
              ]}
            >
              {selectedStatus.label}
            </Text>
            <Text style={styles.providerDetail}>{selectedStatus.detail}</Text>
          </View>
          <Text style={styles.nextAction}>{copy.nextAction}</Text>
          <TouchableOpacity
            style={[
              styles.pathButton,
              styles.pathButtonPrimary,
              !selectedStatus.selectable && styles.pathButtonDisabled,
            ]}
            disabled={!selectedStatus.selectable}
            onPress={() => {
              void onBeginProvider(selectedProvider);
            }}
          >
            <Text style={styles.pathButtonPrimaryLabel}>
              {selectedProvider === 'meditation' ? 'Begin Meditation' : 'Open Reader'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {view.gateSatisfied ? (
        <View style={styles.completePanel}>
          <Text style={styles.completeTitle}>{copy.obligationTitle}</Text>
          <Text style={styles.progressText}>{copy.progressLabel}</Text>
          <Text style={styles.nextAction}>{copy.nextAction}</Text>
        </View>
      ) : null}

      <View style={styles.cooldownRow}>
        <Timer size={16} color={colors.textSecondary} />
        <Text style={styles.cooldownText}>{copy.cooldownLabel}</Text>
      </View>
      <Text style={styles.cooldownNote}>
        The cooldown timer runs independently. Neither meditation nor reading shortens it.
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
  carriedLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.forestDark,
    backgroundColor: colors.backgroundMuted,
    borderRadius: radii.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
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
  pathStatus: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  pathStatusNeutral: { color: colors.textSecondary },
  pathStatusWarning: { color: colors.badgeRedText },
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
  selectedPanel: {
    marginTop: 14,
    borderRadius: radii.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundMuted,
  },
  completePanel: {
    marginTop: 14,
    borderRadius: radii.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundMuted,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  selectedTitle: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    fontFamily: 'serif',
  },
  completeTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    fontFamily: 'serif',
  },
  progressText: {
    marginTop: 8,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  providerRow: {
    marginTop: 10,
    gap: 2,
  },
  providerStatus: {
    fontSize: 12,
    fontWeight: '700',
  },
  providerDetail: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  nextAction: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: colors.forestDark,
    lineHeight: 19,
  },
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
