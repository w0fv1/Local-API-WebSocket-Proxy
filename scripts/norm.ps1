$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$previous = $env:JAVA_TOOL_OPTIONS
try {
    $developmentHome = Join-Path $root '.norm-home'
    $env:JAVA_TOOL_OPTIONS = "$previous --enable-native-access=ALL-UNNAMED -Duser.home=`"$developmentHome`""
    $executable = if ($env:NORM_EXECUTABLE) { $env:NORM_EXECUTABLE } else { 'norm' }
    & $executable @args
    $result = $LASTEXITCODE
} finally { $env:JAVA_TOOL_OPTIONS = $previous }
exit $result
