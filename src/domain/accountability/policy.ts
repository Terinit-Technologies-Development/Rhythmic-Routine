/**
 * Rhythmic Routine v1.1.0 — Accountability Core & Secure Authorization
 * Central Policy & Validation Helpers
 */

import {
  AccountabilityOperation,
  AccountabilityPartner,
  AccountabilitySettings,
} from './types';

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
