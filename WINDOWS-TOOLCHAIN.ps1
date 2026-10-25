# Cosmic Transcriber Web deterministic Windows release toolchain.
# This script intentionally does NOT install/upgrade system Node.js.
# It downloads the reviewed portable Node.js Current archive from nodejs.org,
# verifies the exact official SHA-256 published for that release, and keeps
# npm 12 in a private per-user prefix. The caller then inherits a PATH whose
# first entries are this private npm and Node runtime.

$script:CosmicNodeVersion = '26.12.1'
$script:CosmicNpmVersion = '12.2.1'

function Get-CosmicToolchainSpec {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch) {
    ([System.Runtime.InteropServices.Architecture]::X64) {
      return [pscustomobject]@{
        ArchToken = 'x64'
        Archive = 'node-v26.12.1-win-x64.zip'
        Sha256 = 'b3efd5c70cba3308ed46e7e699a9b8aac075bbc6b027fcb39c84c31acc25e2b4'
        NodeExeSha256 = '1c63f1417e2e26d83ca9a9ec1d548524ab1305bc7209d90ebca56257ff0d84ed'
      }
    }
    ([System.Runtime.InteropServices.Architecture]::Arm64) {
      return [pscustomobject]@{
        ArchToken = 'arm64'
        Archive = 'node-v26.12.1-win-arm64.zip'
        Sha256 = '34567581ee63967b37afb6b7a0cc63a2d550a43d5d838adb75982d7e356f2e2c'
        NodeExeSha256 = '7384299eeb99f419acaa4142771689fbca72e1c942f8da02b7928ffe1744e3ff'
      }
    }
    default {
      throw "Unsupported Windows CPU architecture for the reviewed release toolchain: $arch. Use Windows x64 or ARM64."
    }
  }
}

function Get-CosmicToolchainRoot {
  $base = $env:LOCALAPPDATA
  if ([string]::IsNullOrWhiteSpace($base)) { $base = $env:TEMP }
  if ([string]::IsNullOrWhiteSpace($base)) { throw 'Neither LOCALAPPDATA nor TEMP is available for the private release toolchain cache.' }
  return (Join-Path $base 'CosmicTranscriberWeb\toolchains')
}

function Test-CosmicNodeHome([string]$NodeHome) {
  $nodeExe = Join-Path $NodeHome 'node.exe'
  $npmCmd = Join-Path $NodeHome 'npm.cmd'
  if (-not (Test-Path -LiteralPath $nodeExe) -or -not (Test-Path -LiteralPath $npmCmd)) { return $false }
  try {
    $spec = Get-CosmicToolchainSpec
    $nodeHash = (Get-FileHash -LiteralPath $nodeExe -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($nodeHash -ne $spec.NodeExeSha256) { return $false }
    $version = (& $nodeExe --version).Trim()
    if ($LASTEXITCODE -ne 0) { return $false }
    return $version -eq "v$script:CosmicNodeVersion"
  } catch {
    return $false
  }
}

function Get-CosmicPortableNode {
  $spec = Get-CosmicToolchainSpec
  $root = Get-CosmicToolchainRoot
  New-Item -ItemType Directory -Path $root -Force | Out-Null

  $nodeHome = Join-Path $root "node-v$script:CosmicNodeVersion-win-$($spec.ArchToken)"

  # Never trust a previously extracted writable runtime tree. The compact official
  # archive may be cached, but its SHA-256 is rechecked below and Node is freshly
  # extracted for every toolchain activation.
  if (Test-Path -LiteralPath $nodeHome) { Remove-Item -LiteralPath $nodeHome -Recurse -Force }

  $archivePath = Join-Path $root $spec.Archive
  $archiveGood = $false
  if (Test-Path -LiteralPath $archivePath) {
    $existingHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $archiveGood = $existingHash -eq $spec.Sha256
    if (-not $archiveGood) { Remove-Item -LiteralPath $archivePath -Force }
  }

  if (-not $archiveGood) {
    $url = "https://nodejs.org/dist/v$script:CosmicNodeVersion/$($spec.Archive)"
    $downloadPath = "$archivePath.download-$PID"
    if (Test-Path -LiteralPath $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force }
    Write-Host "Downloading reviewed portable Node.js v$script:CosmicNodeVersion from nodejs.org..." -ForegroundColor Yellow
    try {
      Invoke-WebRequest -Uri $url -OutFile $downloadPath
      $downloadHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($downloadHash -ne $spec.Sha256) {
        throw "Portable Node.js SHA-256 mismatch. Expected $($spec.Sha256); got $downloadHash."
      }
      Move-Item -LiteralPath $downloadPath -Destination $archivePath -Force
    } finally {
      if (Test-Path -LiteralPath $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force }
    }
  }

  $extractRoot = Join-Path $root ("extract-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  try {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    $expanded = Join-Path $extractRoot "node-v$script:CosmicNodeVersion-win-$($spec.ArchToken)"
    if (-not (Test-CosmicNodeHome $expanded)) { throw 'The verified Node.js archive extracted without the expected node.exe/npm.cmd layout.' }
    Move-Item -LiteralPath $expanded -Destination $nodeHome
  } finally {
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
  }

  if (-not (Test-CosmicNodeHome $nodeHome)) { throw 'Portable Node.js installation could not be verified after extraction.' }
  return $nodeHome
}

function Get-CosmicPrivateNpm([string]$NodeHome) {
  $root = Get-CosmicToolchainRoot
  $spec = Get-CosmicToolchainSpec
  $prefix = Join-Path $root "npm-v$script:CosmicNpmVersion-node-v$script:CosmicNodeVersion-$($spec.ArchToken)"
  $npmCmd = Join-Path $prefix 'npm.cmd'
  $npmCli = Join-Path $prefix 'node_modules\npm\bin\npm-cli.js'

  $oldPath = $env:Path
  try {
    $env:Path = "$NodeHome;$oldPath"
    # The private npm prefix is writable cache state. Recreate it from the exact
    # official-registry npm package each activation instead of trusting a
    # previously cached shim or CLI tree that could have been changed locally.
    if (Test-Path -LiteralPath $prefix) { Remove-Item -LiteralPath $prefix -Recurse -Force }

    New-Item -ItemType Directory -Path $prefix -Force | Out-Null
    $bundledNpm = Join-Path $NodeHome 'npm.cmd'
    $nodeExe = Join-Path $NodeHome 'node.exe'
    if (-not (Test-Path -LiteralPath $bundledNpm)) { throw 'Portable Node.js does not contain npm.cmd.' }
    if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'Portable Node.js does not contain node.exe.' }

    Write-Host "Installing private npm $script:CosmicNpmVersion into the Cosmic toolchain cache..." -ForegroundColor Yellow
    $toolRoot = Get-CosmicToolchainRoot
    Push-Location $toolRoot
    try {
      # Bootstrap with the npm version bundled by the verified Node archive, but
      # install npm 12 into a separate prefix. Never use an ambient npm here.
      $npmBootstrapOutput = @(& $bundledNpm install --global --prefix $prefix "npm@$script:CosmicNpmVersion" --registry=https://registry.npmjs.org/ --ignore-scripts --no-audit --no-fund 2>&1)
      $npmBootstrapExit = $LASTEXITCODE
      if ($npmBootstrapOutput.Count -gt 0) { $npmBootstrapOutput | ForEach-Object { Write-Host $_ } }
      if ($npmBootstrapExit -ne 0) { throw "Private npm install failed with exit code $npmBootstrapExit." }
    } finally {
      Pop-Location
    }

    if (-not (Test-Path -LiteralPath $npmCmd)) { throw 'Private npm install completed without creating npm.cmd.' }
    if (-not (Test-Path -LiteralPath $npmCli)) { throw 'Private npm install completed without creating node_modules/npm/bin/npm-cli.js.' }

    # Verify the exact private CLI with the exact verified Node executable.
    # This bypasses PowerShell command-name precedence entirely.
    $installed = (& $nodeExe $npmCli --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $installed -ne $script:CosmicNpmVersion) {
      throw "Private npm verification failed. Expected $script:CosmicNpmVersion; got $installed from $npmCli."
    }

    return [pscustomobject]@{
      Prefix = $prefix
      NpmCmd = $npmCmd
      NpmCli = $npmCli
    }
  } finally {
    $env:Path = $oldPath
  }
}

function Install-CosmicNpmCommandBinding([string]$NodeExe, [string]$NpmCli) {
  if (-not (Test-Path -LiteralPath $NodeExe)) { throw "Cannot bind private npm: node.exe is missing: $NodeExe" }
  if (-not (Test-Path -LiteralPath $NpmCli)) { throw "Cannot bind private npm: npm-cli.js is missing: $NpmCli" }

  # PowerShell gives commands with the same name different precedence depending
  # on command type. Node's official Windows ZIP bundles npm.ps1 (npm 11.17.0 in
  # Node 24.19.0), so merely putting an npm 12 npm.cmd earlier in PATH is not a
  # deterministic PowerShell activation strategy. Bind a session-local function
  # named `npm` that invokes the exact verified private npm CLI with the exact
  # verified private Node executable. Function precedence intentionally wins.
  $env:COSMIC_NODE_EXE = $NodeExe
  $env:COSMIC_NPM_CLI = $NpmCli
  Remove-Item Alias:npm -Force -ErrorAction SilentlyContinue
  Set-Item -Path Function:\global:npm -Value {
    & $env:COSMIC_NODE_EXE $env:COSMIC_NPM_CLI @args
  } -Force
}

function Use-CosmicNodeToolchain {
  $nodeHome = Get-CosmicPortableNode
  $nodeExe = Join-Path $nodeHome 'node.exe'
  $npmInstall = Get-CosmicPrivateNpm $nodeHome
  $npmPrefix = $npmInstall.Prefix
  $npmCli = $npmInstall.NpmCli

  # Child processes (including npm's default cmd.exe script shell) get the
  # private npm prefix first. PowerShell itself gets an explicit function binding
  # below, so it does not depend on npm.ps1/npm.cmd extension precedence.
  $originalPath = $env:Path
  $env:Path = "$npmPrefix;$nodeHome;$originalPath"
  $env:npm_config_prefix = $npmPrefix
  $env:COSMIC_NODE_HOME = $nodeHome
  $env:COSMIC_NPM_PREFIX = $npmPrefix
  $env:COSMIC_NODE_EXE = $nodeExe
  $env:COSMIC_NPM_CLI = $npmCli

  Install-CosmicNpmCommandBinding $nodeExe $npmCli

  # Verify Node by absolute path and npm by both absolute CLI and the bound
  # PowerShell command. This catches PATH/command-precedence regressions early.
  $nodeText = (& $nodeExe --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeText -ne "v$script:CosmicNodeVersion") {
    throw "Private Node.js activation failed. Expected v$script:CosmicNodeVersion; got $nodeText from $nodeExe."
  }
  $npmCliText = (& $nodeExe $npmCli --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $npmCliText -ne $script:CosmicNpmVersion) {
    throw "Private npm CLI activation failed. Expected $script:CosmicNpmVersion; got $npmCliText from $npmCli."
  }
  $npmText = (& npm --version).Trim()
  $npmCommand = Get-Command npm -ErrorAction Stop
  if ($LASTEXITCODE -ne 0 -or $npmText -ne $script:CosmicNpmVersion -or $npmCommand.CommandType -ne [System.Management.Automation.CommandTypes]::Function) {
    throw "Private npm PowerShell binding failed. Expected $script:CosmicNpmVersion via Function; got $npmText via $($npmCommand.CommandType) $($npmCommand.Source)."
  }

  Write-Host "Cosmic private release toolchain: Node $nodeText | npm $npmText" -ForegroundColor Green
  Write-Host "Node executable: $nodeExe" -ForegroundColor DarkGray
  Write-Host "npm CLI: $npmCli" -ForegroundColor DarkGray
  Write-Host "PowerShell npm binding: $($npmCommand.CommandType)" -ForegroundColor DarkGray
  return [pscustomobject]@{
    NodeVersion = $nodeText
    NpmVersion = $npmText
    NodeHome = $nodeHome
    NodeExe = $nodeExe
    NpmPrefix = $npmPrefix
    NpmCli = $npmCli
  }
}
