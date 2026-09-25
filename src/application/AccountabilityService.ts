/**
 * Rhythmic Routine v1.1.0 — Accountability Core & Secure Authorization
 * Accountability Service
 */

import {
  AccountabilityPartner,
  ApprovalRequest,
  ApprovalResult,
  AttemptState,
} from '../domain/accountability/types';
import { validatePartnerPassword } from '../domain/accountability/policy';
import { SecureCredentialProvider } from '../platform/SecureCredentialProvider';
import { getPlatformServices } from '../platform/PlatformServices';

export const MAX_CONSECUTIVE_FAILURES = 5;
export const RATE_LIMIT_LOCKOUT_MS = 60 * 1000; // 60 seconds

export class AccountabilityService {
  private attemptStateMap = new Map<string, AttemptState>();
  private hydratedAttemptIds = new Set<string>();

  constructor(
    private credentials: SecureCredentialProvider = getPlatformServices().credentials
  ) {}

  /**
   * Returns current attempt state for partner.
   * Auto-clears lockout if the lockout timestamp has elapsed.
   */
  public getAttemptState(partnerId: string): AttemptState {
    const state = this.attemptStateMap.get(partnerId);
    if (!state) {
      return { failures: 0 };
    }
    if (state.lockedUntil && Date.now() >= state.lockedUntil) {
      const cleared: AttemptState = { failures: 0 };
      this.attemptStateMap.set(partnerId, cleared);
      void this.credentials.saveApprovalAttemptState?.(partnerId, null).catch(() => {});
      return cleared;
    }
    return state;
  }

  /**
   * Records a failed password attempt and applies 60s lockout upon 5 consecutive failures.
   */
  private async recordFailure(partnerId: string): Promise<AttemptState> {
    const current = this.getAttemptState(partnerId);
    const failures = current.failures + 1;
    let lockedUntil: number | undefined = undefined;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      lockedUntil = Date.now() + RATE_LIMIT_LOCKOUT_MS;
    }
    const next: AttemptState = { failures, lockedUntil };
    this.attemptStateMap.set(partnerId, next);
    await this.credentials.saveApprovalAttemptState?.(partnerId, next);
    return next;
  }

  /**
   * Resets failed attempt counter upon successful password entry or partner removal.
   */
  public async resetAttempts(partnerId: string): Promise<void> {
    this.attemptStateMap.delete(partnerId);
    this.hydratedAttemptIds.add(partnerId);
    await this.credentials.saveApprovalAttemptState?.(partnerId, null);
  }

  private async hydrateAttemptState(partnerId: string): Promise<void> {
    if (this.hydratedAttemptIds.has(partnerId)) return;
    const saved = await this.credentials.loadApprovalAttemptState?.(partnerId);
    if (saved) this.attemptStateMap.set(partnerId, saved);
    this.hydratedAttemptIds.add(partnerId);
  }

  /**
   * Reads only the safe per-partner attempt counters used by the approval UI.
   * Persisted state is hydrated once and an expired lockout is durably cleared.
   */
  public async getPersistedAttemptState(partnerId: string): Promise<AttemptState> {
    await this.hydrateAttemptState(partnerId);
    const state = this.attemptStateMap.get(partnerId);
    if (state?.lockedUntil !== undefined && Date.now() >= state.lockedUntil) {
      await this.resetAttempts(partnerId);
      return { failures: 0 };
    }
    return state
      ? { failures: state.failures, lockedUntil: state.lockedUntil }
      : { failures: 0 };
  }

  /**
   * Verifies partner approval for an explicit operation.
   * Never stores or logs password.
   */
  public async verifyApproval(
    request: ApprovalRequest,
    password: string,
    partner?: AccountabilityPartner
  ): Promise<ApprovalResult> {
    if (!partner || partner.id !== request.partnerId) {
      return { ok: false, reason: 'partner-not-found' };
    }
    if (!partner.enabled) {
      return { ok: false, reason: 'partner-disabled' };
    }

    let state: AttemptState;
    try {
      state = await this.getPersistedAttemptState(partner.id);
    } catch {
      return { ok: false, reason: 'verification-unavailable' };
    }
    if (state.lockedUntil && Date.now() < state.lockedUntil) {
      return {
        ok: false,
        reason: 'rate-limited',
        lockoutEndsAt: state.lockedUntil,
      };
    }

    let valid: boolean;
    try {
      valid = await this.credentials.verify(partner.credentialRef, password);
    } catch {
      return { ok: false, reason: 'verification-unavailable' };
    }
    if (valid) {
      try {
        await this.resetAttempts(partner.id);
      } catch {
        return { ok: false, reason: 'verification-unavailable' };
      }
      return { ok: true, partnerId: partner.id };
    }

    let updatedState: AttemptState;
    try {
      updatedState = await this.recordFailure(partner.id);
    } catch {
      return { ok: false, reason: 'verification-unavailable' };
    }
    if (updatedState.lockedUntil) {
      return {
        ok: false,
        reason: 'rate-limited',
        lockoutEndsAt: updatedState.lockedUntil,
      };
    }

    const remainingAttempts = Math.max(0, MAX_CONSECUTIVE_FAILURES - updatedState.failures);
    return {
      ok: false,
      reason: 'invalid-password',
      remainingAttempts,
    };
  }

  /**
   * Creates a new accountability partner with secure credential.
   * Invariant: Credential verifier is created in secure storage BEFORE
   * metadata is returned for persistence.
   */
  public async createPartner(params: {
    name: string;
    relationshipLabel?: string;
    password: string;
  }): Promise<AccountabilityPartner> {
    const validation = validatePartnerPassword(params.password);
    if (!validation.valid) {
      throw new Error(`Password validation failed: ${validation.reason}`);
    }

    const trimmedName = params.name.trim();
    if (!trimmedName) {
      throw new Error('Partner name is required');
    }

    const partnerId = `partner_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const credentialRef = `cred_${partnerId}`;

    // 1. Create secure credential first
    await this.credentials.create(credentialRef, params.password);

    const now = Date.now();
    return {
      id: partnerId,
      name: trimmedName,
      relationshipLabel: params.relationshipLabel?.trim() || undefined,
      credentialRef,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Updates partner metadata (name, relationshipLabel, enabled).
   */
  public updatePartnerMetadata(
    partner: AccountabilityPartner,
    updates: {
      name?: string;
      relationshipLabel?: string;
      enabled?: boolean;
    }
  ): AccountabilityPartner {
    const nextName = updates.name !== undefined ? updates.name.trim() : partner.name;
    if (!nextName) {
      throw new Error('Partner name cannot be empty');
    }

    return {
      ...partner,
      name: nextName,
      relationshipLabel:
        updates.relationshipLabel !== undefined
          ? updates.relationshipLabel.trim() || undefined
          : partner.relationshipLabel,
      enabled: updates.enabled !== undefined ? updates.enabled : partner.enabled,
      updatedAt: Date.now(),
    };
  }

  /**
   * Securely replaces a partner's password credential without exposing old or new values.
   */
  public async replacePartnerPassword(
    partner: AccountabilityPartner,
    newPassword: string
  ): Promise<AccountabilityPartner> {
    const validation = validatePartnerPassword(newPassword);
    if (!validation.valid) {
      throw new Error(`Password validation failed: ${validation.reason}`);
    }

    await this.credentials.create(partner.credentialRef, newPassword);
    await this.resetAttempts(partner.id);

    return {
      ...partner,
      updatedAt: Date.now(),
    };
  }

  /**
   * Removes secure credential material and clears attempt state.
   */
  public async removePartner(partner: AccountabilityPartner): Promise<void> {
    let removalError: unknown;
    try {
      await this.credentials.remove(partner.credentialRef);
    } catch (error) {
      removalError = error;
    }
    try {
      await this.resetAttempts(partner.id);
    } catch (error) {
      removalError ??= error;
    }
    if (removalError) throw removalError;
  }
}

let serviceInstance: AccountabilityService | null = null;

export function getAccountabilityService(): AccountabilityService {
  if (!serviceInstance) {
    serviceInstance = new AccountabilityService();
  }
  return serviceInstance;
}

export function resetAccountabilityService(): void {
  serviceInstance = new AccountabilityService();
}
