param(
  [string]$BundleRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist\windows-alpha\bundle"),
  [string]$ChecksumsFile,
  [switch]$IncludeExternal
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-Sha256Hex {
  param(
    [Parameter(Mandatory = $true)][string]$Path
  )

  $fileStream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha.ComputeHash($fileStream)
    }
    finally {
      $sha.Dispose()
    }
  }
  finally {
    $fileStream.Dispose()
  }

  return -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
}

function Resolve-ChecksumsFile {
  param(
    [Parameter(Mandatory = $true)][string]$RootDir,
    [string]$ProvidedChecksumsFile
  )

  if ($ProvidedChecksumsFile) {
    return [System.IO.Path]::GetFullPath($ProvidedChecksumsFile)
  }

  $bundleManifest = Join-Path $RootDir "checksums.bundle.sha256"
  if (Test-Path $bundleManifest) {
    return $bundleManifest
  }

  $parentManifest = Join-Path (Split-Path -Parent $RootDir) "checksums.sha256"
  if (Test-Path $parentManifest) {
    return $parentManifest
  }

  throw "No checksum manifest found. Expected checksums.bundle.sha256 in bundle root or checksums.sha256 beside the bundle."
}

$bundleRootPath = [System.IO.Path]::GetFullPath($BundleRoot)
if (-not (Test-Path $bundleRootPath)) {
  throw "Bundle root not found: $bundleRootPath"
}

$manifestPath = Resolve-ChecksumsFile -RootDir $bundleRootPath -ProvidedChecksumsFile $ChecksumsFile
if (-not (Test-Path $manifestPath)) {
  throw "Checksum manifest not found: $manifestPath"
}

$manifestDir = Split-Path -Parent $manifestPath
$manifestName = Split-Path -Leaf $manifestPath
$manifestEntries = Get-Content $manifestPath | Where-Object { $_.Trim().Length -gt 0 }

$checkedCount = 0
$missingFiles = [System.Collections.Generic.List[string]]::new()
$mismatchedFiles = [System.Collections.Generic.List[string]]::new()
$invalidLines = [System.Collections.Generic.List[string]]::new()

foreach ($line in $manifestEntries) {
  if ($line -notmatch "^(?<hash>[0-9A-Fa-f]{64}) \*(?<path>.+)$") {
    $invalidLines.Add($line)
    continue
  }

  $expectedHash = $matches["hash"].ToLowerInvariant()
  $relativePath = $matches["path"]
  $bundlePath = Join-Path $bundleRootPath $relativePath
  $manifestPathCandidate = Join-Path $manifestDir $relativePath
  $bundleExists = Test-Path $bundlePath
  $manifestExists = Test-Path $manifestPathCandidate

  if ($bundleExists) {
    $targetPath = $bundlePath
  }
  elseif ($manifestExists) {
    if (-not $IncludeExternal) {
      continue
    }
    $targetPath = $manifestPathCandidate
  }
  else {
    $targetPath = $bundlePath
  }

  if (-not (Test-Path $targetPath)) {
    $missingFiles.Add($targetPath)
    continue
  }

  $actualHash = Get-Sha256Hex -Path $targetPath
  if ($actualHash -ne $expectedHash) {
    $mismatchedFiles.Add("$targetPath (expected: $expectedHash, actual: $actualHash)")
    continue
  }

  $checkedCount += 1
}

if ($invalidLines.Count -gt 0) {
  Write-Host "[verify] Invalid checksum manifest lines:"
  $invalidLines | ForEach-Object { Write-Host "  $_" }
  exit 1
}

if ($missingFiles.Count -gt 0) {
  Write-Host "[verify] Missing files:"
  $missingFiles | ForEach-Object { Write-Host "  $_" }
  exit 1
}

if ($mismatchedFiles.Count -gt 0) {
  Write-Host "[verify] Hash mismatch:"
  $mismatchedFiles | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Write-Host "[verify] Manifest: $manifestName"
Write-Host "[verify] Bundle root: $bundleRootPath"
Write-Host "[verify] Checked files: $checkedCount"
Write-Host "[verify] Status: OK"
