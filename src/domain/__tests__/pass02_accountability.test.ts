import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as storeModule from '../../store/usePrototypeStore';
import {
  usePrototypeStore,
  __getTransientSecretCountForTests,
} from '../../store/usePrototypeStore';
import {
  requiresPartnerApproval,
  validatePartnerPassword,
  getEnabledPartners,
  PROTECTED_OPERATIONS,
} from '../accountability/policy';
import {
  getAccountabilityService,
  resetAccountabilityService,
  RATE_LIMIT_LOCKOUT_MS,
} from '../../application/AccountabilityService';
import { getPlatformServices } from '../../platform/PlatformServices';
import {
  createCredentialRecord,
  InMemorySecureCredentialProvider,
  verifyCredentialRecord,
} from '../../platform/SecureCredentialProvider';
import { RhythmCoordinator } from '../../application/RhythmCoordinator';
import { bytesToHex } from '@noble/hashes/utils.js';

describe('Pass 02 — Accountability Core & Secure Authorization', () => {
  beforeEach(async () => {
    // Reset credentials and service state
    const { credentials } = getPlatformServices();
    if (credentials instanceof InMemorySecureCredentialProvider) {
      credentials.clear();
    }
    resetAccountabilityService();
    usePrototypeStore.getState().cancelPendingApproval();
    usePrototypeStore.setState({ accountability: { enabled: false, partners: [] } });
    await usePrototypeStore.getState().resetDemo();
  });

  test('native credential records accept platform-generated secure salts', async () => {
    const password = 'credential-regression-password';
    const platformSalt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const record = await createCredentialRecord(password, platformSalt);

    assert.equal(record.saltHex, bytesToHex(platformSalt));
    assert.equal(record.iterations, 150_000);
    assert.equal(await verifyCredentialRecord(password, record), true);
    assert.equal(await verifyCredentialRecord('incorrect-password', record), false);
  });

  test('1. mode defaults OFF after initialization/migration', () => {
    const state = usePrototypeStore.getState();
    assert.ok(state.accountability);
    assert.equal(state.accountability.enabled, false);
    assert.deepEqual(state.accountability.partners, []);
    assert.equal(state.pendingApproval, null);
  });

  test('2. partner metadata persistence and schema integrity', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Sarah Connor',
      relationshipLabel: 'Spouse',
      password: 'partner-secret-pass-123',
    });

    assert.ok(partner.id);
    assert.equal(partner.name, 'Sarah Connor');
    assert.equal(partner.relationshipLabel, 'Spouse');
    assert.equal(partner.enabled, true);
    assert.ok(partner.createdAt > 0);

    // Verify stored in Zustand
    const state = usePrototypeStore.getState();
    assert.equal(state.accountability.partners.length, 1);
    assert.equal(state.accountability.partners[0].id, partner.id);

    // Verify stored in storage preferences
    const { storage } = getPlatformServices();
    const prefs = await storage.loadPreferences();
    assert.ok(prefs?.accountability);
    assert.equal(prefs?.accountability.partners.length, 1);
    assert.equal(prefs?.accountability.partners[0].name, 'Sarah Connor');
  });

  test('3. zero plaintext password exposure in metadata, preferences, and pending approvals', async () => {
    const store = usePrototypeStore.getState();
    const secret = 'ultra-secret-pin-789';

    const partner = await store.createAccountabilityPartner({
      name: 'John Doe',
      password: secret,
    });

    // Partner metadata must never contain password/verifier/salt
    const partnerObj = partner as any;
    assert.equal(partnerObj.password, undefined);
    assert.equal(partnerObj.verifier, undefined);
    assert.equal(partnerObj.salt, undefined);

    // Check stored preferences
    const { storage } = getPlatformServices();
    const prefs = await storage.loadPreferences();
    const serialized = JSON.stringify(prefs);
    assert.equal(serialized.includes(secret), false);

    // Enable mode and check pending approval object
    await store.enableAccountability(partner.id, secret);
    await store.requestProtectedMutation({
      operation: 'change-daily-allowance',
      summary: 'Change allowance to 45m',
      payload: { groupId: 'social', allowanceMinutes: 45 },
    });

    const pending = usePrototypeStore.getState().pendingApproval;
    assert.ok(pending);
    const serializedPending = JSON.stringify(pending);
    assert.equal(serializedPending.includes(secret), false);
    assert.equal((pending as any).password, undefined);
  });

  test('4. correct password verifies successfully', async () => {
    const service = getAccountabilityService();
    const partner = await service.createPartner({
      name: 'Alex',
      password: 'correct-horse-battery',
    });

    const result = await service.verifyApproval(
      { operation: 'disable-accountability', summary: 'Disable mode', partnerId: partner.id },
      'correct-horse-battery',
      partner
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.partnerId, partner.id);
    }
  });

  test('5. wrong password fails with invalid-password and decrements remaining attempts', async () => {
    const service = getAccountabilityService();
    const partner = await service.createPartner({
      name: 'Alex',
      password: 'correct-password-99',
    });

    const result = await service.verifyApproval(
      { operation: 'disable-accountability', summary: 'Disable mode', partnerId: partner.id },
      'wrong-password',
      partner
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'invalid-password');
      assert.equal(result.remainingAttempts, 4);
    }
  });

  test('6. 5 consecutive failures triggers 60s lockout rate limiting', async () => {
    const service = getAccountabilityService();
    const partner = await service.createPartner({
      name: 'Alex',
      password: 'super-secure-pass',
    });

    // 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      const res = await service.verifyApproval(
        { operation: 'disable-accountability', summary: 'Disable mode', partnerId: partner.id },
        `bad-pw-${i}`,
        partner
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reason, 'invalid-password');
        assert.equal(res.remainingAttempts, 5 - i);
      }
    }

    // 5th failed attempt -> locks out
    const fifthRes = await service.verifyApproval(
      { operation: 'disable-accountability', summary: 'Disable mode', partnerId: partner.id },
      'bad-pw-5',
      partner
    );
    assert.equal(fifthRes.ok, false);
    if (!fifthRes.ok) {
      assert.equal(fifthRes.reason, 'rate-limited');
      assert.ok(fifthRes.lockoutEndsAt && fifthRes.lockoutEndsAt > Date.now());
    }

    // Immediate subsequent attempt (even with correct password) must be rejected with rate-limited
    const duringLockout = await service.verifyApproval(
      { operation: 'disable-accountability', summary: 'Disable mode', partnerId: partner.id },
      'super-secure-pass',
      partner
    );
    assert.equal(duringLockout.ok, false);
    if (!duringLockout.ok) {
      assert.equal(duringLockout.reason, 'rate-limited');
    }
  });

  test('7. successful verification resets failed attempt count', async () => {
    const service = getAccountabilityService();
    const partner = await service.createPartner({
      name: 'Alex',
      password: 'my-valid-password',
    });

    // 3 failures
    await service.verifyApproval({ operation: 'reset-local-state', summary: 'Reset', partnerId: partner.id }, 'bad1', partner);
    await service.verifyApproval({ operation: 'reset-local-state', summary: 'Reset', partnerId: partner.id }, 'bad2', partner);
    await service.verifyApproval({ operation: 'reset-local-state', summary: 'Reset', partnerId: partner.id }, 'bad3', partner);

    // 1 success
    const success = await service.verifyApproval(
      { operation: 'reset-local-state', summary: 'Reset', partnerId: partner.id },
      'my-valid-password',
      partner
    );
    assert.equal(success.ok, true);

    // Next failure should start fresh with remainingAttempts = 4
    const nextFail = await service.verifyApproval(
      { operation: 'reset-local-state', summary: 'Reset', partnerId: partner.id },
      'bad4',
      partner
    );
    assert.equal(nextFail.ok, false);
    if (!nextFail.ok) {
      assert.equal(nextFail.reason, 'invalid-password');
      assert.equal(nextFail.remainingAttempts, 4);
    }
  });

  test('7a. approval lockout survives service recreation through the credential provider', async () => {
    const service = getAccountabilityService();
    const partner = await service.createPartner({ name: 'Persistent lockout', password: 'persistent-pass' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.verifyApproval(
        { operation: 'disable-accountability', summary: 'Disable', partnerId: partner.id },
        'incorrect-password',
        partner
      );
    }

    resetAccountabilityService();
    const restartedService = getAccountabilityService();
    const afterRestart = await restartedService.verifyApproval(
      { operation: 'disable-accountability', summary: 'Disable', partnerId: partner.id },
      'persistent-pass',
      partner
    );
    assert.equal(afterRestart.ok, false);
    if (!afterRestart.ok) {
      assert.equal(afterRestart.reason, 'rate-limited');
      assert.ok(afterRestart.lockoutEndsAt && afterRestart.lockoutEndsAt > Date.now());
    }
  });

  test('7b. safe attempt state is partner-specific, survives restart, and permits retry after expiry', async () => {
    const service = getAccountabilityService();
    const lockedPartner = await service.createPartner({
      name: 'Locked partner',
      password: 'locked-partner-pass',
    });
    const otherPartner = await service.createPartner({
      name: 'Other partner',
      password: 'other-partner-pass',
    });

    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await service.verifyApproval(
          { operation: 'disable-accountability', summary: 'Disable', partnerId: lockedPartner.id },
          'incorrect-password',
          lockedPartner
        );
      }

      const credentials = getPlatformServices().credentials;
      assert.ok(credentials instanceof InMemorySecureCredentialProvider);
      assert.deepEqual(
        await credentials.loadApprovalAttemptState(lockedPartner.id),
        { failures: 5, lockedUntil: now + RATE_LIMIT_LOCKOUT_MS }
      );

      resetAccountabilityService();
      const restartedService = getAccountabilityService();
      const lockedState = await usePrototypeStore
        .getState()
        .getAccountabilityAttemptState(lockedPartner.id);
      const otherState = await usePrototypeStore
        .getState()
        .getAccountabilityAttemptState(otherPartner.id);

      assert.deepEqual(lockedState, { failures: 5, lockedUntil: now + RATE_LIMIT_LOCKOUT_MS });
      assert.deepEqual(otherState, { failures: 0 });
      assert.equal('credentialRef' in lockedState, false);

      const blockedRetry = await restartedService.verifyApproval(
        { operation: 'disable-accountability', summary: 'Disable', partnerId: lockedPartner.id },
        'locked-partner-pass',
        lockedPartner
      );
      assert.equal(blockedRetry.ok, false);
      if (!blockedRetry.ok) assert.equal(blockedRetry.reason, 'rate-limited');

      now += RATE_LIMIT_LOCKOUT_MS + 1;
      assert.deepEqual(
        await usePrototypeStore.getState().getAccountabilityAttemptState(lockedPartner.id),
        { failures: 0 }
      );

      const permittedRetry = await restartedService.verifyApproval(
        { operation: 'disable-accountability', summary: 'Disable', partnerId: lockedPartner.id },
        'locked-partner-pass',
        lockedPartner
      );
      assert.equal(permittedRetry.ok, true);
    } finally {
      Date.now = realNow;
    }
  });

  test('8. disabled partner cannot approve', async () => {
    const service = getAccountabilityService();
    const partner = await service.createPartner({
      name: 'Disabled Partner',
      password: 'password-12345',
    });
    const disabledPartner = service.updatePartnerMetadata(partner, { enabled: false });

    const result = await service.verifyApproval(
      { operation: 'disable-accountability', summary: 'Disable', partnerId: disabledPartner.id },
      'password-12345',
      disabledPartner
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'partner-disabled');
    }
  });

  test('9. mode cannot enable without at least one enabled partner', async () => {
    const store = usePrototypeStore.getState();

    // No partners at all
    const res1 = await store.enableAccountability('non-existent-id', 'some-password');
    assert.equal(res1.ok, false);
    if (!res1.ok) {
      assert.equal(res1.reason, 'no-enabled-partners');
    }
    assert.equal(usePrototypeStore.getState().accountability.enabled, false);

    // Only disabled partner
    const partner = await store.createAccountabilityPartner({
      name: 'Inactive',
      password: 'password-123',
    });
    await store.updateAccountabilityPartner(partner.id, { enabled: false });

    const res2 = await store.enableAccountability(partner.id, 'password-123');
    assert.equal(res2.ok, false);
    if (!res2.ok) {
      assert.equal(res2.reason, 'no-enabled-partners');
    }
    assert.equal(usePrototypeStore.getState().accountability.enabled, false);
  });

  test('10. enabling mode requires verified partner password participation', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Partner 1',
      password: 'valid-password-789',
    });

    // Wrong password -> fails and mode stays disabled
    const failRes = await store.enableAccountability(partner.id, 'wrong-pass');
    assert.equal(failRes.ok, false);
    assert.equal(usePrototypeStore.getState().accountability.enabled, false);

    // Correct password -> succeeds and mode is enabled
    const okRes = await store.enableAccountability(partner.id, 'valid-password-789');
    assert.equal(okRes.ok, true);
    assert.equal(usePrototypeStore.getState().accountability.enabled, true);
  });

  test('11. disabling mode requires approval when active', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Partner 1',
      password: 'valid-password-789',
    });
    await store.enableAccountability(partner.id, 'valid-password-789');
    assert.equal(usePrototypeStore.getState().accountability.enabled, true);

    // Direct disable with wrong password fails
    const failRes = await store.disableAccountability(partner.id, 'wrong-password');
    assert.equal(failRes.ok, false);
    assert.equal(usePrototypeStore.getState().accountability.enabled, true);

    // Direct disable with correct password succeeds
    const okRes = await store.disableAccountability(partner.id, 'valid-password-789');
    assert.equal(okRes.ok, true);
    assert.equal(usePrototypeStore.getState().accountability.enabled, false);
  });

  test('12. cannot remove or disable the last enabled partner while mode is active', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Sole Partner',
      password: 'sole-partner-pass',
    });
    await store.enableAccountability(partner.id, 'sole-partner-pass');

    // Attempting to delete the sole active partner must be blocked
    await assert.rejects(
      async () => {
        await store.deleteAccountabilityPartner(partner.id);
      },
      /Cannot remove the last enabled partner/
    );

    // Attempting to disable the sole active partner must be blocked
    await assert.rejects(
      async () => {
        await store.updateAccountabilityPartner(partner.id, { enabled: false });
      },
      /Cannot disable the last enabled partner/
    );

    // Partner is still intact
    const state = usePrototypeStore.getState();
    assert.equal(state.accountability.partners.length, 1);
    assert.equal(state.accountability.partners[0].enabled, true);
  });

  test('13. pure policy matrix: requiresPartnerApproval()', () => {
    const disabledSettings = { enabled: false, partners: [] };
    const enabledSettings = { enabled: true, partners: [] };

    // When mode is OFF: only enable-accountability requires partner approval
    assert.equal(requiresPartnerApproval(disabledSettings, 'enable-accountability'), true);
    for (const op of PROTECTED_OPERATIONS) {
      if (op !== 'enable-accountability') {
        assert.equal(requiresPartnerApproval(disabledSettings, op), false);
      }
    }

    // When mode is ON: ALL protected operations require partner approval
    for (const op of PROTECTED_OPERATIONS) {
      assert.equal(requiresPartnerApproval(enabledSettings, op), true);
    }
  });

  test('14. protected mutation gateway: bypasses when OFF, queues pending approval when ON, dispatches executor on approval', async () => {
    const store = usePrototypeStore.getState();

    // 1. When mode is OFF: executes immediately
    const resultOff = await store.requestProtectedMutation({
      operation: 'change-daily-allowance',
      summary: 'Change allowance to 45m',
      payload: { groupId: 'social', allowanceMinutes: 45 },
    });

    assert.equal(resultOff.status, 'executed');
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
    assert.equal(
      usePrototypeStore.getState().riskGroups.find((g) => g.id === 'social')?.allowanceMinutes,
      45
    );

    // 2. Set up partner and enable mode
    const partner = await store.createAccountabilityPartner({
      name: 'Gate Partner',
      password: 'gateway-password-1',
    });
    await store.enableAccountability(partner.id, 'gateway-password-1');
    assert.equal(usePrototypeStore.getState().accountability.enabled, true);

    // 3. When mode is ON: queues pending approval
    const resultOn = await store.requestProtectedMutation({
      operation: 'change-daily-allowance',
      summary: 'Increase allowance to 60m',
      payload: { groupId: 'entertainment', allowanceMinutes: 60 },
    });

    assert.equal(resultOn.status, 'pending-approval');
    assert.ok(usePrototypeStore.getState().pendingApproval);
    assert.equal(usePrototypeStore.getState().pendingApproval?.operation, 'change-daily-allowance');
    // Allowance should still be 45 (not executed yet)
    assert.equal(
      usePrototypeStore.getState().riskGroups.find((g) => g.id === 'entertainment')?.allowanceMinutes,
      45
    );

    // 4. Failed approval leaves mutation pending and unexecuted
    const failApprove = await store.approveProtectedMutation(partner.id, 'wrong-password');
    assert.equal(failApprove.ok, false);
    assert.ok(usePrototypeStore.getState().pendingApproval);
    assert.equal(
      usePrototypeStore.getState().riskGroups.find((g) => g.id === 'entertainment')?.allowanceMinutes,
      45
    );

    // 5. Successful approval runs executor and clears pending approval
    const okApprove = await store.approveProtectedMutation(partner.id, 'gateway-password-1');
    assert.equal(okApprove.ok, true);
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
    assert.equal(
      usePrototypeStore.getState().riskGroups.find((g) => g.id === 'entertainment')?.allowanceMinutes,
      60
    );

    // 6. Cancellation clears pending approval without executing
    await store.requestProtectedMutation({
      operation: 'change-daily-allowance',
      summary: 'Change allowance to 90m',
      payload: { groupId: 'entertainment', allowanceMinutes: 90 },
    });
    assert.ok(usePrototypeStore.getState().pendingApproval);

    store.cancelPendingApproval();
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
    assert.equal(
      usePrototypeStore.getState().riskGroups.find((g) => g.id === 'entertainment')?.allowanceMinutes,
      60
    );
  });

  test('15. password validation rules', () => {
    assert.equal(validatePartnerPassword('').valid, false);
    assert.equal(validatePartnerPassword('   ').valid, false);
    assert.equal(validatePartnerPassword('12345').valid, false); // < 6 chars
    assert.equal(validatePartnerPassword('123456').valid, true); // exactly 6
    assert.equal(validatePartnerPassword('strong-password-pin').valid, true);
  });

  test('16. getEnabledPartners filters active partners', () => {
    const settings = {
      enabled: true,
      partners: [
        { id: '1', name: 'A', credentialRef: 'c1', enabled: true, createdAt: 1, updatedAt: 1 },
        { id: '2', name: 'B', credentialRef: 'c2', enabled: false, createdAt: 2, updatedAt: 2 },
        { id: '3', name: 'C', credentialRef: 'c3', enabled: true, createdAt: 3, updatedAt: 3 },
      ],
    };
    const enabled = getEnabledPartners(settings);
    assert.equal(enabled.length, 2);
    assert.deepEqual(enabled.map((p) => p.id), ['1', '3']);
  });

  test('17. raw executor APIs and transient secret vault functions are not public', () => {
    const store = usePrototypeStore.getState() as any;
    assert.equal(store.executeProtectedMutation, undefined);
    assert.equal(store.registerMutationExecutor, undefined);

    // Module export audit: transient vault operations must be module-private
    assert.equal((storeModule as any).consumeTransientSecret, undefined);
    assert.equal((storeModule as any).createTransientSecretRef, undefined);
    assert.equal((storeModule as any).deleteTransientSecret, undefined);
    assert.equal((storeModule as any).__clearTransientSecretsForTests, undefined);
  });

  test('18. partner creation password never enters pending state', async () => {
    const store = usePrototypeStore.getState();
    const p1 = await store.createAccountabilityPartner({
      name: 'Partner 1',
      password: 'password-123456',
    });
    await store.enableAccountability(p1.id, 'password-123456');

    const secret = 'brand-new-partner-secret';
    await store.createAccountabilityPartner({
      name: 'Partner 2',
      password: secret,
    });

    const pending = usePrototypeStore.getState().pendingApproval;
    assert.ok(pending);
    const serialized = JSON.stringify(pending);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes('password'), false);
  });

  test('19. replacement password never enters pending state', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Sole Partner',
      password: 'initial-password-1',
    });
    await store.enableAccountability(partner.id, 'initial-password-1');

    const secret = 'replacement-super-secret';
    await store.replaceAccountabilityPartnerPassword(partner.id, secret);

    const pending = usePrototypeStore.getState().pendingApproval;
    assert.ok(pending);
    assert.equal(JSON.stringify(pending).includes(secret), false);
  });

  test('20. cancellation clears transient secret', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Sole Partner',
      password: 'initial-password-1',
    });
    await store.enableAccountability(partner.id, 'initial-password-1');

    await store.replaceAccountabilityPartnerPassword(partner.id, 'replacement-pw-secret');
    assert.equal(__getTransientSecretCountForTests(), 1);

    store.cancelPendingApproval();
    assert.equal(usePrototypeStore.getState().pendingApproval, null);
    assert.equal(__getTransientSecretCountForTests(), 0);
  });

  test('21. failed protected partner creation removes credential', async () => {
    const store = usePrototypeStore.getState();
    const p1 = await store.createAccountabilityPartner({
      name: 'Partner 1',
      password: 'initial-password-1',
    });
    await store.enableAccountability(p1.id, 'initial-password-1');

    const { credentials } = getPlatformServices();
    const initialCredentialCount = credentials instanceof InMemorySecureCredentialProvider ? credentials.size : 0;

    await store.createAccountabilityPartner({
      name: 'Partner 2',
      password: 'candidate-password-2',
    });

    // Mock coordinator updateConfig to fail
    const coordinator = RhythmCoordinator.getInstance();
    const originalUpdate = coordinator.updateConfig.bind(coordinator);
    coordinator.updateConfig = async () => {
      throw new Error('Disk failure');
    };

    try {
      await assert.rejects(
        async () => {
          await store.approveProtectedMutation(p1.id, 'initial-password-1');
        },
        /Disk failure/
      );

      // Verify rollback
      const state = usePrototypeStore.getState();
      assert.equal(state.accountability.partners.length, 1);
      assert.equal(state.accountability.partners[0].id, p1.id);
      assert.equal(state.pendingApproval, null);
      assert.equal(__getTransientSecretCountForTests(), 0);

      if (credentials instanceof InMemorySecureCredentialProvider) {
        assert.equal(credentials.size, initialCredentialCount);
      }
    } finally {
      coordinator.updateConfig = originalUpdate;
    }
  });

  test('22. failed direct partner creation removes credential', async () => {
    const store = usePrototypeStore.getState();
    const { credentials } = getPlatformServices();
    const initialCredentialCount = credentials instanceof InMemorySecureCredentialProvider ? credentials.size : 0;

    const coordinator = RhythmCoordinator.getInstance();
    const originalUpdate = coordinator.updateConfig.bind(coordinator);
    coordinator.updateConfig = async () => {
      throw new Error('Database locked');
    };

    try {
      await assert.rejects(
        async () => {
          await store.createAccountabilityPartner({
            name: 'Doomed Partner',
            password: 'doomed-password-1',
          });
        },
        /Database locked/
      );

      const state = usePrototypeStore.getState();
      assert.equal(state.accountability.partners.length, 0);
      if (credentials instanceof InMemorySecureCredentialProvider) {
        assert.equal(credentials.size, initialCredentialCount);
      }
    } finally {
      coordinator.updateConfig = originalUpdate;
    }
  });

  test('23. failed metadata removal does not delete credential first', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Partner To Keep',
      password: 'partner-password-abc',
    });

    const coordinator = RhythmCoordinator.getInstance();
    const originalUpdate = coordinator.updateConfig.bind(coordinator);
    coordinator.updateConfig = async () => {
      throw new Error('Storage write failed');
    };

    try {
      await assert.rejects(
        async () => {
          await store.deleteAccountabilityPartner(partner.id);
        },
        /Storage write failed/
      );

      // Partner still in metadata
      const state = usePrototypeStore.getState();
      assert.equal(state.accountability.partners.length, 1);
      assert.equal(state.accountability.partners[0].id, partner.id);

      // Credential still verifies
      const service = getAccountabilityService();
      const verifyRes = await service.verifyApproval(
        { operation: 'disable-accountability', summary: 'test', partnerId: partner.id },
        'partner-password-abc',
        partner
      );
      assert.equal(verifyRes.ok, true);
    } finally {
      coordinator.updateConfig = originalUpdate;
    }
  });

  test('24. successful partner deletion removes metadata then credential', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Partner To Delete',
      password: 'partner-password-xyz',
    });

    await store.deleteAccountabilityPartner(partner.id);

    // Removed from store and storage
    const state = usePrototypeStore.getState();
    assert.equal(state.accountability.partners.length, 0);

    const { storage } = getPlatformServices();
    const prefs = await storage.loadPreferences();
    assert.equal(prefs?.accountability?.partners.length, 0);

    // Credential no longer verifies
    const service = getAccountabilityService();
    const verifyRes = await service.verifyApproval(
      { operation: 'disable-accountability', summary: 'test', partnerId: partner.id },
      'partner-password-xyz',
      partner
    );
    assert.equal(verifyRes.ok, false);
  });

  test('25. pending operation cannot be overwritten', async () => {
    const store = usePrototypeStore.getState();
    const partner = await store.createAccountabilityPartner({
      name: 'Partner 1',
      password: 'password-123456',
    });
    await store.enableAccountability(partner.id, 'password-123456');

    // Queue operation 1
    const res1 = await store.requestProtectedMutation({
      operation: 'change-daily-allowance',
      summary: 'Change allowance to 60m',
      payload: { groupId: 'social', allowanceMinutes: 60 },
    });
    assert.equal(res1.status, 'pending-approval');
    const firstPending = usePrototypeStore.getState().pendingApproval;
    assert.ok(firstPending);
    assert.equal(firstPending.operation, 'change-daily-allowance');

    // Attempt operation 2 -> must reject
    await assert.rejects(
      async () => {
        await store.requestProtectedMutation({
          operation: 'reset-local-state',
          summary: 'Reset state',
          payload: {},
        });
      },
      /already awaiting approval/
    );

    // First pending operation remains unchanged
    const currentPending = usePrototypeStore.getState().pendingApproval;
    assert.equal(currentPending?.id, firstPending.id);
    assert.equal(currentPending?.operation, 'change-daily-allowance');
  });
});
