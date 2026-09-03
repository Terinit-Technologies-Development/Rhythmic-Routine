# Changelog

All notable changes to Rhythmic-Routine are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
