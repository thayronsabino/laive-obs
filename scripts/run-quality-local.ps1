$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "[quality] Installing dependencies..."
npm ci | Out-Host

Write-Host "[quality] FFmpeg healthcheck..."
npm run ffmpeg:healthcheck | Out-Host

Write-Host "[quality] Unit + integration tests..."
npm run test | Out-Host

Write-Host "[quality] E2E tests..."
npm run test:e2e | Out-Host

Write-Host "[quality] Packaging windows alpha..."
npm run package:windows-alpha | Out-Host

Write-Host "[quality] Verifying windows alpha package..."
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "verify-windows-alpha.ps1") -BundleRoot (Join-Path $repoRoot "dist\windows-alpha\bundle") -ChecksumsFile (Join-Path $repoRoot "dist\windows-alpha\checksums.sha256") -IncludeExternal | Out-Host

Write-Host "[quality] Completed successfully."
