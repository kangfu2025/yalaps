import { supabase, type PcAgent, type PcCommand, type PcCommandType, type PcSession } from "./supabase";
import { awardPoints } from "./members";

/** ประวัติคำสั่งล่าสุดที่ส่งไปยังเครื่อง PC */
export async function listRecentPcCommands(limit = 20): Promise<PcCommand[]> {
  const { data, error } = await supabase
    .from("pc_commands")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PcCommand[];
}

/** ราคา PC: 30 นาที = 30, 1 ชม. = 50, 2 ชม. = 100 (50 บาท/ชม. + เศษ 30 นาที = +30) */
export function calcPcPrice(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes <= 30) return 30;
  const halves = Math.round(minutes / 30);
  const fullHours = Math.floor(halves / 2);
  const extraHalf = halves % 2;
  return fullHours * 50 + extraHalf * 30;
}

export async function listPcSessionsByDateRange(startDate: string, endDate: string) {
  // startDate/endDate: YYYY-MM-DD (Asia/Bangkok). Force Bangkok offset (+07:00)
  // so filtering is independent of the browser/server timezone.
  const start = new Date(`${startDate}T00:00:00+07:00`);
  const endExclusive = new Date(`${endDate}T00:00:00+07:00`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const { data, error } = await supabase
    .from("pc_sessions")
    .select("*")
    .gte("started_at", start.toISOString())
    .lt("started_at", endExclusive.toISOString())
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PcSession[];
}

export async function sendPcCommand(machineId: string, type: PcCommandType, payload: Record<string, unknown> = {}) {
  const { error } = await supabase.from("pc_commands").insert({ machine_id: machineId, type, payload });
  if (error) throw error;
}

export async function listAgents(): Promise<PcAgent[]> {
  const { data, error } = await supabase.from("pc_agents").select("*");
  if (error) throw error;
  return (data ?? []) as PcAgent[];
}

export async function activePcSession(machineId: string): Promise<PcSession | null> {
  const { data, error } = await supabase
    .from("pc_sessions")
    .select("*")
    .eq("machine_id", machineId)
    .eq("status", "playing")
    .maybeSingle();
  if (error) throw error;
  return data as PcSession | null;
}

export async function listActivePcSessions(): Promise<PcSession[]> {
  const { data, error } = await supabase
    .from("pc_sessions")
    .select("*")
    .eq("status", "playing");
  if (error) throw error;
  return (data ?? []) as PcSession[];
}

export function isAgentOnline(agent: PcAgent | undefined | null): boolean {
  if (!agent) return false;
  const diff = Date.now() - new Date(agent.last_heartbeat).getTime();
  // heartbeat ที่เป็นอนาคต (เครื่องลูกใช้ปฏิทินพุทธ = ปี 2569) ถือว่า "ไม่น่าเชื่อถือ" → ออฟไลน์
  if (diff < -60_000) return false;
  return diff < 60_000;
}


/** เริ่ม session PC — Agent จะเห็นผ่าน Realtime อัตโนมัติ */
export async function startPcSession(opts: {
  machineId: string;
  minutes: number;
  customerName?: string;
  price?: number;
  paidCash?: number;
  paidTransfer?: number;
  redeemedPoints?: boolean;
  memberId?: string | null;
}) {
  const now = new Date();
  const ends = new Date(now.getTime() + opts.minutes * 60_000);
  const price = opts.price ?? calcPcPrice(opts.minutes);
  const redeemed = opts.redeemedPoints ?? false;
  const paidCash = redeemed ? 0 : (opts.paidCash ?? 0);
  const paidTransfer = redeemed ? 0 : (opts.paidTransfer ?? 0);
  const { data, error } = await supabase
    .from("pc_sessions")
    .insert({
      machine_id: opts.machineId,
      customer_name: opts.customerName ?? null,
      member_id: opts.memberId ?? null,
      minutes_purchased: opts.minutes,
      price,
      paid_cash: paidCash,
      paid_transfer: paidTransfer,
      redeemed_points: redeemed,
      started_at: now.toISOString(),
      ends_at: ends.toISOString(),
      status: "playing",
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("machines").update({ status: "playing", updated_at: now.toISOString() }).eq("id", opts.machineId);
  return data as PcSession;
}

/** เพิ่มเวลาให้ session ที่กำลังเล่นอยู่ */
export async function extendPcSession(
  sessionId: string,
  extraMinutes: number,
  opts: { paidCash?: number; paidTransfer?: number; redeemedPoints?: boolean } = {},
) {
  const { data: s, error } = await supabase.from("pc_sessions").select("*").eq("id", sessionId).single();
  if (error) throw error;
  const session = s as PcSession;
  const newEnds = new Date(new Date(session.ends_at).getTime() + extraMinutes * 60_000);
  const extraPrice = calcPcPrice(extraMinutes);
  const redeemed = opts.redeemedPoints ?? false;
  const addCash = redeemed ? 0 : (opts.paidCash ?? 0);
  const addTransfer = redeemed ? 0 : (opts.paidTransfer ?? 0);
  await supabase.from("pc_sessions").update({
    ends_at: newEnds.toISOString(),
    minutes_purchased: session.minutes_purchased + extraMinutes,
    price: session.price + extraPrice,
    paid_cash: Number(session.paid_cash ?? 0) + addCash,
    paid_transfer: Number(session.paid_transfer ?? 0) + addTransfer,
  }).eq("id", sessionId);
}

/** ผูก (หรือถอด) สมาชิกกับ session ที่กำลังเล่นอยู่ */
export async function setPcSessionMember(sessionId: string, memberId: string | null) {
  const { error } = await supabase.from("pc_sessions").update({ member_id: memberId }).eq("id", sessionId);
  if (error) throw error;
}

/** จบ session (บันทึก minutes_used + ยอดชำระเพิ่มเติมตอนเช็คบิล + ให้แต้มสมาชิก) */
export async function endPcSession(
  sessionId: string,
  opts: { forced?: boolean; addCash?: number; addTransfer?: number; foodAmount?: number; memberId?: string | null } = {},
): Promise<{ pointsEarned: number }> {
  const { data: s, error } = await supabase.from("pc_sessions").select("*").eq("id", sessionId).single();
  if (error) throw error;
  const session = s as PcSession;
  const now = new Date();
  const usedMin = Math.max(0, Math.round((now.getTime() - new Date(session.started_at).getTime()) / 60_000));

  const update: Record<string, unknown> = {
    ended_at: now.toISOString(),
    minutes_used: usedMin,
    status: opts.forced ? "force_ended" : "ended",
    paid_cash: Number(session.paid_cash ?? 0) + (opts.addCash ?? 0),
    paid_transfer: Number(session.paid_transfer ?? 0) + (opts.addTransfer ?? 0),
  };
  if (opts.foodAmount !== undefined) {
    update.food_amount = Number(session.food_amount ?? 0) + opts.foodAmount;
  }

  // ให้แต้ม: โซน PC คิดจากนาทีที่ซื้อ (ฐานข้อมูลกันให้ซ้ำจาก session เดียวกัน)
  const memberId = opts.memberId ?? session.member_id ?? null;
  let pointsEarned = 0;
  if (memberId) {
    try {
      pointsEarned = await awardPoints({
        memberId,
        zone: "pc",
        minutes: Number(session.minutes_purchased) || 0,
        pcSessionId: sessionId,
      });
      update.member_id = memberId;
      update.points_earned = pointsEarned;
    } catch (e) {
      console.error("[pc] award points failed:", e);
    }
  }

  await supabase.from("pc_sessions").update(update).eq("id", sessionId);

  await supabase.from("machines").update({
    status: "idle",
    current_reservation_id: null,
    updated_at: now.toISOString(),
  }).eq("id", session.machine_id);

  return { pointsEarned };
}

/** ยกเลิกบิล PC — ไม่นับเป็นรายได้ (ยอดชำระถูกล้างเป็น 0) และเครื่องกลับไปล็อก */
export async function cancelPcSession(sessionId: string) {
  const { cancelSalesForBill } = await import("./products");
  await cancelSalesForBill({ pcSessionId: sessionId }).catch((e) => console.warn("[cancel] product sales:", e));
  const { data: s, error } = await supabase.from("pc_sessions").select("*").eq("id", sessionId).single();
  if (error) throw error;
  const session = s as PcSession;
  const now = new Date();
  const usedMin = Math.max(0, Math.round((now.getTime() - new Date(session.started_at).getTime()) / 60_000));

  const base = {
    ended_at: now.toISOString(),
    minutes_used: usedMin,
    price: 0,
    paid_cash: 0,
    paid_transfer: 0,
    food_amount: 0,
  };

  let res = await supabase.from("pc_sessions").update({ ...base, status: "cancelled" }).eq("id", sessionId);
  if (res.error) {
    // ฐานข้อมูลเก่ายังไม่มีสถานะ 'cancelled' → fallback เป็น force_ended (ยอด 0 อยู่แล้ว)
    res = await supabase.from("pc_sessions").update({ ...base, status: "force_ended" }).eq("id", sessionId);
    if (res.error) throw res.error;
  }

  await supabase.from("machines").update({
    status: "idle",
    current_reservation_id: null,
    updated_at: now.toISOString(),
  }).eq("id", session.machine_id);

  // สั่งล็อกหน้าจอกลับทันที
  await sendPcCommand(session.machine_id, "lock").catch(() => {});
}
