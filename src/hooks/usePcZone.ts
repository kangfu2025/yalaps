import { useCallback, useEffect, useState } from "react";
import { supabase, type PcAgent, type PcCommand, type PcSession } from "@/lib/supabase";
import { listAgents, listRecentPcCommands } from "@/lib/pcControl";

/**
 * ข้อมูลโซน PC (Agent, บิลที่กำลังเล่น, คำสั่งล่าสุด) + อัปเดตสดผ่าน Realtime
 * ย้ายออกมาจาก PcZonePanel เพื่อให้แดชบอร์ดนับสถานะ PC รวมกับโซฟา/รถแข่งได้
 * (โหลดแบบเดียวกับเดิมทุกอย่าง)
 */
export function usePcZone() {
  const [agents, setAgents] = useState<PcAgent[]>([]);
  const [sessions, setSessions] = useState<PcSession[]>([]);
  const [commands, setCommands] = useState<PcCommand[]>([]);

  const reload = useCallback(async () => {
    const [a, s, c] = await Promise.all([
      listAgents(),
      supabase.from("pc_sessions").select("*").eq("status", "playing"),
      listRecentPcCommands(20).catch(() => [] as PcCommand[]),
    ]);
    setAgents(a);
    setSessions((s.data ?? []) as PcSession[]);
    setCommands(c);
  }, []);

  useEffect(() => {
    reload().catch((e) => console.warn("[pc] load failed:", e));
    const ch = supabase
      .channel("pc-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "pc_agents" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "pc_sessions" }, () =>
        reload(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "pc_commands" }, () =>
        reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [reload]);

  return { agents, sessions, commands, reload };
}

export type PcZoneData = ReturnType<typeof usePcZone>;
