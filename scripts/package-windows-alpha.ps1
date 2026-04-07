$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-RelativePath {
  param(
    [Parameter(Mandatory = $true)][string]$BasePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )

  $base = [System.IO.Path]::GetFullPath($BasePath)
  $target = [System.IO.Path]::GetFullPath($TargetPath)
  $baseUri = [System.Uri]::new($base.TrimEnd('\') + '\')
  $targetUri = [System.Uri]::new($target)
  $relative = $baseUri.MakeRelativeUri($targetUri).ToString()
  return [System.Uri]::UnescapeDataString($relative).Replace('/', '\')
}

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

function Write-Checksums {
  param(
    [Parameter(Mandatory = $true)][string]$RootDir,
    [Parameter(Mandatory = $true)][string]$OutputFile
  )

  $files = Get-ChildItem -Path $RootDir -Recurse -File | Sort-Object FullName
  $lines = foreach ($file in $files) {
    $hash = Get-Sha256Hex -Path $file.FullName
    $relative = Get-RelativePath -BasePath $RootDir -TargetPath $file.FullName
    "$hash *$relative"
  }
  Set-Content -Path $OutputFile -Value $lines -Encoding ASCII
}

function Invoke-OptionalSigning {
  param(
    [Parameter(Mandatory = $true)][string]$ArtifactPath,
    [Parameter(Mandatory = $true)][string]$RepoRoot
  )

  $signScript = $env:LAIVE_WINDOWS_SIGN_SCRIPT
  if (-not $signScript) {
    return [ordered]@{
      status = "not-configured"
      note = "Set LAIVE_WINDOWS_SIGN_SCRIPT to sign the final artifact."
      script = $null
    }
  }

  $resolvedSignScript = if ([System.IO.Path]::IsPathRooted($signScript)) {
    $signScript
  }
  else {
    Join-Path $RepoRoot $signScript
  }

  if (-not (Test-Path $resolvedSignScript)) {
    throw "Configured signing script not found: $resolvedSignScript"
  }

  Write-Host "[pack] Signing artifact..."
  powershell -ExecutionPolicy Bypass -File $resolvedSignScript -ArtifactPath $ArtifactPath | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Signing script failed with exit code $LASTEXITCODE."
  }

  return [ordered]@{
    status = "signed"
    note = "Artifact signed via custom script."
    script = $resolvedSignScript
  }
}

function Test-TrueLike {
  param(
    [string]$Value
  )

  if (-not $Value) {
    return $false
  }

  $normalized = $Value.Trim().ToLowerInvariant()
  return @("1", "true", "yes", "on") -contains $normalized
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$outRoot = Join-Path $repoRoot "dist\windows-alpha"
$bundleDir = Join-Path $outRoot "bundle"
$zipPath = Join-Path $outRoot "laive-obs-windows-alpha.zip"
$bundleChecksumsPath = Join-Path $bundleDir "checksums.bundle.sha256"
$checksumsPath = Join-Path $outRoot "checksums.sha256"
$metadataPath = Join-Path $outRoot "build-metadata.json"

Write-Host "[pack] Cleaning previous output..."
if (Test-Path $outRoot) {
  Remove-Item -Recurse -Force $outRoot
}

New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null

Write-Host "[pack] Installing dependencies (workspace root)..."
if (Test-Path (Join-Path $repoRoot "package-lock.json")) {
  npm ci | Out-Host
}
else {
  npm install | Out-Host
}

Write-Host "[pack] Copying runtime files..."
$pathsToCopy = @(
  "apps",
  "infra",
  "scripts\run-e2e-tests.ps1",
  "scripts\run-e2e-soak-tests.ps1",
  "scripts\run-quality-local.ps1",
  "scripts\verify-windows-alpha.ps1",
  "scripts\verify-unix-alpha.sh",
  "scripts\package-unix-alpha.sh",
  "scripts\verify-authenticode-signature.ps1",
  "scripts\sign-windows-alpha-artifact.ps1",
  "scripts\build-windows-installer.ps1",
  "scripts\build-windows-msi.ps1",
  "package.json",
  "package-lock.json",
  ".gitignore",
  "docs\MVP_IMPLEMENTATION.md",
  "docs\E2E_VALIDATION.md"
)

foreach ($entry in $pathsToCopy) {
  $source = Join-Path $repoRoot $entry
  if (Test-Path $source) {
    Copy-Item -Path $source -Destination $bundleDir -Recurse -Force
  }
}

Write-Host "[pack] Writing startup and verify scripts..."
$cmd = @"
@echo off
cd /d %~dp0
npm run dev:desktop
"@
Set-Content -Path (Join-Path $bundleDir "start-laive-obs.cmd") -Value $cmd -Encoding ASCII

$startPs1 = @"
Set-Location `"$PSScriptRoot`"
npm run dev:desktop
"@
Set-Content -Path (Join-Path $bundleDir "start-laive-obs.ps1") -Value $startPs1 -Encoding ASCII

$verifyPs1 = @'
Set-Location "$PSScriptRoot"
$verifyScript = if (Test-Path ".\scripts\verify-windows-alpha.ps1") { ".\scripts\verify-windows-alpha.ps1" } else { ".\verify-windows-alpha.ps1" }
powershell -ExecutionPolicy Bypass -File $verifyScript -BundleRoot "$PSScriptRoot" -ChecksumsFile "$PSScriptRoot\checksums.bundle.sha256"
'@
Set-Content -Path (Join-Path $bundleDir "verify-bundle.ps1") -Value $verifyPs1 -Encoding ASCII

Write-Host "[pack] Writing checksums for bundle files..."
Write-Checksums -RootDir $bundleDir -OutputFile $bundleChecksumsPath
Write-Checksums -RootDir $bundleDir -OutputFile $checksumsPath

Write-Host "[pack] Creating zip..."
Compress-Archive -Path (Join-Path $bundleDir "*") -DestinationPath $zipPath -Force
$zipHash = Get-Sha256Hex -Path $zipPath
Add-Content -Path $checksumsPath -Value "$zipHash *laive-obs-windows-alpha.zip"

$signingMetadata = Invoke-OptionalSigning -ArtifactPath $zipPath -RepoRoot $repoRoot

$packageJson = Get-Content -Raw (Join-Path $repoRoot "package.json") | ConvertFrom-Json
$installerMetadata = [ordered]@{
  status = "not-requested"
  note = "Set LAIVE_BUILD_WINDOWS_INSTALLER=1 to build installer with Inno Setup."
}
$msiMetadata = [ordered]@{
  status = "not-requested"
  note = "Set LAIVE_BUILD_WINDOWS_MSI=1 to build MSI with WiX Toolset v3."
}

if (Test-TrueLike -Value $env:LAIVE_BUILD_WINDOWS_INSTALLER) {
  $installerMetadataPath = Join-Path $outRoot "installer-metadata.json"
  Write-Host "[pack] Building windows installer..."
  powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\build-windows-installer.ps1") -BundleRoot $bundleDir -OutputDir $outRoot -AppVersion $packageJson.version -MetadataPath $installerMetadataPath | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Installer build failed with exit code $LASTEXITCODE."
  }
  $installerMetadata = Get-Content -Raw $installerMetadataPath | ConvertFrom-Json

  if ($installerMetadata.installerSha256 -and $installerMetadata.installerFile) {
    Add-Content -Path $checksumsPath -Value "$($installerMetadata.installerSha256) *$($installerMetadata.installerFile)"
  }
}
else {
  $legacyInstallerPath = Join-Path $outRoot "laive-obs-windows-alpha-installer.exe"
  $legacyInstallerMetadataPath = Join-Path $outRoot "installer-metadata.json"
  if (Test-Path $legacyInstallerPath) {
    Remove-Item -Force $legacyInstallerPath
  }
  if (Test-Path $legacyInstallerMetadataPath) {
    Remove-Item -Force $legacyInstallerMetadataPath
  }
}

if (Test-TrueLike -Value $env:LAIVE_BUILD_WINDOWS_MSI) {
  $msiMetadataPath = Join-Path $outRoot "msi-metadata.json"
  Write-Host "[pack] Building windows msi..."
  powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\build-windows-msi.ps1") -BundleRoot $bundleDir -OutputDir $outRoot -AppVersion $packageJson.version -MetadataPath $msiMetadataPath | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "MSI build failed with exit code $LASTEXITCODE."
  }
  $msiMetadata = Get-Content -Raw $msiMetadataPath | ConvertFrom-Json

  if ($msiMetadata.msiSha256 -and $msiMetadata.msiFile) {
    Add-Content -Path $checksumsPath -Value "$($msiMetadata.msiSha256) *$($msiMetadata.msiFile)"
  }
}
else {
  $legacyMsiPath = Join-Path $outRoot "laive-obs-windows-alpha-installer.msi"
  $legacyMsiMetadataPath = Join-Path $outRoot "msi-metadata.json"
  if (Test-Path $legacyMsiPath) {
    Remove-Item -Force $legacyMsiPath
  }
  if (Test-Path $legacyMsiMetadataPath) {
    Remove-Item -Force $legacyMsiMetadataPath
  }
}

Write-Host "[pack] Verifying bundle integrity..."
powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\verify-windows-alpha.ps1") -BundleRoot $bundleDir -ChecksumsFile $bundleChecksumsPath | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Bundle integrity verification failed with exit code $LASTEXITCODE."
}

Write-Host "[pack] Verifying package integrity..."
powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\verify-windows-alpha.ps1") -BundleRoot $bundleDir -ChecksumsFile $checksumsPath -IncludeExternal | Out-Host

if ($LASTEXITCODE -ne 0) {
  throw "Package integrity verification failed with exit code $LASTEXITCODE."
}

$buildMetadata = [ordered]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  packageName = $packageJson.name
  packageVersion = $packageJson.version
  platform = "windows-alpha"
  nodeVersion = node -v
  npmVersion = npm -v
  gitCommit = "NO_GIT"
  zipFile = (Split-Path -Leaf $zipPath)
  zipSha256 = $zipHash
  bundleChecksumsFile = (Split-Path -Leaf $bundleChecksumsPath)
  checksumsFile = (Split-Path -Leaf $checksumsPath)
  signing = $signingMetadata
  installer = $installerMetadata
  msi = $msiMetadata
}
($buildMetadata | ConvertTo-Json -Depth 5) | Set-Content -Path $metadataPath -Encoding UTF8

Write-Host "[pack] Done."
Write-Host "[pack] Bundle: $bundleDir"
Write-Host "[pack] Zip: $zipPath"
Write-Host "[pack] Checksums: $checksumsPath"
Write-Host "[pack] Metadata: $metadataPath"
