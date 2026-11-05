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
$desktopRoot = Join-Path $DependencyRoot 'ui-desktop'
& (Join-Path $desktopRoot 'scripts/build.ps1') -NormHome $HOME
if ($LASTEXITCODE -ne 0) { throw 'Desktop adapter build failed' }
& (Join-Path $desktopRoot 'gradlew.bat') -p $desktopRoot verifyNativeImageMetadata --console=plain
if ($LASTEXITCODE -ne 0) { throw 'Desktop native metadata verification failed' }
& $env:NORM_EXECUTABLE package (Join-Path $desktopRoot 'ui/desktop') --output (Join-Path $HOME '.norm/cache/packages')
if ($LASTEXITCODE -ne 0) { throw 'Desktop package build failed' }
$nativeTemp = Join-Path $PSScriptRoot '.tmp/native'
New-Item -ItemType Directory -Force $nativeTemp | Out-Null
$env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS -Djava.io.tmpdir=`"$nativeTemp`""
& (Join-Path $PSScriptRoot 'build.ps1') -NormExecutable $env:NORM_EXECUTABLE -Target Agent
& (Join-Path $PSScriptRoot 'build.ps1') -NormExecutable $env:NORM_EXECUTABLE -Target Desktop
