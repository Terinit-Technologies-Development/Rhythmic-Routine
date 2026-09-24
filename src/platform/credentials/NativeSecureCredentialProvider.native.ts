/**
 * Rhythmic Routine v1.1.0 — Native SecureStore Credential Provider
 * Uses expo-secure-store backed by Android Keystore and iOS Keychain.
 */

import * as SecureStore from 'expo-secure-store';
import type { AttemptState } from '../../domain/accountability/types';
import {
  SecureCredentialProvider,
  createCredentialRecord,
  verifyCredentialRecord,
} from '../SecureCredentialProvider';

const CREDENTIAL_KEY_PREFIX = 'rr_sec_cred_';
const APPROVAL_ATTEMPT_KEY_PREFIX = 'rr_accountability_attempt_';

export class NativeSecureCredentialProvider implements SecureCredentialProvider {
  async create(ref: string, password: string): Promise<void> {
    const record = await createCredentialRecord(password);
    await SecureStore.setItemAsync(
      `${CREDENTIAL_KEY_PREFIX}${ref}`,
      JSON.stringify(record)
    );
  }

  async verify(ref: string, password: string): Promise<boolean> {
    const raw = await SecureStore.getItemAsync(`${CREDENTIAL_KEY_PREFIX}${ref}`);
    if (!raw) return false;
    try {
      const record = JSON.parse(raw);
      return await verifyCredentialRecord(password, record);
    } catch {
      return false;
    }
  }

  async remove(ref: string): Promise<void> {
    await SecureStore.deleteItemAsync(`${CREDENTIAL_KEY_PREFIX}${ref}`);
  }

  async loadApprovalAttemptState(partnerId: string): Promise<AttemptState | null> {
    const raw = await SecureStore.getItemAsync(`${APPROVAL_ATTEMPT_KEY_PREFIX}${partnerId}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<AttemptState>;
      if (!Number.isInteger(parsed.failures) || (parsed.failures ?? -1) < 0) return null;
      if (parsed.lockedUntil !== undefined && !Number.isFinite(parsed.lockedUntil)) return null;
      return {
        failures: parsed.failures as number,
        lockedUntil: parsed.lockedUntil,
      };
    } catch {
      return null;
    }
  }

  async saveApprovalAttemptState(partnerId: string, state: AttemptState | null): Promise<void> {
    const key = `${APPROVAL_ATTEMPT_KEY_PREFIX}${partnerId}`;
    if (!state || state.failures === 0) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    await SecureStore.setItemAsync(key, JSON.stringify(state));
  }

}
