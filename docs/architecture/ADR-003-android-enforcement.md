# ADR-003: Android Enforcement Architecture & Privacy Boundary

## Status
Accepted

## Context
Rhythmic-Routine is designed around digital rhythm rather than punitive daily screen-time limits. On Android, the application tracks risk group usage via `UsageStatsManager` (requiring `PACKAGE_USAGE_STATS` permission). However, when a risk group reaches its threshold or enters a routine focus window (Morning Buffer, Evening Wind-Down), the application needs an intervention surface to protect the user from compulsive scrolling.

We evaluated five architectural options for Android intervention:

1. **UsageStats Observation Only (Soft Notification / Banner)**
   * *Pros:* No additional privileged permissions required; simple.
   * *Cons:* Notification banners are easily dismissed or ignored when a user is in a compulsive scrolling loop; no real restriction boundary.

2. **AccessibilityService Window Observation (`TYPE_WINDOW_STATE_CHANGED`)**
   * *Pros:* Detects when a restricted package becomes foregrounded in real-time without polling loops; can immediately present a calm Touch Grass intervention screen; entirely local; user can enable/disable at any time.
   * *Cons:* Requires accessibility disclosure and affirmative user authorization in Android Settings; must strictly avoid inspecting screen content or text.

3. **SYSTEM_ALERT_WINDOW (System Overlay Activity)**
   * *Pros:* Can draw over foreground apps.
   * *Cons:* Android 10+ restricts starting activities from the background; requires heavy overlay permissions that modern Android versions restrict or flag.

4. **Device Owner / Enterprise Work Profile (MDM APIs)**
   * *Pros:* System-level application suspension (`setPackagesSuspended`).
   * *Cons:* Requires factory reset or provisioning via ADB QR code; completely impractical for ordinary consumers installing a personal wellbeing app from GitHub / Google Play.

5. **VPN / Local Loopback DNS Filtering**
   * *Pros:* Blocks network traffic to specific domains.
   * *Cons:* Ineffective for offline apps, drains battery, interferes with real user VPNs, does not block app UI.

---

## Decision

We adopt **Option 2: Narrow AccessibilityService Window Observation (`RhythmEnforcementService`)** with strict privacy boundaries, combined with **Option 1 (UsageStatsManager)** for quantitative usage tracking.

### Strict Privacy & Policy Invariants:
1. **Zero Content Inspection:** The service config declares `canRetrieveWindowContent="false"`. It NEVER reads screen text, node trees, forms, passwords, or personal messages.
2. **Package Identity Only:** The service listens solely to `AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED` and inspects only `event.packageName`.
3. **Dynamic Filtering:** The service only reacts if `event.packageName` is present in the local `SharedPreferences` restriction registry (`rhythm_restrictions`).
4. **Honest Play Policy Classification:** Rhythmic-Routine is **not** an accessibility tool for people with disabilities, and does NOT declare `android:isAccessibilityTool="true"`. It provides prominent in-app disclosure detailing why window observation is used.
5. **Calm Intervention:** When a restricted app opens, `RhythmEnforcementService` launches `RhythmOverlayActivity` (Touch Grass screen) rather than performing destructive system modifications.
6. **User Control:** The service can be disabled by the user at any time in Android Accessibility Settings or within Rhythmic-Routine Settings.

---

## Consequences

* **Observation vs Enforcement Separation:** `UsageStatsManager` remains the quantitative source of truth for session tracking. `RhythmEnforcementService` acts strictly as an enforcement trigger surface.
* **Truthful Capability Reporting:** If the user has not enabled `RhythmEnforcementService`, the platform capability is reported as `foundation-only` (`status: 'unsupported'`). Only when the service is active is it reported as `enforced`.
* **Zero Backend / Zero Telemetry:** No accessibility data or package names ever leave the device.
