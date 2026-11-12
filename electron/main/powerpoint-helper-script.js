// The PowerPoint helper: a long-running PowerShell process that drives Microsoft PowerPoint through
// its automation (COM) interface. It reads one JSON command per line on stdin and answers one JSON
// line per command: { id, ok, ... } or { id, ok: false, error }.
//
// Kept as a string and written to a temp file at run time, so it works from inside the packaged
// app (PowerShell cannot read files inside app.asar).
//
// The slideshow plays in PowerPoint's full presenting mode ("presented by a speaker": pen, laser and
// PowerPoint's own slideshow toolbar), shrunk into a window: made borderless, owned by the No-Prep
// window (so it stays above it and minimises with it) and placed over the player's stage.
// It is never made a child window: Chromium paints over child windows, and a child would be
// destroyed together with No-Prep.
module.exports = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NpWin {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  // A question box PowerPoint opened (e.g. "Save changes?") while playing. It would sit under the
  // slideshow and leave No-Prep's window disabled, so it is brought to the front instead.
  public static bool RaiseDialog(IntPtr show) {
    uint pid; GetWindowThreadProcessId(show, out pid);
    return RaiseBox(pid, show);
  }
  public static bool RaiseBox(uint pid, IntPtr show) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || h == show || !IsWindowVisible(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      string name = c.ToString();
      if (name == "#32770" || name == "NUIDialog") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return false;
    SetWindowPos(found, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);   // topmost, show
    SetForegroundWindow(found);
    return true;
  }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("ole32.dll")] static extern int CoRegisterMessageFilter(IOleMessageFilter filter, out IOleMessageFilter old);
  public static void UseBusyRetry() { IOleMessageFilter old; CoRegisterMessageFilter(new BusyRetry(), out old); }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static IntPtr FindByTitle(string start) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      var t = new StringBuilder(1024);
      GetWindowText(h, t, 1024);
      if (t.ToString().StartsWith(start, StringComparison.OrdinalIgnoreCase)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
[ComImport, Guid("00000016-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IOleMessageFilter {
  [PreserveSig] int HandleInComingCall(int callType, IntPtr caller, int tickCount, IntPtr info);
  [PreserveSig] int RetryRejectedCall(IntPtr callee, int tickCount, int rejectType);
  [PreserveSig] int MessagePending(IntPtr callee, int tickCount, int pendingType);
}
// PowerPoint busy -> try again every 150 ms for up to 2.5 s; after that the call fails as "busy".
public class BusyRetry : IOleMessageFilter {
  public int HandleInComingCall(int callType, IntPtr caller, int tickCount, IntPtr info) { return 0; }
  public int RetryRejectedCall(IntPtr callee, int tickCount, int rejectType) { return (rejectType == 2 && tickCount < 2500) ? 150 : -1; }
  public int MessagePending(IntPtr callee, int tickCount, int pendingType) { return 2; }
}
"@
[NpWin]::UseBusyRetry()

Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase, System.Drawing -TypeDefinition @"
using System;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Automation;
using System.Runtime.InteropServices;
public static class NpShow {
  // Ending a show that has pen marks makes PowerPoint ask "Keep your ink annotations?" and wait.
  // No-Prep plays a read-only copy that is never saved, so when No-Prep ends the show it answers
  // that box itself (Discard) from a background thread while the main thread waits on PowerPoint.
  public static void AnswerInkBox(int pid, int ms) {
    var t = new Thread(() => {
      var until = DateTime.Now.AddMilliseconds(ms);
      while (DateTime.Now < until) {
        try { if (TryAnswer(pid)) return; } catch {}
        Thread.Sleep(150);
      }
    });
    t.IsBackground = true;
    t.Start();
  }
  static bool TryAnswer(int pid) {
    var mine = new PropertyCondition(AutomationElement.ProcessIdProperty, pid);
    var box = new PropertyCondition(AutomationElement.ClassNameProperty, "NUIDialog");
    var button = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
    foreach (AutomationElement top in AutomationElement.RootElement.FindAll(TreeScope.Children, mine)) {
      var dialog = top.Current.ClassName == "NUIDialog" ? top : top.FindFirst(TreeScope.Descendants, box);
      if (dialog == null) continue;
      // The ink box: Keep (id 101) and Discard (id 102), the same in every language.
      AutomationElement keep = null, discard = null;
      foreach (AutomationElement b in dialog.FindAll(TreeScope.Descendants, button)) {
        if (b.Current.AutomationId == "101") keep = b;
        if (b.Current.AutomationId == "102") discard = b;
      }
      if (keep == null || discard == null) continue;
      ((InvokePattern)discard.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
      return true;
    }
    return false;
  }

  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static int ProcessOf(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return (int)pid; }

  // A picture of the slideshow exactly as it is on screen (animations as far as they have got),
  // in real pixels, scaled to 'width'. False when the window could not be photographed.
  public static bool Photograph(IntPtr h, string path, int width) {
    IntPtr old = IntPtr.Zero;
    try { old = SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch {}
    try {
      RECT r; if (!GetWindowRect(h, out r)) return false;
      int w = r.R - r.L, hh = r.B - r.T;
      if (w < 10 || hh < 10) return false;
      using (var full = new Bitmap(w, hh)) {
        using (var g = Graphics.FromImage(full)) {
          IntPtr dc = g.GetHdc();
          bool ok = PrintWindow(h, dc, 2);    // PW_RENDERFULLCONTENT
          g.ReleaseHdc(dc);
          if (!ok) return false;
        }
        if (LooksBlank(full)) return false;
        int outW = Math.Min(width, w), outH = (int)Math.Round((double)hh * outW / w);
        using (var small = new Bitmap(full, outW, outH)) { small.Save(path, ImageFormat.Png); }
      }
      return true;
    } finally {
      if (old != IntPtr.Zero) { try { SetThreadDpiAwarenessContext(old); } catch {} }
    }
  }
  static bool LooksBlank(Bitmap b) {
    Color first = b.GetPixel(b.Width / 2, b.Height / 2);
    for (int i = 1; i <= 8; i++) {
      Color c = b.GetPixel(b.Width * i / 9, b.Height * ((i * 5) % 9 + 1) / 10);
      if (c.ToArgb() != first.ToArgb()) return false;
    }
    return true;
  }
}
"@

$script:app = $null
$script:startedApp = $false
$script:pres = $null
$script:show = $null
$script:hwnd = [IntPtr]::Zero

function Reply($id, $data) {
  $data['id'] = $id
  [Console]::Out.WriteLine(($data | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

function Get-PowerPoint {
  if ($script:app) {
    if (Test-Ready $script:app) { return $script:app }
    # No answer: either it is waiting on a question box (busy) or it was closed (connect again).
    if (Show-PowerPointBox) { throw 'POWERPOINT_BUSY' }
    $script:app = $null
  }
  try {
    $script:app = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
  } catch {
    $script:app = New-Object -ComObject PowerPoint.Application
    $script:startedApp = $true
  }
  if (-not (Test-Ready $script:app)) { $null = Show-PowerPointBox; throw 'POWERPOINT_BUSY' }
  return $script:app
}

# While PowerPoint has a question box open (e.g. "Save changes?", "Keep ink annotations?") it
# turns every request away (after the busy retries above it answers with nothing).
function Test-Ready($ppt) {
  try { return $null -ne $ppt.Presentations } catch { return $false }
}

# Brings PowerPoint's open question box to the front, so the teacher sees what it is waiting for.
function Show-PowerPointBox {
  $raised = $false
  foreach ($proc in @(Get-Process POWERPNT -ErrorAction SilentlyContinue)) {
    try { if ([NpWin]::RaiseBox([uint32]$proc.Id, [IntPtr]::Zero)) { $raised = $true } } catch {}
  }
  return $raised
}

function Find-Open($path) {
  $ppt = Get-PowerPoint
  foreach ($p in @($ppt.Presentations)) {
    if ([string]::Equals($p.FullName, $path, [StringComparison]::OrdinalIgnoreCase)) { return $p }
  }
  return $null
}

function Place($x, $y, $w, $h) {
  if ($script:hwnd -eq [IntPtr]::Zero) { return }
  # SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
  [NpWin]::SetWindowPos($script:hwnd, [IntPtr]::Zero, [int]$x, [int]$y, [int]$w, [int]$h, 0x0004 -bor 0x0010 -bor 0x0020) | Out-Null
}

# After a show ends PowerPoint answers with empty values rather than errors, so check that the
# slideshow window still exists and is on a real slide.
function Show-Running {
  if (-not $script:show -or -not $script:pres) { return $false }
  if ($script:hwnd -ne [IntPtr]::Zero -and -not [NpWin]::IsWindow($script:hwnd)) { return $false }
  # While PowerPoint is moving to another slide it can briefly answer with nothing: ask again.
  for ($try = 0; $try -lt 3; $try++) {
    try {
      $position = $script:show.View.CurrentShowPosition
      if ($null -ne $position -and [int]$position -gt 0 -and $script:pres.Slides.Count -gt 0) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 150
  }
  return $false
}

function Stop-Show {
  # Detach from No-Prep first, so PowerPoint never holds a window whose owner is going away.
  if ($script:hwnd -ne [IntPtr]::Zero -and [NpWin]::IsWindow($script:hwnd)) {
    try { [NpWin]::SetWindowLongPtr($script:hwnd, -8, [IntPtr]::Zero) | Out-Null } catch {}
  }
  if ($script:hwnd -ne [IntPtr]::Zero) {
    try { [NpShow]::AnswerInkBox([NpShow]::ProcessOf($script:hwnd), 8000) } catch {}
  }
  if ($script:show) { try { $script:show.View.Exit() } catch {} }
  if ($script:pres) { try { $script:pres.Saved = -1; $script:pres.Close() } catch {} }
  $script:show = $null; $script:pres = $null; $script:hwnd = [IntPtr]::Zero
  # PowerPoint stays open (hidden) for a quick next show; No-Prep sends 'idle' after a while.
}

# Only quits a PowerPoint this helper started, and only when nothing else is open in it.
function Quit-IfOurs {
  if (-not $script:startedApp -or -not $script:app) { return }
  try {
    if ($script:app.Presentations.Count -eq 0) { $script:app.Quit(); $script:app = $null; $script:startedApp = $false }
  } catch {}
}

# A slideshow No-Prep left behind (it was closed while playing): read-only copies under No-Prep's
# Presentations folder. Files open for editing are never read-only here, so they are never touched.
function Close-Leftovers($root) {
  if (-not $root) { return 0 }
  $root = $root.Replace('/', '\').TrimEnd('\') + '\'
  $ppt = $null
  try { $ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { return 0 }
  $closed = 0
  foreach ($p in @($ppt.Presentations)) {
    try {
      if ($p.ReadOnly -and $p.FullName.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and -not [object]::ReferenceEquals($p, $script:pres)) {
        try { $p.SlideShowWindow.View.Exit() } catch {}
        $p.Saved = -1
        $p.Close()
        $closed++
      }
    } catch {}
  }
  return $closed
}

function Export-Slide($pres, $index, $out, $width) {
  $ratio = $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth
  $pres.Slides.Item($index).Export($out, 'PNG', [int]$width, [int]([double]$width * $ratio))
}

$step = ''
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $msg = $null
  try { $msg = $line | ConvertFrom-Json } catch { continue }
  $id = $msg.id
  $a = $msg.args
  $done = $false
  try {
    switch ($msg.cmd) {
      'ping' { Reply $id @{ ok = $true } }

      'play' {
        $step = 'open'
        Stop-Show
        $ppt = Get-PowerPoint             # first: a busy PowerPoint is reported straight away
        $null = Close-Leftovers ([string]$a.root)
        $open = Find-Open ([string]$a.path)
        if ($open -and -not $open.ReadOnly) { throw 'PRESENTATION_EDITING' }
        # Read-only, no editing window: playing never changes the teacher's file.
        $script:pres = $ppt.Presentations.Open([string]$a.path, -1, 0, 0)
        $settings = $script:pres.SlideShowSettings
        # ppShowTypeSpeaker: PowerPoint's full presenting mode (pen, laser, its slideshow toolbar);
        # the window is shrunk onto the stage below. Never the two-screen presenter view.
        $settings.ShowType = 1
        try { $settings.ShowPresenterView = 0 } catch {}
        $settings.LoopUntilStopped = 0
        $step = 'run'
        $script:show = $settings.Run()
        # Changing the show settings marks it as changed; closing the slideshow window must never
        # ask "Save changes?" (such a box hides under the slideshow and blocks No-Prep's window).
        # PowerPoint's own alert setting is left alone: if No-Prep crashed it would stay changed.
        $script:pres.Saved = -1
        $step = 'window'
        $script:hwnd = [IntPtr]::Zero
        try { $script:hwnd = [IntPtr][Int64]$script:show.HWND } catch {}
        $name = [IO.Path]::GetFileName([string]$a.path)
        for ($i = 0; $script:hwnd -eq [IntPtr]::Zero -and $i -lt 60; $i++) {
          $script:hwnd = [NpWin]::FindByTitle("PowerPoint Slide Show - [$name")
          if ($script:hwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 100 }
        }
        if ($script:hwnd -eq [IntPtr]::Zero) { throw 'The slideshow window did not appear.' }
        # PowerPoint may report the slide area inside the slideshow window: use the outer window.
        $root = [NpWin]::GetAncestor($script:hwnd, 2)   # GA_ROOT
        if ($root -ne [IntPtr]::Zero) { $script:hwnd = $root }
        # Borderless, owned by No-Prep (stays above it, minimises with it), never a child window.
        $style = [NpWin]::GetWindowLong($script:hwnd, -16)
        $style = ($style -band (-bnot 0x00CF0000)) -bor ([int]0x80000000)   # no caption/frame/system menu; WS_POPUP
        [NpWin]::SetWindowLong($script:hwnd, -16, $style) | Out-Null
        # WS_EX_NOACTIVATE: a click on the slide still reaches PowerPoint (next animation), but the
        # keyboard stays with No-Prep, so its own keys and the class leaderboard keep working.
        $exStyle = [NpWin]::GetWindowLong($script:hwnd, -20)
        [NpWin]::SetWindowLong($script:hwnd, -20, ($exStyle -bor 0x08000000)) | Out-Null
        [NpWin]::SetWindowLongPtr($script:hwnd, -8, [IntPtr][Int64]$a.owner) | Out-Null
        Place $a.x $a.y $a.w $a.h
        if ($a.slide -and [int]$a.slide -gt 1) { try { $script:show.View.GotoSlide([int]$a.slide) } catch {} }
        Reply $id @{ ok = $true; slides = $script:pres.Slides.Count; slide = $script:show.View.CurrentShowPosition }
      }

      'move' { Place $a.x $a.y $a.w $a.h; Reply $id @{ ok = $true } }
      'hide' { if ($script:hwnd -ne [IntPtr]::Zero) { [NpWin]::ShowWindow($script:hwnd, 0) | Out-Null }; Reply $id @{ ok = $true } }
      'show' { if ($script:hwnd -ne [IntPtr]::Zero) { [NpWin]::ShowWindow($script:hwnd, 4) | Out-Null }; Reply $id @{ ok = $true } }
      'next' { if (Show-Running) { $script:show.View.Next() }; Reply $id @{ ok = $true } }
      'prev' { if (Show-Running) { $script:show.View.Previous() }; Reply $id @{ ok = $true } }
      'goto' { if (Show-Running) { $script:show.View.GotoSlide([int]$a.slide) }; Reply $id @{ ok = $true } }

      'state' {
        if ($script:hwnd -ne [IntPtr]::Zero) { $null = [NpWin]::RaiseDialog($script:hwnd) }
        if (Show-Running) {
          try { $script:pres.Saved = -1 } catch {}   # pen marks etc. never lead to a save question
          Reply $id @{ ok = $true; running = $true; slide = $script:show.View.CurrentShowPosition; slides = $script:pres.Slides.Count }
        } else {
          Reply $id @{ ok = $true; running = $false }
        }
      }

      'pointer' {
        # The teacher's drawing tools: arrow, pen, laser, eraser; 'clear' wipes this slide's marks.
        if (Show-Running) {
          $view = $script:show.View
          $tool = [string]$a.tool
          if ($tool -eq 'clear') { $view.EraseDrawing() }
          else {
            try { $view.LaserPointerEnabled = 0 } catch {}
            switch ($tool) {
              'pen'    { $view.PointerType = 2; try { $view.PointerColor.RGB = 255 } catch {} }   # red pen
              'eraser' { $view.PointerType = 5 }
              'laser'  { $view.PointerType = 1; try { $view.LaserPointerEnabled = -1 } catch {} }
              default  { $view.PointerType = 1 }
            }
          }
        }
        Reply $id @{ ok = $true }
      }

      'snapshot' {
        # A still picture of the slide on screen (shown while No-Prep covers the slideshow): a photo
        # of the slideshow window as it is now, else the slide as PowerPoint draws it.
        $photo = $false
        if ($script:hwnd -ne [IntPtr]::Zero) { try { $photo = [NpShow]::Photograph($script:hwnd, [string]$a.out, [int]$a.width) } catch {} }
        if (-not $photo) {
          $index = $script:show.View.Slide.SlideIndex
          Export-Slide $script:pres $index ([string]$a.out) ([int]$a.width)
        }
        Reply $id @{ ok = $true }
      }

      'slides' {
        # Small pictures of the playing presentation's slides (from..to), for "jump to a slide".
        # Asked for a few at a time, so other commands (like stop) never wait long behind them.
        # Already-made pictures are kept, so only the first time takes a moment.
        $count = $script:pres.Slides.Count
        [IO.Directory]::CreateDirectory([string]$a.dir) | Out-Null
        $from = [Math]::Max(1, [int]$a.from)
        $to = if ([int]$a.to -gt 0) { [Math]::Min($count, [int]$a.to) } else { $count }
        for ($i = $from; $i -le $to; $i++) {
          $out = [IO.Path]::Combine([string]$a.dir, "$i.png")
          if (-not [IO.File]::Exists($out)) { Export-Slide $script:pres $i $out ([int]$a.width) }
        }
        Reply $id @{ ok = $true; slides = $count }
      }

      'stop' { Stop-Show; Reply $id @{ ok = $true } }

      'thumb' {
        # The first slide as a picture, and the slide count, without showing PowerPoint.
        $step = 'open'
        $ppt = Get-PowerPoint
        $p = $ppt.Presentations.Open([string]$a.path, -1, 0, 0)
        try {
          $count = $p.Slides.Count
          if ($count -gt 0) { Export-Slide $p 1 ([string]$a.out) ([int]$a.width) }
          Reply $id @{ ok = $true; slides = $count }
        } finally {
          try { $p.Saved = -1; $p.Close() } catch {}
        }
      }

      'new' {
        $ppt = Get-PowerPoint
        $ppt.Visible = -1
        $p = $ppt.Presentations.Add(-1)
        $null = $p.Slides.Add(1, 1)       # ppLayoutTitle
        $p.SaveAs([string]$a.path, 24)    # ppSaveAsOpenXMLPresentation (.pptx)
        try { $ppt.Activate() } catch {}
        try { $ppt.ActiveWindow.WindowState = 3 } catch {}   # maximised
        Reply $id @{ ok = $true }
      }

      'edit' {
        $ppt = Get-PowerPoint
        $ppt.Visible = -1
        $p = Find-Open ([string]$a.path)
        if (-not $p) { $p = $ppt.Presentations.Open([string]$a.path, 0, 0, -1) }
        try { $p.Windows.Item(1).Activate() } catch {}
        try { $ppt.Activate() } catch {}
        try { [NpWin]::SetForegroundWindow([IntPtr][Int64]$ppt.HWND) | Out-Null } catch {}
        Reply $id @{ ok = $true }
      }

      'release' {
        # Only when everything is saved: unsaved work is never thrown away.
        $p = Find-Open ([string]$a.path)
        if ($p) {
          if (-not $p.Saved) {
            try { $p.Windows.Item(1).Activate() } catch {}
            try { [NpWin]::SetForegroundWindow([IntPtr][Int64]$script:app.HWND) | Out-Null } catch {}
            throw 'PRESENTATION_UNSAVED'
          }
          try { $p.SlideShowWindow.View.Exit() } catch {}
          $p.Close()
          if (-not $script:pres) { Quit-IfOurs }
        }
        Reply $id @{ ok = $true }
      }

      'cleanup' { Reply $id @{ ok = $true; closed = (Close-Leftovers ([string]$a.root)) } }

      'isopen' { Reply $id @{ ok = $true; open = [bool](Find-Open ([string]$a.path)) } }

      'warm' { $null = Get-PowerPoint; Reply $id @{ ok = $true } }

      # Nothing has happened for a while: let a PowerPoint this helper started go.
      'idle' { if (-not $script:pres) { Quit-IfOurs }; Reply $id @{ ok = $true } }

      'quit' { Stop-Show; Quit-IfOurs; Reply $id @{ ok = $true }; $done = $true }

      default { Reply $id @{ ok = $false; error = "Unknown command: $($msg.cmd)" } }
    }
  } catch {
    $text = $_.Exception.Message
    $code = [regex]::Match($text, 'POWERPOINT_BUSY|PRESENTATION_EDITING|PRESENTATION_UNSAVED').Value
    if (-not $code -and $text -match '0x80010001|0x8001010A') { Show-PowerPointBox; $code = 'POWERPOINT_BUSY' }
    $where = if ($step) { "$step - " } else { '' }
    Reply $id @{ ok = $false; error = $(if ($code) { $code } else { $where + $text }) }
  }
  $step = ''
  if ($done) { break }
}
# No-Prep closed (or went away): never leave a slideshow attached to a window that no longer exists.
try { Stop-Show } catch {}
try { Quit-IfOurs } catch {}
`;
