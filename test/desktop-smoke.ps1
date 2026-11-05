$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$directory = Join-Path $projectRoot ('.tmp/desktop-smoke/' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $directory | Out-Null
foreach ($file in @('local-api-websocket-proxy.exe', 'startup.ps1', 'supervise.ps1')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "build/$file") -Destination $directory
}
@{ taskName = 'Local API Proxy Smoke ' + [Guid]::NewGuid().ToString('N') } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $directory 'startup.json') -Encoding utf8
$launcher = Start-Process -FilePath (Join-Path $directory 'local-api-websocket-proxy.exe') -WorkingDirectory $directory -WindowStyle Hidden -PassThru
try {
    Start-Sleep -Seconds 4
    $snapshot = & (Join-Path $PSScriptRoot 'desktop-ui.ps1') -LauncherId $launcher.Id -Action Snapshot
    if (-not ($snapshot -contains '全部连接') -or -not ($snapshot -contains '新增')) { throw 'Native desktop did not expose proxy controls' }
    $initial = & (Join-Path $PSScriptRoot 'desktop-ui.ps1') -LauncherId $launcher.Id -Action Inspect | ConvertFrom-Json
    if (@($initial | Where-Object { $_.name -eq '删除' -and $_.type -eq 'ControlType.Button' }).Count -ne 1) { throw 'Initial proxy is missing' }
    & (Join-Path $PSScriptRoot 'desktop-ui.ps1') -LauncherId $launcher.Id -Action Click -Text '新增'
    Start-Sleep -Milliseconds 500
    $updated = & (Join-Path $PSScriptRoot 'desktop-ui.ps1') -LauncherId $launcher.Id -Action Inspect | ConvertFrom-Json
    if (@($updated | Where-Object { $_.name -eq '删除' -and $_.type -eq 'ControlType.Button' }).Count -ne 2) { throw 'Native add did not create an independent second proxy' }
    & (Join-Path $PSScriptRoot 'desktop-ui.ps1') -LauncherId $launcher.Id -Action Close
    if (-not $launcher.WaitForExit(15000)) { throw 'Owned native desktop did not terminate' }
    if ($launcher.ExitCode -ne 0) { throw "Native desktop exited with code $($launcher.ExitCode)" }
    if (Test-Path -LiteralPath (Join-Path $directory 'proxy.json')) { throw 'Smoke test must not persist configuration' }
    Write-Output 'Native desktop startup, dynamic add and close verified'
} finally {
    if (-not $launcher.HasExited) { Stop-Process -Id $launcher.Id -Force }
}
