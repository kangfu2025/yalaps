using System;
using Microsoft.Win32;

namespace YalaPcAgent;

public class AgentConfig
{
    public string SupabaseUrl { get; set; } = "";
    public string SupabaseAnonKey { get; set; } = "";
    public string MachineId { get; set; } = "";
    public int MachineNumber { get; set; } = 0;
    public string MachineToken { get; set; } = "";

    public static AgentConfig LoadFromRegistry()
    {
        var c = ReadFrom(Registry.LocalMachine) ?? ReadFrom(Registry.CurrentUser)
            ?? throw new InvalidOperationException(
                @"ไม่พบ config ที่ HKLM\SOFTWARE\YALA\Agent — โปรดรัน install.ps1 ก่อน");
        if (string.IsNullOrWhiteSpace(c.SupabaseUrl) ||
            string.IsNullOrWhiteSpace(c.SupabaseAnonKey) ||
            string.IsNullOrWhiteSpace(c.MachineId))
            throw new InvalidOperationException("config ไม่ครบ (SupabaseUrl / SupabaseAnonKey / MachineId)");
        return c;
    }

    private static AgentConfig? ReadFrom(RegistryKey root)
    {
        using var k = root.OpenSubKey(@"SOFTWARE\YALA\Agent");
        if (k == null) return null;
        int.TryParse((string?)k.GetValue("MachineNumber") ?? "0", out var num);
        return new AgentConfig
        {
            SupabaseUrl = (string?)k.GetValue("SupabaseUrl") ?? "",
            SupabaseAnonKey = (string?)k.GetValue("SupabaseAnonKey") ?? "",
            MachineId = (string?)k.GetValue("MachineId") ?? "",
            MachineNumber = num,
            MachineToken = (string?)k.GetValue("MachineToken") ?? "",
        };
    }
}
