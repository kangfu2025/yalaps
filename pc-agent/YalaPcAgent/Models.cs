using System;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace YalaPcAgent;

[Table("pc_sessions")]
public class PcSessionRow : BaseModel
{
    [PrimaryKey("id", false)] public string Id { get; set; } = "";
    [Column("machine_id")] public string MachineId { get; set; } = "";
    [Column("coupon_id")] public string? CouponId { get; set; }
    [Column("started_at")] public DateTime StartedAt { get; set; }
    [Column("ends_at")] public DateTime EndsAt { get; set; }
    [Column("ended_at")] public DateTime? EndedAt { get; set; }
    [Column("minutes_used")] public int MinutesUsed { get; set; }
    [Column("status")] public string Status { get; set; } = "playing";
}

[Table("pc_agents")]
public class PcAgentRow : BaseModel
{
    [PrimaryKey("machine_id", false)] public string MachineId { get; set; } = "";
    [Column("agent_version")] public string? AgentVersion { get; set; }
    [Column("last_heartbeat")] public DateTime LastHeartbeat { get; set; }
    [Column("is_locked")] public bool IsLocked { get; set; }
    [Column("current_session_id")] public string? CurrentSessionId { get; set; }
}

[Table("pc_commands")]
public class PcCommandRow : BaseModel
{
    [PrimaryKey("id", false)] public string Id { get; set; } = "";
    [Column("machine_id")] public string MachineId { get; set; } = "";
    [Column("type")] public string Type { get; set; } = "";
    [Column("payload")] public System.Collections.Generic.Dictionary<string, object>? Payload { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("ack_at")] public DateTime? AckAt { get; set; }
}
