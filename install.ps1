param(
  [string]$Executable = (Join-Path $PSScriptRoot 'build/local-api-websocket-proxy.exe'),
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs/LocalApiWebSocketProxy'),
  [string]$TaskName = 'Local API WebSocket Proxy',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) "$TaskName.lnk"
if ($Uninstall) {
  & (Join-Path $PSScriptRoot 'startup.ps1') -Action Remove -Directory $InstallDirectory -TaskName $TaskName
  if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
  Write-Output 'Autostart removed; application and configuration retained.'
  return
}

$source = (Resolve-Path -LiteralPath $Executable).Path
$destination = [IO.Path]::GetFullPath($InstallDirectory)
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$installedExe = Join-Path $destination 'local-api-websocket-proxy.exe'
if ($source -ne $installedExe) { Copy-Item -LiteralPath $source -Destination $installedExe -Force }
$sourceConfig = Join-Path (Split-Path -Parent $source) 'proxy.json'
$installedConfig = Join-Path $destination 'proxy.json'
if ((Test-Path -LiteralPath $sourceConfig) -and !(Test-Path -LiteralPath $installedConfig)) {
  Copy-Item -LiteralPath $sourceConfig -Destination $installedConfig
}
foreach ($file in @('startup.ps1', 'supervise.ps1')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $destination $file) -Force
}
& (Join-Path $destination 'startup.ps1') -Action Register -Directory $destination -TaskName $TaskName
$shell = New-Object -ComObject WScript.Shell
$launcherScript = Join-Path $destination 'launch.vbs'
$taskCommand = ('schtasks.exe /Run /TN "' + $TaskName + '"').Replace('"', '""')
Set-Content -LiteralPath $launcherScript -Value ('CreateObject("WScript.Shell").Run "' + $taskCommand + '", 0, False') -Encoding Unicode
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32/wscript.exe'
$shortcut.Arguments = '"' + $launcherScript + '"'
$shortcut.WindowStyle = 1
$shortcut.IconLocation = $installedExe
$shortcut.WorkingDirectory = $destination
$shortcut.Save()
Write-Output "Installed: $installedExe"
Write-Output "Autostart task: $TaskName"
Write-Output "Start menu shortcut: $shortcutPath"
