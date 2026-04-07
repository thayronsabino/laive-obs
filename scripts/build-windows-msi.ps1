param(
  [string]$BundleRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist\windows-alpha\bundle"),
  [string]$OutputDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist\windows-alpha"),
  [string]$AppVersion = "0.1.0-alpha",
  [string]$MetadataPath
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

function Resolve-CommandPath {
  param(
    [Parameter(Mandatory = $true)][string]$Name
  )

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }
  return $null
}

function Resolve-WixToolFromRoot {
  param(
    [Parameter(Mandatory = $true)][string]$RootPath,
    [Parameter(Mandatory = $true)][string]$ToolName
  )

  if (-not $RootPath) {
    return $null
  }

  $candidates = @(
    (Join-Path $RootPath $ToolName),
    (Join-Path (Join-Path $RootPath "bin") $ToolName)
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Get-WixInstallCandidates {
  $roots = New-Object System.Collections.Generic.List[string]

  if ($env:LAIVE_WIX_BIN_PATH) {
    $roots.Add($env:LAIVE_WIX_BIN_PATH)
  }

  if ($env:WIX) {
    $roots.Add($env:WIX)
  }

  foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $pf) {
      continue
    }
    if (-not (Test-Path $pf)) {
      continue
    }

    $directRoots = @(
      (Join-Path $pf "WiX Toolset v3.11"),
      (Join-Path $pf "WiX Toolset v3.14"),
      (Join-Path $pf "WiX Toolset")
    )
    foreach ($root in $directRoots) {
      if (Test-Path $root) {
        $roots.Add($root)
      }
    }

    Get-ChildItem -Path $pf -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like "WiX Toolset v3*" -or $_.Name -eq "WiX Toolset" } |
      ForEach-Object {
        $roots.Add($_.FullName)
      }
  }

  return $roots.ToArray() | Select-Object -Unique
}

function Install-PortableWixTools {
  param(
    [string]$Version = "3.14.1"
  )

  $cacheBase = if ($env:LAIVE_WIX_CACHE_DIR) {
    if ([System.IO.Path]::IsPathRooted($env:LAIVE_WIX_CACHE_DIR)) {
      $env:LAIVE_WIX_CACHE_DIR
    }
    else {
      Join-Path (Split-Path -Parent $PSScriptRoot) $env:LAIVE_WIX_CACHE_DIR
    }
  }
  else {
    Join-Path (Join-Path $env:LOCALAPPDATA "laive-obs\tools\wix") $Version
  }

  $packageDir = Join-Path $cacheBase "package"
  $toolsDir = Join-Path $packageDir "tools"
  $requiredTools = @("heat.exe", "candle.exe", "light.exe")
  $missingTools = @(
    $requiredTools | Where-Object {
      -not (Test-Path (Join-Path $toolsDir $_))
    }
  )
  if ($missingTools.Count -eq 0) {
    return $toolsDir
  }

  New-Item -ItemType Directory -Force -Path $cacheBase | Out-Null

  $nupkgPath = Join-Path $cacheBase "wix.$Version.nupkg"
  $url = "https://api.nuget.org/v3-flatcontainer/wix/$Version/wix.$Version.nupkg"
  Write-Host "[msi] Downloading portable WiX v$Version from NuGet..."
  Invoke-WebRequest -Uri $url -OutFile $nupkgPath

  if (Test-Path $packageDir) {
    Remove-Item -Recurse -Force $packageDir
  }
  Expand-Archive -LiteralPath $nupkgPath -DestinationPath $packageDir -Force

  foreach ($tool in $requiredTools) {
    if (-not (Test-Path (Join-Path $toolsDir $tool))) {
      throw "Portable WiX download succeeded but missing '$tool' in '$toolsDir'."
    }
  }

  return $toolsDir
}

function Resolve-WixTools {
  $heat = Resolve-CommandPath -Name "heat.exe"
  $candle = Resolve-CommandPath -Name "candle.exe"
  $light = Resolve-CommandPath -Name "light.exe"

  $repoRoot = Split-Path -Parent $PSScriptRoot
  foreach ($candidateRootRaw in Get-WixInstallCandidates) {
    if ($heat -and $candle -and $light) {
      break
    }

    $candidateRoot = $candidateRootRaw
    if (-not [System.IO.Path]::IsPathRooted($candidateRoot)) {
      $candidateRoot = Join-Path $repoRoot $candidateRoot
    }

    if (-not $heat) {
      $heat = Resolve-WixToolFromRoot -RootPath $candidateRoot -ToolName "heat.exe"
    }
    if (-not $candle) {
      $candle = Resolve-WixToolFromRoot -RootPath $candidateRoot -ToolName "candle.exe"
    }
    if (-not $light) {
      $light = Resolve-WixToolFromRoot -RootPath $candidateRoot -ToolName "light.exe"
    }
  }

  if (-not $heat -or -not $candle -or -not $light) {
    $disableAutoDownload = @("1", "true", "yes", "on") -contains "$env:LAIVE_DISABLE_WIX_AUTO_DOWNLOAD".Trim().ToLowerInvariant()
    if (-not $disableAutoDownload) {
      $version = if ($env:LAIVE_WIX_VERSION) { $env:LAIVE_WIX_VERSION } else { "3.14.1" }
      try {
        $portableToolsDir = Install-PortableWixTools -Version $version
        if (-not $heat) {
          $heat = Join-Path $portableToolsDir "heat.exe"
        }
        if (-not $candle) {
          $candle = Join-Path $portableToolsDir "candle.exe"
        }
        if (-not $light) {
          $light = Join-Path $portableToolsDir "light.exe"
        }
      }
      catch {
        Write-Warning "[msi] Portable WiX bootstrap failed: $($_.Exception.Message)"
      }
    }
  }

  if (-not $heat -or -not $candle -or -not $light) {
    throw "WiX Toolset v3 commands not found (heat.exe/candle.exe/light.exe). Install WiX Toolset 3 (`choco install wixtoolset -y` or `winget install --id WiXToolset.WiXToolset`), set LAIVE_WIX_BIN_PATH, or allow auto-download from NuGet."
  }

  return [ordered]@{
    heat = $heat
    candle = $candle
    light = $light
  }
}

function Convert-ToMsiVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Version
  )

  if ($Version -match '(\d+)\.(\d+)\.(\d+)') {
    return "$($Matches[1]).$($Matches[2]).$($Matches[3])"
  }
  if ($Version -match '(\d+)\.(\d+)') {
    return "$($Matches[1]).$($Matches[2]).0"
  }
  return "0.1.0"
}

function Invoke-OptionalMsiSigning {
  param(
    [Parameter(Mandatory = $true)][string]$MsiPath,
    [Parameter(Mandatory = $true)][string]$RepoRoot
  )

  $signScript = $env:LAIVE_WINDOWS_MSI_SIGN_SCRIPT
  if (-not $signScript) {
    $signScript = $env:LAIVE_WINDOWS_INSTALLER_SIGN_SCRIPT
  }
  if (-not $signScript) {
    $signScript = $env:LAIVE_WINDOWS_SIGN_SCRIPT
  }

  if (-not $signScript) {
    return [ordered]@{
      status = "not-configured"
      note = "Set LAIVE_WINDOWS_MSI_SIGN_SCRIPT (or installer/global sign script) to sign MSI."
      script = $null
      requested = $false
    }
  }

  $resolvedSignScript = if ([System.IO.Path]::IsPathRooted($signScript)) {
    $signScript
  }
  else {
    Join-Path $RepoRoot $signScript
  }

  if (-not (Test-Path $resolvedSignScript)) {
    throw "Configured MSI signing script not found: $resolvedSignScript"
  }

  Write-Host "[msi] Signing MSI..."
  powershell -ExecutionPolicy Bypass -File $resolvedSignScript -ArtifactPath $MsiPath | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "MSI signing failed with exit code $LASTEXITCODE."
  }

  return [ordered]@{
    status = "signed"
    note = "MSI signed via custom script."
    script = $resolvedSignScript
    requested = $true
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
$bundleRootPath = [System.IO.Path]::GetFullPath($BundleRoot)
$outputDirPath = [System.IO.Path]::GetFullPath($OutputDir)
$metadataPathValue = if ($MetadataPath) {
  [System.IO.Path]::GetFullPath($MetadataPath)
}
else {
  Join-Path $outputDirPath "msi-metadata.json"
}

if (-not (Test-Path $bundleRootPath)) {
  throw "Bundle root not found: $bundleRootPath"
}

if (-not (Test-Path $outputDirPath)) {
  New-Item -ItemType Directory -Force -Path $outputDirPath | Out-Null
}

$wix = Resolve-WixTools
$tmpDir = Join-Path $outputDirPath "msi-tmp"
if (Test-Path $tmpDir) {
  Remove-Item -Recurse -Force $tmpDir
}
New-Item -ItemType Directory -Path $tmpDir | Out-Null

$productVersion = Convert-ToMsiVersion -Version $AppVersion
$harvestWxsPath = Join-Path $tmpDir "bundle-harvest.wxs"
$mainWxsPath = Join-Path $tmpDir "main.wxs"
$outputBaseName = "laive-obs-windows-alpha-installer"
$msiPath = Join-Path $outputDirPath ($outputBaseName + ".msi")

$heatArgs = @(
  "dir",
  $bundleRootPath,
  "-nologo",
  "-gg",
  "-g1",
  "-srd",
  "-dr",
  "INSTALLFOLDER",
  "-cg",
  "BundleFiles",
  "-var",
  "var.BundleRoot",
  "-out",
  $harvestWxsPath
)

Write-Host "[msi] Harvesting bundle with heat.exe..."
& $wix.heat @heatArgs | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "heat.exe failed with exit code $LASTEXITCODE."
}

$mainWxs = @'
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product
    Id="*"
    UpgradeCode="2C15D2E6-8D11-43A0-95F1-6AA1349A772E"
    Language="1033"
    Manufacturer="LAIVE"
    Name="LAIVE OBS"
    Version="$(var.ProductVersion)">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perUser"/>
    <MajorUpgrade DowngradeErrorMessage="A newer version of [ProductName] is already installed."/>
    <MediaTemplate EmbedCab="yes"/>

    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="LocalAppDataFolder">
        <Directory Id="INSTALLFOLDER" Name="LAIVE OBS"/>
      </Directory>
      <Directory Id="ProgramMenuFolder">
        <Directory Id="ProgramMenuDir" Name="LAIVE OBS"/>
      </Directory>
      <Directory Id="DesktopFolder"/>
    </Directory>

    <DirectoryRef Id="ProgramMenuDir">
      <Component Id="ProgramMenuShortcutComponent" Guid="*">
        <Shortcut
          Id="ProgramMenuShortcut"
          Name="LAIVE OBS"
          Description="Launch LAIVE OBS"
          Target="[INSTALLFOLDER]start-laive-obs.cmd"
          WorkingDirectory="INSTALLFOLDER"/>
        <RemoveFolder Id="ProgramMenuDirRemove" On="uninstall"/>
        <RegistryValue Root="HKCU" Key="Software\LAIVE\LAIVE OBS" Name="ProgramMenuShortcut" Type="integer" Value="1" KeyPath="yes"/>
      </Component>
    </DirectoryRef>

    <DirectoryRef Id="DesktopFolder">
      <Component Id="DesktopShortcutComponent" Guid="*">
        <Shortcut
          Id="DesktopShortcut"
          Name="LAIVE OBS"
          Description="Launch LAIVE OBS"
          Target="[INSTALLFOLDER]start-laive-obs.cmd"
          WorkingDirectory="INSTALLFOLDER"/>
        <RegistryValue Root="HKCU" Key="Software\LAIVE\LAIVE OBS" Name="DesktopShortcut" Type="integer" Value="1" KeyPath="yes"/>
      </Component>
    </DirectoryRef>

    <Feature Id="MainFeature" Title="LAIVE OBS" Level="1">
      <ComponentGroupRef Id="BundleFiles"/>
      <ComponentRef Id="ProgramMenuShortcutComponent"/>
      <ComponentRef Id="DesktopShortcutComponent"/>
    </Feature>
  </Product>
</Wix>
'@
Set-Content -Path $mainWxsPath -Value $mainWxs -Encoding UTF8

$mainObj = Join-Path $tmpDir "main.wixobj"
$harvestObj = Join-Path $tmpDir "bundle-harvest.wixobj"
$candleCommonArgs = @(
  "-nologo",
  "-dBundleRoot=$bundleRootPath",
  "-dProductVersion=$productVersion"
)
$candleMainArgs =
  $candleCommonArgs +
  @(
    "-out",
    $mainObj,
    $mainWxsPath
  )
$candleHarvestArgs =
  $candleCommonArgs +
  @(
    "-out",
    $harvestObj,
    $harvestWxsPath
  )

Write-Host "[msi] Compiling main WiX source..."
& $wix.candle @candleMainArgs | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "candle.exe (main.wxs) failed with exit code $LASTEXITCODE."
}

Write-Host "[msi] Compiling harvested WiX source..."
& $wix.candle @candleHarvestArgs | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "candle.exe (bundle-harvest.wxs) failed with exit code $LASTEXITCODE."
}

$lightArgs = @(
  "-nologo",
  "-spdb",
  "-sice:ICE38",
  "-sice:ICE64",
  "-sice:ICE91",
  "-out",
  $msiPath,
  $mainObj,
  $harvestObj
)

Write-Host "[msi] Linking MSI package..."
& $wix.light @lightArgs | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "light.exe failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path $msiPath)) {
  throw "MSI build completed but output file not found: $msiPath"
}

if (Test-Path $tmpDir) {
  Remove-Item -Recurse -Force $tmpDir
}

$msiSigning = Invoke-OptionalMsiSigning -MsiPath $msiPath -RepoRoot $repoRoot
$signatureInfo = & (Join-Path $repoRoot "scripts\verify-authenticode-signature.ps1") -ArtifactPath $msiPath
if (Test-TrueLike -Value $env:LAIVE_REQUIRE_SIGNED_WINDOWS) {
  if ($signatureInfo.status -ne "Valid") {
    throw "LAIVE_REQUIRE_SIGNED_WINDOWS is enabled, but MSI Authenticode status is '$($signatureInfo.status)'."
  }
}
if ($msiSigning.requested -and $signatureInfo.status -ne "Valid") {
  throw "MSI signing was requested, but authenticode status is '$($signatureInfo.status)'."
}

$msiSha256 = Get-Sha256Hex -Path $msiPath
$metadata = [ordered]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  msiFile = (Split-Path -Leaf $msiPath)
  msiPath = $msiPath
  msiSha256 = $msiSha256
  version = $AppVersion
  productVersion = $productVersion
  engine = [ordered]@{
    type = "wix-v3"
    heatPath = $wix.heat
    candlePath = $wix.candle
    lightPath = $wix.light
  }
  signing = $msiSigning
  authenticode = $signatureInfo
  signingPolicy = [ordered]@{
    requireSignedWindows = (Test-TrueLike -Value $env:LAIVE_REQUIRE_SIGNED_WINDOWS)
  }
}

($metadata | ConvertTo-Json -Depth 6) | Set-Content -Path $metadataPathValue -Encoding UTF8
Write-Host "[msi] Built: $msiPath"
Write-Host "[msi] Metadata: $metadataPathValue"
