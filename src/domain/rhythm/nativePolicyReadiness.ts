/**
 * Read-only diagnostic projection for native enforcement readiness.
 *
 * This does not change authorization, persistence or enforcement. It only
 * prevents a capability fact ("the service can enforce") from being presented
 * as proof that the current policy was actually acknowledged by native storage.
 */

export type NativePolicyReadinessStatus =
  | 'ready'
  | 'policy-not-applied'
  | 'setup-needed'
  | 'check-status';

export interface NativePolicySyncFact {
  success: boolean;
  updatedAt: number;
  failedStage?: string;
  error?: string;
}

export interface NativePolicyReadinessInput {
  /** Null means the module status has not been read yet. */
  moduleAvailable?: boolean | null;
  /** Null means enforcement diagnostics have not been read yet. */
  serviceRunning?: boolean | null;
  restrictionAuthorization?: 'unknown' | 'granted' | 'denied' | 'unsupported';
  restrictionCapability?: 'enforced' | 'foundation-only' | 'unsupported';
  /** The last native projection attempt. Missing means never reported. */
  sync?: NativePolicySyncFact | null;
  /** True only when JS and native positively disagree about projected policy. */
  projectionMismatch?: boolean | null;
}

export type NativeServiceDisplay = 'Unavailable' | 'Unverified' | 'Service available';
export type NativeCapabilityDisplay = 'Unavailable' | 'Unverified' | 'Available';
export type NativeAuthorizationDisplay =
  | 'Not verified'
  | 'Authorized'
  | 'Denied'
  | 'Unsupported';

export interface NativePolicyReadiness {
  status: NativePolicyReadinessStatus;
  label: 'Ready' | 'Policy not applied' | 'Setup needed' | 'Check status';
  detail: string;
  /** True only when every positive native acknowledgement is present. */
  policyApplied: boolean;
  /** Display-only labels: never echo a simulated or unverified permission bit. */
  serviceDisplay: NativeServiceDisplay;
  capabilityDisplay: NativeCapabilityDisplay;
  authorizationDisplay: NativeAuthorizationDisplay;
}

function stageSuffix(stage: string | undefined): string {
  return stage ? ` at ${stage}` : '';
}

export function deriveNativePolicyReadiness(
  input: NativePolicyReadinessInput
): NativePolicyReadiness {
  const serviceDisplay: NativeServiceDisplay =
    input.moduleAvailable === false
      ? 'Unavailable'
      : input.moduleAvailable !== true
        ? 'Unverified'
        : input.serviceRunning === false
          ? 'Unavailable'
          : input.serviceRunning === true
            ? 'Service available'
            : 'Unverified';
  const authorizationDisplay: NativeAuthorizationDisplay =
    input.moduleAvailable !== true
      ? 'Not verified'
      : input.restrictionAuthorization === 'granted'
        ? 'Authorized'
        : input.restrictionAuthorization === 'denied'
          ? 'Denied'
          : input.restrictionAuthorization === 'unsupported'
            ? 'Unsupported'
            : 'Not verified';
  const capabilityDisplay: NativeCapabilityDisplay =
    input.moduleAvailable === false ||
    input.serviceRunning === false ||
    authorizationDisplay === 'Denied' ||
    authorizationDisplay === 'Unsupported' ||
    input.restrictionCapability === 'foundation-only' ||
    input.restrictionCapability === 'unsupported'
      ? 'Unavailable'
      : input.moduleAvailable === true &&
          input.serviceRunning === true &&
          authorizationDisplay === 'Authorized' &&
          input.restrictionCapability === 'enforced'
        ? 'Available'
        : 'Unverified';
  const displayLabels = { serviceDisplay, capabilityDisplay, authorizationDisplay };

  if (input.moduleAvailable !== true) {
    if (input.moduleAvailable === false) {
      return {
        status: 'setup-needed',
        label: 'Setup needed',
        detail: 'The native Rhythm module is unavailable. Enforcement is not treated as active.',
        policyApplied: false,
        ...displayLabels,
      };
    }
    return {
      status: 'check-status',
      label: 'Check status',
      detail: 'Native module status has not been confirmed yet.',
      policyApplied: false,
      ...displayLabels,
    };
  }

  if (input.restrictionAuthorization !== 'granted') {
    return {
      status: 'setup-needed',
      label: 'Setup needed',
      detail:
        input.restrictionAuthorization === 'denied'
          ? 'Restriction authorization is denied. Enforcement is not treated as active.'
          : 'Restriction authorization has not been confirmed. Enforcement is not treated as active.',
      policyApplied: false,
      ...displayLabels,
    };
  }

  if (input.serviceRunning === false) {
    return {
      status: 'setup-needed',
      label: 'Setup needed',
      detail: 'The native enforcement service is not running. Enforcement is not treated as active.',
      policyApplied: false,
      ...displayLabels,
    };
  }
  if (input.serviceRunning !== true) {
    return {
      status: 'check-status',
      label: 'Check status',
      detail: 'Native enforcement service status has not been confirmed yet.',
      policyApplied: false,
      ...displayLabels,
    };
  }

  if (input.restrictionCapability !== 'enforced') {
    return {
      status: 'setup-needed',
      label: 'Setup needed',
      detail: 'Restriction capability is foundation-only. Complete native setup before relying on enforcement.',
      policyApplied: false,
      ...displayLabels,
    };
  }

  if (!input.sync) {
    return {
      status: 'policy-not-applied',
      label: 'Policy not applied',
      detail: 'No native policy sync has been reported. Enforcement is not treated as active.',
      policyApplied: false,
      ...displayLabels,
    };
  }

  if (!input.sync.success) {
    return {
      status: 'policy-not-applied',
      label: 'Policy not applied',
      detail: `The last native policy sync failed${stageSuffix(input.sync.failedStage)}. Reapply the native policy before relying on enforcement.`,
      policyApplied: false,
      ...displayLabels,
    };
  }

  if (!Number.isFinite(input.sync.updatedAt) || input.sync.updatedAt <= 0) {
    return {
      status: 'policy-not-applied',
      label: 'Policy not applied',
      detail: 'Native policy sync has not been acknowledged yet. Enforcement is not treated as active.',
      policyApplied: false,
      ...displayLabels,
    };
  }

  if (input.projectionMismatch === true) {
    return {
      status: 'policy-not-applied',
      label: 'Policy not applied',
      detail: 'Native policy is out of sync with Routine. Reapply the native policy before relying on enforcement.',
      policyApplied: false,
      ...displayLabels,
    };
  }

  return {
    status: 'ready',
    label: 'Ready',
    detail: 'Native module, enforcement service and the last acknowledged policy sync are all confirmed.',
    policyApplied: true,
    ...displayLabels,
  };
}
