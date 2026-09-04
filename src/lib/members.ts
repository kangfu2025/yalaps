import { supabase, type Zone } from "./supabase";

export interface Member {
  id: string;
  phone: string;
  name: string;
  points: number;
  lifetime_points: number;
  visits: number;
  joined_at: string;
  last_visit_at: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PointTransaction {
  id: string;
  member_id: string;
  delta: number;
  balance_after: number;
  reason: "earn_play" | "redeem_free_hour" | "manual_adjust";
  zone: string | null;
  hours: number | null;
  minutes: number | null;
  reservation_id: string | null;
  pc_session_id: string | null;
  note: string | null;
  created_at: string;
}

export interface PointsConfig {
  hours_per_point_ps5: number;
  hours_per_point_pc: number;
  redeem_cost: number;
  redeem_zones: string;
  shop_name: string;
}

/** ค่าเริ่มต้น ใช้เมื่อยังไม่ได้รัน migration หรือโหลด config ไม่สำเร็จ */
export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  hours_per_point_ps5: 1,
  hours_per_point_pc: 2,
  redeem_cost: 10,
  redeem_zones: "sofa,racing",
  shop_name: "YALA PLAYSTATION",
};

let _configCache: PointsConfig | null = null;

/** กติกาแต้มมาจาก store_settings ที่เดียว — แก้ในฐานข้อมูลได้โดยไม่ต้อง deploy */
export async function getPointsConfig(force = false): Promise<PointsConfig> {
  if (_configCache && !force) return _configCache;
  try {
    const { data, error } = await supabase.rpc("points_config");
    if (error) throw error;
    const c = data as Partial<PointsConfig> | null;
    _configCache = {
      hours_per_point_ps5:
        Number(c?.hours_per_point_ps5) || DEFAULT_POINTS_CONFIG.hours_per_point_ps5,
      hours_per_point_pc: Number(c?.hours_per_point_pc) || DEFAULT_POINTS_CONFIG.hours_per_point_pc,
      redeem_cost: Number(c?.redeem_cost) || DEFAULT_POINTS_CONFIG.redeem_cost,
      redeem_zones: c?.redeem_zones || DEFAULT_POINTS_CONFIG.redeem_zones,
      shop_name: c?.shop_name || DEFAULT_POINTS_CONFIG.shop_name,
    };
    return _configCache;
  } catch (e) {
    console.warn("[members] points_config failed, ใช้ค่าเริ่มต้น:", e);
    return DEFAULT_POINTS_CONFIG;
  }
}

export function normalizePhone(input: string): string {
  let d = (input || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("66")) d = "0" + d.slice(2);
  else if (d.length === 12 && d.startsWith("660")) d = d.slice(3);
  return d;
}

export function formatPhone(phone: string): string {
  const d = normalizePhone(phone);
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return phone;
}

/** แต้มที่บิลนี้จะได้ — ใช้แสดงตัวอย่างในหน้าจอ (ของจริงคำนวณซ้ำในฐานข้อมูล) */
export function pointsForPlay(
  zone: Zone,
  opts: { hours?: number; minutes?: number },
  cfg: PointsConfig,
): number {
  const hours = zone === "pc" ? (opts.minutes ?? 0) / 60 : (opts.hours ?? 0);
  const per = zone === "pc" ? cfg.hours_per_point_pc : cfg.hours_per_point_ps5;
  if (per <= 0) return 0;
  return Math.max(0, Math.floor(hours / per));
}

export function canRedeemZone(zone: Zone, cfg: PointsConfig): boolean {
  return cfg.redeem_zones
    .split(",")
    .map((s) => s.trim())
    .includes(zone);
}

// ================= ค้นหา / จัดการสมาชิก =================

export async function findMemberByPhone(phone: string): Promise<Member | null> {
  const d = normalizePhone(phone);
  if (d.length < 9) return null;
  const { data, error } = await supabase.from("members").select("*").eq("phone", d).maybeSingle();
  if (error) throw error;
  return (data as Member) ?? null;
}

export async function getMember(id: string): Promise<Member | null> {
  const { data, error } = await supabase.from("members").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Member) ?? null;
}

export async function searchMembers(term: string, limit = 50): Promise<Member[]> {
  let q = supabase
    .from("members")
    .select("*")
    .order("last_visit_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  const t = (term || "").trim();
  if (t) {
    const digits = normalizePhone(t);
    q =
      digits.length >= 3
        ? q.or(`phone.ilike.%${digits}%,name.ilike.%${t}%`)
        : q.ilike("name", `%${t}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Member[];
}

export async function listMembers(limit = 200): Promise<Member[]> {
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .order("points", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Member[];
}

/** สมัครสมาชิก — ใช้ได้ทั้งหน้าสาธารณะ (anon) และหน้าแอดมิน */
export async function registerMember(
  name: string,
  phone: string,
): Promise<{
  status: "created" | "exists" | "invalid_phone" | "invalid_name";
  message: string;
  name?: string;
  phone?: string;
  points?: number;
}> {
  const { data, error } = await supabase.rpc("register_member", { p_name: name, p_phone: phone });
  if (error) throw error;
  const result = data as {
    status: "created" | "exists" | "invalid_phone" | "invalid_name";
    message: string;
    name?: string;
    phone?: string;
  };
  // สมาชิกใหม่ -> แจ้งเตือน LINE (import แบบ dynamic กันวงจร import ระหว่างไฟล์)
  if (result.status === "created") {
    const [{ notifyLine }, { buildMemberMessage }] = await Promise.all([
      import("./lineNotify"),
      import("./lineMessages"),
    ]);
    void notifyLine("member", buildMemberMessage(result.name ?? name, result.phone ?? phone));
  }
  return result;
}

/**
 * ลูกค้าสมัครเสร็จจากหน้า /join แล้ว -> สั่งจอลูกค้าปิดหน้า QR
 * ฝั่งฐานข้อมูลจะเปลี่ยนเป็นหน้า "ยินดีต้อนรับ" เฉพาะตอนที่จอกำลังโชว์ QR อยู่
 * (ถ้าจอกำลังโชว์ยอดชำระของลูกค้าอีกคน จะไม่ไปทับ)
 */
export async function closeJoinScreen(name: string): Promise<void> {
  const { error } = await supabase.rpc("close_join_screen", { p_name: name });
  if (error) throw error;
}

export async function updateMember(
  id: string,
  patch: Partial<Pick<Member, "name" | "phone" | "active" | "notes">>,
): Promise<void> {
  const body: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (typeof patch.phone === "string") body.phone = normalizePhone(patch.phone);
  const { error } = await supabase.from("members").update(body).eq("id", id);
  if (error) throw error;
}

export async function adjustPoints(
  memberId: string,
  delta: number,
  note?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("member_adjust_points", {
    p_member_id: memberId,
    p_delta: delta,
    p_note: note ?? null,
  });
  if (error) throw error;
  return Number(data);
}

export async function listMemberTransactions(
  memberId: string,
  limit = 50,
): Promise<PointTransaction[]> {
  const { data, error } = await supabase
    .from("point_transactions")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PointTransaction[];
}

// ================= ให้แต้ม / แลกแต้ม =================

/** ให้แต้มตามเวลาเล่น — ปลอดภัยถ้าเรียกซ้ำ (ฐานข้อมูลกันบิลซ้ำให้) */
export async function awardPoints(opts: {
  memberId: string;
  zone: Zone;
  hours?: number;
  minutes?: number;
  reservationId?: string | null;
  pcSessionId?: string | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc("member_award_points", {
    p_member_id: opts.memberId,
    p_zone: opts.zone,
    p_hours: opts.hours ?? 0,
    p_minutes: opts.minutes ?? 0,
    p_reservation_id: opts.reservationId ?? null,
    p_pc_session_id: opts.pcSessionId ?? null,
  });
  if (error) throw error;
  return Number(data) || 0;
}

export async function redeemFreeHour(opts: {
  memberId: string;
  zone: Zone;
  reservationId?: string | null;
}): Promise<{ ok: boolean; message?: string; cost?: number; points_left?: number }> {
  const { data, error } = await supabase.rpc("member_redeem_free_hour", {
    p_member_id: opts.memberId,
    p_zone: opts.zone,
    p_reservation_id: opts.reservationId ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; message?: string; cost?: number; points_left?: number };
}

/**
 * คืนแต้มที่หักไปแล้ว — ใช้ตอนหักแต้มสำเร็จแต่สร้างบิลไม่สำเร็จ
 *
 * ถ้าคืนไม่สำเร็จจริง ๆ จะไม่ throw ต่อ เพราะขั้นนี้เป็นการกู้สถานการณ์
 * ที่มี error อยู่แล้ว — ปล่อยให้ error ตัวจริงถึงมือพนักงานดีกว่า
 */
export async function refundPoints(
  memberId: string,
  points: number,
  note?: string,
): Promise<boolean> {
  if (points <= 0) return true;
  try {
    const { error } = await supabase.rpc("member_refund_points", {
      p_member_id: memberId,
      p_points: points,
      p_note: note ?? null,
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("[members] คืนแต้มไม่สำเร็จ ต้องปรับด้วยมือ:", { memberId, points, e });
    return false;
  }
}

/** ตารางสมาชิกพร้อมใช้งานหรือยัง (ยังไม่ได้รัน migration = false) */
export async function membersReady(): Promise<boolean> {
  try {
    const { error } = await supabase.from("members").select("id").limit(1);
    if (error) throw error;
    return true;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code ?? "";
    const msg = e instanceof Error ? e.message : String(e ?? "");
    if (code === "PGRST205" || code === "42P01" || /Could not find the table/i.test(msg))
      return false;
    return true;
  }
}
