/**
 * Rhythmic Routine v1.1.0 — Accountability Core & Secure Authorization
 * Central Policy & Validation Helpers
 */

import {
  AccountabilityOperation,
  AccountabilityPartner,
  AccountabilitySettings,
  AppPolicyPayload,
} from './types';
import {
  DeviceApp,
  RiskGroup,
  RiskGroupConfigurationDraft,
  RoutineWindow,
  OfflineActivity,
} from '../../types/domain';
import {
  resolveGroupAllowanceMinutes,
  resolveGroupRecoveryActivityId,
} from '../rhythm/allowance';

/**
 * All protected accountability operations.
 * Maintained as an explicit exhaustive list.
 */
export const PROTECTED_OPERATIONS: readonly AccountabilityOperation[] = [
  'change-app-classification',
  'change-daily-allowance',
  'create-risk-group',
  'edit-risk-group',
  'delete-risk-group',
  'edit-risk-group-protection',
  'start-access-lease',
  'reset-local-state',
  'enable-accountability',
  'disable-accountability',
  'manage-accountability-partner',
  'edit-ios-risk-group-selection',
] as const;

/**
 * Pure policy function to determine whether a given operation requires
 * partner authorization under the current settings.
 *
 * - When Accountability Mode is OFF:
 *   Only 'enable-accountability' requires partner approval (setup verification).
 *   All other operations are permitted immediately.
 * - When Accountability Mode is ON:
 *   All protected operations strictly require partner approval.
 */
export function requiresPartnerApproval(
  settings: AccountabilitySettings,
  operation: AccountabilityOperation
): boolean {
  if (!settings.enabled) {
    return operation === 'enable-accountability';
  }

  return PROTECTED_OPERATIONS.includes(operation);
}

export type PasswordValidationResult =
  | { valid: true }
  | { valid: false; reason: 'too-short' | 'empty' };

/**
 * Validates candidate partner password or PIN.
 * Invariants:
 * - Minimum 6 characters.
 * - Trim only for validation decision; never silently alter intentional input.
 * - Reject empty or whitespace-only.
 */
export function validatePartnerPassword(password: string): PasswordValidationResult {
  const trimmed = password.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'empty' };
  }
  if (trimmed.length < 6) {
    return { valid: false, reason: 'too-short' };
  }
  return { valid: true };
}

/**
 * Returns all currently active and enabled partners.
 */
export function getEnabledPartners(
  settings: AccountabilitySettings
): AccountabilityPartner[] {
  return settings.partners.filter((p) => p.enabled);
}

/**
 * Builds a human-readable, specific summary for an app classification/policy change.
 * Examples:
 * - “Change Instagram from Risk / Social to Normal”
 * - “Move YouTube to Entertainment and set daily allowance to 45 min”
 * - “Classify Discord as Risk (Social Feeds)”
 */
export function buildAppPolicySummary(
  app: Pick<DeviceApp, 'name' | 'classification' | 'riskGroupId'>,
  payload: AppPolicyPayload,
  riskGroups: Pick<RiskGroup, 'id' | 'name'>[] = []
): string {
  const prevClassification = app.classification;
  const nextClassification = payload.classification;
  const targetGroup = riskGroups.find((g) => g.id === payload.riskGroupId);
  const prevGroup = riskGroups.find((g) => g.id === app.riskGroupId);

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  let base = '';
  if (nextClassification === 'risk') {
    const groupName = targetGroup?.name || 'Risk Group';
    if (prevClassification === 'risk') {
      if (payload.riskGroupId && payload.riskGroupId !== app.riskGroupId) {
        base = `Move ${app.name} to ${groupName}`;
      } else {
        base = `Update ${app.name} protection in ${groupName}`;
      }
    } else {
      base = `Move ${app.name} to ${groupName}`;
    }

    if (payload.dailyAllowanceMinutes !== undefined) {
      base += ` and set daily allowance to ${payload.dailyAllowanceMinutes} min`;
    }
    return base;
  }

  // Moving away from Risk or between non-risk
  if (prevClassification === 'risk') {
    const fromGroup = prevGroup?.name ? ` / ${prevGroup.name}` : '';
    return `Change ${app.name} from Risk${fromGroup} to ${cap(nextClassification)}`;
  }

  return `Change ${app.name} from ${cap(prevClassification)} to ${cap(nextClassification)}`;
}

/**
 * Builds a precise, human-readable summary detailing each staged change to a Risk Group.
 * Examples:
 * - "Update Social Feeds: allowance 45 → 30 min; cooldown 90 → 120 min; remove Morning Buffer protection; recovery activity → Reading"
 * - "Update Social Feeds: rename “Social Feeds” to “Calm Feeds”"
 * - "Update Social Feeds"
 */
export function buildRiskGroupEditSummary(
  group: RiskGroup,
  draft: RiskGroupConfigurationDraft,
  routineWindows: RoutineWindow[] = [],
  activities: OfflineActivity[] = []
): string {
  const changes: string[] = [];

  const trimmedDraftName = draft.name.trim();
  if (trimmedDraftName && trimmedDraftName !== group.name) {
    changes.push(`rename “${group.name}” to “${trimmedDraftName}”`);
  }

  const trimmedDraftDesc = draft.description.trim();
  const currentDesc = (group.description ?? '').trim();
  if (trimmedDraftDesc !== currentDesc) {
    changes.push('update description');
  }

  const currentAllowance = resolveGroupAllowanceMinutes(group);
  if (draft.allowanceMinutes !== currentAllowance) {
    changes.push(`allowance ${currentAllowance} → ${draft.allowanceMinutes} min`);
  }

  if (draft.cooldownMinutes !== group.cooldownMinutes) {
    changes.push(`cooldown ${group.cooldownMinutes} → ${draft.cooldownMinutes} min`);
  }

  const currentRecovery = resolveGroupRecoveryActivityId(group);
  if (draft.recoveryActivityId !== currentRecovery) {
    const activity = activities.find((a) => a.id === draft.recoveryActivityId);
    changes.push(`recovery activity → ${activity?.title ?? draft.recoveryActivityId}`);
  }

  const morningWindow = routineWindows.find(
    (w) => w.type === 'morning-buffer' || w.id === 'morning-buffer'
  );
  const currentMorning = morningWindow?.protectedGroupIds?.includes(group.id) ?? false;
  if (draft.morningProtected !== currentMorning) {
    changes.push(
      draft.morningProtected
        ? 'add Morning Buffer protection'
        : 'remove Morning Buffer protection'
    );
  }

  const eveningWindow = routineWindows.find(
    (w) => w.type === 'evening-wind-down' || w.id === 'evening-wind-down'
  );
  const currentEvening = eveningWindow?.protectedGroupIds?.includes(group.id) ?? false;
  if (draft.eveningProtected !== currentEvening) {
    changes.push(
      draft.eveningProtected
        ? 'add Evening Wind-Down protection'
        : 'remove Evening Wind-Down protection'
    );
  }

  return changes.length
    ? `Update ${group.name}: ${changes.join('; ')}`
    : `Update ${group.name}`;
}
