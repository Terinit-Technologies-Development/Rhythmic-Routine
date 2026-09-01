# Changelog

All notable changes to Rhythmic-Routine are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
