/**
 * Rhythmic Routine v1.1.0 — Accountability Core & Secure Authorization
 * Domain Types
 */

import {
  AppClassification,
  CreateRiskGroupInput,
  RiskGroupConfigurationDraft,
  RoutineWindow,
} from '../../types/domain';

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
  | 'edit-routine-schedule'
  | 'start-access-lease'
  | 'reset-local-state'
  | 'enable-accountability'
  | 'disable-accountability'
  | 'manage-accountability-partner'
  | 'edit-ios-risk-group-selection';

export type ApprovalFailureReason =
  | 'invalid-password'
  | 'rate-limited'
  | 'partner-not-found'
  | 'partner-disabled'
  | 'no-enabled-partners'
  | 'verification-unavailable'
  | 'approval-expired';

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

export interface AppPolicyPayload {
  appId: string;
  classification: AppClassification;
  riskGroupId?: string;
  dailyAllowanceMinutes?: number;
}

export interface RiskGroupEditPayload {
  groupId: string;
  draft: RiskGroupConfigurationDraft;
}

export interface DeleteRiskGroupPayload {
  groupId: string;
  replacementGroupId?: string;
}

export interface AccessLeasePayload {
  groupId: string;
  durationMinutes: number;
}

export interface GroupProtectionEditPayload {
  windowId: string;
  groupId: string;
  enabled: boolean;
}

export interface DailyAllowanceEditPayload {
  groupId: string;
  allowanceMinutes: number;
}

export interface IOSSelectionEditPayload {
  groupId: string;
  stagedSelectionRef: string;
  tokenCount: number;
}

export interface RoutineScheduleEditPayload {
  routineWindows: RoutineWindow[];
}

export type ProtectedMutation =
  | {
      operation: 'change-app-classification';
      summary: string;
      payload: AppPolicyPayload;
    }
  | {
      operation: 'change-daily-allowance';
      summary: string;
      payload: DailyAllowanceEditPayload;
    }
  | {
      operation: 'create-risk-group';
      summary: string;
      payload: CreateRiskGroupInput;
    }
  | {
      operation: 'edit-risk-group';
      summary: string;
      payload: RiskGroupEditPayload;
    }
  | {
      operation: 'delete-risk-group';
      summary: string;
      payload: DeleteRiskGroupPayload;
    }
  | {
      operation: 'edit-risk-group-protection';
      summary: string;
      payload: GroupProtectionEditPayload;
    }
  | {
      operation: 'edit-routine-schedule';
      summary: string;
      payload: RoutineScheduleEditPayload;
    }
  | {
      operation: 'start-access-lease';
      summary: string;
      payload: AccessLeasePayload;
    }
  | {
      operation: 'reset-local-state';
      summary: string;
      payload: Record<string, unknown>;
    }
  | {
      operation: 'enable-accountability';
      summary: string;
      payload: Record<string, unknown>;
    }
  | {
      operation: 'disable-accountability';
      summary: string;
      payload: Record<string, unknown>;
    }
  | {
      operation: 'manage-accountability-partner';
      summary: string;
      payload: ManagePartnerMutationPayload;
    }
  | {
      operation: 'edit-ios-risk-group-selection';
      summary: string;
      payload: IOSSelectionEditPayload;
    };

export interface PendingApproval<TPayload = unknown> {
  id: string;
  operation: AccountabilityOperation;
  summary: string;
  payload: TPayload;
  requestedAt: number;
  /** Execution-time stale-state check, captured when the request is created. */
  authorizationSnapshot?: string;
  accountabilityEnabledAtRequest?: boolean;
}

export interface AttemptState {
  failures: number;
  lockedUntil?: number;
}
