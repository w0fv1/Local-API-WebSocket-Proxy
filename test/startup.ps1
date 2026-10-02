$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$directory = [IO.Path]::GetFullPath((Join-Path $project '.tmp/local-api-startup-test'))
$taskName = 'Local API WebSocket Proxy Test'
$installedExe = Join-Path $directory 'local-api-websocket-proxy.exe'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
Set-Content -LiteralPath (Join-Path $directory 'proxy.json') -Value '{"proxies":[]}' -Encoding utf8
try {
  & (Join-Path $project 'install.ps1') -InstallDirectory $directory -TaskName $taskName
  $task = Get-ScheduledTask -TaskName $taskName
  if ($task.Settings.RestartCount -ne 999 -or $task.Settings.RestartInterval -ne 'PT1M' -or $task.Settings.ExecutionTimeLimit -ne 'PT0S' -or $task.Settings.MultipleInstances -ne 'IgnoreNew') { throw 'Unexpected recovery settings' }
  if ($task.Principal.LogonType -ne 'Interactive' -or $task.Principal.RunLevel -ne 'Limited') { throw 'Unexpected logon principal' }
  if ($task.Triggers[0].CimClass.CimClassName -ne 'MSFT_TaskLogonTrigger') { throw 'Missing logon trigger' }
  $startup = Join-Path $directory 'startup.ps1'
  if ((& $startup -Action Query -Directory $directory) -ne 'true') { throw 'Installed startup is not enabled' }
  & $startup -Action Disable -Directory $directory
  if ((& $startup -Action Query -Directory $directory) -ne 'false') { throw 'Startup was not disabled' }
  if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Disabled') { throw 'Manual launch must remain available' }
  & (Join-Path $project 'install.ps1') -InstallDirectory $directory -TaskName $taskName
  if ((& $startup -Action Query -Directory $directory) -ne 'false') { throw 'Reinstall overwrote startup choice' }
  & $startup -Action Enable -Directory $directory
  if ((& $startup -Action Query -Directory $directory) -ne 'true') { throw 'Startup was not enabled' }
  & $startup -Action Disable -Directory $directory
  Start-ScheduledTask -TaskName $taskName
  $deadline = (Get-Date).AddSeconds(20)
  $child = $null
  do {
    Start-Sleep -Milliseconds 500
    $launcher = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $installedExe } | Select-Object -First 1
    if ($launcher) { $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($launcher.ProcessId)" | Where-Object Name -eq 'application.exe' | Select-Object -First 1 }
  } until ($child -or (Get-Date) -gt $deadline)
  if (!$child) { throw 'Scheduled application did not launch' }
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 1
  if (@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $installedExe }).Count -ne 1) { throw 'Duplicate scheduled launch' }
  $original = $launcher.ProcessId
  Stop-Process -Id $child.ProcessId -Force
  Write-Output "Simulated application crash; waiting for task recovery (launcher $original)."
  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Seconds 1
    $replacement = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $installedExe -and $_.ProcessId -ne $original } | Select-Object -First 1
  } until ($replacement -or (Get-Date) -gt $deadline)
  if (!$replacement) { throw 'Task did not recover abnormal exit' }
  $deadline = (Get-Date).AddSeconds(20)
  $windowReady = $false
  do {
    try {
      & (Join-Path $PSScriptRoot 'desktop-ui.ps1') -LauncherId $replacement.ProcessId -Action Inspect | Out-Null
      $windowReady = $true
    } catch { Start-Sleep -Milliseconds 250 }
  } until ($windowReady -or (Get-Date) -gt $deadline)
  if (!$windowReady) { throw 'Recovered application window did not appear' }
  & (Join-Path $PSScriptRoot 'desktop-ui.ps1') -LauncherId $replacement.ProcessId -Action Close
  $deadline = (Get-Date).AddSeconds(10)
  do { Start-Sleep -Milliseconds 200 } until ((Get-ScheduledTask -TaskName $taskName).State -eq 'Ready' -or (Get-Date) -gt $deadline)
  if ((Get-ScheduledTaskInfo -TaskName $taskName).LastTaskResult -ne 0) { throw 'Normal window close was not successful' }
  Write-Output 'PASS: startup switch, reinstall persistence, manual launch without autostart, singleton launch, crash recovery, normal close.'
} finally {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $taskName }
  & (Join-Path $project 'install.ps1') -TaskName $taskName -Uninstall
}
