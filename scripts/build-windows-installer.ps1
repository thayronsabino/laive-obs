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

function Resolve-IsccPath {
  $candidatePaths = @()
  if ($env:LAIVE_INNO_ISCC_PATH) {
    $candidatePaths += $env:LAIVE_INNO_ISCC_PATH
  }
  if ($env:ProgramFiles) {
    $candidatePaths += (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
  }
  if ($env:ProgramFiles -and $env:ProgramFiles -ne ${env:ProgramFiles(x86)}) {
    $candidatePaths += (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
  }

  foreach ($candidate in $candidatePaths) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return $null
}

function Invoke-OptionalInstallerSigning {
  param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$RepoRoot
  )

  $signScript = $env:LAIVE_WINDOWS_INSTALLER_SIGN_SCRIPT
  if (-not $signScript) {
    $signScript = $env:LAIVE_WINDOWS_SIGN_SCRIPT
  }

  if (-not $signScript) {
    return [ordered]@{
      status = "not-configured"
      note = "Set LAIVE_WINDOWS_INSTALLER_SIGN_SCRIPT (or LAIVE_WINDOWS_SIGN_SCRIPT) to sign installer."
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
    throw "Configured installer signing script not found: $resolvedSignScript"
  }

  Write-Host "[installer] Signing installer..."
  powershell -ExecutionPolicy Bypass -File $resolvedSignScript -ArtifactPath $InstallerPath | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Installer signing failed with exit code $LASTEXITCODE."
  }

  return [ordered]@{
    status = "signed"
    note = "Installer signed via custom script."
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
  Join-Path $outputDirPath "installer-metadata.json"
}

if (-not (Test-Path $bundleRootPath)) {
  throw "Bundle root not found: $bundleRootPath"
}

if (-not (Test-Path $outputDirPath)) {
  New-Item -ItemType Directory -Force -Path $outputDirPath | Out-Null
}

$isccPath = Resolve-IsccPath
if (-not $isccPath) {
  throw "Inno Setup compiler not found. Install Inno Setup 6 or set LAIVE_INNO_ISCC_PATH."
}

$tmpDir = Join-Path $outputDirPath "installer-tmp"
if (Test-Path $tmpDir) {
  Remove-Item -Recurse -Force $tmpDir
}
New-Item -ItemType Directory -Path $tmpDir | Out-Null

$issPath = Join-Path $tmpDir "laive-obs-windows-alpha.iss"
$outputBaseFilename = "laive-obs-windows-alpha-installer"
$installerPath = Join-Path $outputDirPath ($outputBaseFilename + ".exe")

$iss = @'
#define MyAppName "LAIVE OBS"
#define MyPublisher "LAIVE"
#define MyMainExe "start-laive-obs.cmd"

[Setup]
AppId={{7D5F31FE-2FE5-4FD0-903B-8BF554E1D5F7}
AppName={#MyAppName}
AppVersion={#MyVersion}
AppPublisher={#MyPublisher}
DefaultDirName={localappdata}\Programs\LAIVE OBS
DefaultGroupName=LAIVE OBS
DisableProgramGroupPage=yes
OutputDir={#MyOutput}
OutputBaseFilename={#MyOutBase}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible and x86compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#MySource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\LAIVE OBS"; Filename: "{app}\{#MyMainExe}"; WorkingDir: "{app}"
Name: "{autodesktop}\LAIVE OBS"; Filename: "{app}\{#MyMainExe}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyMainExe}"; Description: "{cm:LaunchProgram,LAIVE OBS}"; Flags: nowait postinstall skipifsilent
'@
Set-Content -Path $issPath -Value $iss -Encoding ASCII

$isccArgs = @(
  "/Qp",
  "/DMyVersion=$AppVersion",
  "/DMySource=$bundleRootPath",
  "/DMyOutput=$outputDirPath",
  "/DMyOutBase=$outputBaseFilename",
  $issPath
)

Write-Host "[installer] Building with ISCC: $isccPath"
& $isccPath @isccArgs | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "ISCC failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path $installerPath)) {
  throw "Installer build completed but output file not found: $installerPath"
}

if (Test-Path $tmpDir) {
  Remove-Item -Recurse -Force $tmpDir
}

$installerSigning = Invoke-OptionalInstallerSigning -InstallerPath $installerPath -RepoRoot $repoRoot
$signatureInfo = & (Join-Path $repoRoot "scripts\verify-authenticode-signature.ps1") -ArtifactPath $installerPath
if (Test-TrueLike -Value $env:LAIVE_REQUIRE_SIGNED_WINDOWS) {
  if ($signatureInfo.status -ne "Valid") {
    throw "LAIVE_REQUIRE_SIGNED_WINDOWS is enabled, but installer Authenticode status is '$($signatureInfo.status)'."
  }
}
if ($installerSigning.requested -and $signatureInfo.status -ne "Valid") {
  throw "Installer signing was requested, but authenticode status is '$($signatureInfo.status)'."
}
$installerSha256 = Get-Sha256Hex -Path $installerPath

$metadata = [ordered]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  installerFile = (Split-Path -Leaf $installerPath)
  installerPath = $installerPath
  installerSha256 = $installerSha256
  version = $AppVersion
  engine = [ordered]@{
    type = "inno-setup"
    isccPath = $isccPath
  }
  signing = $installerSigning
  authenticode = $signatureInfo
  signingPolicy = [ordered]@{
    requireSignedWindows = (Test-TrueLike -Value $env:LAIVE_REQUIRE_SIGNED_WINDOWS)
  }
}

($metadata | ConvertTo-Json -Depth 6) | Set-Content -Path $metadataPathValue -Encoding UTF8
Write-Host "[installer] Built: $installerPath"
Write-Host "[installer] Metadata: $metadataPathValue"
