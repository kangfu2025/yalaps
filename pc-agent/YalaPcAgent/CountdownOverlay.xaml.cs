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

    // --- โหมดหลบเกม ---
    // ไม่ใช้ Show()/Hide() และไม่แตะ Topmost อีกต่อไป: การเปลี่ยน z-order คือสิ่งที่
    // ดีดเกม fullscreen ออก เราจึง "จอด" หน้าต่างไว้นอกจอด้วย SWP_NOZORDER แทน
    private const int ParkedX = -32000, ParkedY = -32000;
    private int _normalX = 20, _normalY = 20;
    private int _fsStreak;                 // ต้องอ่านค่าเดิมติดกัน 2 รอบก่อนสลับสถานะ (hysteresis)
    private const int FsConfirmTicks = 2;
    private string? _pendingWarn;          // ข้อความเตือนที่ค้างไว้ระหว่างเล่นเกม
    private const int WarnSeconds = 8;

    public string SessionId => _sessionId;

    /// <summary>true เมื่อเวลาหมดแล้ว (ใช้แยกกรณี "เวลาหมดจริง" ออกจาก "sync อ่านไม่เจอ")</summary>
    public bool IsExpired => _ended;

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

        // จำตำแหน่งจริง (physical pixel) ไว้ก่อน เพื่อคืนตำแหน่งได้ถูกต้องบนจอที่มี scaling
        if (WinLock.TryGetWindowPos(hwnd, out var nx, out var ny)) { _normalX = nx; _normalY = ny; }

        _timer.Interval = TimeSpan.FromSeconds(1);
        _timer.Tick += Tick;
        _timer.Start();
        Tick(null, EventArgs.Empty);

        _warnTimer.Tick += (_, _) => { _warnTimer.Stop(); WarnText.Text = ""; };

        // โหมด "หลบเกม": ถ้ามีแอป fullscreen อยู่หน้าสุด ให้จอด overlay ไว้นอกจอ
        _fsTimer.Interval = TimeSpan.FromSeconds(2);
        _fsTimer.Tick += (_, _) => ApplyFullscreenAvoidance();
        _fsTimer.Start();

        // สถานะเริ่มต้น: ถ้ามีเกมอยู่แล้วตั้งแต่แรก ให้จอดทันทีโดยไม่ต้องรอ hysteresis
        try
        {
            if (WinLock.IsFullscreenAppActive())
            {
                _hiddenForFullscreen = true;
                SetParked(true);
                Log.Info("overlay parked off-screen at start (fullscreen app detected)");
            }
        }
        catch (Exception ex) { Log.Error("initial fullscreen check failed", ex); }
    }

    /// <summary>ย้าย overlay เข้า/ออกนอกจอ โดยไม่แตะ z-order และไม่ Show/Hide</summary>
    private void SetParked(bool parked)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        WinLock.MoveNoZOrder(hwnd,
            parked ? ParkedX : _normalX,
            parked ? ParkedY : _normalY);
    }

    /// <summary>
    /// ตรวจทุก 2 วินาที แต่จะสลับสถานะก็ต่อเมื่ออ่านค่าใหม่ได้ติดกัน 2 รอบ (= 4 วินาที)
    /// กันกรณี detection สั่นตอนโหลดฉาก/คัตซีน ซึ่งจะกลายเป็น z-order churn ถ้าเชื่อทันที
    /// </summary>
    private void ApplyFullscreenAvoidance()
    {
        if (_ended) return;
        try
        {
            var busy = WinLock.IsFullscreenAppActive();
            if (busy == _hiddenForFullscreen) { _fsStreak = 0; return; }
            if (++_fsStreak < FsConfirmTicks) return;

            _fsStreak = 0;
            _hiddenForFullscreen = busy;
            SetParked(busy);

            if (!busy)
            {
                // กลับมาแสดง: เขียนเวลาล่าสุดทันที ไม่ต้องรอ tick ถัดไป
                TimeText.Text = _lastTimeText;
                if (_pendingWarn != null)
                {
                    WarnText.Text = _pendingWarn;
                    _pendingWarn = null;
                    _warnTimer.Stop();
                    _warnTimer.Interval = TimeSpan.FromSeconds(WarnSeconds);
                    _warnTimer.Start();
                }
            }

            Log.Info(busy
                ? "overlay parked off-screen (fullscreen app detected)"
                : "overlay restored (no fullscreen app)");
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

    /// <summary>วาดใหม่เฉพาะเมื่อค่าเปลี่ยนจริง และเฉพาะเมื่อ overlay ไม่ได้จอดอยู่นอกจอ</summary>
    private void SetTimeText(string text)
    {
        if (text == _lastTimeText) return;
        _lastTimeText = text;
        if (_hiddenForFullscreen) return;
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

    /// <summary>
    /// แจ้งเตือนแบบไม่แย่งโฟกัสและ "ไม่แตะหน้าต่างเลย" ระหว่างลูกค้าเล่นเกม
    ///
    /// เวอร์ชันก่อนหน้าเรียก Show() + Topmost = true ตอนอยู่ในเกม ซึ่งเป็นการยกเลิก
    /// โหมดหลบเกมด้วยตัวเอง และเป็นสาเหตุที่เกมเด้งออกตรงนาทีที่ 10 / 5 / 1 ของทุก session
    /// ตอนนี้ถ้ากำลังเล่นเกมอยู่จะเตือนด้วย "เสียง" อย่างเดียว (ไม่ผ่าน DWM)
    /// แล้วค่อยโชว์ข้อความบนแถบเมื่อลูกค้าออกจากเกมมาที่ desktop
    /// </summary>
    public void Warn(string msg, int seconds = WarnSeconds)
    {
        Dispatcher.Invoke(() =>
        {
            if (_hiddenForFullscreen)
            {
                _pendingWarn = msg;
                Sound.PlayWarn();
                Log.Info($"warn while fullscreen -> sound only: {msg}");
                return;
            }

            WarnText.Text = msg;
            _warnTimer.Stop();
            _warnTimer.Interval = TimeSpan.FromSeconds(seconds);
            _warnTimer.Start();
        });
    }

    // ห้ามปิดเอง ยกเว้นเราสั่งเอง หรือ Windows กำลังปิดเครื่อง/ล็อกออฟ
    // (ถ้าไม่เช็ค IsSessionEnding เครื่องจะค้างที่หน้า "แอปกำลังขัดขวางการปิดเครื่อง")
    protected override void OnClosing(CancelEventArgs e)
    {
        if (!_ended && !App.AllowShutdown && !App.IsSessionEnding) e.Cancel = true;
        base.OnClosing(e);
    }
}
