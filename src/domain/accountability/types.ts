/**
 * Rhythmic Routine v1.1.0 — Accountability Core & Secure Authorization
 * Domain Types
 */

export interface AccountabilityPartner {
  id: string;
  name: string;
  relationshipLabel?: string;
  credentialRef: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AccountabilitySettings {
  enabled: boolean;
  partners: AccountabilityPartner[];
}

export type AccountabilityOperation =
  | 'change-app-classification'
  | 'change-daily-allowance'
  | 'create-risk-group'
  | 'edit-risk-group'
  | 'delete-risk-group'
  | 'edit-risk-group-protection'
  | 'start-access-lease'
  | 'reset-local-state'
  | 'enable-accountability'
  | 'disable-accountability'
  | 'manage-accountability-partner';

export type ApprovalFailureReason =
  | 'invalid-password'
  | 'rate-limited'
  | 'partner-not-found'
  | 'partner-disabled'
  | 'no-enabled-partners';

export type ApprovalResult =
  | { ok: true; partnerId: string }
  | {
      ok: false;
      reason: ApprovalFailureReason;
      remainingAttempts?: number;
      lockoutEndsAt?: number;
    };

export interface ApprovalRequest {
  operation: AccountabilityOperation;
  summary: string;
  partnerId: string;
}

export type ManagePartnerMutationPayload =
  | {
      action: 'create';
      name: string;
      relationshipLabel?: string;
      secretRef: string;
    }
  | {
      action: 'update';
      partnerId: string;
      updates: {
        name?: string;
        relationshipLabel?: string;
        enabled?: boolean;
      };
    }
  | {
      action: 'remove';
      partnerId: string;
    }
  | {
      action: 'replace-password';
      partnerId: string;
      secretRef: string;
    };

export interface ProtectedMutation<TPayload = unknown> {
  operation: AccountabilityOperation;
  summary: string;
  payload: TPayload;
}

export interface PendingApproval<TPayload = unknown> {
  id: string;
  operation: AccountabilityOperation;
  summary: string;
  payload: TPayload;
  requestedAt: number;
}

export interface AttemptState {
  failures: number;
  lockedUntil?: number;
}
