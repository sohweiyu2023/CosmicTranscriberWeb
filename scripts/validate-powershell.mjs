import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const command=String.raw`
$ErrorActionPreference = 'Stop'
$root = $env:COSMIC_PS_ROOT

function Test-CommandParameters([System.Management.Automation.Language.ScriptBlockAst]$Ast, [string]$Label) {
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
      $parameter = $element.ParameterName
      if (-not $resolved.Parameters.ContainsKey($parameter)) {
        $invalid += ('{0}:{1}:{2}: command {3} has no named parameter -{4}' -f $Label, $element.Extent.StartLineNumber, $element.Extent.StartColumnNumber, $name, $parameter)
      }
    }
  }
  return $invalid
}

# Self-test the binding validator with the exact class of error that escaped 1.0.7.
$probeTokens = $null
$probeErrors = $null
$probeAst = [System.Management.Automation.Language.Parser]::ParseInput("New-Item -LiteralPath 'x' -ItemType Directory", [ref]$probeTokens, [ref]$probeErrors)
if ($probeErrors.Count -ne 0) { throw 'PowerShell parameter-validator self-test unexpectedly failed to parse its probe.' }
$probeInvalid = @(Test-CommandParameters $probeAst '<parameter-validator-self-test>')
if ($probeInvalid.Count -ne 1 -or $probeInvalid[0] -notmatch 'New-Item has no named parameter -LiteralPath') {
  throw 'PowerShell parameter-validator self-test failed to detect invalid New-Item -LiteralPath.'
}

$files = Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.ps1' |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' }
$failed = $false
foreach ($file in $files) {
  $tokens = $null
  $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) {
    $failed = $true
    foreach ($error in $errors) {
      Write-Error ("PowerShell parser error in {0}:{1}:{2}: {3}" -f $file.FullName, $error.Extent.StartLineNumber, $error.Extent.StartColumnNumber, $error.Message)
    }
    continue
  }
  foreach ($bindingError in @(Test-CommandParameters $ast $file.FullName)) {
    $failed = $true
    Write-Error ("PowerShell parameter binding error: {0}" -f $bindingError)
  }
}
if ($failed) { exit 1 }
Write-Host ("PowerShell parser + named-parameter binding PASS ({0} script(s))." -f $files.Count)
`;
const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',command],{
  cwd:root,
  stdio:'inherit',
  shell:false,
  env:{...process.env,COSMIC_PS_ROOT:root}
});
if(result.error){
  console.error(`PowerShell validation gate could not start pwsh: ${result.error.message}`);
  process.exit(1);
}
if(result.status!==0)process.exit(result.status||1);
