param([string]$DependencyRoot = (Join-Path $PSScriptRoot '.tmp/dependencies'), [switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $DependencyRoot | Out-Null
foreach ($dependency in (Get-Content -Raw (Join-Path $PSScriptRoot 'build-dependencies.json') | ConvertFrom-Json)) {
    if ($dependency.revision -notmatch '^[a-f0-9]{40}$' -or $dependency.directory -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') { throw 'Dependencies require immutable revisions and simple directory names' }
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
& (Join-Path $DependencyRoot 'ui.theme/scripts/build.ps1') -JavaHome $env:THEME_JAVA_HOME
if ($LASTEXITCODE -ne 0) { throw 'Theme build failed' }
$normHome = Join-Path $PSScriptRoot '.norm-home'
$maven = Join-Path $normHome '.norm/cache/maven'
$packages = Join-Path $normHome '.norm/cache/packages/github'
New-Item -ItemType Directory -Force $maven, $packages | Out-Null
Copy-Item -Path (Join-Path $DependencyRoot 'ui.theme/build/repository/*') -Destination $maven -Recurse -Force
$previousOptions = $env:JAVA_TOOL_OPTIONS
try {
    $env:JAVA_TOOL_OPTIONS = "$previousOptions --enable-native-access=ALL-UNNAMED -Duser.home=`"$normHome`""
    foreach ($library in @('ui.theme', 'ui', 'ui.desktop', 'ui.desktop.kit')) {
        $libraryRoot = Join-Path $DependencyRoot $library
        if ($library -eq 'ui.desktop') {
            & (Join-Path $libraryRoot 'scripts/prepare.ps1') -NormHome $normHome
            if ($LASTEXITCODE -ne 0) { throw "$library preparation failed" }
        }
        if ($library -eq 'ui.desktop.kit') {
            & (Join-Path $libraryRoot 'scripts/prepare.ps1') -NormHome $normHome -UiRoot (Join-Path $DependencyRoot 'ui')
            if ($LASTEXITCODE -ne 0) { throw "$library preparation failed" }
        }
        $modulePath = $library.Replace('.', '/')
        if ($library -eq 'ui') {
            & (Join-Path $libraryRoot 'scripts/package.ps1') -Output (Join-Path $libraryRoot 'build/norm-repository')
        } else {
            & $env:NORM_EXECUTABLE package (Join-Path $libraryRoot $modulePath) --output (Join-Path $libraryRoot 'build/norm-repository')
        }
        if ($LASTEXITCODE -ne 0) { throw "$library packaging failed" }
        Copy-Item -Path (Join-Path $libraryRoot 'build/norm-repository/*') -Destination $packages -Recurse -Force
    }
    & $env:NORM_EXECUTABLE package (Join-Path $PSScriptRoot 'src/localapi/proxy') --output (Join-Path $PSScriptRoot 'build/norm-repository')
    if ($LASTEXITCODE -ne 0) { throw 'Proxy module packaging failed' }
    Copy-Item -Path (Join-Path $PSScriptRoot 'build/norm-repository/*') -Destination $packages -Recurse -Force
} finally { $env:JAVA_TOOL_OPTIONS = $previousOptions }
if ($PrepareOnly) { return }
$nativeTemp = Join-Path $PSScriptRoot '.tmp/native'
New-Item -ItemType Directory -Force $nativeTemp | Out-Null
$env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS -Djava.io.tmpdir=`"$nativeTemp`""
$applicationNorm = Join-Path $PSScriptRoot 'scripts/norm.ps1'
& (Join-Path $PSScriptRoot 'build.ps1') -NormExecutable $applicationNorm -Target Agent
& (Join-Path $PSScriptRoot 'build.ps1') -NormExecutable $applicationNorm -Target Desktop
