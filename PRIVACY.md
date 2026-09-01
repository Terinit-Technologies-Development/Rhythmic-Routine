# Privacy Architecture & Principles

Rhythmic-Routine is designed from first principles as a **strictly local-first digital wellbeing application**.

## 1. Zero Cloud Backend & Zero Telemetry
* Rhythmic-Routine has no remote servers, databases, or API backends.
* There are no user accounts, passwords, or authentication requirements.
* There are zero third-party analytics SDKs, advertising trackers, or error-reporting telemetry networks.
* 100% of your usage data, schedules, risk group configurations, and history logs remain exclusively on your physical device.

## 2. Android Permission & Observation Boundary
* **Usage Access (`PACKAGE_USAGE_STATS`):** Used solely to query timestamped foreground application transitions via Android's `UsageStatsManager`.
* **Accessibility Intervention Service (`RhythmEnforcementService`):**
  * Observes only window state changes (`TYPE_WINDOW_STATE_CHANGED`) to detect when a restricted application enters the foreground during an active routine buffer or recovery cooldown.
  * **Zero Content Inspection:** The service explicitly configures `canRetrieveWindowContent="false"`. It NEVER reads screen text, keystrokes, form entries, or private messages.
  * **No Disability Tool Misrepresentation:** We do not declare `android:isAccessibilityTool="true"`.
* **Targeted App Discovery:** Discovers launchable applications using Android's standard launcher query (`ACTION_MAIN` + `CATEGORY_LAUNCHER`). Rhythmic-Routine does NOT request the broad, invasive `QUERY_ALL_PACKAGES` permission. Your installed application inventory is never uploaded or shared.

## 3. iOS Screen Time & Family Controls Boundary
* On iOS, application shielding and usage events are managed out-of-process by Apple's `DeviceActivity` and `ManagedSettings` frameworks.
* Rhythmic-Routine never sees plaintext app bundle IDs on iOS; it references opaque system tokens (`ApplicationToken`, `ActivityCategoryToken`) stored securely in the app's sandboxed App Group `UserDefaults`.

## 4. Local Retention & Compaction
* Fine-grained raw usage events are automatically compacted and retained for only 14 days.
* Daily aggregate summaries are retained locally for 90 days to render weekly insight trends.
* Users can completely erase all local data at any time via Settings -> "Reset Local Storage & Engine State".
