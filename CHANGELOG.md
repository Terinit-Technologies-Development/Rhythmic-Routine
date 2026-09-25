# Changelog

All notable changes to Rhythmic-Routine are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-09-26

### Added
- **Productive Attention Exchange:** the first two daily cooldowns remain timer-only. Cooldown #3 requires 60 verified reading minutes + 36 dwell-qualified pages; each subsequent cooldown adds +30 minutes and +11 pages. Daily cumulative evidence is not spent, and both reading time and qualified pages are mandatory for every gated cooldown.
- **Rhythmic Reader V2 evidence:** daily verified active reading and dwell-qualified pages for the device-local calendar day, exposed through a signature-protected cross-app provider. Gated re-entry fails closed when Reader evidence is absent or incompatible.
- **Reading quota surfaces:** Routine Today "Reading quota" card with daily verified totals, active cooldown quota progress, and the next cooldown target; Reader Today quota preview refreshed every 15 seconds; focused Routine evidence refresh every 30 seconds.
- **Routine → Reader quota preview:** a signature-protected read-only provider publishes the next daily cooldown requirement to the signed Reader client. Reader now requests `com.terinit.rhythmicreader.permission.RECOVERY`; unauthorized callers remain denied.
- **Settings access:** gear entry from the main Routine headers; Accountability continues to be managed from Settings.
- **Explicit Risk Group assignment:** classifying an app as Risk requires an explicit group selection with no silent Social fallback, and custom Risk Groups remain visible on Today.
- **Daily allowance/cycle presentation:** every Risk Group card shows used/allowance counters, remaining cycle time, and the zero-allowance state.
- **Accountability partner save feedback:** add-partner saves show explicit progress and error state, block duplicate submits, and keep actions above the keyboard and navigation area.

### Changed
- **Internal channel alignment:** `eas.json` uses local source-controlled versioning (`appVersionSource: local`) and internal APK profiles for QA and stable distribution; store submission configuration was removed.

### Fixed
- **Reader quota sync:** Reader now holds the signature permission required to read Routine's next-quota preview provider, restoring quota synchronization.
- **Routine evidence freshness:** Reader evidence refreshes when Today is focused, every 30 seconds, and on app resume.
- **Accountability hardening:** a central protected mutation boundary with immutable approval payloads and execution-time stale-state checks; persistent per-partner lockout; SecureStore-backed credentials; protected reset and protected Emergency Access; last-enabled-partner invariant.

### Platform Status
- **Android:** Owner-accepted private/internal release. Routine↔Reader signature-protected IPC verified on-device. Productive Attention, Accountability, quota sync, and core application behaviour accepted by owner.
- **iOS:** Source implementation remains experimental/unverified for this internal Android release.
- **Web:** Development/testing environment only.

### Validation
- 355 unit/integration tests passing across 67 suites.
- `npm run typecheck` (0 errors), `npm run lint` (0 errors / 0 warnings), and `npx expo export --platform web` complete cleanly.
- Native Android: `:rhythm-device:testDebugUnitTest`, `:rhythm-device:compileDebugKotlin`, `:app:assembleDebug`, the stable internal release APK, and the standalone QA APK all build successfully; the QA APK verification script passes.

## [1.1.0] — 2026-09-19

### Added
- **Accountability Partner System:** Local-first, zero-backend partner accountability model supporting multiple partners with granular metadata (name, relationship label).
- **Secure Partner Credential Management:** Salted PBKDF2-HMAC-SHA256 password verifiers stored in secure storage; zero plaintext password exposure in persistent storage, Zustand state, or UI modals.
- **Centralized Mutation Authorization Gateway:** Module-private executor architecture guaranteeing that any protected operation (`create-risk-group`, `edit-risk-group`, `delete-risk-group`, `edit-risk-group-protection`, `edit-routine-schedule`, `change-app-classification`, `change-daily-allowance`, `enable-accountability`, `disable-accountability`, `manage-accountability-partner`, `start-access-lease`, `reset-local-state`, `edit-ios-risk-group-selection`) strictly passes through partner approval when Accountability Mode is enabled.
- **Two-Phase Native iOS Selection Staging:** Staged FamilyActivityPicker selection (`pending_selection.<UUID>`) on iOS preventing unapproved App Group mutation; includes automatic rollback and orphan discard on transaction failure or rejection.
- **Custom Risk Groups:** Full user lifecycle for custom Risk Groups (create, edit, delete, icon/color customization) with per-group daily allowances, individual cooldown durations, and assigned recovery activities.
- **Lockout Rate Limiting:** Brute-force protection locking out partner password verification for 60 seconds after 5 consecutive failed attempts, decremented and reset on successful verification.
- **Atomic Configuration Transactions:** Consolidated configuration mutations through `RhythmCoordinator` with transaction-safe history event recording and unified rollback on failure.

### Changed
- **Group-Level Allowance Model:** Replaced legacy per-app daily risk allowances with unified per-Risk-Group allowance pooling (all apps in a group draw from the single group ledger).
- **Automatic v1.0.1 -> v1.1.0 Migration:** Deterministic upgrade migrating legacy group threshold minutes into `allowanceMinutes`, defaulting recovery activity to `walk`, and stripping deprecated per-app allowances.
- **Safe Area & Modal Usability:** Hardened all dialogs, bottom sheets, and the Partner Approval modal with `KeyboardAvoidingView` and platform-specific `useSafeAreaInsets` padding.

### Fixed
- **Authorization UI Bypasses:** Eliminated raw executor exports, routine scheduling direct mutations (active day toggling and time adjustments), and direct `updateConfig` bypasses across all screens, drawers, and demo state switchers.
- **Credential Memory Leakage:** In-flight partner passwords for partner creation/verification are managed via transient module-private memory vaults and destroyed immediately upon consumption or cancellation.
- **History Write Decoupling:** History logging failures no longer invalidate already-committed configuration transactions or induce split-state desynchronization.
- **iOS Picker State Invariant:** Staged FamilyActivityPicker selections cannot bypass partner authorization by writing directly to active App Group storage before approval.

### Platform Status
- **Android:** Fully verified on standalone QA variant with AccessibilityService foreground observation, UsageStats reconciliation, calm Touch Grass overlay (`#FAF7F0`), and group allowance enforcement.
- **iOS:** Complete source architecture implementation with Screen Time DeviceActivity plugins, App Group storage, and two-phase FamilyActivityPicker staging; pending physical Apple hardware validation.
- **Web:** Local interactive simulator and testing environment.

### Validation
- **Automated Test Matrix:** 320 unit/integration tests passing across 63 test suites (100% pass rate).
- **TypeScript:** Clean compilation with 0 errors (`node --stack-size=8192 ./node_modules/typescript/bin/tsc --noEmit`).
- **ESLint:** Clean lint run with 0 errors and 0 warnings (`expo lint`).
- **Expo Bundler:** Clean Android bundle export (`5.4MB HBC bundle`) with zero unresolved dependencies or module errors.

## [1.0.1] — 2026-09-03

### Added
- Per-Risk-app daily usage allowances with a 30-minute default.
- 15-minute allowance adjustment units with a 0-minute minimum.
- Once-per-local-day allowance editing with a maximum +15-minute daily increase.
- Native Android per-app daily usage ledger.
- Real Android usage data and daily allowance information in Insights.
- Seven-local-day observed Risk-app usage aggregation.

### Changed
- Evening protection now flows continuously into Overnight Protection before Morning Buffer.
- Overnight Protection applies to all apps classified as Risk.
- Android daily allowance enforcement is event-driven through foreground window transitions and a single active deadline.
- Risk Group session tracking uses a reduced bounded refresh cadence while daily allowance enforcement remains native.
- Insights distinguish measured, empty, unavailable, permission-required, and demo states.
- Daily allowance usage during intentional Access Leases continues to count toward the daily total.

### Fixed
- Evening Wind-Down no longer falls through to Open Day before Morning Buffer.
- Cross-midnight daily usage accounting no longer double-counts active segments.
- Duplicate foreground events no longer reset active usage segments.
- Installed-app refresh no longer resets allowance policy or the daily edit guard.
- Native routine transitions can release restrictions without React Native JS being active.
- Android routine serialization no longer treats Open Day as Evening Wind-Down.
- Usage reconciliation is idempotent across live Accessibility events and UsageStats recovery.
- Native Insights no longer silently fall back to demo or stale usage values.
- Allowance/classification updates are persisted deterministically.
- Foreground-package recovery callbacks are available across native enforcement transitions.

### Platform Status
- **Android:** Owner-accepted physical v1.0.1 candidate. Core application behaviour and Insights verified on physical hardware.
- **iOS:** Source-implemented experimental foundation; not physically qualified for v1.0.1.
- **Web:** Development/demo environment.

### Validation
- Source suite: 188 tests / 34 suites at the approved Pass 03 baseline.
- Standalone Android candidate installed and owner-accepted.
- Dedicated final overlay regression: deferred as a non-blocking post-release smoke check.

## [1.0.0] — 2026-09-01

### Added
- **Morning Buffer:** Intentional morning boundary preventing distracting feeds before wake-up goals.
- **Evening Wind-Down:** Pre-sleep protection window gently pausing social and entertainment apps.
- **Native Android Launcher App Discovery:** Discovers launchable device apps via targeted `<queries>` (`ACTION_MAIN` + `CATEGORY_LAUNCHER`) without invasive permissions.
- **Risk Groups:** Tracks cumulative active screen time across related apps (e.g. Social, Video) with 5-minute inactivity gap accounting.
- **Touch Grass Recovery Overlay:** Fullscreen opaque (`#FAF7F0`) calming intervention with Back-to-Home navigation and 1-second auto-close polling on window end.
- **Multi-Group Cooldowns & Access Leases:** Parallel group cooldown management and temporary emergency access leases that suppress restrictions without mutating the underlying base restriction set.
- **Essential App Safety Invariant:** Absolute exemption of essential utilities (Phone, Maps, Clock) guaranteed across all routine windows and cooldowns.
- **Local SQLite Persistence & Compaction:** Zero-cloud SQLite storage (`expo-sqlite`) with 14-day raw event compaction and 90-day weekly rollup summaries.
- **Native Android AccessibilityService Enforcement:** Foreground window observation (`canRetrieveWindowContent="false"`) with centralized affirmative consent disclosure flow.
- **Standalone QA Android Packaging:** Reproducible offline APK packaging (`app-qaStandalone.apk`) with embedded JS bundle and `.qa` namespace.
- **Canonical Brand Identity:** Unified logo asset (`rhythmic_routine_logo.png`) and `#F8F4E8` adaptive background.
- **Experimental iOS Foundation:** CNG config plugins for Screen Time ManagedSettings and DeviceActivity extension synthesis.
- **Source-Available Licensing:** Adoption of Rhythmic-Routine Personal Use License 1.0 for personal non-commercial use with commercial licensing managed by Terinit Technologies.

### Platform Status
- **Android:** Experimentally validated on physical hardware (`PHYSICAL_DEVICE_VERIFIED`).
- **iOS:** Source-implemented foundation; not physically validated on Apple hardware.
- **Web:** Local development and interactive simulation environment.
