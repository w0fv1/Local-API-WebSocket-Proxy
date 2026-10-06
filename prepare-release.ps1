param([string]$Tag)
$ErrorActionPreference = 'Stop'
$version = (Get-Content -Raw (Join-Path $PSScriptRoot 'package.json') | ConvertFrom-Json).version
if ($Tag -and $Tag -cne "v$version") { throw 'Tag must match package.json version' }
& (Join-Path $PSScriptRoot 'package-release.ps1') -Version $version
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'output') | Out-Null
$archive = "local-api-websocket-proxy-$version-windows-x64.zip"
Copy-Item (Join-Path $PSScriptRoot ".tmp/local-api-proxy-releases/$archive") (Join-Path $PSScriptRoot "output/$archive")
@{appKey='local-api-websocket-proxy';name='Local API WebSocket Proxy';version=$version;platform='windows-x64';artifact="output/$archive";notes='RELEASE.md';website='https://github.com/w0fv1/Local-API-WebSocket-Proxy'} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'output/release.json') -Encoding utf8
