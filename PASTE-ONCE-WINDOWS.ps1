$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Version = '1.2.0'
$Downloads = Join-Path $HOME 'Downloads'

try {
  if (-not (Get-Command pwsh -ErrorAction SilentlyContinue)) {
    throw 'PowerShell 7 (pwsh) is required. Install PowerShell 7, then run this same launcher again.'
  }

  $zip = Get-ChildItem -Path $Downloads -File -Filter "CosmicTranscriberWeb-$Version-audited-source-candidate*.zip" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $zip) {
    throw "Could not find CosmicTranscriberWeb-$Version-audited-source-candidate*.zip in $Downloads"
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $runRoot = Join-Path $Downloads "CosmicTranscriberWeb-$Version-run-$stamp"
  New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
  Expand-Archive -LiteralPath $zip.FullName -DestinationPath $runRoot -Force

  $project = Join-Path $runRoot "CosmicTranscriberWeb-$Version"
  $runner = Join-Path $project 'FIRST-DEPLOY-WINDOWS.ps1'
  if (-not (Test-Path -LiteralPath $runner)) {
    throw "Guided runner not found after extraction: $runner"
  }

  Write-Host "Fresh run directory: $runRoot" -ForegroundColor Green
  & pwsh -NoProfile -ExecutionPolicy Bypass -File $runner
  if ($LASTEXITCODE -ne 0) {
    throw "Cosmic Transcriber Web $Version stopped safely with exit code $LASTEXITCODE. Do not run later deployment commands manually."
  }
} catch {
  Write-Host "`nSTOPPED — DO NOT CONTINUE TO A LATER STAGE" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  # Throw instead of exit so a block pasted into an existing PowerShell window
  # stops fail-closed without closing the user's console before logs can be copied.
  throw
}
