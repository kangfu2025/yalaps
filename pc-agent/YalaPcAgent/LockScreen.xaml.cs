using System;
using System.ComponentModel;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;

namespace YalaPcAgent;

public partial class LockScreen : Window
{
    /// <summary>อนุญาตให้ปิดหน้าต่างนี้ได้ (ใช้ตอนเริ่ม session)</summary>
    public bool AllowClose { get; set; }

    public LockScreen() { InitializeComponent(); }

    public void SetMessage(string msg) =>
        Dispatcher.Invoke(() => MessageText.Text = msg);

    public void SetStatus(string status) =>
        Dispatcher.Invoke(() => StatusText.Text = status);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        MachineText.Text = App.Cfg != null ? $"เครื่องหมายเลข {App.Cfg.MachineNumber}" : "ยังไม่ได้ตั้งค่าเครื่อง";
        if (App.Sb != null && App.Cfg != null)
            StatusText.Text = $"Agent v{App.Sb.AgentVersion}  |  {App.Cfg.MachineId[..8]}…";


        // block Alt+F4, Alt+Tab basic handling — task manager needs group policy
        PreviewKeyDown += (_, ev) =>
        {
            if (ev.Key == Key.F4 && (Keyboard.Modifiers & ModifierKeys.Alt) != 0) ev.Handled = true;
            if (ev.Key == Key.Tab && (Keyboard.Modifiers & ModifierKeys.Alt) != 0) ev.Handled = true;
            if (ev.Key == Key.LWin || ev.Key == Key.RWin) ev.Handled = true;
        };

        // keep on top even if another app tries to steal focus
        var hwnd = new WindowInteropHelper(this).Handle;
        WinLock.MakeTopmost(hwnd);
    }

    // block close (Alt+F4 etc.)
    protected override void OnClosing(CancelEventArgs e)
    {
        if (!App.AllowShutdown && !AllowClose && !App.IsSessionEnding) e.Cancel = true;
        base.OnClosing(e);
    }

    private void OnShutdownClick(object sender, RoutedEventArgs e)
    {
        var res = MessageBox.Show(
            "ยืนยันปิดเครื่อง?\nกรุณาใช้เฉพาะกรณีไม่มีลูกค้าใช้งาน",
            "YALA",
            MessageBoxButton.OKCancel,
            MessageBoxImage.Question);
        if (res != MessageBoxResult.OK) return;
        App.AllowShutdown = true;
        WinLock.Shutdown();
    }
}
