import type {
  RestorativeProvider,
  RestorativeStatusView,
} from './restorativeGate';
import type {
  MeditationProviderAvailability,
  MeditationQueryStatus,
} from './meditationEvidence';
import type {
  RecoveryProviderAvailability,
  RecoveryQueryStatus,
} from './recovery';

/**
 * Plain presentation for the CD4+ restorative choice. This module never
 * evaluates evidence or changes policy; it only turns the already-derived
 * read model into honest labels and next actions.
 */

export interface MeditationProviderDiagnostic {
  availability?: MeditationProviderAvailability;
  queryStatus?: MeditationQueryStatus;
  sessionMissing?: boolean;
}

export interface ReaderProviderDiagnostic {
  availability?: RecoveryProviderAvailability;
  queryStatus?: RecoveryQueryStatus;
  sessionMissing?: boolean;
}

export interface ProviderStatusCopy {
  label: string;
  detail: string;
  action: string;
  selectable: boolean;
}

export interface RestorativeCardCopy {
  statusLabel: string;
  carriedLabel?: string;
  obligationTitle: string;
  progressLabel: string;
  nextAction: string;
  cooldownLabel: string;
  showChoice: boolean;
  showSelectedObligation: boolean;
  providerSwitchAllowed: boolean;
  selectedProvider?: RestorativeProvider;
  meditationPath: ProviderStatusCopy;
  readerPath: ProviderStatusCopy;
}

export function formatEvidenceDuration(remainingSeconds: number): string {
  const total = Math.max(0, Math.ceil(remainingSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours} hr ${minutes.toString().padStart(2, '0')} min`;
  }
  if (minutes > 0) {
    return `${minutes} min ${seconds.toString().padStart(2, '0')} sec`;
  }
  return `${seconds} sec`;
}

function providerName(provider: RestorativeProvider | undefined): string {
  if (provider === 'meditation') return 'Meditation';
  if (provider === 'reader') return 'Reader';
  return 'Selected path';
}

function remainingEvidence(required: number, verified: number): number {
  return Math.max(0, Math.ceil(required - verified));
}

function evidenceSummary(view: RestorativeStatusView): string {
  const obligation = view.obligation;
  if (!obligation || obligation.kind === 'select-provider') {
    return 'Choose Reader or Meditation; progress from the two paths cannot be combined.';
  }

  if (view.gateSatisfied) {
    return 'All required evidence is verified.';
  }

  const remainingSeconds = remainingEvidence(
    obligation.requiredSeconds,
    obligation.verifiedSeconds
  );
  const requiredPages = obligation.requiredQualifiedPages ?? 0;
  const verifiedPages = obligation.verifiedQualifiedPages ?? 0;
  const remainingPages = Math.max(0, requiredPages - verifiedPages);

  if (obligation.kind === 'meditation-session') {
    return remainingSeconds > 0
      ? `${formatEvidenceDuration(remainingSeconds)} of qualified Meditation time remaining.`
      : 'Qualified Meditation time is verified; waiting for the completion check.';
  }

  if (obligation.kind === 'reader-daily-baseline') {
    if (remainingSeconds <= 0 && remainingPages <= 0) {
      return 'Reader daily evidence is verified.';
    }
    const parts: string[] = [];
    if (remainingSeconds > 0) {
      parts.push(`${formatEvidenceDuration(remainingSeconds)} reading`);
    }
    if (remainingPages > 0) {
      parts.push(`${remainingPages} qualified page${remainingPages === 1 ? '' : 's'}`);
    }
    return `${parts.join(' and ')} remaining in today's Reader baseline.`;
  }

  if (remainingSeconds <= 0 && remainingPages <= 0) {
    return 'The bound Reader session evidence is verified.';
  }
  const parts: string[] = [];
  if (remainingSeconds > 0) {
    parts.push(`${formatEvidenceDuration(remainingSeconds)} active reading`);
  }
  if (remainingPages > 0) {
    parts.push(`${remainingPages} qualified page${remainingPages === 1 ? '' : 's'}`);
  }
  return `${parts.join(' and ')} remaining in the bound Reader session.`;
}

function statusLabel(view: RestorativeStatusView): string {
  const cooldownActive = view.cooldownRemainingSeconds > 0;
  const selected =
    view.selectedProvider ?? view.obligation?.provider;
  const obligationStarted =
    (view.obligation?.verifiedSeconds ?? 0) > 0 ||
    (view.obligation?.verifiedQualifiedPages ?? 0) > 0;

  if (view.gateSatisfied) {
    return cooldownActive
      ? 'Restorative complete · cooldown active'
      : 'Restorative complete · cooldown elapsed';
  }

  if (selected) {
    const name = providerName(selected);
    if (!obligationStarted) {
      return cooldownActive
        ? `${name} selected · waiting for verified evidence · cooldown active`
        : `${name} selected · waiting for verified evidence · cooldown elapsed, obligation pending`;
    }
    return cooldownActive
      ? `${name} in progress · cooldown active`
      : `${name} in progress · cooldown elapsed, obligation pending`;
  }

  return cooldownActive
    ? 'Cooldown active · restorative choice pending'
    : 'Cooldown elapsed · restorative choice pending';
}

function obligationTitle(view: RestorativeStatusView): string {
  if (view.gateSatisfied) return 'Restorative requirement complete';
  switch (view.obligation?.kind) {
    case 'reader-daily-baseline':
      return 'Selected obligation · Reader daily baseline';
    case 'reader-recovery-session':
      return 'Selected obligation · Reader session';
    case 'meditation-session':
      return 'Selected obligation · Meditation session';
    case 'select-provider':
    default:
      return 'No restorative path selected yet';
  }
}

export function describeMeditationPath(
  view: RestorativeStatusView,
  diagnostic?: MeditationProviderDiagnostic
): ProviderStatusCopy {
  if (view.meditationPathsRemaining <= 0) {
    return {
      label: 'No cooldown Meditation paths remain today',
      detail: 'The two-per-attention-day cooldown limit is used up.',
      action: 'Choose the Reader path if its requirements can be met.',
      selectable: false,
    };
  }

  const availability = diagnostic?.availability;
  const selected = view.selectedProvider === 'meditation';
  if (availability === 'not-installed') {
    return {
      label: 'Not installed',
      detail: 'Meditation is not installed or is not visible to Routine.',
      action: 'Install the official Meditation app, then retry this path.',
      selectable: false,
    };
  }
  if (availability === 'untrusted-signature') {
    return {
      label: 'Signature not trusted',
      detail: 'The installed Meditation app is not signed by the expected publisher.',
      action: 'Use the official same-signed build, then retry this path.',
      selectable: false,
    };
  }
  if (availability === 'permission-denied') {
    return {
      label: 'Permission denied',
      detail: 'Meditation did not grant Routine access to its status provider.',
      action: 'Open Meditation and allow the required status access, then retry.',
      selectable: false,
    };
  }
  if (availability === 'protocol-incompatible') {
    return {
      label: 'Incompatible app version',
      detail: 'Meditation answered with a protocol Routine cannot verify.',
      action: 'Update Meditation to a compatible version, then retry.',
      selectable: false,
    };
  }

  const queryStatus = diagnostic?.queryStatus;
  if (diagnostic?.sessionMissing || queryStatus === 'session-missing') {
    return {
      label: 'Session not found',
      detail: 'The bound Meditation session was not found by the provider.',
      action: 'Start this path again to create a new bound session.',
      selectable: true,
    };
  }
  if (queryStatus === 'corrupt') {
    return {
      label: 'Status unreadable',
      detail: 'Meditation returned a status record that could not be verified.',
      action: 'Check the connection and retry; no completion is credited.',
      selectable: true,
    };
  }
  if (
    queryStatus === 'query-failed' ||
    queryStatus === 'unavailable' ||
    queryStatus === 'legacy-ambiguous-null' ||
    availability === 'unavailable'
  ) {
    return {
      label: 'Check connection — status unknown',
      detail: 'Routine could not positively confirm the Meditation session status.',
      action: 'Check the connection and retry; no completion is credited until verified.',
      selectable: true,
    };
  }
  if (view.phase === 'meditation-incompatible') {
    return {
      label: 'Incompatible app version',
      detail: 'Meditation evidence does not match the required protocol.',
      action: 'Update Meditation to a compatible version, then retry.',
      selectable: false,
    };
  }

  if (availability === 'available' && !selected && !view.gateSatisfied) {
    return {
      label: 'Available — no session yet',
      detail: 'Meditation answered, but no bound cooldown session has started.',
      action: 'Choose Meditation to begin the 30-minute session.',
      selectable: true,
    };
  }

  if (view.gateSatisfied && selected) {
    return {
      label: 'Complete',
      detail: 'The bound Meditation session is verified.',
      action: 'No further Meditation action is required.',
      selectable: false,
    };
  }
  if (selected && (view.obligation?.verifiedSeconds ?? 0) > 0) {
    return {
      label: 'In progress',
      detail: 'Qualified time from the bound Meditation session is recorded.',
      action: 'Continue until the required qualified time is verified.',
      selectable: true,
    };
  }
  if (selected) {
    return {
      label: 'Waiting for verified session',
      detail: 'No completed bound Meditation status is confirmed yet.',
      action: 'Begin or resume the bound session, then return to refresh.',
      selectable: true,
    };
  }
  return {
    label: 'Not yet started',
    detail: 'Selecting this path binds a Meditation session before launch.',
    action: 'Choose Meditation to begin the 30-minute session.',
    selectable: true,
  };
}

export function describeReaderPath(
  view: RestorativeStatusView,
  diagnostic?: ReaderProviderDiagnostic
): ProviderStatusCopy {
  if (view.gateSatisfied && view.selectedProvider === 'reader') {
    return {
      label: 'Complete',
      detail: 'The selected Reader evidence is verified.',
      action: 'No further Reader action is required.',
      selectable: false,
    };
  }

  const availability = diagnostic?.availability;
  if (availability === 'not-installed') {
    return {
      label: 'Not installed',
      detail: 'Reader is not installed or is not visible to Routine.',
      action: 'Install the official Reader app, then retry this path.',
      selectable: false,
    };
  }
  if (availability === 'untrusted-signature') {
    return {
      label: 'Signature not trusted',
      detail: 'The installed Reader app is not signed by the expected publisher.',
      action: 'Use the official same-signed build, then retry this path.',
      selectable: false,
    };
  }
  if (availability === 'permission-denied') {
    return {
      label: 'Permission denied',
      detail: 'Reader did not grant Routine access to its recovery status provider.',
      action: 'Open Reader and allow the required recovery access, then retry.',
      selectable: false,
    };
  }
  if (availability === 'protocol-incompatible') {
    return {
      label: 'Incompatible app version',
      detail: 'Reader answered with a recovery protocol Routine cannot verify.',
      action: 'Update Reader to a compatible version, then retry.',
      selectable: false,
    };
  }

  const queryStatus = diagnostic?.queryStatus;
  if (diagnostic?.sessionMissing || queryStatus === 'session-missing') {
    return {
      label: 'Session not found',
      detail: 'The bound Reader recovery session was not found by the provider.',
      action: 'Start this path again to create a new bound session.',
      selectable: true,
    };
  }
  if (queryStatus === 'corrupt') {
    return {
      label: 'Status unreadable',
      detail: 'Reader returned a recovery record that could not be verified.',
      action: 'Check the connection and retry; no completion is credited.',
      selectable: true,
    };
  }
  if (
    queryStatus === 'query-failed' ||
    queryStatus === 'unavailable' ||
    queryStatus === 'legacy-ambiguous-null' ||
    availability === 'unavailable'
  ) {
    return {
      label: 'Check connection — status unknown',
      detail: 'Routine could not positively confirm the Reader recovery status.',
      action: 'Check the connection and retry; no completion is credited until verified.',
      selectable: true,
    };
  }

  if (view.phase === 'reader-incompatible') {
    return {
      label: 'Incompatible app version',
      detail: 'Reader answered with evidence Routine cannot verify.',
      action: 'Update Reader to a compatible version, then retry.',
      selectable: true,
    };
  }

  const selected = view.selectedProvider === 'reader';
  if (availability === 'available' && !selected && !view.gateSatisfied) {
    return {
      label: 'Available — no session yet',
      detail: 'Reader answered, but no bound recovery session has started.',
      action: 'Choose Reading to begin the bound 30-minute session.',
      selectable: true,
    };
  }
  const verified =
    (view.obligation?.verifiedSeconds ?? 0) > 0 ||
    (view.obligation?.verifiedQualifiedPages ?? 0) > 0;

  if (selected && verified) {
    return {
      label: 'In progress',
      detail: 'The bound Reader session has verified progress.',
      action: 'Continue until the required reading time and pages are verified.',
      selectable: true,
    };
  }
  if (selected) {
    return {
      label: 'Waiting for verified session',
      detail: 'Reader status is verified only after the bound session is opened.',
      action: 'Open the bound Reader session, then return to refresh evidence.',
      selectable: true,
    };
  }
  return {
    label: 'Not yet started',
    detail: 'The Reader option uses one bound session, not the daily aggregate.',
    action: 'Choose Reading to open the bound session.',
    selectable: true,
  };
}

export function deriveRestorativeCardCopy(
  view: RestorativeStatusView,
  meditationDiagnostic?: MeditationProviderDiagnostic,
  readerDiagnostic?: ReaderProviderDiagnostic
): RestorativeCardCopy {
  const cooldownActive = view.cooldownRemainingSeconds > 0;
  const obligationProvider = view.obligation?.provider;
  const selectedProvider =
    view.selectedProvider ??
    (obligationProvider === 'reader' || obligationProvider === 'meditation'
      ? obligationProvider
      : undefined);
  const gateOpen = !view.gateSatisfied;
  const providerSwitchAllowed =
    gateOpen && Boolean(selectedProvider) && view.providerSwitchAllowed === true;
  const showChoice =
    gateOpen &&
    view.obligation?.kind !== 'reader-daily-baseline' &&
    (!selectedProvider || providerSwitchAllowed);
  const showSelectedObligation =
    gateOpen && Boolean(selectedProvider || view.obligation?.kind === 'reader-daily-baseline');
  const meditationPath = describeMeditationPath(view, meditationDiagnostic);
  const readerPath = describeReaderPath(view, readerDiagnostic);

  let nextAction: string;
  if (view.gateSatisfied) {
    nextAction = cooldownActive
      ? 'Wait for the separate cooldown timer; no restorative action remains.'
      : 'No restorative action remains.';
  } else if (showChoice && !providerSwitchAllowed) {
    nextAction = cooldownActive
      ? 'Choose Reader or Meditation below. The cooldown timer continues independently.'
      : 'Choose Reader or Meditation below to reopen access.';
  } else {
    const selectedStatus =
      selectedProvider === 'meditation' ? meditationPath : readerPath;
    if (providerSwitchAllowed && selectedStatus.selectable) {
      nextAction = cooldownActive
        ? 'Continue the selected session, or switch to the other path before verified progress. The cooldown timer continues independently.'
        : 'Continue the selected session, or switch to the other path before verified progress.';
    } else if (providerSwitchAllowed) {
      nextAction =
        'Switch to the other path, or resolve the selected provider issue, before verified progress.';
    } else if (!selectedStatus.selectable) {
      nextAction = selectedStatus.action;
    } else {
      nextAction = cooldownActive
        ? 'Continue the selected session. The cooldown timer continues independently.'
        : 'Finish the selected session to reopen access.';
    }
  }

  return {
    statusLabel: statusLabel(view),
    ...(view.carriedObligation
      ? { carriedLabel: 'Carried obligation from an earlier attention day — not new debt today.' }
      : {}),
    obligationTitle: obligationTitle(view),
    progressLabel: evidenceSummary(view),
    nextAction,
    cooldownLabel:
      view.cooldownRemainingSeconds > 0
        ? `Cooldown ${formatEvidenceDuration(view.cooldownRemainingSeconds)} remaining`
        : view.gateSatisfied
          ? 'Cooldown complete'
          : 'Cooldown elapsed · obligation pending',
    showChoice,
    showSelectedObligation,
    providerSwitchAllowed,
    ...(selectedProvider ? { selectedProvider } : {}),
    meditationPath,
    readerPath,
  };
}
