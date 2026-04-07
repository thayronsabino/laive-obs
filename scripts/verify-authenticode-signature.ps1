param(
  [Parameter(Mandatory = $true)][string]$ArtifactPath,
  [switch]$RequireValid
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
    $candidates = @(Get-ChildItem -Path $kitsRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
      Where-Object { Test-Path $_ })

    if ($candidates.Count -gt 0) {
      return $candidates[0]
    }
  }

  return $null
}

$authModuleReady = $false
try {
  Import-Module Microsoft.PowerShell.Security -ErrorAction Stop | Out-Null
  $authModuleReady = $true
}
catch {
  $authModuleReady = $false
}

if (-not $authModuleReady -or -not (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue)) {
  $resolvedSignTool = Resolve-SignToolPath

  if ($resolvedSignTool) {
    $stdoutFile = Join-Path $env:TEMP ("laive-sig-verify-" + [System.Guid]::NewGuid().ToString() + ".out.txt")
    $stderrFile = Join-Path $env:TEMP ("laive-sig-verify-" + [System.Guid]::NewGuid().ToString() + ".err.txt")
    try {
      $quotedArtifactPath = '"' + $ArtifactPath + '"'
      $proc = Start-Process `
        -FilePath $resolvedSignTool `
        -ArgumentList ("verify /pa " + $quotedArtifactPath) `
        -NoNewWindow `
        -PassThru `
        -Wait `
        -RedirectStandardOutput $stdoutFile `
        -RedirectStandardError $stderrFile

      $verifyExit = $proc.ExitCode
      $verifyOutput = @()
      if (Test-Path $stdoutFile) {
        $verifyOutput += Get-Content $stdoutFile
      }
      if (Test-Path $stderrFile) {
        $verifyOutput += Get-Content $stderrFile
      }
    }
    finally {
      if (Test-Path $stdoutFile) {
        Remove-Item -Force $stdoutFile
      }
      if (Test-Path $stderrFile) {
        Remove-Item -Force $stderrFile
      }
    }

    $status = if ($verifyExit -eq 0) { "Valid" } else { "InvalidOrNotSigned" }
    $statusMessage = ($verifyOutput | Select-Object -First 8 | ForEach-Object { $_.ToString().Trim() }) -join " | "

    $result = [ordered]@{
      file = [System.IO.Path]::GetFullPath($ArtifactPath)
      status = $status
      statusMessage = $statusMessage
      isValid = ($verifyExit -eq 0)
      signerSubject = $null
      signerThumbprint = $null
      timestampSubject = $null
    }

    if ($RequireValid -and -not $result.isValid) {
      throw "Authenticode verification via signtool failed for '$ArtifactPath'."
    }

    Write-Host "[authenticode] File: $($result.file)"
    Write-Host "[authenticode] Status: $($result.status)"
    [PSCustomObject]$result
    return
  }

  $result = [ordered]@{
    file = [System.IO.Path]::GetFullPath($ArtifactPath)
    status = "Unavailable"
    statusMessage = "Get-AuthenticodeSignature and signtool verification are unavailable in this runtime."
    isValid = $false
    signerSubject = $null
    signerThumbprint = $null
    timestampSubject = $null
  }

  if ($RequireValid) {
    throw "Authenticode verification is unavailable in this runtime."
  }

  Write-Host "[authenticode] File: $($result.file)"
  Write-Host "[authenticode] Status: $($result.status)"
  [PSCustomObject]$result
  return
}

$signature = Get-AuthenticodeSignature -FilePath $ArtifactPath
$signer = $signature.SignerCertificate
$timestamp = $signature.TimeStamperCertificate

$result = [ordered]@{
  file = [System.IO.Path]::GetFullPath($ArtifactPath)
  status = [string]$signature.Status
  statusMessage = $signature.StatusMessage
  isValid = ($signature.Status -eq "Valid")
  signerSubject = if ($signer) { $signer.Subject } else { $null }
  signerThumbprint = if ($signer) { $signer.Thumbprint } else { $null }
  timestampSubject = if ($timestamp) { $timestamp.Subject } else { $null }
}

if ($RequireValid -and -not $result.isValid) {
  throw "Invalid authenticode signature status '$($result.status)' for '$ArtifactPath'."
}

Write-Host "[authenticode] File: $($result.file)"
Write-Host "[authenticode] Status: $($result.status)"
if ($result.signerSubject) {
  Write-Host "[authenticode] Signer: $($result.signerSubject)"
}

[PSCustomObject]$result
