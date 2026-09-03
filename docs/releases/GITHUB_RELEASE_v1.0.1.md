## Rhythmic-Routine v1.0.1

v1.0.1 strengthens Rhythm's daily-use accounting and closes the
overnight gap between Evening Wind-Down and Morning Buffer.

### Highlights

- Risk apps remain protected overnight between Evening and Morning.
- Each Risk app now has its own daily allowance.
- Daily allowance defaults to 30 minutes.
- Allowances use 15-minute adjustment units.
- A daily allowance can be increased by at most 15 minutes per day.
- Allowances can be reduced to 0 minutes.
- Android tracks daily Risk-app usage through a native local ledger.
- Usage continues counting during intentional Access Leases.
- Daily allowance enforcement remains active when the Rhythm UI is backgrounded.
- Insights now use real Android usage observations rather than native demo values.
- Seven-day Risk usage and Risk Group activity are based on observed local usage.
- Native routine and cooldown boundaries no longer depend on React Native JS timing.
- Android usage/error states now avoid presenting stale values as current measurements.

### Validation

The standalone Android candidate was installed and accepted on physical
hardware by the project owner. Core application behaviour and the new
Insights experience were observed working correctly.

A dedicated additional overlay smoke regression was deferred by owner
decision and is not a blocker for this release.

iOS remains source-implemented and experimental; it is not hardware-qualified
as part of v1.0.1.

### Distribution

This is a source release. No production Android or iOS store binary is
included.

### License

Rhythmic-Routine remains source-available under the
Rhythmic-Routine Personal Use License 1.0.

Personal/non-commercial individual use is permitted under that license.
Commercial use requires a separate written commercial license from
Terinit Technologies.
