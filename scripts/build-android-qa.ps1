# PowerShell helper script to build and verify Android QA Standalone APK

$ErrorActionPreference = "Stop"

Write-Host "[build-android-qa] Step 1: Running Expo clean prebuild..." -ForegroundColor Cyan
npx expo prebuild --platform android --clean --no-install

Write-Host "[build-android-qa] Step 2: Assembling qaStandalone APK with Gradle..." -ForegroundColor Cyan
Push-Location android
try {
    .\gradlew.bat clean
    .\gradlew.bat assembleQaStandalone
} finally {
    Pop-Location
}

Write-Host "[build-android-qa] Step 3: Verifying bundled JS and package invariants..." -ForegroundColor Cyan
node scripts/verify-android-qa-apk.mjs

Write-Host "[build-android-qa] Build and verification completed successfully!" -ForegroundColor Green
