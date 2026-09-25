## Rhythmic-Routine v1.2.0

v1.2.0 introduces the Productive Attention Exchange: cooldown recovery can now
require verified reading instead of waiting out a timer. Routine and Rhythmic
Reader synchronize daily reading evidence through a signature-protected local
IPC channel.

This is an **Internal Stable Release** for private / internal Android
distribution (direct APK). No store binary is included.

### Highlights

- The first two daily cooldowns remain timer-only.
- Cooldown #3 requires 60 verified reading minutes + 36 dwell-qualified pages.
- Each subsequent cooldown adds +30 minutes and +11 pages.
- Daily cumulative reading evidence is not spent; both time and pages are required.
- Reader V2 evidence is per device-local calendar day.
- Gated re-entry fails closed when Reader evidence is absent or incompatible.
- Routine Today shows a Reading quota card: daily verified totals, active
  cooldown quota progress, and the next cooldown target.
- Reader Today previews Routine's next cooldown quota and refreshes every 15 seconds.
- Reader now holds the signature permission required to read Routine's quota
  preview; unauthorized callers remain denied.
- Productive Attention enforcement is native and does not depend on React Native JS.
- Accountability hardening: central protected mutation boundary, immutable
  approval payloads, execution-time stale-state checks, persistent per-partner
  lockout, SecureStore-backed credentials, protected reset, and protected
  Emergency Access.
- Custom Risk Groups are fully visible on Today; risk classification requires an
  explicit Risk Group selection.
- Settings access from the main headers; Accountability remains in Settings.

### Validation

The paired Routine + Reader build was installed and updated in place on the
owner's physical Android device and accepted as behaving as intended.

Automated validation: 355 tests across 67 suites passing, clean typecheck, clean
lint, clean web export, and passing native Android builds (debug, stable
internal release APK, and standalone QA APK).

iOS remains source-implemented and experimental for this internal Android
release. Web remains a development/testing environment.

### Distribution

Private / Internal Android. Direct APK installation. No Google Play, App Store,
or EAS store submission configuration is part of this release.

### IPC and Signing

Routine and Reader share the signature-protected
`com.terinit.rhythmicreader.permission.RECOVERY` permission. Future internal
releases must continue to ship both applications with the same stable signing
identity, and must preserve the permission name, package IDs, and provider
authorities.

### License

Rhythmic-Routine remains source-available under the Rhythmic-Routine Personal
Use License 1.0. Personal/non-commercial use is permitted under that license.
Commercial use requires a separate written commercial license from Terinit
Technologies.
