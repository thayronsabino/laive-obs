param(
  [int]$DurationSec = 3600,
  [int]$DestinationCount = 3,
  [int]$OutageIntervalSec = 90,
  [int]$OutageDurationSec = 12
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ($DurationSec -lt 30) {
  throw "DurationSec must be >= 30."
}
if ($DestinationCount -lt 2) {
  throw "DestinationCount must be >= 2."
}
if ($OutageIntervalSec -lt 10) {
  throw "OutageIntervalSec must be >= 10."
}
if ($OutageDurationSec -lt 3) {
  throw "OutageDurationSec must be >= 3."
}

$env:RUN_E2E_SOAK = "1"
$env:E2E_SOAK_DURATION_SEC = [string]$DurationSec
$env:E2E_SOAK_DESTINATION_COUNT = [string]$DestinationCount
$env:E2E_SOAK_OUTAGE_INTERVAL_SEC = [string]$OutageIntervalSec
$env:E2E_SOAK_OUTAGE_DURATION_SEC = [string]$OutageDurationSec

Write-Host "[e2e-soak] DurationSec=$DurationSec DestinationCount=$DestinationCount OutageIntervalSec=$OutageIntervalSec OutageDurationSec=$OutageDurationSec"
npm --workspace apps/core-service run test:e2e:soak:internal
