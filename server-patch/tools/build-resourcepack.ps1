# Builds aurora_caldeirao.zip (server resource pack) from resourcepack/.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File server-patch/tools/build-resourcepack.ps1
#
# The zip is what `resource-pack=` in server.properties points at. Every time the
# pack changes, rebuild it, re-upload the asset and update `resource-pack-sha1`.

param(
  [string]$SourceDir = (Join-Path $PSScriptRoot '..\resourcepack'),
  [string]$Output = (Join-Path $PSScriptRoot '..\aurora_caldeirao.zip')
)

$ErrorActionPreference = 'Stop'

$SourceDir = (Resolve-Path $SourceDir).Path
$Output = [IO.Path]::GetFullPath($Output)

if (Test-Path $Output) { Remove-Item $Output -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($Output, 'Create')
try {
  Get-ChildItem $SourceDir -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($SourceDir.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $zip.Dispose()
}

$sha1 = (Get-FileHash $Output -Algorithm SHA1).Hash.ToLower()
$size = (Get-Item $Output).Length

Write-Host "Built $Output ($size bytes)"
Write-Host "SHA1: $sha1"
Write-Host ''
Write-Host 'server.properties:'
Write-Host "  resource-pack-sha1=$sha1"
