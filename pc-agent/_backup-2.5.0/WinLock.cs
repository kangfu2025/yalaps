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
        SWP_NOACTIVATE = 0x0010;

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

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    [DllImport("shell32.dll")]
    private static extern int SHQueryUserNotificationState(out int state);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    private const int SM_CXSCREEN = 0, SM_CYSCREEN = 1;
    private const int QUNS_RUNNING_D3D_FULL_SCREEN = 2, QUNS_PRESENTATION_MODE = 3;

    /// <summary>
    /// true เมื่อมีแอป fullscreen (เกม/วิดีโอ) อยู่หน้าสุด — ใช้สั่งซ่อน overlay
    /// เพื่อไม่ให้ DWM ดีดเกมออกจากโหมด exclusive fullscreen
    /// </summary>
    public static bool IsFullscreenAppActive()
    {
        try
        {
            if (SHQueryUserNotificationState(out var st) == 0 &&
                (st == QUNS_RUNNING_D3D_FULL_SCREEN || st == QUNS_PRESENTATION_MODE))
                return true;
        }
        catch { }

        try
        {
            var fg = GetForegroundWindow();
            if (fg == IntPtr.Zero || fg == GetShellWindow()) return false;

            // ข้ามหน้าต่างของเราเอง (lock screen / overlay)
            foreach (System.Windows.Window w in System.Windows.Application.Current.Windows)
            {
                try
                {
                    var h = new System.Windows.Interop.WindowInteropHelper(w).Handle;
                    if (h == fg) return false;
                }
                catch { }
            }

            if (!GetWindowRect(fg, out var r)) return false;
            int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
            return (r.Right - r.Left) >= sw && (r.Bottom - r.Top) >= sh;
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
