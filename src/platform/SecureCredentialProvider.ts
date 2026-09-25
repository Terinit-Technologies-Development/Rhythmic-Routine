/**
 * Rhythmic Routine v1.1.0 — Accountability Core & Secure Authorization
 * Secure Credential Provider Interface & PBKDF2 Implementation
 */

import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
  randomBytes,
} from '@noble/hashes/utils.js';
import type { AttemptState } from '../domain/accountability/types';

export const PBKDF2_ITERATIONS = 150_000;
export const PBKDF2_KEY_LENGTH = 32;

export interface CredentialRecord {
  saltHex: string;
  verifierHex: string;
  iterations: number;
  algorithm: 'pbkdf2-sha256';
}

export interface SecureCredentialProvider {
  create(ref: string, password: string): Promise<void>;
  verify(ref: string, password: string): Promise<boolean>;
  remove(ref: string): Promise<void>;
  loadApprovalAttemptState?(partnerId: string): Promise<AttemptState | null>;
  saveApprovalAttemptState?(partnerId: string, state: AttemptState | null): Promise<void>;
}

/**
 * Constant-time byte array equality check to prevent timing attacks.
 */
export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Derives verifier bytes from password and salt using PBKDF2-HMAC-SHA256.
 */
export async function deriveVerifier(
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS
): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8ToBytes(password), salt, {
    c: iterations,
    dkLen: PBKDF2_KEY_LENGTH,
  });
}

/**
 * Computes a verifier record for a password and its caller-provided secure random salt.
 */
export async function createCredentialRecord(password: string, salt: Uint8Array): Promise<CredentialRecord> {
  const verifier = await deriveVerifier(password, salt, PBKDF2_ITERATIONS);
  return {
    saltHex: bytesToHex(salt),
    verifierHex: bytesToHex(verifier),
    iterations: PBKDF2_ITERATIONS,
    algorithm: 'pbkdf2-sha256',
  };
}

/**
 * Verifies candidate password against stored salt and verifier in constant time.
 */
export async function verifyCredentialRecord(
  password: string,
  record: CredentialRecord
): Promise<boolean> {
  if (!record || record.algorithm !== 'pbkdf2-sha256') {
    return false;
  }
  try {
    const salt = hexToBytes(record.saltHex);
    const expectedVerifier = hexToBytes(record.verifierHex);
    const computedVerifier = await deriveVerifier(password, salt, record.iterations);
    return constantTimeEquals(computedVerifier, expectedVerifier);
  } catch {
    return false;
  }
}

/**
 * In-memory secure credential provider implementation.
 * Used for testing, web environment, and node runtime.
 */
export class InMemorySecureCredentialProvider implements SecureCredentialProvider {
  private store = new Map<string, string>();
  private approvalAttempts = new Map<string, AttemptState>();

  async create(ref: string, password: string): Promise<void> {
    const record = await createCredentialRecord(password, randomBytes(16));
    this.store.set(ref, JSON.stringify(record));
  }

  async verify(ref: string, password: string): Promise<boolean> {
    const raw = this.store.get(ref);
    if (!raw) return false;
    try {
      const record = JSON.parse(raw);
      return await verifyCredentialRecord(password, record);
    } catch {
      return false;
    }
  }

  async remove(ref: string): Promise<void> {
    this.store.delete(ref);
  }

  async loadApprovalAttemptState(partnerId: string): Promise<AttemptState | null> {
    const state = this.approvalAttempts.get(partnerId);
    return state ? { ...state } : null;
  }

  async saveApprovalAttemptState(partnerId: string, state: AttemptState | null): Promise<void> {
    if (state) this.approvalAttempts.set(partnerId, { ...state });
    else this.approvalAttempts.delete(partnerId);
  }

  /**
   * Helper for tests to inspect if credential exists without revealing verifier.
   */
  has(ref: string): boolean {
    return this.store.has(ref);
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
    this.approvalAttempts.clear();
  }
}
