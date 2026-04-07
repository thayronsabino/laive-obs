$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$env:RUN_E2E = "1"
npm --workspace apps/core-service run test:e2e:internal
