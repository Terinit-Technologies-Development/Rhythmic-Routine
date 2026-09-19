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
      return cleared;
    }
    return state;
  }

  /**
   * Records a failed password attempt and applies 60s lockout upon 5 consecutive failures.
   */
  public recordFailure(partnerId: string): AttemptState {
    const current = this.getAttemptState(partnerId);
    const failures = current.failures + 1;
    let lockedUntil: number | undefined = undefined;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      lockedUntil = Date.now() + RATE_LIMIT_LOCKOUT_MS;
    }
    const next: AttemptState = { failures, lockedUntil };
    this.attemptStateMap.set(partnerId, next);
    return next;
  }

  /**
   * Resets failed attempt counter upon successful password entry or partner removal.
   */
  public resetAttempts(partnerId: string): void {
    this.attemptStateMap.delete(partnerId);
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
    if (!partner) {
      return { ok: false, reason: 'partner-not-found' };
    }
    if (!partner.enabled) {
      return { ok: false, reason: 'partner-disabled' };
    }

    const state = this.getAttemptState(partner.id);
    if (state.lockedUntil && Date.now() < state.lockedUntil) {
      return {
        ok: false,
        reason: 'rate-limited',
        lockoutEndsAt: state.lockedUntil,
      };
    }

    const valid = await this.credentials.verify(partner.credentialRef, password);
    if (valid) {
      this.resetAttempts(partner.id);
      return { ok: true, partnerId: partner.id };
    }

    const updatedState = this.recordFailure(partner.id);
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
    this.resetAttempts(partner.id);

    return {
      ...partner,
      updatedAt: Date.now(),
    };
  }

  /**
   * Removes secure credential material and clears attempt state.
   */
  public async removePartner(partner: AccountabilityPartner): Promise<void> {
    await this.credentials.remove(partner.credentialRef);
    this.resetAttempts(partner.id);
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

