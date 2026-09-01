# Contributing to Rhythmic-Routine

We welcome community contributions, bug reports, and improvements to Rhythmic-Routine!

Rhythmic-Routine is a **source-available** project distributed under the [Rhythmic-Routine Personal Use License](LICENSE) with commercial licensing managed by Terinit Technologies.

---

## 1. Contributor License Terms

Before submitting code, documentation, or design improvements, please review the [Contributor License Agreement (CLA)](CONTRIBUTOR_LICENSE.md).

Submitting a Pull Request, code patch, documentation patch, or other material for incorporation constitutes acceptance of [CONTRIBUTOR_LICENSE.md](CONTRIBUTOR_LICENSE.md).

By submitting material for incorporation, you certify that:
1. Your contribution is your own original work.
2. You grant Terinit Technologies a perpetual, transferable, sublicensable license to incorporate, redistribute, and dual-license your contribution under the Personal Use License and commercial licenses.
3. You check the CLA confirmation box in the Pull Request template.

Merely opening an issue, submitting a bug report, suggesting a feature, commenting, or participating in a community discussion does not constitute a code contribution under the CLA.

---

## 2. Core Development Invariants

Every contribution must respect the following architectural invariants:

1. **Local-First & Zero Telemetry:** Never add network servers, cloud tracking SDKs, analytics, ads, accounts, or telemetry. All user data, app inventories, and usage statistics remain strictly on-device.
2. **Deterministic Rhythm Engine:** Domain logic, state transitions, inactivity gap tolerances, and restriction reason unions belong exclusively in `src/domain/rhythm/` as pure, deterministic TypeScript accompanied by automated unit tests.
3. **Essential App Absolute Exemption:** The invariant that Essential apps (*Phone, Maps, Emergency Utilities*) are never restricted under any routine, cooldown, or lease must remain mathematically inviolable.
4. **Platform Separation:** Native platform code in `modules/rhythm-device/` must adhere to least-privilege boundaries (e.g. targeted `<queries>` instead of `QUERY_ALL_PACKAGES`).

---

## 3. Pull Request Process

1. **Branch Off Clean Base:** Create a focused feature branch from `master`.
2. **Unit Tests:** Add or update automated test suites in `src/domain/**/__tests__/` to cover new behaviors or fixes.
3. **Run Quality Gates:**
   ```bash
   npm test
   npm run typecheck
   npm run lint
   npm run build:web
   ```
4. **Complete the PR Template:** Complete all checklist items in `.github/pull_request_template.md`, including confirming acceptance of the [Contributor License Agreement](CONTRIBUTOR_LICENSE.md).
