# SW-2026-004 — Android release artifacts and device deployment

- **Prepared:** 2026-10-05
- **Classification:** **INTERNAL ANDROID RELEASE — OWNER ACCEPTED — KNOWN QA DEBT TRACKED**
- **Use:** Direct Android APKs intended for internal/personal use; no Play Store
  submission or production promotion.
- **Repository visibility:** Routine, Reader, and Meditation repositories are
  public. Their GitHub release assets are publicly downloadable.
- **Device deployment:** Pending. `adb devices -l` reported no attached devices
  during release preparation; no install, uninstall, or data-clear operation was
  performed.

## Release APKs

Each APK below was built from the listed release-branch commit, is a non-debuggable
`release` variant, and verifies with the same local shared internal signer. The
signing keystore and passwords are ignored/local and are not committed. The
certificate fingerprint identifies the signer; it is not a production-store
signing claim.

| App | Package | Version / code | minSdk / targetSdk | ABIs | Source commit | APK size | SHA-256 |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| Routine | `com.terinit.rhythmicroutine` | `1.3.0` / `5` | 24 / 36 | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` | [`aa594bb`](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/commit/aa594bb3a0b6428bfe29c2f2a704da7dfbdbe1c4) | 113,558,863 bytes | `c698b0498545c16ad21b4b92fef42841973d2cd497a4d723e40d274ecdadfdc3` |
| Reader | `com.terinit.rhythmicreader` | `1.3.0` / `3` | 28 / 36 | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` | [`e4babc3`](https://github.com/Terinit-Technologies-Development/Rhythmic-Reader/commit/e4babc331086c73c53fd7d19ca9c92b6a9690d50) | 54,472,211 bytes | `6c6cbc376571e119535789c4c57af4a83acdc78a4c038317038ecbd94720e884` |
| Meditation | `com.terinit.rhythmicmeditation` | `1.0.0` / `2` | 26 / 36 | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` | [`c40eef2`](https://github.com/Terinit-Technologies-Development/Rhythmic-Meditation/commit/c40eef2e9f3dfc749169d7f495d2032e1903ccb3) | 13,734,243 bytes | `e55c6c073308cb113884a04d946f95d31e56e095e8ea674d2e4e07abe7f08e23` |

| App | Repository artifact path | Public release asset |
| --- | --- | --- |
| Routine | `android/app/build/outputs/apk/release/app-release.apk` | [Rhythmic-Routine-v1.3.0.apk](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/releases/download/v1.3.0/Rhythmic-Routine-v1.3.0.apk) |
| Reader | `app/build/outputs/apk/release/app-release.apk` | [Rhythmic-Reader-v1.3.0.apk](https://github.com/Terinit-Technologies-Development/Rhythmic-Reader/releases/download/v1.3.0/Rhythmic-Reader-v1.3.0.apk) |
| Meditation | `app/build/outputs/apk/release/app-release.apk` | [Rhythmic-Meditation-v1.0.0.apk](https://github.com/Terinit-Technologies-Development/Rhythmic-Meditation/releases/download/v1.0.0/Rhythmic-Meditation-v1.0.0.apk) |

The release APKs were inspected with Android build-tools `aapt` and
`apksigner`. All report signer-certificate SHA-256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
Package IDs are unchanged and version codes advance from the recorded v1.2.0 /
v0.1.0 baselines (Routine `4→5`, Reader `2→3`, Meditation `1→2`).

### Packaging and permission inspection

- **Routine:** The release APK contains the embedded
  `assets/index.android.bundle`; its merged release manifest has the app's
  `MainActivity` launcher and no Expo DevLauncher manifest components. Release
  permissions include usage stats, overlay, legacy external storage capped at
  API 32, biometrics, vibration, and the named Reader/Meditation IPC permissions.
- **Reader:** Exported recovery entry/provider components are protected by
  `com.terinit.rhythmicreader.permission.RECOVERY`; the Daily Evidence provider
  requires that permission for reads and writes. Document access is mediated by
  the Android document picker.
- **Meditation:** The exported status provider requires
  `com.terinit.rhythmicmeditation.permission.STATUS_ACCESS`. The active-session
  foreground service is non-exported and declares the special-use subtype;
  Routine recovery is protected by the Reader-owned recovery permission.

## Automated validation

| Repository | Results |
| --- | --- |
| Routine | `npm test` **423 / 423** across 82 suites; typecheck and lint passed; `:rhythm-device:testDebugUnitTest` **80 / 80**; debug compile/APK and signed release APK passed. |
| Reader | `test` **106 / 106**; debug APK, release APK, debug Android-test APK, and lint passed. |
| Meditation | `:app:testDebugUnitTest` **177 / 177**; debug APK, release APK, debug Android-test APK, and lint passed with the shared local signer. |

Building an Android-test APK is compile/package validation only; no connected
instrumentation test is claimed by this record. Prior device qualification and
the earlier zero-test shared-signer instrumentation attempt are recorded in the
[SW-2026-004 closeout](SW-2026-004-CLOSEOUT.md) and app handoffs.

## Frozen policy and known QA debt

Routine remains the cooldown and enforcement authority. CD3 remains 3600
qualified Reader seconds plus 36 pages. New CD4+ gates remain 1800 seconds plus
11 qualified Reader pages, or 1800 qualified Meditation seconds. Restorative
activity never shortens a cooldown; migrated legacy obligations retain their
original requirements.

The fresh Routine-bound CD4 Meditation acceptance passed. CD3 Reader acceptance,
fresh CD4 Reader acceptance, and Routine reboot-persistence rows remain
incomplete. Routine issues [#8](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/8),
[#9](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/9),
[#10](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/10),
and [#11](https://github.com/Terinit-Technologies-Development/Rhythmic-Routine/issues/11)
remain open. This release does not claim exhaustive OEM certification, Play
Store qualification, medical use, or uncircumventable enforcement.

## Data-preserving device deployment

Deployment happens only after the owner connects the intended device and confirms
it is the target. Handle one device at a time.

1. Capture the device serial, Android version/ABI, installed package versions,
   signing certificate, and a read-only baseline of Routine and Reader app data.
2. Verify that installed packages are the matching package IDs and that each
   update's version code is newer and certificate matches the fingerprint above.
3. Install the corresponding APK with `adb install -r <apk>`; launch and smoke
   check the app and cross-app contracts before proceeding to the next app.
4. Recheck package version, signing identity, and persisted app data, recording
   results without copying private user records into the repository.

If Android reports a signature or version conflict, stop and preserve the
installed app and its data. **Never uninstall or clear app data to bypass an
update conflict.**
