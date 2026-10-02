param(
  [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version
)

$ErrorActionPreference = 'Stop'
$output = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '.tmp/local-api-proxy-releases'))
$name = "local-api-websocket-proxy-$Version-windows-x64"
$stage = Join-Path $output ($name + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $stage 'build') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build/local-api-websocket-proxy.exe') -Destination (Join-Path $stage 'build')
foreach ($file in @('startup.ps1', 'supervise.ps1')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $stage 'build')
}
foreach ($file in @('install.ps1', 'startup.ps1', 'supervise.ps1', 'package.json', 'package-lock.json', 'LICENSE')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $stage
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'gateway') -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'DISTRIBUTION.md') -Destination (Join-Path $stage 'README.md')
$archive = Join-Path $output "$name.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -Force
$checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $output "$name.sha256") -Value "$checksum  $name.zip" -Encoding ascii
Write-Output $archive
Write-Output $checksum
