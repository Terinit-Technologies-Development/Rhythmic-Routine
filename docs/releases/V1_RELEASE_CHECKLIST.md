# Rhythmic-Routine V1 Release Checklist

This checklist tracks the qualification, licensing, hygiene, and publication gates for Rhythmic-Routine v1.0.0.

---

## 1. Automated Quality & Source Gates

- [x] **Version Pinning:** `package.json` and Expo config declare `version: "1.0.0"`.
- [x] **Automated Tests:** 104 tests passing across 16 test suites (`npm test`).
- [x] **TypeScript Validation:** `npm run typecheck` passes with zero type errors.
- [x] **Code Quality & Linting:** `npm run lint` passes with zero errors and zero warnings.
- [x] **Web Export:** `npm run build:web` bundles static production web output without errors.
- [x] **Expo Dependency Health:** `npx expo-doctor` passes all checks cleanly.
- [x] **CNG Prebuild Reproducibility:** `npx expo prebuild --clean --no-install` is strictly idempotent.

---

## 2. Platform Qualification Status

- [x] **Android Hardware Qualification:** Standalone QA APK (`app-qaStandalone.apk`) verified on physical device hardware across Pass 04C and Pass 04D.
- [x] **Android Launcher Discovery:** Targeted package queries (`ACTION_MAIN` + `CATEGORY_LAUNCHER`) verified without `QUERY_ALL_PACKAGES`.
- [x] **Android Enforcement & Overlay:** Foreground re-evaluation, opaque calm theme (`#FAF7F0`), debounce, and Back-to-Home navigation verified.
- [x] **iOS Status Truthfulness:** iOS documented as experimental source implementation, explicitly unverified on physical hardware.

---

## 3. Licensing, Governance & Community Surface

- [x] **Root License:** [Rhythmic-Routine Personal Use License 1.0](LICENSE) installed.
- [x] **Commercial Licensing:** [`COMMERCIAL_LICENSE.md`](COMMERCIAL_LICENSE.md) documentation established.
- [x] **Historical MIT Caveat:** [`LICENSE_HISTORY.md`](LICENSE_HISTORY.md) documented to protect historical grants.
- [x] **Trademark Policy:** [`TRADEMARKS.md`](TRADEMARKS.md) established.
- [x] **Contributor Governance:** [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CONTRIBUTOR_LICENSE.md`](CONTRIBUTOR_LICENSE.md) installed.
- [x] **Third-Party Notices:** [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) established.
- [x] **Community Files:** [`SECURITY.md`](SECURITY.md), [`SUPPORT.md`](SUPPORT.md), and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) created.
- [x] **GitHub Templates:** Issue templates (bug report, feature request, config) and pull request template created in `.github/`.
- [x] **Terminology Audit:** All current-project references to "open source", "free and open source", and "MIT licensed" replaced with "source-available".

---

## 4. Repository & Artifact Hygiene

- [x] **No Binary Artifacts Committed:** Zero `.apk`, `.aab`, `.jar`, `.so`, or `.dylib` files committed.
- [x] **No Secrets Committed:** Zero private keys, signing keystores (`.jks`, `.keystore`), certificates, or `.env` files.
- [x] **Package Privacy:** `"private": true` preserved in `package.json`.

---

## 5. Owner Final Publication Actions (Manual Gates)

The following gates are left unchecked for the repository owner:

- [ ] **Owner Review & Legal Confirmation:** Review custom Personal Use License and Commercial Licensing terms (and optionally seek professional legal counsel).
- [ ] **Closeout PR Review:** Review the final closeout Pull Request from `release/v1-repository-closeout` to `master`.
- [ ] **Merge PR:** Merge `release/v1-repository-closeout` into `master`.
- [ ] **Tag Release:** Create and push the Git tag `v1.0.0` from `master`:
  ```bash
  git tag -a v1.0.0 -m "Rhythmic-Routine v1.0.0 (Experimental V1)"
  git push origin v1.0.0
  ```
- [ ] **Publish GitHub Release:** Publish the draft release using the markdown prepared in [`docs/releases/GITHUB_RELEASE_v1.0.0.md`](GITHUB_RELEASE_v1.0.0.md).
- [ ] **Signed Release Artifact (Optional):** In a separate signing/distribution pass, compile and publish a production-signed Android APK/AAB if desired.
