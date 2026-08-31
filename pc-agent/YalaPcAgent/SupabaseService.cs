using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Supabase;
using Supabase.Postgrest;
using Supabase.Realtime.PostgresChanges;
using static Supabase.Postgrest.Constants;


namespace YalaPcAgent;

public class SupabaseService
{
    private readonly AgentConfig _cfg;
    private Supabase.Client _c = null!;
    public string AgentVersion { get; } = "2.5.1";

    /// <summary>true เมื่อ InitAsync สำเร็จแล้ว</summary>
    public bool IsReady { get; private set; }

    public SupabaseService(AgentConfig cfg) { _cfg = cfg; }

    public async Task InitAsync()
    {
        var opts = new SupabaseOptions { AutoConnectRealtime = true };
        _c = new Supabase.Client(_cfg.SupabaseUrl, _cfg.SupabaseAnonKey, opts);
        await _c.InitializeAsync();
        IsReady = true;
        Log.Info($"Supabase initialized: {_cfg.SupabaseUrl} machine={_cfg.MachineId} #{_cfg.MachineNumber}");
    }

    /// <summary>ดึง session ที่ active ของเครื่องนี้ (ถ้ามี) — ใช้ตอน boot / reconnect</summary>
    public async Task<PcSessionRow?> GetActiveSessionAsync()
    {
        var q = await _c.From<PcSessionRow>()
            .Filter("machine_id", Operator.Equals, _cfg.MachineId)
            .Filter("status", Operator.Equals, "playing")
            .Order("started_at", Ordering.Descending)
            .Limit(1)
            .Get();
        return q.Models.Count > 0 ? q.Models[0] : null;
    }

    public async Task HeartbeatAsync(bool isLocked, string? currentSessionId)
    {
        var row = new PcAgentRow
        {
            MachineId = _cfg.MachineId,
            AgentVersion = AgentVersion,
            LastHeartbeat = DateTime.UtcNow,
            IsLocked = isLocked,
            CurrentSessionId = currentSessionId,
        };
        await _c.From<PcAgentRow>().Upsert(row);
    }

    /// <summary>Subscribe pc_sessions realtime — เรียก onChange เมื่อมีการเปลี่ยนแปลงของเครื่องนี้</summary>
    public async Task SubscribeSessionsAsync(Action onChange)
    {
        var channel = _c.Realtime.Channel("realtime", "public", "pc_sessions");
        channel.AddPostgresChangeHandler(
            PostgresChangesOptions.ListenType.All,
            (_, change) =>
            {
                try
                {
                    // Supabase.Realtime 7.x exposes postgres_changes as PostgresChangesResponse.
                    // Use the SDK model hydrators instead of reading raw Record/OldRecord payloads.
                    PcSessionRow? row = change.Model<PcSessionRow>();

                    if (row == null || string.IsNullOrWhiteSpace(row.MachineId))
                    {
                        row = change.OldModel<PcSessionRow>();
                    }

                    if (row?.MachineId == _cfg.MachineId) onChange();
                }
                catch (Exception ex) { Log.Error("sessions realtime handler failed", ex); }
            });

        await channel.Subscribe();
        Log.Info("subscribed: pc_sessions");
    }

    /// <summary>Subscribe pc_commands realtime — คำสั่งจากหน้า Admin</summary>
    public async Task SubscribeCommandsAsync(Action onChange)
    {
        var channel = _c.Realtime.Channel("realtime", "public", "pc_commands");
        channel.AddPostgresChangeHandler(
            PostgresChangesOptions.ListenType.All,
            (_, change) =>
            {
                try
                {
                    var row = change.Model<PcCommandRow>();
                    Log.Info($"realtime pc_commands event: machine={row?.MachineId} type={row?.Type}");
                    // ไม่ว่าจะ parse ได้หรือไม่ ก็ให้ไปดึงคำสั่งค้างเสมอ (กัน payload รูปแบบไม่ตรง)
                    if (row == null || row.MachineId == _cfg.MachineId) onChange();
                }
                catch (Exception ex)
                {
                    Log.Error("commands realtime handler failed — fallback to poll", ex);
                    try { onChange(); } catch { }
                }
            });

        await channel.Subscribe();
        Log.Info("subscribed: pc_commands");
    }

    /// <summary>
    /// คำสั่งที่ยังไม่ถูกตอบรับของเครื่องนี้ (เก่าสุดก่อน)
    /// ดึงคำสั่งล่าสุด 30 รายการของเครื่องนี้แล้วกรอง ack_at == null ในหน่วยความจำ
    /// (เลี่ยง filter is.null ที่ SDK บางเวอร์ชันสร้าง query ผิดรูป)
    /// </summary>
    public async Task<List<PcCommandRow>> GetPendingCommandsAsync()
    {
        var q = await _c.From<PcCommandRow>()
            .Filter("machine_id", Operator.Equals, _cfg.MachineId)
            .Order("created_at", Ordering.Descending)
            .Limit(30)
            .Get();

        var pending = q.Models
            .Where(x => x.AckAt == null)
            .OrderBy(x => x.CreatedAt)
            .ToList();

        if (pending.Count > 0)
            Log.Info($"pending commands: {pending.Count} [{string.Join(",", pending.Select(p => p.Type))}]");

        return pending;
    }

    public async Task AckCommandAsync(string id)
    {
        await _c.From<PcCommandRow>()
            .Filter("id", Operator.Equals, id)
            .Set(x => x.AckAt!, DateTime.UtcNow)
            .Update();
        Log.Info($"ack command {id}");
    }
}
