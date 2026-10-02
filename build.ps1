param(
  [Parameter(Mandatory)][string]$NormExecutable,
  [ValidateSet('Desktop', 'Agent')][string]$Target = 'Desktop'
)

$ErrorActionPreference = 'Stop'
$norm = (Resolve-Path -LiteralPath $NormExecutable).Path
$projectRoot = $PSScriptRoot
$workspace = Join-Path $projectRoot 'build/workspace'
$logRoot = Join-Path $projectRoot '.tmp/local-api-proxy-build'
if (Test-Path -LiteralPath $workspace) {
  $resolvedWorkspace = (Resolve-Path -LiteralPath $workspace).Path
  $expectedWorkspace = [IO.Path]::GetFullPath((Join-Path $projectRoot 'build/workspace'))
  if ($resolvedWorkspace -ne $expectedWorkspace) { throw 'Unexpected build workspace path' }
  Remove-Item -LiteralPath $resolvedWorkspace -Recurse -Force
}
New-Item -ItemType Directory -Force $workspace, $logRoot | Out-Null
$modules = @{
  'proxy' = 'dependencies/localapi/proxy'
  'desktop' = 'localapi/desktop'
}
foreach ($entry in $modules.GetEnumerator()) {
  $destination = Join-Path $workspace $entry.Value
  New-Item -ItemType Directory -Force $destination | Out-Null
  Copy-Item -Path (Join-Path $projectRoot "src/localapi/$($entry.Key)/*.norm") -Destination $destination -Force
}
$module = if ($Target -eq 'Agent') { 'dependencies/localapi/proxy' } else { 'localapi/desktop' }
$source = (Join-Path $workspace "$module/application.norm").Replace('\', '/')
$log = Join-Path $logRoot ("$($Target.ToLowerInvariant())-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Push-Location $projectRoot
try {
  $arguments = @('build')
  if ($Target -eq 'Desktop') { $arguments += '--windowed' }
  $arguments += $source
  & $norm @arguments *> $log
  if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath $log -Tail 35; throw "Application build failed. Log: $log" }
} finally { Pop-Location }
$name = if ($Target -eq 'Agent') { 'proxy' } else { 'desktop' }
$artifact = Join-Path $workspace "$module/build/$name.exe"
$output = Join-Path $projectRoot ('build/' + $(if ($Target -eq 'Agent') { 'agent.exe' } else { 'local-api-websocket-proxy.exe' }))
Copy-Item -LiteralPath $artifact -Destination $output -Force
if ($Target -eq 'Desktop') {
  foreach ($file in @('startup.ps1', 'supervise.ps1')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Split-Path -Parent $output) -Force
  }
}
Write-Output $output
Write-Output "Build log: $log"
