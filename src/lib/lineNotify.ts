import { supabase } from "./supabase";

export type LineEvent = "start" | "extend" | "checkout" | "cancel" | "member" | "test";

export interface LineConfig {
  id: number;
  enabled: boolean;
  target_id: string | null;
  target_label: string | null;
  events: Record<string, boolean>;
  updated_at: string;
}

export const LINE_EVENT_LABELS: Record<Exclude<LineEvent, "test">, string> = {
  start: "เปิดเครื่อง",
  extend: "ต่อเวลา",
  checkout: "ปิดบิล",
  cancel: "ยกเลิกบิล",
  member: "สมาชิกใหม่",
};

let cache: LineConfig | null = null;
let cacheAt = 0;
const CACHE_MS = 60_000;

export async function getLineConfig(force = false): Promise<LineConfig | null> {
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  try {
    const { data, error } = await supabase
      .from("line_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    cache = (data as LineConfig) ?? null;
    cacheAt = Date.now();
    return cache;
  } catch {
    return null; // ยังไม่ได้รัน migration หรืออ่านไม่ได้ — ไม่ให้กระทบงานหลัก
  }
}

export function clearLineConfigCache() {
  cache = null;
  cacheAt = 0;
}

export async function saveLineConfig(patch: Partial<LineConfig>): Promise<void> {
  const { error } = await supabase
    .from("line_config")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
  clearLineConfigCache();
}

export async function lineUsageThisMonth(): Promise<number> {
  const { data, error } = await supabase.rpc("line_usage_this_month");
  if (error) throw error;
  return Number(data) || 0;
}

export interface LinePushResult {
  ok: boolean;
  skipped?: string;
  error?: string;
}

/** ส่งข้อความจริง — ผ่านเซิร์ฟเวอร์เพราะ token อยู่ฝั่งนั้น */
async function push(event: LineEvent, message: string): Promise<LinePushResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const res = await fetch("/api/line-push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ event, message }),
  });
  try {
    return (await res.json()) as LinePushResult;
  } catch {
    return { ok: false, error: `ส่งไม่สำเร็จ (HTTP ${res.status})` };
  }
}

/**
 * แจ้งเตือนแบบ "ห้ามพัง"
 *
 * ทุกจุดที่เรียกคือกลางขั้นตอนเปิดเครื่อง/ปิดบิล ถ้า LINE ล่มหรือโควตาหมด
 * ต้องไม่ทำให้บิลเสีย จึงกลืน error ทั้งหมดและไม่ throw ออกไป
 */
export async function notifyLine(event: LineEvent, message: string): Promise<void> {
  try {
    const cfg = await getLineConfig();
    if (!cfg?.enabled || !cfg.target_id) return;
    if (event !== "test" && cfg.events?.[event] === false) return;
    await push(event, message);
  } catch (e) {
    console.warn("[line] notify failed:", e);
  }
}

/** ส่งข้อความทดสอบจากหน้าตั้งค่า — อันนี้ต้องรู้ผลจริง จึงไม่กลืน error */
export async function sendLineTest(message: string): Promise<LinePushResult> {
  return push("test", message);
}
