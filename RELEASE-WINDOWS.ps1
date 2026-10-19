# Cosmic Transcriber Web - Windows release certification
# Run from PowerShell 7:
#   pwsh -NoProfile -ExecutionPolicy Bypass -File .\RELEASE-WINDOWS.ps1
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'WINDOWS-TOOLCHAIN.ps1')

function Require-Success([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE." }
}

try {
  Write-Host '=== Cosmic Transcriber Web Windows release certification ==='
  & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'WINDOWS-TOOLCHAIN-SELFTEST.ps1')
  Require-Success 'Windows toolchain executable self-test'
  Use-CosmicNodeToolchain | Out-Null
  $nodeVersion = (& node --version).Trim(); Require-Success 'node --version'
  $npmVersion = (& npm --version).Trim(); Require-Success 'npm --version'
  Write-Host "Node: $nodeVersion | npm: $npmVersion"
  $nodeSemver = [version]($nodeVersion.TrimStart('v'))
  $npmSemver = [version]$npmVersion
  if ($nodeVersion -ne 'v26.7.0') { throw "Reviewed private Node v26.7.0 is required for this release; found $nodeVersion. Run through the shipped toolchain bootstrap instead of changing global Node." }
  if ($npmVersion -ne '12.0.2') { throw "Reviewed private npm 12.0.2 is required for this release; found $npmVersion. Run through the shipped toolchain bootstrap instead of changing global npm." }

  $registry = (& npm config get registry).Trim(); Require-Success 'npm registry check'
  $strictAllowScripts = (& npm config get strict-allow-scripts).Trim(); Require-Success 'npm strict allow-scripts check'
  $strictNpmrc = (& npm config get strict-npmrc).Trim(); Require-Success 'npm strict npmrc check'
  Write-Host "Registry: $registry | strict-allow-scripts: $strictAllowScripts | strict-npmrc: $strictNpmrc"

  & node scripts/validate-powershell.mjs; Require-Success 'PowerShell parser and named-parameter validation'
  & node scripts/version-consistency.mjs; Require-Success 'release/application version consistency'
  if ($registry -ne 'https://registry.npmjs.org/') { throw "Expected public npm registry https://registry.npmjs.org/; found $registry" }
  if ($strictAllowScripts -ne 'true') { throw "Project dependency install-script enforcement is not active (strict-allow-scripts=$strictAllowScripts). Do not continue." }
  if ($strictNpmrc -ne 'true') { throw "Project npm configuration typo protection is not active (strict-npmrc=$strictNpmrc). Do not continue." }

  Write-Host "`n=== Verify reviewed dependency graph is still current without mutating it ==="
  & npm run deps:check; Require-Success 'npm run deps:check'

  Write-Host "`n=== Prove clean lockfile install ==="
  if (Test-Path node_modules) { Remove-Item node_modules -Recurse -Force }
  & npm ci; Require-Success 'npm ci'
  & npm run browsers:install:all; Require-Success 'Playwright browser installation'

  Write-Host "`n=== Build, test twice through release packaging, and certify ZIP ==="
  & node scripts/package-source.mjs --staging-candidate; Require-Success 'staging-candidate package creation'

  $pkg = Get-Content '.\package.json' -Raw | ConvertFrom-Json
  $zip = Join-Path (Split-Path $PSScriptRoot -Parent) ("CosmicTranscriberWeb-$($pkg.version)-source.zip")
  if (!(Test-Path $zip)) { throw "Certified ZIP was not created at $zip" }

  # The editable tree intentionally remains releaseReady:false. Read the
  # manifest from the certified ZIP itself so only the round-trip-tested
  # artifact can satisfy this final gate.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $entry = $archive.Entries | Where-Object { $_.FullName -match '/RELEASE_MANIFEST\.json$' } | Select-Object -First 1
    if ($null -eq $entry) { throw 'Certified ZIP does not contain RELEASE_MANIFEST.json.' }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { $manifest = ($reader.ReadToEnd() | ConvertFrom-Json) }
    finally { $reader.Dispose() }
  } finally { $archive.Dispose() }
  if ($manifest.releaseReady -ne $false) { throw 'Staging-candidate ZIP manifest must remain releaseReady:false.' }
  if ($manifest.version -ne $pkg.version) { throw "Certified ZIP manifest version $($manifest.version) does not match package $($pkg.version)." }

  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash

  # Prepare a pristine deployment directory from the certified ZIP so the
  # operator cannot accidentally continue from the undeployable candidate.
  $deployBase = Join-Path (Split-Path $zip -Parent) 'deploy'
  $deployPath = Join-Path $deployBase ("CosmicTranscriberWeb-$($pkg.version)")
  New-Item -ItemType Directory -Force -Path $deployBase | Out-Null
  if (Test-Path $deployPath) { Remove-Item $deployPath -Recurse -Force }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $deployBase)
  if (!(Test-Path (Join-Path $deployPath 'package-lock.json'))) { throw "Prepared deployment copy is missing package-lock.json: $deployPath" }
  $deployManifest = Get-Content (Join-Path $deployPath 'RELEASE_MANIFEST.json') -Raw | ConvertFrom-Json
  if ($deployManifest.releaseReady -ne $false -or $deployManifest.certificationLevel -ne 'staging') { throw 'Prepared staging deployment copy is not staging-certified with releaseReady:false.' }

  Write-Host "`n=== ALL LOCAL RELEASE GATES PASSED ===" -ForegroundColor Green
  Write-Host "Certified staging candidate: $zip"
  Write-Host "SHA-256: $hash"
  Write-Host "Version: $($pkg.version)"
  Write-Host "Prepared deployment folder: $deployPath" -ForegroundColor Cyan
  Write-Host 'The editable audit-candidate tree remains releaseReady:false by design.'
  Write-Host "`nNEXT — do not keep working in this candidate directory. Run:" -ForegroundColor Yellow
  Write-Host "  Set-Location '$deployPath'"
  Write-Host '  npm ci'
  Write-Host '  npm run configure:access:staging'
  Write-Host '  node scripts/wrangler-invoke.mjs login --use-keyring'
  Write-Host '  node scripts/wrangler-invoke.mjs whoami'
  Write-Host '  npm run configure:registry:staging'
  Write-Host '  node scripts/deploy-verify.mjs staging'
  Write-Host '  npm run deploy:staging'
  Write-Host '  # Existing Cosmic staging is an upgrade; do NOT use deploy:first:staging.'
  exit 0
} catch {
  Write-Host "`n=== RELEASE CERTIFICATION FAILED - DO NOT DEPLOY ===" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
