param(
  [Parameter(Mandatory)][string]$ZipPath,
  [Parameter(Mandatory)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$zipFull = (Resolve-Path -LiteralPath $ZipPath).Path
$destinationFull = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationFull) { throw 'Native extraction destination must not already exist.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipFull)
try {
  foreach ($entry in $archive.Entries) {
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($destinationFull, $entry.FullName))
    if (-not $target.StartsWith($destinationFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive entry escapes extraction destination.' }
  }
  [IO.Compression.ZipFile]::ExtractToDirectory($zipFull, $destinationFull)
  foreach ($entry in $archive.Entries) {
    $target = [IO.Path]::Combine($destinationFull, $entry.FullName)
    $actual = Get-Item -LiteralPath $target
    if ($actual.Length -ne $entry.Length -or $actual.LastWriteTimeUtc -ne $entry.LastWriteTime.UtcDateTime) { throw "Native extraction did not preserve archive size/timestamp: $($entry.FullName)" }
    if ($entry.FullName -like '*/tests/fixtures/*') {
      [ordered]@{ fixture=$entry.FullName; size=$actual.Length; lastWriteTimeUtc=$actual.LastWriteTimeUtc.ToString('o'); sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json -Compress
    }
  }
} finally { $archive.Dispose() }
