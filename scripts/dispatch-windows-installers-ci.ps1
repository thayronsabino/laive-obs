param(
  [Parameter(Mandatory = $true)][string]$Repository,
  [string]$Ref = "main",
  [switch]$RequireSignedWindows,
  [switch]$EnableZipSigning,
  [switch]$Wait
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-GhAuth {
  $null = gh auth status 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
  }
}

Assert-GhAuth

$requireSigned = if ($RequireSignedWindows.IsPresent) { "true" } else { "false" }
$zipSigning = if ($EnableZipSigning.IsPresent) { "true" } else { "false" }

Write-Host "[installers] Dispatching workflow on ref: $Ref"
gh workflow run "windows-installers-ci.yml" `
  --repo $Repository `
  --ref $Ref `
  --field "ref=$Ref" `
  --field "require_signed_windows=$requireSigned" `
  --field "enable_zip_signing=$zipSigning"

if ($LASTEXITCODE -ne 0) {
  throw "Failed to dispatch windows installers workflow in '$Repository'."
}

Start-Sleep -Seconds 4
$runJson = gh run list --repo $Repository --workflow "windows-installers-ci.yml" --limit 1 --json databaseId,url,status,conclusion,headBranch,event
if ($LASTEXITCODE -ne 0) {
  Write-Host "[installers] Workflow dispatched. Could not fetch run summary."
  exit 0
}

$runs = $runJson | ConvertFrom-Json
if ($runs.Count -eq 0) {
  Write-Host "[installers] Workflow dispatched. No run found yet."
  exit 0
}

$run = $runs[0]
Write-Host "[installers] Run ID: $($run.databaseId)"
Write-Host "[installers] Status: $($run.status)"
Write-Host "[installers] URL: $($run.url)"

if ($Wait.IsPresent) {
  Write-Host "[installers] Waiting for workflow completion..."
  gh run watch $run.databaseId --repo $Repository --exit-status
  if ($LASTEXITCODE -ne 0) {
    throw "Workflow run failed or was cancelled. Run URL: $($run.url)"
  }
}
