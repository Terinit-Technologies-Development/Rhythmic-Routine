# Pass 04 — iOS Entitlement, Build & Lifecycle Qualification Results

## 1. Inventory of Target Identifiers & Entitlements

| Attribute | Configured Value | Verification Source |
| :--- | :--- | :--- |
| **Main App Bundle Identifier** | `com.terinit.rhythmicroutine` | `app.config.ts`, `npx expo config --type introspect` |
| **Extension Bundle Identifier** | `com.terinit.rhythmicroutine.activitymonitor` | `app.config.ts`, `extra.eas.build...appExtensions` |
| **Shared App Group** | `group.com.terinit.rhythmicroutine` | `app.config.ts`, `plugins/withRhythmScreenTime.ts` |
| **Main App Entitlements** | `com.apple.developer.family-controls: true`<br>`com.apple.security.application-groups: [group.com.terinit.rhythmicroutine]` | Introspected Config |
| **Extension Entitlements** | `com.apple.developer.family-controls: true`<br>`com.apple.security.application-groups: [group.com.terinit.rhythmicroutine]` | `app.config.ts` EAS Extension declaration |
| **Extension Target Name** | `RhythmDeviceActivityMonitor` | `plugins/withRhythmScreenTime.ts` |
| **Extension Point** | `com.apple.deviceactivity.monitor-extension` | `plugins/withRhythmScreenTime.ts` |

---

## 2. Introspected iOS Configuration (`npx expo config --type introspect`)

Sanitized verification excerpt:
```json
{
  "ios": {
    "supportsTablet": true,
    "bundleIdentifier": "com.terinit.rhythmicroutine",
    "entitlements": {
      "com.apple.developer.family-controls": true,
      "com.apple.security.application-groups": [
        "group.com.terinit.rhythmicroutine"
      ]
    },
    "infoPlist": {
      "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)",
      "CFBundleShortVersionString": "1.0.0",
      "CFBundleVersion": "1"
    }
  },
  "extra": {
    "eas": {
      "build": {
        "experimental": {
          "ios": {
            "appExtensions": [
              {
                "targetName": "RhythmDeviceActivityMonitor",
                "bundleIdentifier": "com.terinit.rhythmicroutine.activitymonitor",
                "entitlements": {
                  "com.apple.developer.family-controls": true,
                  "com.apple.security.application-groups": [
                    "group.com.terinit.rhythmicroutine"
                  ]
                }
              }
            ]
          }
        }
      }
    }
  }
}
```

---

## 3. Native Project Synthesis & Structural Verification

On Windows development environments, Expo CNG purposefully skips creating the `ios/` folder (`CocoaPods` / `xcodebuild` requires macOS). The repository validates the Xcode project configuration using `scripts/verify-ios-extension-project.mjs` which performs full structural synthesis via the `xcode` parser:

### Results:
```text
[verify-ios-extension] Running structural synthesis test using xcode parser...
[verify-ios-extension] Verifying initial project synthesis (Pass 1)...
  ✓ Found marker: "RhythmDeviceActivityMonitor"
  ✓ Found marker: "RhythmDeviceActivityMonitor.appex"
  ✓ Found marker: "Embed App Extensions"
  ✓ Found marker: "PBXTargetDependency"
  ✓ Found marker: "dstSubfolderSpec = 13"
  ✓ Verified: RhythmDeviceActivityMonitor.appex is embedded in Embed App Extensions phase
  ✓ Verified: exactly 1 PBXTargetDependency exists
  ✓ Verified: exactly 1 RhythmDeviceActivityMonitor.appex build file exists
  ✓ Verified: PrivacyInfo.xcprivacy file reference exists in extension group
  ✓ Verified: PrivacyInfo.xcprivacy is added to extension PBXResourcesBuildPhase
[verify-ios-extension] Verifying idempotent project re-synthesis (Pass 2)...
  ✓ Verified idempotency: exactly 1 PBXTargetDependency remains after re-synthesis
  ✓ Verified idempotency: exactly 2 native targets exist without duplicates
  ✓ Verified idempotency: exactly 1 PrivacyInfo.xcprivacy resource build file exists
[verify-ios-extension] All Xcode extension embedding checks passed successfully.
```

- **PBXTargetDependency Invariant:** Exactly 1 target dependency connects `RhythmicRoutine` to `RhythmDeviceActivityMonitor`. Idempotent re-runs do not create duplicates.
- **PBXCopyFilesBuildPhase Invariant:** Exactly 1 `.appex` build file is embedded into destination subfolder `13` (Plugins/App Extensions).
- **Extension Privacy Manifest Invariant:** `PrivacyInfo.xcprivacy` is copied to the extension destination and wired into the extension target's `PBXResourcesBuildPhase` (not `PBXSourcesBuildPhase`).

---

## 4. Family Controls Distribution Entitlement Gate

- **Capability Class:** Restricted Apple Developer Entitlement (`com.apple.developer.family-controls`).
- **Current State:** `WAITING_ON_APPLE_ENTITLEMENT` / `provisioning-blocked`.
- **Requirements:**
  1. The Apple Developer Account holder must apply for and receive Apple approval for the Family Controls distribution entitlement for both `com.terinit.rhythmicroutine` and `com.terinit.rhythmicroutine.activitymonitor`.
  2. Provisioning profiles generated for TestFlight or App Store distribution must explicitly include the entitlement.
- **Architectural Preservation:**
  The entitlement is **not** removed from source, `app.config.ts`, or the extension configuration. The application maintains 100% fidelity to the required Screen Time architecture rather than degrading configuration to force a generic iOS build.

---

## 5. Screen Time / DeviceActivity Lifecycle Invariants

### 5.1 Authorization State Machine
- `FamilyControls.AuthorizationCenter.shared.requestAuthorization(for: .individual)`
- **Denied / Revoked:** Returns `status = "denied"`. Overall capability evaluates to `foundation-only` (`setup required`).
- **Approved without App Selection:** Returns `status = "approved"`, but with 0 selected tokens. Capability reports `foundation-only` (truthful reporting: cannot shield apps without active tokens).
- **Approved + Non-empty Selection + Operational Monitors:** Capability transitions to `enforced`.

### 5.2 Per-Risk-Group Activity Selection & Revision Tracking
- Each Risk Group selection is stored in `UserDefaults(suiteName: "group.com.terinit.rhythmicroutine")` under `selection.<groupId>`.
- Token data remains strictly opaque in native memory and is never serialized to JS or logs.
- When an app selection is updated or cleared, `selection_revision.<groupId>` increments natively.
- The TS store syncs `nativeSelectionRevision`, which alters the configuration signature and cleanly forces `synchronizeMonitoringConfiguration` without stale cache masking.

### 5.3 iOS DeviceActivity Monitor Budget & Consolidation
- **System Limit:** Apple enforces a strict quota on concurrent `DeviceActivityName` monitors per application.
- **Consolidation Strategy:**
  - 7-day routines are compressed into single daily interval schedules (1 monitor each, e.g. `routine|morning-buffer|daily` and `routine|evening-wind-down|daily`).
  - Zero-group routines (e.g. Open Day) are skipped entirely (0 monitors).
  - All configured Risk Groups are consolidated into a single `risk.daily` activity with multi-event threshold tracking.
  - Active cooldowns and access leases are scheduled using a single, unified nearest-expiry monitor (`expiry|next|<timestamp>`) with a minimum 15-minute wake interval.
- **Total Concurrent Activities:** Maximum 3 to 4 concurrent activities, safely within iOS system limits.

### 5.4 Two-Phase Monitoring Error Boundaries & Health Derivation
- When `synchronizeMonitoringConfiguration` executes, `persistent_monitoring_operational` is set to `false` immediately before stopping/replacing topology to ensure prior healthy state cannot survive failure.
- **Phase 1 (Persistent Monitors):** Stops old persistent activities, starts routines, starts `risk.daily`. On success: `persistent_monitoring_operational = true`.
- **Phase 2 (Expiry Monitor):** Calls `ensureNearestExpiryMonitor`.
- **Health Derivation Invariant:**
  - Overall `monitoring_operational = persistent_operational && (!hasActiveExpiry || expiry_operational)`.
  - If persistent fails: overall is immediately `false`.
  - If persistent succeeds but expiry fails when an expiry is active: overall is `false`, but persistent diagnostics remain `true`.

### 5.5 Cold-Start Native State Import Ordering
- On cold relaunch of Rhythmic-Routine:
  1. `RhythmDeviceModule.getSnapshot()` reads App Group `UserDefaults` before any outward JS synchronization.
  2. Active native cooldowns and leases created by the background `DeviceActivityMonitorExtension` are imported into `RhythmCoordinator` and `RhythmEngine`.
  3. Wall-clock reconciliation is evaluated.
  4. Only after local state reconciliation does the coordinator sync outward to native shields and monitors.

---

## 6. iOS Qualification Classification

- **Source & Configuration Classification:** **`source-config-verified`**
  - All iOS configuration keys, main app privacy manifests, extension targets, entitlements, and Xcode synthesis invariants are structurally verified and 100% passing.
- **Binary & Execution Classification:** **`real-bundle-verification-pending`**
  - Blockers:
    - Host machine is Windows; direct `xcodebuild` requires macOS or remote EAS cloud build.
    - Family Controls distribution entitlement pending Apple Developer Program approval (`owner-confirmation-required` / `WAITING_ON_APPLE_ENTITLEMENT`).
    - Physical iPhone testing pending signed ad-hoc / internal device distribution.
