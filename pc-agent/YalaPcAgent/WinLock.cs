using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace YalaPcAgent;

public static class WinLock
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool LockWorkStation();

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private const uint SWP_NOMOVE = 0x0002, SWP_NOSIZE = 0x0001, SWP_SHOWWINDOW = 0x0040,
        SWP_NOACTIVATE = 0x0010, SWP_NOZORDER = 0x0004;

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TRANSPARENT = 0x20, WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOOLWINDOW = 0x80;

    public static void MakeTopmost(IntPtr hwnd) =>
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);

    /// <summary>
    /// ทำให้หน้าต่างเป็น overlay จริง ๆ: ไม่รับคลิก ไม่รับโฟกัส ไม่อยู่ใน Alt+Tab
    /// ป้องกันเกม fullscreen เด้งออกเวลา overlay ถูกแสดง/อัปเดต
    /// </summary>
    public static void MakeOverlayWindow(IntPtr hwnd)
    {
        try
        {
            var ex = GetWindowLong(hwnd, GWL_EXSTYLE);
            SetWindowLong(hwnd, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
        catch { }
    }

    /// <summary>
    /// ย้ายหน้าต่างโดย "ไม่แตะ z-order และไม่ Show/Hide"
    /// ใช้จอด overlay ไว้นอกจอระหว่างลูกค้าเล่นเกม — DWM จึงไม่มีเหตุให้ดีดเกมออกจาก fullscreen
    /// </summary>
    public static void MoveNoZOrder(IntPtr hwnd, int x, int y)
    {
        try { SetWindowPos(hwnd, IntPtr.Zero, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE); }
        catch { }
    }

    /// <summary>อ่านตำแหน่งจริง (physical pixel) ของหน้าต่าง — ใช้จำตำแหน่งเดิมก่อนจอดนอกจอ</summary>
    public static bool TryGetWindowPos(IntPtr hwnd, out int x, out int y)
    {
        x = 0; y = 0;
        try
        {
            if (!GetWindowRect(hwnd, out var r)) return false;
            x = r.Left; y = r.Top;
            return true;
        }
        catch { return false; }
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    [DllImport("shell32.dll")]
    private static extern int SHQueryUserNotificationState(out int state);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    private const uint MONITOR_DEFAULTTONEAREST = 2;
    private const int DWMWA_CLOAKED = 14;

    // ค่าจริงของ QUERY_USER_NOTIFICATION_STATE (เวอร์ชันก่อนหน้าเลื่อนไป 1 ตำแหน่ง
    // ทำให้ QUNS_PRESENTATION_MODE ตรวจไม่เจอ)
    private const int QUNS_BUSY = 2, QUNS_RUNNING_D3D_FULL_SCREEN = 3, QUNS_PRESENTATION_MODE = 4;

    /// <summary>
    /// true เมื่อหน้าต่างหน้าสุดกินเต็ม "จอที่หน้าต่างนั้นอยู่" (ไม่ใช่จอหลักเสมอไป)
    /// รองรับ exclusive fullscreen, borderless fullscreen, หลายจอ และจอที่ตั้ง scaling ต่างกัน
    ///
    /// ตั้งใจให้ "เอนไปทางบอกว่ามีเกม" มากกว่าตรงกันข้าม:
    ///   - เดาผิดว่ามีเกม  -> overlay ถูกจอดไว้นอกจอ ลูกค้าไม่เห็นเวลาที่เหลือ (เสียหายน้อย)
    ///   - เดาผิดว่าไม่มี -> overlay โผล่ทับเกม เกมเด้งออก (เสียหายมาก)
    /// </summary>
    public static bool IsFullscreenAppActive()
    {
        // 1) ทางที่เชื่อถือได้ที่สุดสำหรับเกม D3D exclusive / โหมดนำเสนอ
        try
        {
            if (SHQueryUserNotificationState(out var st) == 0 &&
                (st == QUNS_BUSY || st == QUNS_RUNNING_D3D_FULL_SCREEN || st == QUNS_PRESENTATION_MODE))
                return true;
        }
        catch { }

        try
        {
            var fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;
            if (fg == GetShellWindow() || fg == GetDesktopWindow()) return false;

            // 2) หน้าต่างของ process เราเอง (LockScreen / overlay) ไม่นับ
            //    เทียบ process id แทนการวน Application.Current.Windows เพราะ
            //    ฟังก์ชันนี้ถูกเรียกจาก background thread ด้วย (วน Windows จะ throw)
            GetWindowThreadProcessId(fg, out var pid);
            if (pid == (uint)Environment.ProcessId) return false;

            // 3) หน้าต่าง UWP ที่ถูก cloak ไว้ (ยังเป็น foreground แต่มองไม่เห็นจริง) ไม่นับ
            try
            {
                if (DwmGetWindowAttribute(fg, DWMWA_CLOAKED, out var cloaked, sizeof(int)) == 0 && cloaked != 0)
                    return false;
            }
            catch { }

            // 4) เทียบกับ "จอที่หน้าต่างนั้นอยู่" — พิกัดสองฝั่งอยู่ใน virtual screen
            //    เดียวกัน จึงไม่ต้องแปลง DPI เอง (ต้องคู่กับ app.manifest PerMonitorV2)
            if (!GetWindowRect(fg, out var r)) return false;

            var mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
            if (mon == IntPtr.Zero) return false;

            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            if (!GetMonitorInfo(mon, ref mi)) return false;

            const int tol = 2; // เผื่อเกมที่ตั้งขนาดพลาด 1-2 px
            return r.Left <= mi.rcMonitor.Left + tol
                && r.Top <= mi.rcMonitor.Top + tol
                && r.Right >= mi.rcMonitor.Right - tol
                && r.Bottom >= mi.rcMonitor.Bottom - tol;
        }
        catch { return false; }
    }

    public static void LockWorkstation()
    {
        try { LockWorkStation(); } catch { }
    }

    public static void Shutdown()
    {
        Process.Start(new ProcessStartInfo("shutdown", "/s /t 5 /c \"YALA: shutdown\"")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
        });
    }
}
