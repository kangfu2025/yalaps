using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace YalaPcAgent;

public partial class App : Application
{
    public static SupabaseService Sb = null!;
    public static AgentConfig Cfg = null!;
    public static LockScreen? Lock;
    public static CountdownOverlay? Overlay;
    public static bool AllowShutdown = false;
    /// <summary>true เมื่อ Windows กำลัง logoff/shutdown — หน้าต่างต้องยอมปิด ไม่งั้นเครื่องค้าง</summary>
    public static bool IsSessionEnding;

    private static string? _currentSessionId;
    private static readonly SemaphoreSlim _syncLock = new(1, 1);
    private static readonly SemaphoreSlim _cmdLock = new(1, 1);
    /// <summary>Admin สั่งปลดล็อกชั่วคราว — ห้าม sync เด้งหน้าล็อกกลับมา</summary>
    private static bool _adminUnlocked;
    private static Mutex? _singleInstance;
    private static DateTime _lastSyncUtc = DateTime.MinValue;
    private static bool _connected;
    private static int _noSessionStreak;

    private async void OnStartup(object sender, StartupEventArgs e)
    {
        // Windows ภาษาไทยใช้ปฏิทินพุทธ -> วันที่ที่ส่งขึ้น server จะกลายเป็น พ.ศ. (2569)
        // บังคับ InvariantCulture ให้ทุก thread เพื่อให้เวลาเป็น ค.ศ. เสมอ
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;
        Thread.CurrentThread.CurrentCulture = CultureInfo.InvariantCulture;

        // single instance — กัน Run key + Scheduled Task เปิดซ้อนกัน
        _singleInstance = new Mutex(true, @"Global\YalaPcAgent", out var isNew);
        if (!isNew)
        {
            Log.Warn("another instance is already running — exiting this one");
            Shutdown(0);
            return;
        }

        AppDomain.CurrentDomain.UnhandledException += (_, ev) =>
            Log.Error("unhandled exception", ev.ExceptionObject as Exception);
        DispatcherUnhandledException += (_, ev) =>
        {
            Log.Error("dispatcher exception", ev.Exception);
            ev.Handled = true; // ห้ามให้แอปตาย
        };
        TaskScheduler.UnobservedTaskException += (_, ev) =>
        {
            Log.Error("unobserved task exception", ev.Exception);
            ev.SetObserved();
        };

        // Windows สั่งปิดเครื่อง/ล็อกออฟ (เช่น Windows Update บังคับรีสตาร์ต):
        // ต้องปลดล็อก OnClosing ของหน้าต่างทั้งหมด ไม่งั้นจะค้างที่หน้า
        // "แอปนี้กำลังขัดขวางการปิดเครื่อง" บนเครื่องที่ลูกค้าใช้อยู่
        SessionEnding += (_, ev) =>
        {
            IsSessionEnding = true;
            Log.Info($"windows session ending: {ev.ReasonSessionEnding}");
        };

        try
        {
            Cfg = AgentConfig.LoadFromRegistry();
            Log.Info($"=== YalaPcAgent starting === machine #{Cfg.MachineNumber} ({Cfg.MachineId}) log={Log.Path}");
            Sb = new SupabaseService(Cfg);
        }
        catch (Exception ex)
        {
            Log.Error("config load failed", ex);
            ShowLock("ยังไม่ได้ตั้งค่าเครื่อง\nกรุณาติดต่อผู้ดูแลระบบ");
            SetStatus("config error: " + ex.Message);
            return; // ค้างหน้าล็อกไว้ ปลอดภัยกว่าปิดตัวเอง
        }

        // show lock screen ทันที ก่อนต่อ network — user จะไม่เห็น desktop เลย
        ShowLock("กรุณาติดต่อพนักงานเพื่อเปิดเครื่อง");
        SetStatus("กำลังเชื่อมต่อ...");

        // เชื่อมต่อแบบ retry ไม่รู้จบ (ตอนบูตเน็ตอาจยังไม่พร้อม) — ห้าม exit เด็ดขาด
        _ = Task.Run(ConnectLoopAsync);

        // heartbeat loop
        _ = Task.Run(async () =>
        {
            while (true)
            {
                if (Sb.IsReady)
                {
                    try
                    {
                        await Sb.HeartbeatAsync(
                            isLocked: Overlay == null && !_adminUnlocked,
                            currentSessionId: _currentSessionId);
                    }
                    catch (Exception ex) { Log.Error("heartbeat failed", ex); }
                }
                await Task.Delay(TimeSpan.FromSeconds(15));
            }
        });

        // periodic resync (กันเคส realtime หลุด)
        _ = Task.Run(async () =>
        {
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(30));
                if (!Sb.IsReady) continue;
                try { await SyncFromServerAsync(); }
                catch (Exception ex) { Log.Error("periodic sync failed", ex); }
            }
        });

        // polling คำสั่งค้าง (กันเคส realtime หลุด)
        _ = Task.Run(async () =>
        {
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(10));
                if (!Sb.IsReady) continue;
                try { await ProcessCommandsAsync(); }
                catch (Exception ex) { Log.Error("command poll failed", ex); }
            }
        });

        // อัปเดตข้อความสถานะบนหน้าล็อกทุก 5 วินาที
        _ = Task.Run(async () =>
        {
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(5));
                RefreshStatusLine();
            }
        });

        await Task.CompletedTask;
    }

    /// <summary>เชื่อมต่อ Supabase + subscribe realtime พร้อม retry ไม่รู้จบ</summary>
    private static async Task ConnectLoopAsync()
    {
        var attempt = 0;
        while (true)
        {
            attempt++;
            try
            {
                await Sb.InitAsync();
                await Sb.SubscribeSessionsAsync(() => _ = SyncFromServerAsync());
                await Sb.SubscribeCommandsAsync(() => _ = ProcessCommandsAsync());

                // ข้ามคำสั่งเก่าค้างท่อ (ไม่ให้ shutdown เก่าย้อนมาสั่งปิดเครื่องตอนบูต)
                await DiscardStaleCommandsAsync();

                _connected = true;
                RefreshStatusLine();
                Log.Info($"connected (attempt {attempt})");

                await SyncFromServerAsync();
                await ProcessCommandsAsync();
                return;
            }
            catch (Exception ex)
            {
                _connected = false;
                Log.Error($"connect attempt {attempt} failed", ex);
                SetStatus($"กำลังลองเชื่อมต่อใหม่ ({attempt})...");
                await Task.Delay(TimeSpan.FromSeconds(10));
            }
        }
    }

    private static void SetStatus(string text) => Lock?.SetStatus(text);

    private static void RefreshStatusLine()
    {
        try
        {
            if (Lock == null || Cfg == null) return;
            var sync = _lastSyncUtc == DateTime.MinValue
                ? "-"
                : $"{(int)(DateTime.UtcNow - _lastSyncUtc).TotalSeconds}s";
            SetStatus($"Agent v{Sb?.AgentVersion} | {(_connected ? "เชื่อมต่อแล้ว" : "ออฟไลน์")} | sync {sync} | {Cfg.MachineId[..8]}…");
        }
        catch { }
    }

    /// <summary>ตอนเปิดโปรแกรม: ack คำสั่งเก่า (&gt; 10 นาที) ทิ้งโดยไม่ทำงาน</summary>
    private static async Task DiscardStaleCommandsAsync()
    {
        try
        {
            var pending = await Sb.GetPendingCommandsAsync();
            foreach (var c in pending)
            {
                if ((DateTime.UtcNow - ToUtc(c.CreatedAt)).TotalMinutes > 10)
                {
                    Log.Info($"discard stale command {c.Type} ({c.Id})");
                    try { await Sb.AckCommandAsync(c.Id); }
                    catch (Exception ex) { Log.Error("ack stale failed", ex); }
                }
            }
        }
        catch (Exception ex) { Log.Error("discard stale failed", ex); }
    }

    /// <summary>อ่านคำสั่งค้างจาก pc_commands แล้วทำงาน + ack</summary>
    public static async Task ProcessCommandsAsync()
    {
        if (Sb == null || !Sb.IsReady) return;
        if (!await _cmdLock.WaitAsync(0)) return;
        try
        {
            System.Collections.Generic.List<PcCommandRow> pending;
            try { pending = await Sb.GetPendingCommandsAsync(); }
            catch (Exception ex) { Log.Error("fetch pending commands failed", ex); return; }

            foreach (var c in pending)
            {
                var shutdown = false;
                Log.Info($"executing command {c.Type} ({c.Id})");
                try
                {
                    switch (c.Type)
                    {
                        case "lock":
                            _adminUnlocked = false;
                            _currentSessionId = null;
                            ShowLock("เครื่องถูกล็อกโดยผู้ดูแลระบบ\nกรุณาติดต่อพนักงาน");
                            break;

                        case "unlock":
                            _adminUnlocked = true;
                            Current.Dispatcher.Invoke(() =>
                            {
                                Overlay?.ForceClose();
                                Overlay = null;
                                CloseLock();
                            });
                            break;

                        case "warn":
                        {
                            var mins = ReadMinutes(c);
                            var msg = mins > 0
                                ? $"เหลือเวลาอีก {mins} นาที — กรุณาเตรียมเซฟงาน"
                                : "แจ้งเตือนจากพนักงาน";
                            // ไม่ใช้ MessageBox: popup แย่งโฟกัสทำให้เกม fullscreen เด้งออก
                            Current.Dispatcher.Invoke(() => Overlay?.Warn(msg));
                            break;
                        }


                        case "shutdown":
                            shutdown = true;
                            break;

                        case "end_session":
                        case "show_countdown":
                        default:
                            _adminUnlocked = false;
                            await SyncFromServerAsync();
                            break;
                    }
                }
                catch (Exception ex) { Log.Error($"command {c.Type} failed", ex); }

                try { await Sb.AckCommandAsync(c.Id); }
                catch (Exception ex) { Log.Error("ack failed", ex); }

                if (shutdown)
                {
                    AllowShutdown = true;
                    Log.Info("shutting down machine by admin command");
                    try { await Sb.HeartbeatAsync(isLocked: true, currentSessionId: null); } catch { }
                    WinLock.Shutdown();
                    return;
                }
            }
        }
        finally { _cmdLock.Release(); }
    }

    private static int ReadMinutes(PcCommandRow c)
    {
        try
        {
            if (c.Payload != null && c.Payload.TryGetValue("minutes", out var v) && v != null)
                return Convert.ToInt32(v, CultureInfo.InvariantCulture);
        }
        catch { }
        return 0;
    }


    /// <summary>ดึง state ล่าสุดจาก server แล้วปรับหน้าจอให้ตรง</summary>
    public static async Task SyncFromServerAsync()
    {
        if (Sb == null || !Sb.IsReady) return;
        if (!await _syncLock.WaitAsync(0)) return;
        try
        {
            PcSessionRow? active = null;
            try { active = await Sb.GetActiveSessionAsync(); }
            catch (Exception ex) { Log.Error("get active session failed", ex); return; }

            _lastSyncUtc = DateTime.UtcNow;

            var now = DateTime.UtcNow;
            var endsAtUtc = active == null ? DateTime.MinValue : ToUtc(active.EndsAt);
            var isActive = active != null && endsAtUtc > now && active.EndedAt == null;

            if (isActive && active != null)
            {
                _adminUnlocked = false;
                _noSessionStreak = 0;
                if (_currentSessionId != active.Id || Overlay == null)

                {
                    _currentSessionId = active.Id;
                    ShowCountdown(endsAtUtc, active.Id);
                }
                else
                {
                    Overlay?.UpdateEndsAt(endsAtUtc); // เติมเวลา
                }
            }
            else
            {
                if (_adminUnlocked) { _currentSessionId = null; return; } // Admin สั่งปลดล็อกไว้

                // กันเน็ตกระตุก/ข้อมูลคลาดเคลื่อนชั่วคราวมาเด้งหน้าล็อกทับเกม:
                // ถ้ากำลังมี session แสดงอยู่ ต้องอ่านค่า "ไม่มี session" ติดกัน 2 รอบก่อน
                if (Overlay != null && ++_noSessionStreak < 2)
                {
                    Log.Warn("no active session (1st read) — รออีกรอบก่อนล็อก");
                    return;
                }

                // อ่านไม่เจอ session แต่ overlay ยังนับเวลาเหลืออยู่ และลูกค้ากำลังเล่นเกม
                // fullscreen -> เกือบแน่ว่าเป็นข้อมูลคลาดเคลื่อนชั่วคราว ไม่ใช่เวลาหมดจริง
                // เลื่อนการล็อกออกไปแทนที่จะเด้งหน้าล็อกทับเกม
                // (เส้นทาง "เวลาหมดจริง" ใช้ OnTimeExpired() คนละทาง จึงยังล็อกทันทีเหมือนเดิม)
                if (Overlay != null && !Overlay.IsExpired && WinLock.IsFullscreenAppActive())
                {
                    Log.Warn("no active session but a fullscreen game is running and time remains — เลื่อนการล็อก");
                    _noSessionStreak = 1;
                    return;
                }
                _noSessionStreak = 0;
                _currentSessionId = null;
                var msg = active != null && endsAtUtc <= now
                    ? "เวลาการใช้งานหมดแล้ว\nกรุณาติดต่อพนักงานเพื่อเติมเวลา"
                    : "กรุณาติดต่อพนักงานเพื่อเปิดเครื่อง";
                ShowLock(msg);
            }

        }
        finally { _syncLock.Release(); }
    }

    public static void OnTimeExpired()
    {
        Current.Dispatcher.Invoke(() =>
        {
            _currentSessionId = null;
            Log.Info("session time expired -> lock");
            // ไม่เรียก Windows LockWorkStation — ต้องให้ลูกค้าเห็นหน้า YALA LockScreen ตลอด
            ShowLock("เวลาการใช้งานหมดแล้ว\nกรุณาติดต่อพนักงานเพื่อเติมเวลา");
        });
    }

    public static void ShowLock(string message)
    {
        Current.Dispatcher.Invoke(() =>
        {
            Overlay?.ForceClose();
            Overlay = null;
            if (Lock == null || !Lock.IsVisible)
            {
                if (Lock == null) Lock = new LockScreen();
                Log.Info("lock screen shown + activated");
                Lock.Show();
                Lock.Activate();
                Lock.Topmost = true;
            }
            // ถ้าหน้าล็อกแสดงอยู่แล้ว: อัปเดตข้อความเท่านั้น ห้าม Show/Activate ซ้ำ
            // (การเรียกซ้ำทุก 30 วิ คือสาเหตุที่หน้าต่างเด้งขึ้นมาแย่งโฟกัสระหว่างเล่นเกม)
            Lock.SetMessage(message);
            RefreshStatusLine();
        });
    }

    /// <summary>ปิดหน้าล็อกจริง (ไม่ค้างเป็นหน้าต่างซ่อน ป้องกัน z-order change ทับเกม)</summary>
    public static void CloseLock()
    {
        Current.Dispatcher.Invoke(() =>
        {
            if (Lock == null) return;
            Lock.Topmost = false;
            Lock.AllowClose = true;
            try { Lock.Close(); } catch (Exception ex) { Log.Error("close lock failed", ex); }
            Lock = null;
        });
    }

    public static void ShowCountdown(DateTime endsAt, string sessionId)
    {
        Current.Dispatcher.Invoke(() =>
        {
            if (Overlay != null && Overlay.SessionId == sessionId)
            {
                Overlay.UpdateEndsAt(endsAt); // session เดิม — ไม่ต้องสร้างหน้าต่างใหม่
                CloseLock();
                return;
            }
            Overlay?.ForceClose();
            Overlay = new CountdownOverlay(endsAt, sessionId);
            Overlay.Show();
            CloseLock();
        });
    }



    /// <summary>
    /// Supabase C# client อาจคืน timestamptz เป็นเวลาเครื่อง (Local) แต่ Kind=Unspecified
    /// ถ้าบังคับเป็น UTC จะทำให้เวลาที่เหลือเกินจริง +7 ชม. (เขตเวลาไทย)
    /// </summary>
    internal static DateTime ToUtc(DateTime d) => d.Kind switch
    {
        DateTimeKind.Utc => d,
        DateTimeKind.Local => d.ToUniversalTime(),
        _ => DateTime.SpecifyKind(d, DateTimeKind.Local).ToUniversalTime(),
    };
}
