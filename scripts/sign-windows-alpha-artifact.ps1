param(
  [Parameter(Mandatory = $true)][string]$ArtifactPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path $ArtifactPath)) {
  throw "Artifact not found: $ArtifactPath"
}

function Resolve-SignToolPath {
  $fromEnv = $env:LAIVE_SIGNTOOL_PATH
  if ($fromEnv) {
    if ([System.IO.Path]::IsPathRooted($fromEnv)) {
      if (Test-Path $fromEnv) {
        return $fromEnv
      }
    }
    else {
      $cmd = Get-Command $fromEnv -ErrorAction SilentlyContinue
      if ($cmd) {
        return $cmd.Source
      }
    }
  }

  $direct = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
  if ($direct) {
    return $direct.Source
  }

  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (Test-Path $kitsRoot) {
    $candidates = Get-ChildItem -Path $kitsRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
      Where-Object { Test-Path $_ }

    if ($candidates.Count -gt 0) {
      return $candidates[0]
    }
  }

  return $null
}

$signToolPath = Resolve-SignToolPath
if (-not $signToolPath) {
  throw "signtool.exe not found. Install Windows SDK or set LAIVE_SIGNTOOL_PATH."
}

$timestampUrl = $env:LAIVE_SIGN_TIMESTAMP_URL
if (-not $timestampUrl) {
  $timestampUrl = "https://timestamp.digicert.com"
}

$args = @("sign", "/fd", "SHA256", "/tr", $timestampUrl, "/td", "SHA256")

$certFile = $env:LAIVE_SIGN_CERT_FILE
$certPassword = $env:LAIVE_SIGN_CERT_PASSWORD
$certThumbprint = $env:LAIVE_SIGN_CERT_SHA1

if ($certFile) {
  $resolvedCertFile = if ([System.IO.Path]::IsPathRooted($certFile)) {
    $certFile
  }
  else {
    Join-Path (Split-Path -Parent $PSScriptRoot) $certFile
  }

  if (-not (Test-Path $resolvedCertFile)) {
    throw "Certificate file not found: $resolvedCertFile"
  }

  $args += @("/f", $resolvedCertFile)
  if ($certPassword) {
    $args += @("/p", $certPassword)
  }
}
elseif ($certThumbprint) {
  $args += @("/sha1", $certThumbprint)
}
else {
  throw "Missing certificate config. Set LAIVE_SIGN_CERT_FILE (+ optional LAIVE_SIGN_CERT_PASSWORD) or LAIVE_SIGN_CERT_SHA1."
}

$args += $ArtifactPath

Write-Host "[sign] Running signtool with configured certificate source."
Write-Host "[sign] Tool: $signToolPath"
Write-Host "[sign] Artifact: $ArtifactPath"
& $signToolPath @args
if ($LASTEXITCODE -ne 0) {
  throw "signtool failed with exit code $LASTEXITCODE."
}

$verifyArgs = @("verify", "/pa", $ArtifactPath)
& $signToolPath @verifyArgs
if ($LASTEXITCODE -ne 0) {
  throw "signtool verify failed with exit code $LASTEXITCODE."
}

Write-Host "[sign] Artifact signed: $ArtifactPath"
