$ErrorActionPreference = 'Stop'
$executable = Join-Path $PSScriptRoot 'local-api-websocket-proxy.exe'
for (;;) {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $executable
  $start.WorkingDirectory = $PSScriptRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  try {
    [void]$process.Start()
    $process.WaitForExit()
    $result = $process.ExitCode
  } finally { $process.Dispose() }
  if ($result -eq 0) { exit 0 }
  Start-Sleep -Seconds 5
}
