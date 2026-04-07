param(
  [Parameter(Mandatory = $true)][string]$Repository,
  [string]$PfxPath,
  [string]$PfxPassword,
  [string]$CertSha1,
  [string]$TimestampUrl = "http://timestamp.digicert.com",
  [switch]$RequireSignedWindows,
  [switch]$EnableWindowsZipSigning
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-GhAuth {
  $null = gh auth status 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
  }
}

function Set-GhSecret {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $Value | gh secret set $Name --repo $Repository --body - | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set secret '$Name' in '$Repository'."
  }
  Write-Host "[secrets] Set $Name"
}

Assert-GhAuth

if ($RequireSignedWindows -and -not $PfxPath -and -not $CertSha1) {
  Write-Warning "[secrets] LAIVE_REQUIRE_SIGNED_WINDOWS sera habilitado sem novo material de assinatura nesta execucao."
  Write-Warning "[secrets] Certifique-se de que os secrets LAIVE_SIGN_CERT_PFX_BASE64 ou LAIVE_SIGN_CERT_SHA1 ja estejam configurados no repositorio."
}

if ($PfxPath) {
  $resolvedPfxPath = [System.IO.Path]::GetFullPath($PfxPath)
  if (-not (Test-Path $resolvedPfxPath)) {
    throw "PFX file not found: $resolvedPfxPath"
  }
  $pfxBytes = [System.IO.File]::ReadAllBytes($resolvedPfxPath)
  $pfxBase64 = [System.Convert]::ToBase64String($pfxBytes)
  Set-GhSecret -Name "LAIVE_SIGN_CERT_PFX_BASE64" -Value $pfxBase64
}

if ($PfxPassword) {
  Set-GhSecret -Name "LAIVE_SIGN_CERT_PASSWORD" -Value $PfxPassword
}

if ($CertSha1) {
  Set-GhSecret -Name "LAIVE_SIGN_CERT_SHA1" -Value $CertSha1
}

if ($TimestampUrl) {
  Set-GhSecret -Name "LAIVE_SIGN_TIMESTAMP_URL" -Value $TimestampUrl
}

if ($RequireSignedWindows) {
  Set-GhSecret -Name "LAIVE_REQUIRE_SIGNED_WINDOWS" -Value "1"
}
else {
  Set-GhSecret -Name "LAIVE_REQUIRE_SIGNED_WINDOWS" -Value "0"
}

if ($EnableWindowsZipSigning) {
  Set-GhSecret -Name "LAIVE_ENABLE_WINDOWS_ZIP_SIGNING" -Value "1"
}
else {
  Set-GhSecret -Name "LAIVE_ENABLE_WINDOWS_ZIP_SIGNING" -Value "0"
}

Write-Host "[secrets] Done for repository: $Repository"
