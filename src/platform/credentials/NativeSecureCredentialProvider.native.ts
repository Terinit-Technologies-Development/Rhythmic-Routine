/**
 * Rhythmic Routine v1.1.0 — Native SecureStore Credential Provider
 * Uses expo-secure-store backed by Android Keystore and iOS Keychain.
 */

import * as SecureStore from 'expo-secure-store';
import {
  SecureCredentialProvider,
  createCredentialRecord,
  verifyCredentialRecord,
} from '../SecureCredentialProvider';

const CREDENTIAL_KEY_PREFIX = 'rr_sec_cred_';

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
}
