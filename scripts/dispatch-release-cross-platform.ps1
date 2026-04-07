param(
  [Parameter(Mandatory = $true)][string]$Repository,
  [Parameter(Mandatory = $true)][string]$Tag
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

Write-Host "[release] Dispatching workflow for tag: $Tag"
gh workflow run "release-cross-platform.yml" --repo $Repository --field "tag=$Tag"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to dispatch release workflow in '$Repository'."
}

Start-Sleep -Seconds 4
$runJson = gh run list --repo $Repository --workflow "release-cross-platform.yml" --limit 1 --json databaseId,url,status,conclusion,headBranch,event
if ($LASTEXITCODE -ne 0) {
  Write-Host "[release] Workflow dispatched. Could not fetch run summary."
  exit 0
}

$runs = $runJson | ConvertFrom-Json
if ($runs.Count -gt 0) {
  $run = $runs[0]
  Write-Host "[release] Run ID: $($run.databaseId)"
  Write-Host "[release] Status: $($run.status)"
  Write-Host "[release] URL: $($run.url)"
}
else {
  Write-Host "[release] Workflow dispatched. No run found yet."
}
