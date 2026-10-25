import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const read=(p)=>readFile(path.join(root,p),'utf8');

test('Windows release uses exact private reviewed Node/npm toolchain without winget mutation',async()=>{
  const [tool,first,release,nvm]=await Promise.all([
    read('WINDOWS-TOOLCHAIN.ps1'),read('FIRST-DEPLOY-WINDOWS.ps1'),read('RELEASE-WINDOWS.ps1'),read('.nvmrc')
  ]);
  assert.match(tool,/\$script:CosmicNodeVersion = '26\.12\.1'/);
  assert.match(tool,/\$script:CosmicNpmVersion = '12\.2\.1'/);
  assert.equal(nvm.trim(),'26.12.1');
  assert.match(first,/Use-CosmicNodeToolchain/);
  assert.match(release,/Use-CosmicNodeToolchain/);
  for(const text of [tool,first,release]) assert.doesNotMatch(text,/\bwinget\b/i);
});

test('portable Node archives are architecture-specific and pinned to official SHA-256 values',async()=>{
  const tool=await read('WINDOWS-TOOLCHAIN.ps1');
  assert.match(tool,/node-v26\.12\.1-win-x64\.zip/);
  assert.match(tool,/b3efd5c70cba3308ed46e7e699a9b8aac075bbc6b027fcb39c84c31acc25e2b4/);
  assert.match(tool,/1c63f1417e2e26d83ca9a9ec1d548524ab1305bc7209d90ebca56257ff0d84ed/);
  assert.match(tool,/node-v26\.12\.1-win-arm64\.zip/);
  assert.match(tool,/34567581ee63967b37afb6b7a0cc63a2d550a43d5d838adb75982d7e356f2e2c/);
  assert.match(tool,/7384299eeb99f419acaa4142771689fbca72e1c942f8da02b7928ffe1744e3ff/);
  assert.match(tool,/https:\/\/nodejs\.org\/dist\/v\$script:CosmicNodeVersion/);
  assert.match(tool,/Get-FileHash[^\n]+SHA256/);
  assert.match(tool,/\$downloadHash -ne \$spec\.Sha256/);
  assert.match(tool,/\$nodeHash -ne \$spec\.NodeExeSha256/);
  assert.doesNotMatch(tool,/Test-CosmicNodeHome \$nodeHome\) \{ return \$nodeHome \}/);
  assert.match(tool,/Never trust a previously extracted writable runtime tree/);
});

test('private toolchain is prepended to PATH and npm uses a private prefix',async()=>{
  const tool=await read('WINDOWS-TOOLCHAIN.ps1');
  assert.match(tool,/\$env:Path = "\$npmPrefix;\$nodeHome;\$originalPath"/);
  assert.match(tool,/\$env:npm_config_prefix = \$npmPrefix/);
  assert.match(tool,/npm-v\$script:CosmicNpmVersion-node-v\$script:CosmicNodeVersion/);
  assert.match(tool,/--global --prefix \$prefix/);
  assert.match(tool,/--registry=https:\/\/registry\.npmjs\.org\//);
  assert.match(tool,/if \(Test-Path -LiteralPath \$prefix\) \{ Remove-Item -LiteralPath \$prefix -Recurse -Force \}/);
  assert.doesNotMatch(tool,/installed -eq \$script:CosmicNpmVersion\) \{ return \$prefix \}/);
});


test('PowerShell npm activation binds the exact private npm CLI instead of trusting npm.ps1 command resolution',async()=>{
  const tool=await read('WINDOWS-TOOLCHAIN.ps1');
  assert.match(tool,/node_modules\\npm\\bin\\npm-cli\.js/);
  assert.match(tool,/function Install-CosmicNpmCommandBinding/);
  assert.match(tool,/Function:\\global:npm/);
  assert.match(tool,/& \$env:COSMIC_NODE_EXE \$env:COSMIC_NPM_CLI @args/);
  assert.match(tool,/Install-CosmicNpmCommandBinding \$nodeExe \$npmCli/);
  assert.match(tool,/\$npmCliText = \(& \$nodeExe \$npmCli --version\)\.Trim\(\)/);
  assert.match(tool,/\$npmCommand\.CommandType -ne \[System\.Management\.Automation\.CommandTypes\]::Function/);
  assert.match(tool,/Node's official Windows ZIP bundles npm\.ps1/);
  assert.doesNotMatch(tool,/Get-Command npm[\s\S]{0,180}\$env:Path = "\$npmPrefix;\$nodeHome/);
});

test('private npm bootstrap cannot leak native stdout into the structured return value',async()=>{
  const tool=await read('WINDOWS-TOOLCHAIN.ps1');
  assert.match(tool,/\$npmBootstrapOutput = @\(& \$bundledNpm install/);
  assert.match(tool,/\$npmBootstrapExit = \$LASTEXITCODE/);
  assert.match(tool,/\$npmBootstrapOutput \| ForEach-Object \{ Write-Host \$_ \}/);
  assert.match(tool,/return \[pscustomobject\]@\{\s*Prefix = \$prefix\s*NpmCmd = \$npmCmd\s*NpmCli = \$npmCli/s);
});

test('Windows release runs an executable toolchain self-test before dependency-backed certification',async()=>{
  const [self,first,release,pkg]=await Promise.all([
    read('WINDOWS-TOOLCHAIN-SELFTEST.ps1'),read('FIRST-DEPLOY-WINDOWS.ps1'),read('RELEASE-WINDOWS.ps1'),read('package.json')
  ]);
  assert.match(self,/\$items = @\(Use-CosmicNodeToolchain\)/);
  assert.match(self,/\$items\.Count -eq 1/);
  assert.match(self,/Windows toolchain executable self-test: PASS/);
  assert.match(first,/WINDOWS-TOOLCHAIN-SELFTEST\.ps1/);
  assert.match(release,/WINDOWS-TOOLCHAIN-SELFTEST\.ps1/);
  assert.equal(JSON.parse(pkg).scripts['test:windows-toolchain'],'pwsh -NoProfile -ExecutionPolicy Bypass -File ./WINDOWS-TOOLCHAIN-SELFTEST.ps1');
});
