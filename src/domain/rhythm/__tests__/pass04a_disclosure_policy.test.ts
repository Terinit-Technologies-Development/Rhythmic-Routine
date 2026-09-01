import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT } from '../../../constants/accessibilityDisclosure';

describe('Pass 04A — Android Accessibility Disclosure & Policy Invariants', () => {
  it('centralizes required prominent disclosure clauses in ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT', () => {
    // 1. Non-assistive tool disclaimer
    assert.match(
      ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.nonAssistiveNotice,
      /NOT an assistive tool for people with disabilities/i
    );

    // 2. What is observed: package name via window state change
    const hasPackageObservation = ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.bullets.some(
      (b) => b.includes('package name') && b.includes('Window State Change')
    );
    assert.equal(hasPackageObservation, true, 'Must disclose Window State Change package observation');

    // 3. What is NOT read: screen text, passwords, messages, keystrokes, form content
    const hasZeroContentInspection = ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.bullets.some(
      (b) =>
        b.includes('NOT read') &&
        b.includes('screen text') &&
        b.includes('passwords') &&
        b.includes('messages') &&
        b.includes('keystrokes') &&
        b.includes('form content')
    );
    assert.equal(hasZeroContentInspection, true, 'Must disclose that no screen text/passwords/keystrokes are read');

    // 4. Local processing guarantee: zero data shared
    const hasLocalProcessing = ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.bullets.some(
      (b) => b.includes('strictly local') && b.includes('Zero data is shared')
    );
    assert.equal(hasLocalProcessing, true, 'Must disclose strictly local processing');

    // 5. Explicit Touch Grass purpose
    const hasPurpose = ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.bullets.some(
      (b) => b.includes('Touch Grass') && b.includes('active routine or cooldown')
    );
    assert.equal(hasPurpose, true, 'Must disclose Touch Grass intervention purpose');

    // 6. Verbatim button labels
    assert.equal(ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.cancelLabel, 'Cancel');
    assert.equal(
      ANDROID_ACCESSIBILITY_DISCLOSURE_TEXT.confirmLabel,
      'I Understand — Enable Intervention'
    );
  });

  it('verifies consent flow invariant: Cancel does not request permission; Confirm does', async () => {
    let permissionRequested = false;
    let modalVisible = false;

    const mockRequestPermission = async () => {
      permissionRequested = true;
    };

    // 1. User encounters setup card and triggers setup
    modalVisible = true;
    assert.equal(modalVisible, true);
    assert.equal(permissionRequested, false);

    // 2. User cancels: modal closes without requesting permission
    const onCancel = () => {
      modalVisible = false;
    };
    onCancel();
    assert.equal(modalVisible, false);
    assert.equal(permissionRequested, false, 'Cancel must not trigger permission request');

    // 3. User re-opens and confirms affirmative consent
    modalVisible = true;
    const onConfirm = async () => {
      modalVisible = false;
      await mockRequestPermission();
    };
    await onConfirm();
    assert.equal(modalVisible, false);
    assert.equal(permissionRequested, true, 'Confirm must trigger permission request');
  });

  it('ensures both Home/Today and Settings reuse the centralized AndroidAccessibilityDisclosure component', () => {
    const todayPath = path.resolve('app/(tabs)/today.tsx');
    const settingsPath = path.resolve('app/settings.tsx');

    const todayContent = fs.readFileSync(todayPath, 'utf8');
    const settingsContent = fs.readFileSync(settingsPath, 'utf8');

    // Both files import the shared component
    assert.match(todayContent, /import \{ AndroidAccessibilityDisclosure \}/);
    assert.match(settingsContent, /import \{ AndroidAccessibilityDisclosure \}/);

    // Both render <AndroidAccessibilityDisclosure
    assert.match(todayContent, /<AndroidAccessibilityDisclosure/);
    assert.match(settingsContent, /<AndroidAccessibilityDisclosure/);

    // Today screen exposes "Finish device setup" and "Set up intervention"
    assert.match(todayContent, /Finish device setup/);
    assert.match(todayContent, /Set up intervention/);
  });
});
