# SW-2026-005 A4 — shared-signer Android QA build front-end.
#
# Modes:
#   plan     (default) validate configuration and print the plan. No writes.
#   prepare  run Expo prebuild for Routine (no --clean, no install).
#   build    build all requested apps serially, zipalign, post-sign every AUT
#            and instrumentation APK with one shared key, verify, write manifest.
#
# This script deliberately does NOT stop Gradle daemons, kill Java processes,
# delete caches, run `clean`, install anything, or touch a device. The Node
# harness owns argv construction and fail-closed verification.

[CmdletBinding()]
param(
  [ValidateSet('plan', 'prepare', 'build')]
  [string]$Mode = 'plan',

  [string]$RoutineRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$ReaderRoot = $env:SW005_READER_ROOT,
  [string]$MeditationRoot = $env:SW005_MEDITATION_ROOT,

  [string]$RoutineSha = $env:SW005_ROUTINE_SHA,
  [string]$ReaderSha = $env:SW005_READER_SHA,
  [string]$MeditationSha = $env:SW005_MEDITATION_SHA,
  [string]$Apps = 'routine,reader,meditation',

  [string]$AndroidSdk = $(if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { $env:ANDROID_HOME }),
  [string]$BuildToolsVersion = $env:SW005_BUILD_TOOLS_VERSION,
  [string]$JdkHome = $env:JAVA_HOME,
  [string]$GradleHome = $env:SW005_GRADLE_HOME,
  [string]$GradleLauncherJar = $env:SW005_GRADLE_LAUNCHER_JAR,
  [string]$GradleUserHome = $env:SW005_GRADLE_USER_HOME,
  [int]$MaxHeapMb = 1024,
  [string]$Architectures = 'arm64-v8a',

  [string]$Keystore = $env:SW005_KEYSTORE,
  [string]$KeyAlias = $env:SW005_KEY_ALIAS,
  [string]$ExpectedCertSha256 = $env:SW005_EXPECTED_CERT_SHA256,
  [string]$KeystorePassEnv = 'SW005_KS_PASS',
  [string]$KeyPassEnv = 'SW005_KEY_PASS',

  [string]$OutputDir = $env:SW005_SIGNED_APK_DIR,
  [string]$Manifest = $env:SW005_MANIFEST,
  [int]$RoutineVersionCode = $(if ($env:SW005_ROUTINE_VERSION_CODE) { [int]$env:SW005_ROUTINE_VERSION_CODE } else { 0 }),

  [switch]$AllowLowMemory,
  [switch]$EmulatorRunning,
  [switch]$Strict,
  [string]$NodePath = 'node'
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$harness = Join-Path $repoRoot 'scripts\sw005\harness.mjs'

if (-not (Test-Path -LiteralPath $harness)) {
  throw "Harness entry point not found: $harness"
}

$node = (Get-Command $NodePath -ErrorAction Stop).Source

function Add-Argument {
  param([System.Collections.Generic.List[string]]$List, [string]$Name, [string]$Value)
  if (-not [string]::IsNullOrWhiteSpace($Value)) {
    $List.Add($Name)
    $List.Add($Value)
  }
}

$nodeArgs = [System.Collections.Generic.List[string]]::new()
$nodeArgs.Add($harness)
Add-Argument $nodeArgs '--mode' $Mode
Add-Argument $nodeArgs '--routine-root' $RoutineRoot
Add-Argument $nodeArgs '--reader-root' $ReaderRoot
Add-Argument $nodeArgs '--meditation-root' $MeditationRoot
Add-Argument $nodeArgs '--routine-sha' $RoutineSha
Add-Argument $nodeArgs '--reader-sha' $ReaderSha
Add-Argument $nodeArgs '--meditation-sha' $MeditationSha
Add-Argument $nodeArgs '--apps' $Apps
Add-Argument $nodeArgs '--sdk' $AndroidSdk
Add-Argument $nodeArgs '--build-tools-version' $BuildToolsVersion
Add-Argument $nodeArgs '--jdk-home' $JdkHome
Add-Argument $nodeArgs '--gradle-home' $GradleHome
Add-Argument $nodeArgs '--gradle-launcher-jar' $GradleLauncherJar
Add-Argument $nodeArgs '--gradle-user-home' $GradleUserHome
Add-Argument $nodeArgs '--max-heap-mb' ([string]$MaxHeapMb)
Add-Argument $nodeArgs '--architectures' $Architectures
Add-Argument $nodeArgs '--keystore' $Keystore
Add-Argument $nodeArgs '--key-alias' $KeyAlias
Add-Argument $nodeArgs '--expected-cert-sha256' $ExpectedCertSha256
Add-Argument $nodeArgs '--ks-pass-env' $KeystorePassEnv
Add-Argument $nodeArgs '--key-pass-env' $KeyPassEnv
Add-Argument $nodeArgs '--output-dir' $OutputDir
Add-Argument $nodeArgs '--manifest' $Manifest
if ($RoutineVersionCode -gt 0) {
  Add-Argument $nodeArgs '--routine-version-code' ([string]$RoutineVersionCode)
}
if ($AllowLowMemory) { $nodeArgs.Add('--allow-low-memory') }
if ($EmulatorRunning) { $nodeArgs.Add('--emulator-running') }
if ($Strict) { $nodeArgs.Add('--strict') }

# Fail before invoking anything if password values are absent. The values
# themselves are never read into a variable, printed, or placed in argv.
if ($Mode -eq 'build') {
  $environmentNames = [Environment]::GetEnvironmentVariables().Keys
  if ($environmentNames -notcontains $KeystorePassEnv) {
    throw "Keystore password environment variable '$KeystorePassEnv' is not set."
  }
  if ($environmentNames -notcontains $KeyPassEnv) {
    throw "Key password environment variable '$KeyPassEnv' is not set."
  }
  if (-not $Keystore -or -not (Test-Path -LiteralPath $Keystore)) {
    throw 'A shared keystore outside every repository is required for build mode (--Keystore / SW005_KEYSTORE).'
  }
}

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $node
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WorkingDirectory = $repoRoot

if ($psi.PSObject.Properties['ArgumentList']) {
  foreach ($argument in $nodeArgs) {
    $psi.ArgumentList.Add($argument)
  }
  $process = [System.Diagnostics.Process]::Start($psi)
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "SW-2026-005 QA harness exited with code $($process.ExitCode)."
  }
} else {
  # Windows PowerShell 5.1 (.NET Framework) has no ArgumentList. Native
  # command invocation still passes the array as discrete argv entries; no
  # string is composed, so spaces/quotes stay safe.
  $nodeArgv = $nodeArgs.ToArray()
  & $node @nodeArgv
  if ($LASTEXITCODE -ne 0) {
    throw "SW-2026-005 QA harness exited with code $LASTEXITCODE."
  }
}
