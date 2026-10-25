# Cosmic Transcriber Web - guided Windows certification + first staging/production deployment
# Run from the audit candidate with PowerShell 7:
#   pwsh -NoProfile -ExecutionPolicy Bypass -File .\FIRST-DEPLOY-WINDOWS.ps1
#
# This MUST stay a real script file rather than a long block pasted statement-by-statement.
# PowerShell interactive input can continue after a thrown error; this script is one process
# and exits immediately on a failed native command or failed release/deployment gate.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'WINDOWS-TOOLCHAIN.ps1')


function Get-PowerShellParameterErrors([System.Management.Automation.Language.ScriptBlockAst]$Ast, [string]$Label) {
  $localFunctions = @{}
  foreach ($definition in $Ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    $localFunctions[$definition.Name] = $true
  }
  $invalid = @()
  foreach ($commandAst in $Ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)) {
    $name = $commandAst.GetCommandName()
    if ([string]::IsNullOrWhiteSpace($name) -or $localFunctions.ContainsKey($name)) { continue }
    $resolved = Get-Command -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $resolved) { continue }
    if ($resolved.CommandType -notin @(
      [System.Management.Automation.CommandTypes]::Cmdlet,
      [System.Management.Automation.CommandTypes]::Function,
      [System.Management.Automation.CommandTypes]::Filter
    )) { continue }
    foreach ($element in $commandAst.CommandElements) {
      if ($element -isnot [System.Management.Automation.Language.CommandParameterAst]) { continue }
      if (-not $resolved.Parameters.ContainsKey($element.ParameterName)) {
        $invalid += ("$Label line $($element.Extent.StartLineNumber): command $name has no named parameter -$($element.ParameterName)")
      }
    }
  }
  return $invalid
}

function Assert-PowerShellScripts {
  $scripts = @(
    (Join-Path $PSScriptRoot 'FIRST-DEPLOY-WINDOWS.ps1'),
    (Join-Path $PSScriptRoot 'RELEASE-WINDOWS.ps1'),
    (Join-Path $PSScriptRoot 'PASTE-ONCE-WINDOWS.ps1'),
    (Join-Path $PSScriptRoot 'WINDOWS-TOOLCHAIN.ps1'),
    (Join-Path $PSScriptRoot 'WINDOWS-TOOLCHAIN-SELFTEST.ps1')
  )
  foreach ($script in $scripts) {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) {
      $messages = $errors | ForEach-Object { "line $($_.Extent.StartLineNumber), column $($_.Extent.StartColumnNumber): $($_.Message)" }
      throw "PowerShell parser validation failed for $script`n$($messages -join "`n")"
    }
    $bindingErrors = @(Get-PowerShellParameterErrors $ast $script)
    if ($bindingErrors.Count -gt 0) {
      throw "PowerShell named-parameter validation failed:`n$($bindingErrors -join "`n")"
    }
  }
  Write-Host 'PowerShell deployment-script parser + named-parameter check: PASS' -ForegroundColor Green
}
function Section([string]$Title) {
  Write-Host "`n================================================================" -ForegroundColor Cyan
  Write-Host " $Title" -ForegroundColor Cyan
  Write-Host "================================================================" -ForegroundColor Cyan
}

function Require-LastExit([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE." }
}

function Invoke-NativeAllowFailure([scriptblock]$Command) {
  # Only use this for commands whose non-zero result is intentionally inspected
  # (currently only an informational pre-first-deploy history listing).
  # All release/deploy gates remain strict.
  $previous = $PSNativeCommandUseErrorActionPreference
  try {
    $PSNativeCommandUseErrorActionPreference = $false
    & $Command | Out-Host
    $exitCode = $LASTEXITCODE
    return $exitCode
  } finally {
    $PSNativeCommandUseErrorActionPreference = $previous
  }
}


function Get-NodeSemver {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $null }
  $text = (& node --version).Trim(); Require-LastExit 'node --version'
  return [pscustomobject]@{ Text = $text; Version = [version]($text.TrimStart('v')) }
}

function Get-NpmSemver {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return $null }
  $text = (& npm --version).Trim(); Require-LastExit 'npm --version'
  return [pscustomobject]@{ Text = $text; Version = [version]$text }
}

function Require-ExactInput([string]$Prompt, [string]$Expected) {
  $value = Read-Host $Prompt
  $normalized = if ($null -eq $value) { '' } else { $value.Trim() }
  if ($normalized -ine $Expected) { throw "Confirmation not received. Expected: $Expected (case-insensitive; surrounding spaces are ignored)." }
}

function Show-AccessSteps([string]$Environment, [string]$Hostname) {
  Write-Host "`nCloudflare browser steps for ${Environment}:" -ForegroundColor Yellow
  Write-Host '  1. Sign in to Cloudflare.'
  Write-Host '  2. Open Zero Trust.'
  Write-Host '  3. Go to Access controls -> Applications.'
  Write-Host "  4. Create or open the Cosmic Transcriber $Environment self-hosted/public application."
  Write-Host "  5. Its public hostname must be exactly: $Hostname" -ForegroundColor Cyan
  Write-Host '  6. Confirm the intended Allow policy and the OTP/Google identity providers you want to retain.'
  Write-Host '  7. Find the Team name/domain under Zero Trust -> Settings -> Team name and domain.'
  Write-Host '     Cosmic expects: https://<team-name>.cloudflareaccess.com'
  Write-Host '  8. Open the Access application -> Configure -> Additional settings.'
  Write-Host '  9. Copy the Application Audience (AUD) Tag.'
  if ($Environment -eq 'production') {
    Write-Host ' 10. Use the PRODUCTION application AUD. Do not reuse the staging AUD.' -ForegroundColor Yellow
  }
}

try {
  Section '0. POWERSHELL SCRIPT PREFLIGHT'
  Assert-PowerShellScripts

  $initialManifestPath = Join-Path $PSScriptRoot 'RELEASE_MANIFEST.json'
  if (Test-Path $initialManifestPath) {
    $initialManifest = Get-Content $initialManifestPath -Raw | ConvertFrom-Json
    if ($initialManifest.releaseReady -eq $true) {
      throw 'FIRST-DEPLOY-WINDOWS.ps1 must start from the audit-candidate tree (releaseReady:false), not from an already-certified deployment copy.'
    }
  }

  Section '1. TOOLCHAIN'
  & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'WINDOWS-TOOLCHAIN-SELFTEST.ps1')
  Require-LastExit 'Windows toolchain executable self-test'
  # Do not mutate or trust the machine-wide Node installation. The reviewed
  # release uses a SHA-256-verified portable Node 26.12.1 + private npm 12.2.1
  # cache and prepends those executables for this process tree only.
  $toolchain = Use-CosmicNodeToolchain
  $node = Get-NodeSemver
  if ($null -eq $node -or $node.Text -ne 'v26.12.1') {
    $currentNode = if ($null -eq $node) { 'not found' } else { $node.Text }
    throw "Reviewed private Node v26.12.1 activation failed; current process sees: $currentNode"
  }
  $npm = Get-NpmSemver
  if ($null -eq $npm -or $npm.Text -ne '12.2.1') {
    $currentNpm = if ($null -eq $npm) { 'not found' } else { $npm.Text }
    throw "Reviewed private npm 12.2.1 activation failed; current process sees: $currentNpm"
  }
  Write-Host "Toolchain cache: $($toolchain.NodeHome)" -ForegroundColor DarkGray

  Section '2. FULL LOCAL RELEASE CERTIFICATION'
  & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'RELEASE-WINDOWS.ps1')
  Require-LastExit 'release certification'

  # RELEASE-WINDOWS.ps1 deterministically creates this sibling deployment tree
  # from the certified releaseReady:true ZIP.
  $pkg = Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json
  $releaseParent = Split-Path $PSScriptRoot -Parent
  $deployPath = Join-Path (Join-Path $releaseParent 'deploy') ("CosmicTranscriberWeb-$($pkg.version)")
  if (-not (Test-Path (Join-Path $deployPath 'package-lock.json'))) {
    throw "Certification returned success but the prepared deployment tree is missing: $deployPath"
  }
  $deployManifest = Get-Content (Join-Path $deployPath 'RELEASE_MANIFEST.json') -Raw | ConvertFrom-Json
  if ($deployManifest.releaseReady -ne $true -or $deployManifest.version -ne $pkg.version) {
    throw 'Prepared deployment tree does not carry the expected releaseReady:true versioned manifest.'
  }
  Set-Location $deployPath
  Write-Host "Certified deployment tree: $deployPath" -ForegroundColor Green

  Section '3. CLEAN INSTALL CERTIFIED DEPLOYMENT TREE'
  & npm ci; Require-LastExit 'certified deployment npm ci'

  Section '4. STAGING ACCESS CONFIGURATION'
  Show-AccessSteps 'staging' 'transcriber-staging.awakeningtoreality.com'
  Read-Host 'Press ENTER only after the staging Access application is ready'
  & npm run configure:access:staging; Require-LastExit 'staging Access configuration'

  Section '5. CLOUDFLARE LOGIN'
  & node scripts/wrangler-invoke.mjs login --use-keyring; Require-LastExit 'Wrangler login'
  & node scripts/wrangler-invoke.mjs whoami; Require-LastExit 'Wrangler whoami'
  Require-ExactInput 'Type YES if the account displayed above is the correct Cloudflare account' 'YES'

  Section '6. STAGING REGISTRY CONFIGURATION + FINAL VERIFY'
  & npm run configure:registry:staging; Require-LastExit 'staging registry configuration'
  & node scripts/deploy-verify.mjs staging; Require-LastExit 'staging deployment verification'

  Section '7. FIRST STAGING DEPLOYMENT'
  & npm run deploy:first:staging; Require-LastExit 'first staging deployment'
  & node scripts/wrangler-invoke.mjs secret list --env staging; Require-LastExit 'staging secret list'
  & node scripts/wrangler-invoke.mjs deployments list --env staging; Require-LastExit 'staging deployments list'

  Write-Host "`nTest https://transcriber-staging.awakeningtoreality.com before production:" -ForegroundColor Yellow
  Write-Host '  [ ] Cloudflare Access appears before the app.'
  Write-Host '  [ ] Authorized login works and unauthorized login is rejected.'
  Write-Host '  [ ] A short non-sensitive MP3 transcribes successfully with a test BYOK OpenAI key.'
  Write-Host '  [ ] Forget API key works.'
  Write-Host '  [ ] Raw OpenAI key is absent from Local/Session Storage, IndexedDB, Cache Storage and JS-readable cookies.'
  Write-Host '  [ ] Workers & Pages -> staging Worker -> Settings -> Domains & Routes shows only the intended custom domain.'
  Write-Host '  [ ] workers.dev is Disabled and Preview URLs are Disabled.'
  Require-ExactInput 'After those checks, type STAGING-OK to continue' 'STAGING-OK'

  Section '8. PRODUCTION ACCESS CONFIGURATION'
  Show-AccessSteps 'production' 'transcriber.awakeningtoreality.com'
  Read-Host 'Press ENTER only after the production Access application is ready'
  & npm run configure:access:production; Require-LastExit 'production Access configuration'
  & npm run configure:registry:production; Require-LastExit 'production registry configuration'
  & node scripts/deploy-verify.mjs production; Require-LastExit 'production deployment verification'

  Section '9. PRODUCTION PRE-DEPLOYMENT HISTORY' 
  # On a true first deployment there may be no existing production deployment.
  # Listing is informational here; the actual deploy remains a hard gate.
  $historyExit = Invoke-NativeAllowFailure { node scripts/wrangler-invoke.mjs deployments list --env production }
  if ($historyExit -ne 0) { Write-Host "No readable production deployment history yet (exit $historyExit); continuing only because this is the first-deploy runner." -ForegroundColor Yellow }
  Require-ExactInput 'Type DEPLOY-PRODUCTION exactly to deploy production' 'DEPLOY-PRODUCTION'

  Section '10. FIRST PRODUCTION DEPLOYMENT'
  & npm run deploy:first:production; Require-LastExit 'first production deployment'
  & node scripts/wrangler-invoke.mjs secret list --env production; Require-LastExit 'production secret list'
  & node scripts/wrangler-invoke.mjs deployments list --env production; Require-LastExit 'production deployments list'

  Section '11. FINAL MANUAL ACCEPTANCE'
  Write-Host 'Production: https://transcriber.awakeningtoreality.com' -ForegroundColor Green
  Write-Host 'Confirm Access-before-app, authorized/unauthorized behavior, one short transcription, Forget API key, custom domain, workers.dev disabled, Preview URLs disabled, and no raw BYOK key in browser-readable storage.'
  Write-Host 'Then complete docs/SAFARI_MAC_ACCEPTANCE.md on a real macOS Safari before broad release.'
  Write-Host "`n=== GUIDED FIRST DEPLOYMENT FLOW COMPLETED ===" -ForegroundColor Green
  exit 0
} catch {
  Write-Host "`n=== STOPPED — DO NOT CONTINUE TO A LATER STAGE ===" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Copy the complete PowerShell output and send it for review. Do not run later deployment commands manually.' -ForegroundColor Red
  exit 1
}
