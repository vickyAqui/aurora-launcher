# Builds the client mod that carries the Caldeirao Futuro assets and the
# Totem of Possession particle swap (mod id aurora_vicky).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File server-patch/tools/build-caldeirao-mod.ps1
#
# The jar is a Forge mod: mods.toml + @Mod class + pack.mcmeta + the same assets/
# tree used by the (retired) server resource pack, plus a client-side mixin and
# the prebuilt (SRG-reobfuscated) classes in mod/classes/. Because it ships as
# a mod, Forge loads it automatically on startup and it does not show up in the
# resource pack screen, so players cannot disable it.
#
# The build also copies the jar into modpack/mods/ so `npm run modpack:build` and
# `npm run modpack:publish` pick it up.

param(
  [string]$ModSource = (Join-Path $PSScriptRoot '..\mod'),
  [string]$AssetsDir = (Join-Path $PSScriptRoot '..\resourcepack\assets'),
  [string]$Output = (Join-Path $PSScriptRoot '..\aurora_vicky-1.0.4.jar'),
  [string]$ModpackMods = (Join-Path $PSScriptRoot '..\..\modpack\mods'),
  [string]$Libraries = (Join-Path $env:APPDATA '\.aurora_studios\aurora-studios\libraries'),
  [string]$JdkHome = (Join-Path $env:APPDATA '\.aurora_studios\aurora-studios\runtime\jre-17'),
  [string]$ForgeJar = (Join-Path $env:APPDATA '\.aurora_studios\aurora-studios\libraries\net\minecraftforge\javafmllanguage\1.20.1-47.4.10\javafmllanguage-1.20.1-47.4.10.jar'),
  [string]$ForgeUniversal = (Join-Path $env:APPDATA '\.aurora_studios\aurora-studios\libraries\net\minecraftforge\forge\1.20.1-47.4.10\forge-1.20.1-47.4.10-universal.jar'),
  [string]$MinecraftSrg = (Join-Path $env:APPDATA '\.aurora_studios\aurora-studios\libraries\net\minecraft\client\1.20.1-20230612.114412\client-1.20.1-20230612.114412-srg.jar'),
  [string]$FmlCore = (Join-Path $env:APPDATA '\.aurora_studios\aurora-studios\libraries\net\minecraftforge\fmlcore\1.20.1-47.4.10\fmlcore-1.20.1-47.4.10.jar'),
  [string]$EventBus = (Join-Path $env:APPDATA '\.aurora_studios\aurora-studios\libraries\net\minecraftforge\eventbus\6.0.5\eventbus-6.0.5.jar'),
  [switch]$SkipModpackCopy
)

$ErrorActionPreference = 'Stop'

$ModSource = (Resolve-Path $ModSource).Path
$AssetsDir = (Resolve-Path $AssetsDir).Path
$Output = [IO.Path]::GetFullPath($Output)
$JdkHome = (Resolve-Path $JdkHome).Path
$ForgeJar = (Resolve-Path $ForgeJar).Path
$ForgeUniversal = (Resolve-Path $ForgeUniversal).Path
$MinecraftSrg = (Resolve-Path $MinecraftSrg).Path
$FmlCore = (Resolve-Path $FmlCore).Path
$EventBus = (Resolve-Path $EventBus).Path
$Libraries = (Resolve-Path $Libraries).Path

function Resolve-Lib([string]$pattern) {
  $hit = Get-ChildItem -Path $Libraries -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $hit) { throw "Library not found: $pattern" }
  return $hit.FullName
}

# Extra libraries needed by the pronoun code (persistence, commands, network, mixin render).
$ExtraLibs = @(
  'fmlloader-1.20.1-47.4.10.jar',
  'gson-2.10.1.jar',
  'brigadier-1.1.8.jar',
  'netty-buffer-4.1.82.Final.jar',
  'netty-common-4.1.82.Final.jar',
  'joml-1.10.5.jar',
  'mixin-0.8.5.jar',
  'log4j-api-2.19.0.jar'
) | ForEach-Object { Resolve-Lib $_ }

$javac = Join-Path $JdkHome 'bin\javac.exe'
$jar = Join-Path $JdkHome 'bin\jar.exe'
foreach ($tool in @($javac, $jar, $ForgeJar, $ForgeUniversal, $MinecraftSrg, $FmlCore, $EventBus)) {
  if (-not (Test-Path $tool)) { throw "Not found: $tool" }
}

$stage = Join-Path ([IO.Path]::GetTempPath()) ("aurora-caldeirao-mod-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null

try {
  New-Item -ItemType Directory -Force -Path (Join-Path $stage 'META-INF') | Out-Null
  Copy-Item (Join-Path $ModSource 'mods.toml') (Join-Path $stage 'META-INF\mods.toml')
  Copy-Item (Join-Path $ModSource 'pack.mcmeta') $stage
  Copy-Item $AssetsDir (Join-Path $stage 'assets') -Recurse

  # Totem of Possession particle swap (mixin). The classes are prebuilt with
  # ForgeGradle and reobfuscated to SRG names; see mod/totem-src for sources.
  $classesDir = Join-Path $ModSource 'classes'
  if (-not (Test-Path $classesDir)) { throw "Prebuilt classes not found: $classesDir" }
  Copy-Item (Join-Path $classesDir 'com') (Join-Path $stage 'com') -Recurse -Force
  Copy-Item (Join-Path $ModSource 'auroratotem.mixins.json') $stage -Force
  Copy-Item (Join-Path $ModSource 'aurorapronouns.mixins.json') $stage -Force

  $sources = Get-ChildItem (Join-Path $ModSource 'src') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
  if (-not $sources) { throw 'No Java sources found.' }

  # Built as an array on purpose: passing -classpath inline makes PowerShell 5.1
  # hand javac a broken argument list ("invalid flag: :").
  $classpath = (@($ForgeJar, $ForgeUniversal, $MinecraftSrg, $FmlCore, $EventBus) + $ExtraLibs + @((Join-Path $ModSource 'classes'))) -join ';'
  # No refmap is needed: every mixin target/injector uses SRG names with remap=false.
  $javacArgs = @('-encoding', 'UTF-8', '-source', '17', '-target', '17', '-proc:none',
    '-classpath', $classpath, '-d', $stage) + $sources
  & $javac @javacArgs
  if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }

  if (Test-Path $Output) { Remove-Item $Output -Force }
  # --date keeps the jar byte-for-byte reproducible (javac rewrites the class
  # timestamp on every build, which would otherwise change the manifest SHA1).
  & $jar @('--create', '--date=2020-01-01T00:00:00Z', '--file', $Output, '-C', $stage, '.')
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
