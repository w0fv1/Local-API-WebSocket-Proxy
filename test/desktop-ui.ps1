param(
  [Parameter(Mandatory)][int]$LauncherId,
  [ValidateSet('Snapshot', 'Inspect', 'ExerciseInputs', 'Click', 'Toggle', 'Resize', 'Capture', 'Close')][string]$Action = 'Snapshot',
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
} elseif ($Action -eq 'ExerciseInputs') {
  Add-Type -AssemblyName System.Drawing
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class ProxyFieldInput {
  [DllImport("user32")] public static extern bool SetProcessDPIAware();
  [DllImport("user32")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32")] public static extern bool ScreenToClient(IntPtr window, ref Point point);
  [DllImport("user32")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wp, IntPtr lp);
}
"@
  [void][ProxyFieldInput]::SetProcessDPIAware()
  $handle = [IntPtr]$window.Current.NativeWindowHandle
  [void][ProxyFieldInput]::ShowWindow($handle, 9)
  [void][ProxyFieldInput]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, 3)
  [void][ProxyFieldInput]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 250
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  $fields = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if ($fields.Count -ne 3) { throw "Expected three editable fields, found $($fields.Count)" }
  foreach ($field in $fields) {
    $bounds = $field.Current.BoundingRectangle
    $point = [Drawing.Point]::new([int]($bounds.X + 15), [int]($bounds.Y + $bounds.Height / 2))
    if (![ProxyFieldInput]::ScreenToClient($handle, [ref]$point)) { throw 'Failed to resolve field position' }
    $position = [IntPtr]($point.X -bor ($point.Y -shl 16))
    $value = [System.Windows.Automation.ValuePattern]$field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $original = $value.Current.Value
    [void][ProxyFieldInput]::PostMessage($handle, 0x201, [IntPtr]1, $position)
    [void][ProxyFieldInput]::PostMessage($handle, 0x202, [IntPtr]0, $position)
    for ($i = 0; $i -lt 40 -and !$field.Current.HasKeyboardFocus; $i++) { Start-Sleep -Milliseconds 50 }
    if (!$field.Current.HasKeyboardFocus) { throw 'Text field did not receive pointer focus' }
    [void][ProxyFieldInput]::PostMessage($handle, 0x102, [IntPtr]120, [IntPtr]1)
    for ($i = 0; $i -lt 40 -and $value.Current.Value -eq $original; $i++) { Start-Sleep -Milliseconds 50 }
    if ($value.Current.Value -eq $original) { throw 'Focused input did not accept text' }
    $value.SetValue($original)
  }
} elseif ($Action -in @('Resize', 'Capture')) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ProxyTestWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@
  [void][ProxyTestWindow]::ShowWindow([IntPtr]$window.Current.NativeWindowHandle, 9)
  Start-Sleep -Milliseconds 120
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
