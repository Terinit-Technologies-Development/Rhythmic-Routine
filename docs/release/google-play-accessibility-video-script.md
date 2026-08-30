# Google Play Store Accessibility Declaration Video Demonstration Script

## Overview & Policy Requirement
Google Play requires a video demonstration showcasing the in-app prominent disclosure, user consent flow, Accessibility settings navigation, service activation, and the in-app behavior demonstrating the declared AccessibilityService functionality.

---

## Technical Recording Guidelines
- **Device:** Real physical Android device (or high-fidelity emulator if physical device unavailable).
- **Language:** English.
- **Display Settings:** Standard system font and display scaling; light mode recommended to highlight nature tones.
- **Recording Quality:** Minimum 1080p, 60fps, no edits or jump-cuts during the permission consent and system settings sequence.
- **Pacing:** Allow 2–3 seconds on disclosure text so Google Play reviewers can easily read the policy disclosure.

---

## Shot-by-Shot Demonstration Script

### Scene 1: App Launch & Initial State
- **Action:** Launch Rhythmic-Routine from the Android home launcher.
- **Visual:** Home screen loads showing current routine status (e.g., Morning Buffer Active or Available).
- **Callout / Caption:** "Rhythmic-Routine digital wellbeing app — Fresh installation state."

### Scene 2: Navigate to Settings & Verification of Initial Capability
- **Action:** Tap the Settings tab in the bottom navigation bar.
- **Visual:** Settings screen displays "Intervention Capability: Foundation-only (Setup Required)".
- **Callout / Caption:** "Intervention is disabled by default. Setup is required."

### Scene 3: Trigger Prominent In-App Disclosure
- **Action:** Tap "Enable Intervention (Accessibility)" button.
- **Visual:** The full-screen prominent disclosure modal appears cleanly over the interface.
- **Reviewer Note:** Pause for 3 seconds to permit reading. The modal clearly displays:
  - Non-assistive tool disclaimer.
  - WHAT is observed (active foreground package name via Window State Change).
  - WHAT is NOT observed (screen text, passwords, messages, forms).
  - Local-only data processing guarantee (no cloud, no accounts).

### Scene 4: Demonstration of Negative Consent (Cancel)
- **Action:** Tap the "Cancel" button.
- **Visual:** The modal immediately dismisses. The app remains on the Settings screen. The Android system Accessibility settings page is **NOT** opened.
- **Callout / Caption:** "Demonstrating voluntary consent: tapping Cancel does not open system settings."

### Scene 5: Re-Trigger & Affirmative Informed Consent
- **Action:** Tap "Enable Intervention (Accessibility)" again. Modal re-appears. Tap "I Understand — Enable Intervention".
- **Visual:** The app programmatically opens Android's system Accessibility Settings (`android.settings.ACCESSIBILITY_SETTINGS`).
- **Callout / Caption:** "Affirmative consent confirmed: routing user to system Accessibility settings."

### Scene 6: Enabling RhythmEnforcementService in Android Settings
- **Action:** User locates "Rhythmic-Routine" in the list of Downloaded / Installed Services, toggles the switch to ON, and accepts the standard Android OS security prompt.
- **Visual:** Service status flips to "On".
- **Callout / Caption:** "User explicitly enables RhythmEnforcementService."

### Scene 7: Return to Rhythm & Dynamic Capability Derivation
- **Action:** Press Back / navigate back to Rhythmic-Routine.
- **Visual:** Settings screen refreshes immediately: "Intervention Capability: Enforced".
- **Callout / Caption:** "App truthfully updates capability to 'Enforced' upon service binding."

### Scene 8: Configure a Risk Group App
- **Action:** Navigate to Rhythm tab. Under "Risk Groups", select or confirm a test app (e.g. Chrome / Social app) is assigned to the "Social" group with a low threshold (e.g., 1 minute) or trigger a manual cooldown for demonstration.

### Scene 9: Trigger Cooldown & Demonstrate Mindful Intervention ("Touch Grass")
- **Action:** Switch to the home screen and launch the restricted Risk App.
- **Visual:** As the restricted app window enters foreground, `RhythmEnforcementService` receives `TYPE_WINDOW_STATE_CHANGED`, identifies the package as restricted by cooldown, and presents the fullscreen `RhythmOverlayActivity` ("Touch Grass — Take a Mindful Break").
- **Callout / Caption:** "Foreground window detected: deterministic Touch Grass mindful reminder displayed."

### Scene 10: Essential Apps Invariant Demonstration
- **Action:** From the Touch Grass screen or home screen, launch the Phone (Dialer) app or Google Maps.
- **Visual:** The Phone / Maps app opens immediately with **zero** intervention or blocking.
- **Callout / Caption:** "Essential apps (Phone, Maps, Emergency) are strictly unblocked at all times."

---

## Submission Checklist for Play Console
- [ ] Video hosted as Unlisted YouTube link (or direct MP4 upload where permitted).
- [ ] Video covers entire unedited flow from initial state through Touch Grass intervention.
- [ ] Prominent disclosure text is clearly legible in recording.
- [ ] Script submitted alongside declaration text in Play Console Policy Declaration form.
