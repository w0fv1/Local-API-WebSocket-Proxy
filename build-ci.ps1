param([string]$DependencyRoot = (Join-Path $PSScriptRoot '.tmp/dependencies'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $DependencyRoot | Out-Null
foreach ($dependency in (Get-Content -Raw (Join-Path $PSScriptRoot 'build-dependencies.json') | ConvertFrom-Json)) {
    if ($dependency.revision -notmatch '^[a-f0-9]{40}$' -or $dependency.directory -notmatch '^[A-Za-z0-9-]+$') { throw 'Dependencies require immutable revisions and simple directory names' }
    $destination = Join-Path $DependencyRoot $dependency.directory
    if (-not (Test-Path (Join-Path $destination '.git'))) {
        git clone --no-checkout "https://github.com/$($dependency.repository).git" $destination
        if ($LASTEXITCODE -ne 0) { throw "Cannot clone $($dependency.repository)" }
    }
    git -C $destination fetch origin $dependency.revision --depth=1
    if ($LASTEXITCODE -ne 0) { throw "Cannot fetch $($dependency.repository)" }
    git -C $destination checkout --detach $dependency.revision
    if ($LASTEXITCODE -ne 0) { throw "Cannot checkout $($dependency.repository)" }
}
$normRoot = Join-Path $DependencyRoot 'Norm'
& (Join-Path $normRoot 'gradlew.bat') -p $normRoot :compiler:installRuntimeDist --no-daemon
if ($LASTEXITCODE -ne 0) { throw 'Norm compiler build failed' }
$env:NORM_EXECUTABLE = Join-Path $normRoot 'build/compiler/norm-runtime/bin/norm.bat'
$env:PATH = (Split-Path -Parent $env:NORM_EXECUTABLE) + [IO.Path]::PathSeparator + $env:PATH
& (Join-Path $DependencyRoot 'theme/scripts/build.ps1') -JavaHome $env:THEME_JAVA_HOME
if ($LASTEXITCODE -ne 0) { throw 'Theme build failed' }
& (Join-Path $DependencyRoot 'ui-component/scripts/prepare.ps1')
if ($LASTEXITCODE -ne 0) { throw 'UI dependencies build failed' }
$nativeTemp = Join-Path $PSScriptRoot '.tmp/native'
New-Item -ItemType Directory -Force $nativeTemp | Out-Null
$env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS -Djava.io.tmpdir=`"$nativeTemp`""
$kitNorm = Join-Path $DependencyRoot 'ui-component/scripts/norm.ps1'
& (Join-Path $PSScriptRoot 'build.ps1') -NormExecutable $kitNorm -Target Agent
& (Join-Path $PSScriptRoot 'build.ps1') -NormExecutable $kitNorm -Target Desktop
