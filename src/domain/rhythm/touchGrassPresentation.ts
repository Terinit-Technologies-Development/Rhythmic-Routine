import type { AttentionGateStatus } from './attentionExchange';
import type { MorningMeditationRuntimeState } from './types';

export type TouchGrassPresentationMode =
  | 'morning'
  | 'morning-and-cooldown'
  | 'morning-and-attention'
  | 'cooldown'
  | 'attention'
  | 'none';

export interface TouchGrassPresentation {
  mode: TouchGrassPresentationMode;
  title: string;
  badge: string;
  subtitle: string;
  showCooldownTimer: boolean;
  showReadingRequirements: boolean;
  showMorningFocus: boolean;
  showCooldownFacts: boolean;
  emergencyLinkText: string;
}

export function deriveTouchGrassPresentation(input: {
  morning?: MorningMeditationRuntimeState;
  hasActiveCooldown: boolean;
  attention?: AttentionGateStatus;
  groupName?: string;
  allowanceMinutes?: number;
  cooldownMinutes?: number;
}): TouchGrassPresentation {
  const morningPending = input.morning?.state === 'morning-meditation-required';
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
  const emergencyLinkText = morningPending
    ? 'Emergency access cannot bypass morning focus'
    : 'Need emergency access?';

  if (morningPending && attentionActive) {
    return {
      mode: 'morning-and-attention',
      title: 'Morning focus · Productive attention 🌱',
      badge: 'Morning focus · attention',
      subtitle: `${morningText}\nThe cooldown has ended. Complete the verified productive-attention requirements too.`,
      showCooldownTimer: false,
      showReadingRequirements: true,
      showMorningFocus: true,
      showCooldownFacts: false,
      emergencyLinkText,
    };
  }

  if (morningPending && input.hasActiveCooldown) {
    return {
      mode: 'morning-and-cooldown',
      title: 'Morning focus · Cooldown 🌱',
      badge: 'Morning focus · Cooldown',
      subtitle: `${morningText}\n${cooldownFacts}`,
      showCooldownTimer: true,
      showReadingRequirements: false,
      showMorningFocus: true,
      showCooldownFacts: true,
      emergencyLinkText,
    };
  }

  if (morningPending) {
    return {
      mode: 'morning',
      title: 'Morning meditation required 🌱',
      badge: 'Morning focus',
      subtitle: morningText,
      showCooldownTimer: false,
      showReadingRequirements: false,
      showMorningFocus: true,
      showCooldownFacts: false,
      emergencyLinkText,
    };
  }

  if (attentionActive) {
    return {
      mode: 'attention',
      title: 'Productive attention 🌱',
      badge: 'Productive attention',
      subtitle:
        input.attention?.phase === 'reader-unavailable'
          ? 'The cooldown has ended. Reader evidence is unavailable, so productive attention cannot be verified yet.'
          : input.attention?.phase === 'reader-incompatible'
          ? 'The cooldown has ended. Reader evidence is incompatible with the required protocol.'
          : input.attention?.phase === 'satisfied'
          ? 'Both reading requirements are verified. Rhythm is updating your access.'
          : 'The cooldown has ended. Complete both reading requirements to regain access.',
      showCooldownTimer: false,
      showReadingRequirements: true,
      showMorningFocus: false,
      showCooldownFacts: false,
      emergencyLinkText,
    };
  }

  if (input.hasActiveCooldown) {
    return {
      mode: 'cooldown',
      title: input.groupName ? `${input.groupName} Cooldown 🌱` : 'Cooldown 🌱',
      badge: 'Cooldown in progress',
      subtitle: cooldownFacts,
      showCooldownTimer: true,
      showReadingRequirements: false,
      showMorningFocus: false,
      showCooldownFacts: true,
      emergencyLinkText,
    };
  }

  return {
    mode: 'none',
    title: 'Touch grass 🌱',
    badge: 'No active hold',
    subtitle: 'No active cooldown or morning obligation. Open the apps you choose consciously.',
    showCooldownTimer: false,
    showReadingRequirements: false,
    showMorningFocus: false,
    showCooldownFacts: false,
    emergencyLinkText,
  };
}
