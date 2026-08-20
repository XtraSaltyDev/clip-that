param([Parameter(Mandatory = $true)][string]$Handles)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ClipThatWindows {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hwnd, StringBuilder value, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
}
'@

# DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2. Failure is harmless on older Windows;
# DWM still returns physical extended-frame bounds on supported Windows 11 hosts.
[void][ClipThatWindows]::SetProcessDpiAwarenessContext([IntPtr](-4))

$result = foreach ($rawHandle in $Handles.Split(',')) {
  $number = 0L
  if (-not [long]::TryParse($rawHandle, [ref]$number) -or $number -le 0) { continue }
  $hwnd = [IntPtr]$number
  $rect = New-Object ClipThatWindows+RECT
  $status = [ClipThatWindows]::DwmGetWindowAttribute(
    $hwnd,
    9,
    [ref]$rect,
    [Runtime.InteropServices.Marshal]::SizeOf([type][ClipThatWindows+RECT])
  )
  if ($status -ne 0 -or $rect.Right -le $rect.Left -or $rect.Bottom -le $rect.Top) { continue }

  $title = New-Object Text.StringBuilder 2048
  [void][ClipThatWindows]::GetWindowText($hwnd, $title, $title.Capacity)
  [uint32]$processId = 0
  [void][ClipThatWindows]::GetWindowThreadProcessId($hwnd, [ref]$processId)
  $processName = ''
  try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {}

  [pscustomobject]@{
    handle = $number.ToString()
    x = $rect.Left
    y = $rect.Top
    width = $rect.Right - $rect.Left
    height = $rect.Bottom - $rect.Top
    title = $title.ToString()
    appName = $processName
  }
}

ConvertTo-Json -Compress -InputObject @($result)
