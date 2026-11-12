# Builds the client mod that carries the Caldeirao Futuro assets (mod id aurora_vicky).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File server-patch/tools/build-caldeirao-mod.ps1
#
# The jar is a resource-only Forge mod: mods.toml + @Mod class + pack.mcmeta +
# the same assets/ tree used by the (retired) server resource pack. Because it
# ships as a mod, Forge loads it automatically on startup and it does not show
# up in the resource pack screen, so players cannot disable it.
#
# The build also copies the jar into modpack/mods/ so `npm run modpack:build` and
# `npm run modpack:publish` pick it up.

param(
  [string]$ModSource = (Join-Path $PSScriptRoot '..\mod'),
  [string]$AssetsDir = (Join-Path $PSScriptRoot '..\resourcepack\assets'),
  [string]$Output = (Join-Path $PSScriptRoot '..\aurora_vicky-1.0.0.jar'),
  [string]$ModpackMods = (Join-Path $PSScriptRoot '..\..\modpack\mods'),
  [string]$JdkHome = (Join-Path $env:APPDATA '\.aurora_studios\aurora-studios\runtime\jre-17'),
  [string]$ForgeJar = (Join-Path $env:APPDATA '\.aurora_studios\aurora-studios\libraries\net\minecraftforge\javafmllanguage\1.20.1-47.4.10\javafmllanguage-1.20.1-47.4.10.jar'),
  [switch]$SkipModpackCopy
)

$ErrorActionPreference = 'Stop'

$ModSource = (Resolve-Path $ModSource).Path
$AssetsDir = (Resolve-Path $AssetsDir).Path
$Output = [IO.Path]::GetFullPath($Output)
$JdkHome = (Resolve-Path $JdkHome).Path
$ForgeJar = (Resolve-Path $ForgeJar).Path

$javac = Join-Path $JdkHome 'bin\javac.exe'
$jar = Join-Path $JdkHome 'bin\jar.exe'
foreach ($tool in @($javac, $jar, $ForgeJar)) {
  if (-not (Test-Path $tool)) { throw "Not found: $tool" }
}

$stage = Join-Path ([IO.Path]::GetTempPath()) ("aurora-caldeirao-mod-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null

try {
  New-Item -ItemType Directory -Force -Path (Join-Path $stage 'META-INF') | Out-Null
  Copy-Item (Join-Path $ModSource 'mods.toml') (Join-Path $stage 'META-INF\mods.toml')
  Copy-Item (Join-Path $ModSource 'pack.mcmeta') $stage
  Copy-Item $AssetsDir (Join-Path $stage 'assets') -Recurse

  $sources = Get-ChildItem (Join-Path $ModSource 'src') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
  if (-not $sources) { throw 'No Java sources found.' }

  # Built as an array on purpose: passing -classpath inline makes PowerShell 5.1
  # hand javac a broken argument list ("invalid flag: :").
  $javacArgs = @('-encoding', 'UTF-8', '-source', '17', '-target', '17', '-classpath', $ForgeJar, '-d', $stage) + $sources
  & $javac @javacArgs
  if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }

  if (Test-Path $Output) { Remove-Item $Output -Force }
  & $jar @('--create', '--file', $Output, '-C', $stage, '.')
  if ($LASTEXITCODE -ne 0) { throw "jar failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

$sha1 = (Get-FileHash $Output -Algorithm SHA1).Hash.ToLower()
$size = (Get-Item $Output).Length
Write-Host "Built $Output ($size bytes)"
Write-Host "SHA1: $sha1"

if (-not $SkipModpackCopy) {
  if (-not (Test-Path $ModpackMods)) { throw "Modpack mods folder not found: $ModpackMods" }
  Copy-Item $Output (Join-Path $ModpackMods (Split-Path $Output -Leaf)) -Force
  Write-Host "Copied to $ModpackMods"
}
