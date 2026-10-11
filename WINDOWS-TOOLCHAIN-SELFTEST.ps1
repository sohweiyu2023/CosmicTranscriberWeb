# Executable regression/smoke test for the deterministic Windows release toolchain.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'WINDOWS-TOOLCHAIN.ps1')

function Assert-True([bool]$Condition,[string]$Message) {
  if (-not $Condition) { throw $Message }
}

$items = @(Use-CosmicNodeToolchain)
Assert-True ($items.Count -eq 1) "Toolchain activation must emit exactly one success-pipeline object; got $($items.Count)."
$toolchain = $items[0]
foreach ($name in @('NodeVersion','NpmVersion','NodeHome','NodeExe','NpmPrefix','NpmCli')) {
  Assert-True ($toolchain.PSObject.Properties.Name -contains $name) "Toolchain result is missing property $name."
}
Assert-True ($toolchain.NodeVersion -eq 'v26.7.0') "Expected Node v26.7.0; got $($toolchain.NodeVersion)."
Assert-True ($toolchain.NpmVersion -eq '12.0.2') "Expected npm 12.0.2; got $($toolchain.NpmVersion)."
Assert-True (Test-Path -LiteralPath $toolchain.NodeExe) "Verified private node.exe is missing."
Assert-True (Test-Path -LiteralPath $toolchain.NpmCli) "Verified private npm CLI is missing."

$npmText = (& npm --version).Trim()
Assert-True ($LASTEXITCODE -eq 0) 'Bound npm --version returned non-zero.'
Assert-True ($npmText -eq '12.0.2') "Bound npm resolved to $npmText instead of 12.0.2."
$npmCommand = Get-Command npm -ErrorAction Stop
Assert-True ($npmCommand.CommandType -eq [System.Management.Automation.CommandTypes]::Function) "PowerShell npm binding must be a Function; got $($npmCommand.CommandType)."

Write-Host 'Windows toolchain executable self-test: PASS' -ForegroundColor Green
