param(
    [Parameter(Mandatory = $true)][string]$InputJar,
    [Parameter(Mandatory = $true)][string]$OutputJar
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Find-Java {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME "bin\java.exe") }
    if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA ".aurora_studios\aurora-studios\runtime\jre-17\bin\java.exe") }
    $cmd = Get-Command "java.exe" -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    throw "Java 17+ nao encontrado. Defina JAVA_HOME ou adicione java.exe ao PATH."
}

$java = Find-Java
$patcher = Join-Path $scriptDir "patch.jar"

Write-Host "Java:    $java"
Write-Host "Patcher: $patcher"
Write-Host "Entrada: $InputJar"
Write-Host "Saida:   $OutputJar"

& $java -jar $patcher $InputJar $OutputJar
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
