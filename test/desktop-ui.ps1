param(
  [Parameter(Mandatory)][int]$LauncherId,
  [ValidateSet('Snapshot', 'Inspect', 'Click', 'Toggle', 'Resize', 'Capture', 'Close')][string]$Action = 'Snapshot',
  [string]$Text,
  [double]$Width = 760,
  [double]$Height = 680,
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$processIds = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $LauncherId" | Select-Object -ExpandProperty ProcessId) + @($LauncherId)
$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Local API WebSocket Proxy'))
$window = @($windows | Where-Object { $_.Current.ProcessId -in $processIds }) | Select-Object -First 1
if (!$window) { throw 'Owned proxy window not found' }
if ($Action -eq 'Close') {
  ([System.Windows.Automation.WindowPattern]$window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)).Close()
} elseif ($Action -in @('Resize', 'Capture')) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ProxyTestWindow {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@
  if ($Action -eq 'Resize') {
    if (![ProxyTestWindow]::SetWindowPos([IntPtr]$window.Current.NativeWindowHandle, [IntPtr]::Zero, 0, 0, [int]$Width, [int]$Height, 6)) { throw 'Cannot resize proxy window' }
  } else {
    if (!$OutputPath) { throw 'Missing capture path' }
    if (![ProxyTestWindow]::SetWindowPos([IntPtr]$window.Current.NativeWindowHandle, [IntPtr](-1), 0, 0, 0, 0, 3)) { throw 'Cannot bring proxy window forward' }
    Start-Sleep -Milliseconds 250
    Add-Type -AssemblyName System.Drawing
    $bounds = $window.Current.BoundingRectangle
    $bitmap = [Drawing.Bitmap]::new([int]$bounds.Width, [int]$bounds.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $bitmap.Size)
      $bitmap.Save([IO.Path]::GetFullPath($OutputPath), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose(); [void][ProxyTestWindow]::SetWindowPos([IntPtr]$window.Current.NativeWindowHandle, [IntPtr](-2), 0, 0, 0, 0, 3) }
  }
} elseif ($Action -eq 'Toggle') {
  $condition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Text), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::IsTogglePatternAvailableProperty, $true))
  $toggle = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if (!$toggle -or !$toggle.Current.IsEnabled) { throw "Toggle unavailable: $Text" }
  ([System.Windows.Automation.TogglePattern]$toggle.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)).Toggle()
} elseif ($Action -eq 'Click') {
  $condition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Text), [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
  $button = @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition) | Where-Object { $_.Current.IsEnabled }) | Select-Object -First 1
  if (!$button -or !$button.Current.IsEnabled) { throw "Button unavailable: $Text" }
  ([System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
} elseif ($Action -eq 'Inspect') {
  $elements = @($window) + @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
  @($elements | ForEach-Object {
    $bounds = $_.Current.BoundingRectangle
    if ($bounds.IsEmpty) { $bounds = $null }
    [pscustomobject]@{ name = $_.Current.Name; type = $_.Current.ControlType.ProgrammaticName; enabled = $_.Current.IsEnabled; x = $bounds.X; y = $bounds.Y; width = $bounds.Width; height = $bounds.Height }
  }) | ConvertTo-Json -Compress
} else {
  $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name }
}
