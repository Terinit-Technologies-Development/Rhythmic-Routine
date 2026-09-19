# PowerShell helper script to build and verify Android QA Standalone APK

$ErrorActionPreference = "Stop"

# Release any Gradle daemon locks before cleaning
if (Test-Path "android\gradlew.bat") {
    Push-Location android
    try {
        .\gradlew.bat --stop | Out-Null
    } catch {}
    Pop-Location
}
Get-Process java -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "[build-android-qa] Step 1: Running Expo clean prebuild..." -ForegroundColor Cyan
npx expo prebuild --platform android --clean --no-install
if ($LASTEXITCODE -ne 0) {
    throw "Expo prebuild failed with code $LASTEXITCODE"
}

Write-Host "[build-android-qa] Step 2: Assembling qaStandalone APK with Gradle..." -ForegroundColor Cyan
Push-Location android
try {
    .\gradlew.bat clean
    if ($LASTEXITCODE -ne 0) { throw "Gradle clean failed with code $LASTEXITCODE" }
    .\gradlew.bat assembleQaStandalone -PreactNativeArchitectures=arm64-v8a
    if ($LASTEXITCODE -ne 0) { throw "Gradle assembleQaStandalone failed with code $LASTEXITCODE" }
} finally {
    Pop-Location
}

Write-Host "[build-android-qa] Step 3: Verifying bundled JS and package invariants..." -ForegroundColor Cyan
node scripts/verify-android-qa-apk.mjs
if ($LASTEXITCODE -ne 0) {
    throw "APK verification failed with code $LASTEXITCODE"
}

Write-Host "[build-android-qa] Build and verification completed successfully!" -ForegroundColor Green
