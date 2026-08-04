const { spawn } = require('child_process');
const SUPPORTED_MODES = new Set(['native-fullscreen', 'borderless-fullscreen', 'centered']);
function normalizePresentationMode(mode) {
  return SUPPORTED_MODES.has(mode) ? mode : 'centered';
}
function buildWindowsPresentationScript({ pid, mode = 'borderless-fullscreen', timeoutMs = 12000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) throw new TypeError('pid must be a positive integer');
  const selectedMode = normalizePresentationMode(mode);
  const boundedTimeout = Math.max(1000, Math.min(30000, Number(timeoutMs) || 12000));
  return String.raw`$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GameDeckWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint sourceThread, uint targetThread, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
}
'@
$pidValue = ${pid}
$modeValue = '${selectedMode}'
$deadline = [DateTime]::UtcNow.AddMilliseconds(${boundedTimeout})
$window = [IntPtr]::Zero
$process = $null
while ([DateTime]::UtcNow -lt $deadline -and $window -eq [IntPtr]::Zero) {
  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if (-not $process) { break }
  $process.Refresh()
  $window = $process.MainWindowHandle
  if ($window -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 120 }
}
if ($window -eq [IntPtr]::Zero) {
  [pscustomobject]@{ ok = $false; mode = $modeValue; status = 'window-timeout'; pid = $pidValue } | ConvertTo-Json -Compress
  exit 2
}
$original = New-Object GameDeckWindow+RECT
[GameDeckWindow]::GetWindowRect($window, [ref]$original) | Out-Null
$monitor = [GameDeckWindow]::MonitorFromWindow($window, 2)
$info = New-Object GameDeckWindow+MONITORINFO
$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][GameDeckWindow+MONITORINFO])
if (-not [GameDeckWindow]::GetMonitorInfo($monitor, [ref]$info)) { throw 'Could not resolve the target monitor.' }
[GameDeckWindow]::ShowWindowAsync($window, 9) | Out-Null
$status = 'centered'
$bounds = $info.rcMonitor
if ($modeValue -eq 'native-fullscreen') {
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    $actual = New-Object GameDeckWindow+RECT
    [GameDeckWindow]::GetWindowRect($window, [ref]$actual) | Out-Null
    $covers = [Math]::Abs($actual.Left - $bounds.Left) -le 2 -and [Math]::Abs($actual.Top - $bounds.Top) -le 2 -and [Math]::Abs($actual.Right - $bounds.Right) -le 2 -and [Math]::Abs($actual.Bottom - $bounds.Bottom) -le 2
    if ($covers) { $status = 'native-fullscreen'; break }
    Start-Sleep -Milliseconds 100
  }
}
if ($modeValue -eq 'borderless-fullscreen') {
  $style = [GameDeckWindow]::GetWindowLongPtr($window, -16).ToInt64()
  $chromeMask = [long]0x00CF0000
  $popupStyle = [long]0x80000000
  $newStyle = ($style -band (-bnot $chromeMask)) -bor $popupStyle
  [GameDeckWindow]::SetWindowLongPtr($window, -16, [IntPtr]$newStyle) | Out-Null
  $width = $bounds.Right - $bounds.Left
  $height = $bounds.Bottom - $bounds.Top
  [GameDeckWindow]::SetWindowPos($window, [IntPtr]::Zero, $bounds.Left, $bounds.Top, $width, $height, 0x0260) | Out-Null
  Start-Sleep -Milliseconds 180
  $actual = New-Object GameDeckWindow+RECT
  [GameDeckWindow]::GetWindowRect($window, [ref]$actual) | Out-Null
  $covers = [Math]::Abs($actual.Left - $bounds.Left) -le 2 -and [Math]::Abs($actual.Top - $bounds.Top) -le 2 -and [Math]::Abs($actual.Right - $bounds.Right) -le 2 -and [Math]::Abs($actual.Bottom - $bounds.Bottom) -le 2
  if ($covers) { $status = 'borderless-fullscreen' }
}
if ($status -ne 'borderless-fullscreen' -and $status -ne 'native-fullscreen') {
  $work = $info.rcWork
  $workWidth = $work.Right - $work.Left
  $workHeight = $work.Bottom - $work.Top
  $originalWidth = [Math]::Max(320, $original.Right - $original.Left)
  $originalHeight = [Math]::Max(240, $original.Bottom - $original.Top)
  $targetWidth = [Math]::Min($originalWidth, [Math]::Floor($workWidth * 0.92))
  $targetHeight = [Math]::Min($originalHeight, [Math]::Floor($workHeight * 0.92))
  $targetLeft = $work.Left + [Math]::Floor(($workWidth - $targetWidth) / 2)
  $targetTop = $work.Top + [Math]::Floor(($workHeight - $targetHeight) / 2)
  [GameDeckWindow]::SetWindowPos($window, [IntPtr]::Zero, $targetLeft, $targetTop, $targetWidth, $targetHeight, 0x0240) | Out-Null
  $status = if ($modeValue -eq 'centered') { 'centered' } else { 'centered-fallback' }
}
$foregroundWindow = [GameDeckWindow]::GetForegroundWindow()
$foregroundPid = 0
$targetPid = 0
$foregroundThread = [GameDeckWindow]::GetWindowThreadProcessId($foregroundWindow, [ref]$foregroundPid)
$targetThread = [GameDeckWindow]::GetWindowThreadProcessId($window, [ref]$targetPid)
$attached = $false
if ($foregroundThread -ne 0 -and $targetThread -ne 0 -and $foregroundThread -ne $targetThread) {
  $attached = [GameDeckWindow]::AttachThreadInput($foregroundThread, $targetThread, $true)
}
[GameDeckWindow]::SetWindowPos($window, [IntPtr](-1), 0, 0, 0, 0, 0x0003) | Out-Null
[GameDeckWindow]::BringWindowToTop($window) | Out-Null
[GameDeckWindow]::SetForegroundWindow($window) | Out-Null
[GameDeckWindow]::SetFocus($window) | Out-Null
[GameDeckWindow]::SetWindowPos($window, [IntPtr](-2), 0, 0, 0, 0, 0x0003) | Out-Null
if ($attached) { [GameDeckWindow]::AttachThreadInput($foregroundThread, $targetThread, $false) | Out-Null }
Start-Sleep -Milliseconds 180
$foreground = [GameDeckWindow]::GetForegroundWindow() -eq $window
$final = New-Object GameDeckWindow+RECT
[GameDeckWindow]::GetWindowRect($window, [ref]$final) | Out-Null
[pscustomobject]@{
  ok = $true
  mode = $modeValue
  status = $status
  pid = $pidValue
  left = $final.Left
  top = $final.Top
  width = $final.Right - $final.Left
  height = $final.Bottom - $final.Top
  monitorLeft = $info.rcMonitor.Left
  monitorTop = $info.rcMonitor.Top
  monitorRight = $info.rcMonitor.Right
  monitorBottom = $info.rcMonitor.Bottom
  monitorWidth = $info.rcMonitor.Right - $info.rcMonitor.Left
  monitorHeight = $info.rcMonitor.Bottom - $info.rcMonitor.Top
  foreground = $foreground
} | ConvertTo-Json -Compress`;
}
function parsePresentationResult(stdout, stderr = '') {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  const candidate = lines.at(-1);
  if (!candidate) return { ok: false, status: 'no-result', error: String(stderr || '').trim() };
  try {
    return JSON.parse(candidate);
  } catch {
    return { ok: false, status: 'invalid-result', error: String(stderr || candidate).trim() };
  }
}
function handoffHostWindowForNativeGame({ hostWindow, child } = {}) {
  if (!hostWindow || !child || typeof child.once !== 'function') return { minimized: false, restore: () => false };
  const available = typeof hostWindow.isDestroyed !== 'function' || !hostWindow.isDestroyed();
  const visible = available && (typeof hostWindow.isVisible !== 'function' || hostWindow.isVisible());
  if (!visible) return { minimized: false, restore: () => false };
  const wasMaximized = typeof hostWindow.isMaximized === 'function' && hostWindow.isMaximized();
  let restored = false;
  const restore = () => {
    if (restored) return false;
    restored = true;
    if (typeof hostWindow.isDestroyed === 'function' && hostWindow.isDestroyed()) return false;
    try {
      if (typeof hostWindow.isMinimized !== 'function' || hostWindow.isMinimized()) hostWindow.restore?.();
      if (wasMaximized) hostWindow.maximize?.();
      hostWindow.show?.();
      hostWindow.focus?.();
      return true;
    } catch {
      return false;
    }
  };
  child.once('exit', restore);
  child.once('error', restore);
  try {
    hostWindow.blur?.();
    hostWindow.minimize?.();
    return { minimized: true, restore };
  } catch {
    return { minimized: false, restore };
  }
}

function presentNativeGameWindow({ pid, mode = 'borderless-fullscreen', timeoutMs = 12000, platform = process.platform, spawnImpl = spawn } = {}) {
  if (platform !== 'win32') return Promise.resolve({ ok: false, status: 'unsupported-platform', mode: normalizePresentationMode(mode) });
  const script = buildWindowsPresentationScript({ pid, mode, timeoutMs });
  return new Promise(resolve => {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', error => resolve({ ok: false, status: 'presenter-error', mode: normalizePresentationMode(mode), error: error.message }));
    child.once('close', () => resolve(parsePresentationResult(stdout, stderr)));
  });
}
module.exports = {
  buildWindowsPresentationScript,
  normalizePresentationMode,
  handoffHostWindowForNativeGame,
  parsePresentationResult,
  presentNativeGameWindow
};
