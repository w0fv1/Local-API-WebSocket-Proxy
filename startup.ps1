param(
  [ValidateSet('Query', 'Enable', 'Disable', 'Register', 'Remove')][string]$Action = 'Query',
  [string]$Directory = $PSScriptRoot,
  [string]$TaskName
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$directoryPath = [IO.Path]::GetFullPath($Directory)
$metadataPath = Join-Path $directoryPath 'startup.json'
if (!$TaskName) {
  $TaskName = if (Test-Path -LiteralPath $metadataPath) { (Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json).taskName } else { 'Local API WebSocket Proxy' }
}
if ([string]::IsNullOrWhiteSpace($TaskName)) { throw 'Missing startup task name' }
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Action -eq 'Query') {
  $enabled = $existing -and $existing.State -ne 'Disabled' -and @($existing.Triggers | Where-Object { $_.Enabled -and $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count -gt 0
  Write-Output ([bool]$enabled).ToString().ToLowerInvariant()
  return
}
if ($Action -eq 'Remove') {
  if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
  return
}
if ($Action -eq 'Disable' -and !$existing) { return }
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$trigger.Enabled = $Action -ne 'Disable'
if ($Action -eq 'Register' -and $existing) {
  $trigger.Enabled = $existing.State -ne 'Disabled' -and @($existing.Triggers | Where-Object { $_.Enabled -and $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count -gt 0
}
if ($Action -ne 'Register' -and $existing) {
  Set-ScheduledTask -TaskName $TaskName -Trigger $trigger | Out-Null
  if ($existing.State -eq 'Disabled') { Enable-ScheduledTask -TaskName $TaskName | Out-Null }
} else {
  $executable = Join-Path $directoryPath 'local-api-websocket-proxy.exe'
  $supervisor = Join-Path $directoryPath 'supervise.ps1'
  if (!(Test-Path -LiteralPath $executable) -or !(Test-Path -LiteralPath $supervisor)) { throw 'Missing startup application or supervisor' }
  $powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $taskAction = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $supervisor + '"') -WorkingDirectory $directoryPath
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Description 'Local API proxy: user logon and abnormal exit recovery.' -Force | Out-Null
  @{ taskName = $TaskName } | ConvertTo-Json -Compress | Set-Content -LiteralPath $metadataPath -Encoding utf8
}
