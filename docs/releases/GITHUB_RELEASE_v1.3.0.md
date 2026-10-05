## Rhythmic Routine v1.3.0 — Internal Stable Android Release

Direct Android APK for normal internal and personal use. This repository and its
release assets are public. No Play Store package or submission is included. The
APK, package, version, signer, build source, and validation record are listed in
[`SW-2026-004-DEVICE-DEPLOYMENT.md`](SW-2026-004-DEVICE-DEPLOYMENT.md).

### APK

- [Download Rhythmic-Routine-v1.3.0.apk](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/releases/download/v1.3.0/Rhythmic-Routine-v1.3.0.apk)
- SHA-256: `c698b0498545c16ad21b4b92fef42841973d2cd497a4d723e40d274ecdadfdc3`

### Highlights

- Attention Day allocation and Morning Meditation integration.
- Restorative Gates for CD4+, with provider selection bound to the exact gate.
- CD3 Reader Daily Baseline remains 3600 seconds plus 36 qualified pages.
- CD4+ Reader recovery is 1800 seconds plus 11 qualified pages, or Meditation
  is 1800 qualified seconds.
- Maximum two Meditation substitutions per Attention Day.
- Native enforcement hardening and policy-projection diagnostics.
- HyperOS Accessibility detection repair.
- Evening Meditation and cross-app Insights integration.
- Provider-bound recovery reconciliation without changing cooldown end times.
- Legacy migration compatibility, including retained cumulative
  `LEGACY_READING` obligations such as 5400 seconds / 47 pages.

The v1.2.0 description that each later cooldown adds 30 minutes and 11 pages is
replaced by the fixed, discrete Restorative Gate model. Existing migrated legacy
obligations are preserved; new CD4+ Reader gates use 1800 / 11 and do not create
hidden cumulative Reader debt. Restorative activity never shortens cooldowns.

### Validation boundary

Primary physical qualification: Xiaomi Redmi Note 13 Pro+ 5G, Android 16 / API
36. The remaining full CD3/CD4 physical matrix, extended reboot/time-change
permutations, broader OEM work, long-horizon battery observation, multi-day
Insights qualification, and shared-signer instrumentation harness are tracked
as post-release QA debt.

### Known QA / Follow-up Certification — open

- [#8 — complete physical end-to-end restorative gate acceptance matrix](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/8)
- [#9 — preserve auditable Attention-Day allocation provenance](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/9)
- [#10 — make shared-signer cross-app Android instrumentation repeatable](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/10)
- [#11 — complete extended Android resilience and long-horizon certification](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/11)

This release does not claim full Android certification, production proof across
OEMs, public-store qualification, medical/addiction-treatment status, or
uncircumventable enforcement.
