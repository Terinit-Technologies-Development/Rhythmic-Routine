# Pass 04 — Defect & Discrepancy Log

## Severity Classification Model
- **P0**: Security / data-loss / unsafe release blocker.
- **P1**: Core enforcement lifecycle broken or invariant violated.
- **P2**: Important release / policy / UX issue.
- **P3**: Minor polish / documentation / label alignment.

---

## Defects Log

### Defect DEF-04-01: Expo SDK 57 Dependency Drift & Expo Doctor Failure
- **Platform:** Cross-Platform Build / Expo Toolchain
- **Severity:** **P2** (Release Build & Dependency Validation)
- **Reproduction:**
  Run `npx expo-doctor` on merged `master` (`80c5c65`).
- **Expected:**
  All checks pass cleanly (21/21).
- **Actual:**
  20/21 passed, 1 check failed:
  - `@types/jest`: expected `29.5.14`, found `30.0.0` (Major version mismatch)
  - `expo`: expected `~57.0.18`, found `~57.0.17` (Patch mismatch)
  - `expo-constants`: expected `~57.0.16`, found `~57.0.15` (Patch mismatch)
- **Root Cause:**
  Subtle SDK-57 patch release drift on npm registry after initial project bootstrap, and `@types/jest` v30 installed when Expo SDK 57 targets Jest types v29.
- **Source Fix:**
  - Updated `package.json` with `npx expo install expo@~57.0.18 expo-constants@~57.0.16`.
  - Replaced `"@types/jest": "^30.0.0"` with `"@types/jest": "~29.5.14"`.
- **Verification:**
  - `npx expo-doctor` passed: **21/21 checks passed. No issues detected!**
  - `npx expo install --check`: **Dependencies are up to date.**
  - `npm test`: **79 / 79 passing.**
  - `npm run typecheck`: **0 errors.**
  - `npm run lint`: **0 errors, 0 warnings.**

---

### Defect DEF-04-02: Android Prominent Disclosure Dismiss Button Label Alignment
- **Platform:** Android
- **Severity:** **P3** (Store Policy & Disclosure Precision)
- **Reproduction:**
  Inspect `app/settings.tsx` lines 294–301 for the negative consent button on the Android Accessibility disclosure modal.
- **Expected:**
  The negative choice button is explicitly labeled **"Cancel"** to match Google Play Accessibility declaration requirements verbatim.
- **Actual:**
  The button was labeled `"Not Now"`.
- **Root Cause:**
  Informal placeholder copy during initial screen design.
- **Source Fix:**
  Updated `app/settings.tsx` button label to `<Text style={styles.cancelConsentText}>Cancel</Text>`.
- **Verification:**
  - Tapping "Cancel" dismisses modal cleanly without opening `android.settings.ACCESSIBILITY_SETTINGS`.
  - Text matches Google Play policy declaration and video script verbatim.

---

## Open Defect Summary
- **P0 Open:** 0
- **P1 Open:** 0
- **P2 Open:** 0
- **P3 Open:** 0
*(All identified defects resolved and verified on branch)*
