using System;
using System.ComponentModel;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;

namespace YalaPcAgent;

public partial class CountdownOverlay : Window
{
    private DateTime _endsAt;
    private readonly string _sessionId;
    private readonly DispatcherTimer _timer = new();
    private readonly DispatcherTimer _warnTimer = new();
    private readonly DispatcherTimer _fsTimer = new();
    private bool _warn10, _warn5, _warn1, _ended, _loggedRemain;
    private string _lastTimeText = "";
    private bool _hiddenForFullscreen;

    public string SessionId => _sessionId;

    public CountdownOverlay(DateTime endsAt, string sessionId)
    {
        InitializeComponent();
        _endsAt = ToUtc(endsAt);
        _sessionId = sessionId;
        CodeText.Text = $"เครื่อง {App.Cfg.MachineNumber}";
    }

    /// <summary>เติมเวลา / อัปเดต ends_at โดยไม่ต้องเปิดหน้าใหม่</summary>
    public void UpdateEndsAt(DateTime endsAt)
    {
        Dispatcher.Invoke(() =>
        {
            _endsAt = ToUtc(endsAt);
            // reset warnings ถ้าเวลาถูกเติมกลับมามากกว่า threshold
            var remain = _endsAt - DateTime.UtcNow;
            if (remain.TotalMinutes > 10) { _warn10 = _warn5 = _warn1 = false; }
            else if (remain.TotalMinutes > 5) { _warn5 = _warn1 = false; }
            else if (remain.TotalMinutes > 1) { _warn1 = false; }
        });
    }

    /// <summary>Supabase C# client อาจคืนเวลาเป็นเวลาเครื่องแต่ Kind=Unspecified — แปลงให้เป็น UTC ให้ถูก</summary>
    private static DateTime ToUtc(DateTime d) => App.ToUtc(d);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // ห้ามแย่งโฟกัส/ห้ามรับคลิก — เกมแบบ fullscreen จะไม่เด้งออก
        var hwnd = new WindowInteropHelper(this).Handle;
        WinLock.MakeOverlayWindow(hwnd);

        _timer.Interval = TimeSpan.FromSeconds(1);
        _timer.Tick += Tick;
        _timer.Start();
        Tick(null, EventArgs.Empty);

        _warnTimer.Tick += (_, _) => { _warnTimer.Stop(); WarnText.Text = ""; };

        // โหมด "หลบเกม": ถ้ามีแอป fullscreen อยู่หน้าสุด ให้ซ่อน overlay ทั้งหมด
        _fsTimer.Interval = TimeSpan.FromSeconds(2);
        _fsTimer.Tick += (_, _) => ApplyFullscreenAvoidance();
        _fsTimer.Start();
        ApplyFullscreenAvoidance();
    }

    private void ApplyFullscreenAvoidance()
    {
        if (_ended) return;
        try
        {
            var busy = WinLock.IsFullscreenAppActive();
            if (busy && !_hiddenForFullscreen)
            {
                _hiddenForFullscreen = true;
                Topmost = false;
                Hide();
                Log.Info("overlay hidden (fullscreen app detected)");
            }
            else if (!busy && _hiddenForFullscreen)
            {
                _hiddenForFullscreen = false;
                Show();
                Topmost = true;
                Log.Info("overlay shown (no fullscreen app)");
            }
        }
        catch (Exception ex) { Log.Error("fullscreen avoidance failed", ex); }
    }

    private void Tick(object? s, EventArgs e)
    {
        var remain = _endsAt - DateTime.UtcNow;
        if (remain.TotalSeconds <= 0)
        {
            SetTimeText("00:00");
            if (!_ended)
            {
                _ended = true;
                _timer.Stop();
                _fsTimer.Stop();
                App.OnTimeExpired();
            }
            return;
        }
        SetTimeText(remain.TotalHours >= 1
            ? $"{(int)remain.TotalHours}:{remain.Minutes:00}:{remain.Seconds:00}"
            : $"{remain.Minutes:00}:{remain.Seconds:00}");
        if (!_loggedRemain)
        {
            _loggedRemain = true;
            Log.Info($"countdown start: remain={remain.TotalMinutes:0.0} min (ends_at_utc={_endsAt:o})");
            if (remain.TotalHours > 24) Log.Error("remaining time looks wrong (>24h) — check ends_at timezone", new Exception("suspicious remaining time"));
        }
        int mins = (int)Math.Ceiling(remain.TotalMinutes);
        if (!_warn10 && mins == 10) { _warn10 = true; Warn("เหลือเวลาอีก 10 นาที"); }
        else if (!_warn5 && mins == 5) { _warn5 = true; Warn("เหลือเวลาอีก 5 นาที"); }
        else if (!_warn1 && mins == 1) { _warn1 = true; Warn("เหลือ 1 นาที — เซฟงาน"); }
    }

    /// <summary>วาดใหม่เฉพาะเมื่อค่าเปลี่ยนจริง และเฉพาะเมื่อ overlay มองเห็นอยู่</summary>
    private void SetTimeText(string text)
    {
        if (text == _lastTimeText) return;
        _lastTimeText = text;
        if (_hiddenForFullscreen || !IsVisible) return;
        TimeText.Text = text;
    }

    public void ForceClose()
    {
        _ended = true;
        _timer.Stop();
        _warnTimer.Stop();
        _fsTimer.Stop();
        Close();
    }

    /// <summary>แจ้งเตือนแบบไม่มี popup/ไม่แย่งโฟกัส — แสดงบนแถบ overlay ชั่วคราว</summary>
    public void Warn(string msg, int seconds = 8)
    {
        Dispatcher.Invoke(() =>
        {
            // ระหว่างเล่นเกม fullscreen: โผล่ overlay ชั่วคราวเท่านั้น แล้วซ่อนกลับ
            if (_hiddenForFullscreen)
            {
                TimeText.Text = _lastTimeText;
                WarnText.Text = msg;
                Show();
                Topmost = true;
                _hiddenForFullscreen = false;
                Log.Info($"overlay warn shown over fullscreen app: {msg}");
            }
            else
            {
                WarnText.Text = msg;
            }
            _warnTimer.Stop();
            _warnTimer.Interval = TimeSpan.FromSeconds(seconds);
            _warnTimer.Start();
        });
    }

    protected override void OnClosing(CancelEventArgs e) { if (!_ended) e.Cancel = true; base.OnClosing(e); }
}
