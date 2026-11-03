import type { AttentionGateStatus } from './attentionExchange';
import type { RestorativeGatePhase, RestorativeStatusView } from './restorativeGate';
import { deriveRestorativeCardCopy } from './restorativePresentation';
import type { MorningMeditationRuntimeState } from './types';

export type TouchGrassPresentationMode =
  | 'morning'
  | 'morning-and-cooldown'
  | 'morning-and-attention'
  | 'cooldown'
  | 'attention'
  | 'restorative'
  | 'none';

export interface TouchGrassPresentation {
  mode: TouchGrassPresentationMode;
  title: string;
  badge: string;
  subtitle: string;
  showCooldownTimer: boolean;
  showReadingRequirements: boolean;
  showMorningFocus: boolean;
  showRestorativeHold: boolean;
  showCooldownFacts: boolean;
  emergencyLinkText: string;
  /** Rich read-only copy for the CD4+ selected obligation/status. */
  restorativeStatusLabel?: string;
  restorativeObligationLabel?: string;
  restorativeProgressLabel?: string;
  restorativeNextAction?: string;
  restorativeCarriedLabel?: string;
}

export function deriveTouchGrassPresentation(input: {
  morning?: MorningMeditationRuntimeState;
  hasActiveCooldown: boolean;
  attention?: AttentionGateStatus;
  restorativeHold?: boolean;
  restorativeGroupName?: string;
  restorativeProvider?: 'reader' | 'meditation';
  restorativePhase?: RestorativeGatePhase;
  /** Existing store projection; no provider query is made from presentation. */
  restorativeStatus?: RestorativeStatusView;
  /**
   * A DIFFERENT unfinished obligation that must remain visible as separate
   * information; it is never described as this card's obligation.
   */
  otherPendingRestorativeGroupName?: string;
  groupName?: string;
  allowanceMinutes?: number;
  cooldownMinutes?: number;
}): TouchGrassPresentation {
  const morningPending =
    input.morning?.state === 'morning-meditation-required' ||
    Boolean(
      input.morning?.requirement &&
        input.morning.requirement.satisfiedAt === undefined
    );
  const attentionActive = Boolean(
    input.attention &&
      input.attention.phase !== 'none' &&
      input.attention.phase !== 'cooldown-active'
  );
  const cooldownFacts =
    input.groupName && input.allowanceMinutes !== undefined && input.cooldownMinutes !== undefined
      ? `${input.allowanceMinutes} min group allowance reached · ${input.cooldownMinutes} min recovery break.`
      : 'Recovery break active.';
  const morningText =
    'Complete the bound morning meditation session to reopen managed nonessential apps. Essential apps, Routine and Meditation stay available.';
  const restorativeHold = input.restorativeHold === true;
  const restorativeUnavailable =
    input.restorativePhase === 'reader-unavailable' ||
    input.restorativePhase === 'reader-incompatible' ||
    input.restorativePhase === 'meditation-unavailable' ||
    input.restorativePhase === 'meditation-incompatible';
  const restorativeProviderLabel =
    input.restorativeProvider === 'reader'
      ? 'bound Reader session'
      : input.restorativeProvider === 'meditation'
      ? 'bound Meditation session'
      : 'Reader or Meditation session';
  const restorativeCopy = input.restorativeStatus
    ? deriveRestorativeCardCopy(input.restorativeStatus)
    : undefined;
  const restorativeText = !restorativeHold
    ? ''
    : restorativeCopy
    ? [
        restorativeCopy.carriedLabel,
        `Restorative obligation${input.restorativeGroupName ? ` for ${input.restorativeGroupName}` : ''}: ${restorativeCopy.obligationTitle.toLowerCase()}.`,
        restorativeCopy.progressLabel,
        restorativeCopy.nextAction,
      ]
        .filter(Boolean)
        .join(' ')
    : `${restorativeUnavailable
        ? 'The selected restorative verification is currently unavailable'
        : 'A bound restorative requirement is still pending'}${
        input.restorativeGroupName ? ` for ${input.restorativeGroupName}` : ''
      }. Complete the ${restorativeProviderLabel} shown below; the obligation remains open until verified.`;
  const otherPendingText = input.otherPendingRestorativeGroupName
    ? `Separate obligation also outstanding for ${input.otherPendingRestorativeGroupName}; it is enforced independently.`
    : '';
  const restorativeSectionText = [
    restorativeHold ? restorativeText : '',
    otherPendingText,
  ]
    .filter(Boolean)
    .join('\n');
  const withRestorative = (text: string) =>
    restorativeSectionText ? `${text}\n${restorativeSectionText}` : text;
  const restorativeFields = restorativeCopy
    ? {
        restorativeStatusLabel: restorativeCopy.statusLabel,
        restorativeObligationLabel: restorativeCopy.obligationTitle,
        restorativeProgressLabel: restorativeCopy.progressLabel,
        restorativeNextAction: restorativeCopy.nextAction,
        ...(restorativeCopy.carriedLabel
          ? { restorativeCarriedLabel: restorativeCopy.carriedLabel }
          : {}),
      }
    : {};
  const emergencyLinkText = morningPending
    ? 'Emergency access cannot bypass morning focus'
    : 'Need emergency access?';

  if (morningPending && attentionActive) {
    return {
      mode: 'morning-and-attention',
      title: 'Morning focus · Productive attention 🌱',
      badge: 'Morning focus · attention',
      subtitle: withRestorative(`${morningText}\nThe cooldown has ended. Complete the verified productive-attention requirements too.`),
      showCooldownTimer: false,
      showReadingRequirements: true,
      showMorningFocus: true,
      showRestorativeHold: restorativeHold,
      showCooldownFacts: false,
      emergencyLinkText,
      ...restorativeFields,
    };
  }

  if (morningPending && input.hasActiveCooldown) {
    return {
      mode: 'morning-and-cooldown',
      title: 'Morning focus · Cooldown 🌱',
      badge: 'Morning focus · Cooldown',
      subtitle: withRestorative(`${morningText}\n${cooldownFacts}`),
      showCooldownTimer: true,
      showReadingRequirements: false,
      showMorningFocus: true,
      showRestorativeHold: restorativeHold,
      showCooldownFacts: true,
      emergencyLinkText,
      ...restorativeFields,
    };
  }

  if (morningPending) {
    return {
      mode: 'morning',
      title: 'Morning meditation required 🌱',
      badge: 'Morning focus',
      subtitle: withRestorative(morningText),
      showCooldownTimer: false,
      showReadingRequirements: false,
      showMorningFocus: true,
      showRestorativeHold: restorativeHold,
      showCooldownFacts: false,
      emergencyLinkText,
      ...restorativeFields,
    };
  }

  if (attentionActive) {
    return {
      mode: 'attention',
      title: 'Productive attention 🌱',
      badge: 'Productive attention',
      subtitle: withRestorative(
        input.attention?.phase === 'reader-unavailable'
          ? 'The cooldown has ended. Reader evidence is unavailable, so productive attention cannot be verified yet.'
          : input.attention?.phase === 'reader-incompatible'
          ? 'The cooldown has ended. Reader evidence is incompatible with the required protocol.'
          : input.attention?.phase === 'satisfied'
          ? 'Both reading requirements are verified. Rhythm is updating your access.'
          : 'The cooldown has ended. Complete both reading requirements to regain access.'
      ),
      showCooldownTimer: false,
      showReadingRequirements: true,
      showMorningFocus: false,
      showRestorativeHold: restorativeHold,
      showCooldownFacts: false,
      emergencyLinkText,
      ...restorativeFields,
    };
  }

  if (input.hasActiveCooldown) {
    return {
      mode: 'cooldown',
      title: input.groupName ? `${input.groupName} Cooldown 🌱` : 'Cooldown 🌱',
      badge: 'Cooldown in progress',
      subtitle: withRestorative(cooldownFacts),
      showCooldownTimer: true,
      showReadingRequirements: false,
      showMorningFocus: false,
      showRestorativeHold: restorativeHold,
      showCooldownFacts: true,
      emergencyLinkText,
      ...restorativeFields,
    };
  }

  if (restorativeHold) {
    return {
      mode: 'restorative',
      title: 'Restorative obligation pending 🌱',
      badge: 'Restorative hold',
      subtitle: restorativeSectionText,
      showCooldownTimer: false,
      showReadingRequirements: false,
      showMorningFocus: false,
      showRestorativeHold: true,
      showCooldownFacts: false,
      emergencyLinkText,
      ...restorativeFields,
    };
  }

  return {
    mode: 'none',
    title: 'Touch grass 🌱',
    badge: 'No active hold',
    subtitle: 'No active cooldown, morning obligation or restorative requirement. Routine schedule policy may still apply.',
    showCooldownTimer: false,
    showReadingRequirements: false,
    showMorningFocus: false,
    showRestorativeHold: false,
    showCooldownFacts: false,
    emergencyLinkText,
    ...restorativeFields,
  };
}
