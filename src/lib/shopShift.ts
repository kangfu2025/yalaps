import { supabase } from "./supabase";
import { formatBaht } from "./priceEngine";

/**
 * เปิดร้าน / ปิดร้าน / เงินในลิ้นชัก
 *
 * ทุกการตัดสินใจอยู่ที่ฐานข้อมูล (shop_shift_migration.sql):
 * สถานะร้าน ยอดที่ควรมีในลิ้นชัก สิทธิ์ถอนเงิน และตัวกันเปิดเครื่อง
 * ไฟล์นี้แค่เรียกฟังก์ชันพวกนั้น ไม่คำนวณยอดเงินเองซ้ำอีกชุด
 * (ยกเว้นผลรวมตอนกรอกจำนวนใบ ซึ่งใช้โชว์สดบนจอ — ตอนบันทึกฐานข้อมูลคิดใหม่เอง)
 */

/** ชนิดธนบัตร/เหรียญที่นับ เรียงจากใหญ่ไปเล็ก */
export const BANKNOTES = [1000, 500, 100, 50, 20] as const;
export const COINS = [10, 5, 1] as const;
export const DENOMS = [...BANKNOTES, ...COINS] as const;

export type Denom = (typeof DENOMS)[number];
export type CashCounts = Partial<Record<`${Denom}`, number>>;

export function countTotal(counts: CashCounts): number {
  return DENOMS.reduce((s, d) => s + d * (Number(counts[`${d}`]) || 0), 0);
}

export interface DrawerCash {
  opening: number;
  ps5: number;
  pc: number;
  pos: number;
  other_in: number;
  cash_in: number;
  cash_out: number;
  withdrawn: number;
  expected: number;
}

export interface ShopStatus {
  /** false = ยังไม่ได้รัน shop_shift_migration.sql — ระบบทำงานแบบเดิม ไม่มีการกัน */
  installed: boolean;
  /** ตัวกันเปิดเครื่องทำงานอยู่ไหม (ปิดได้ฉุกเฉินใน shop_config) */
  gate: boolean;
  open: boolean;
  role: string | null;
  /** บิล PS5 + เครื่อง PC ที่ยังไม่ปิดบิล — ต้องเป็น 0 ถึงจะปิดร้านได้ */
  active_sessions: number;
  last_closed: { closed_at: string; counted_cash: number; diff: number } | null;
  shift: {
    id: string;
    opened_at: string;
    opened_by_name: string | null;
    opening_cash: number;
    opening_counts: CashCounts;
  } | null;
  cash: DrawerCash | null;
}

export interface ShopShift {
  id: string;
  status: "open" | "closed";
  opened_at: string;
  opened_by_name: string | null;
  opening_counts: CashCounts;
  opening_cash: number;
  closed_at: string | null;
  closed_by_name: string | null;
  closing_counts: CashCounts | null;
  counted_cash: number | null;
  cash_in: number | null;
  cash_out: number | null;
  withdrawn: number | null;
  expected_cash: number | null;
  diff: number | null;
  breakdown: DrawerCash | null;
  note: string | null;
}

export interface CashWithdrawal {
  id: string;
  shift_id: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  note: string | null;
  withdrawn_by_name: string | null;
  created_at: string;
}

export interface CloseResult extends DrawerCash {
  id: string;
  counted: number;
  diff: number;
}

export const SHOP_CLOSED_MESSAGE = "กรุณาเปิดร้านก่อนเริ่มใช้งานเครื่อง";

/** error นี้มาจากร้านปิด (ด่านหน้าเว็บ หรือ trigger ในฐานข้อมูล) ใช่ไหม — ใช้เลือกแสดงหน้าต่างเปิดร้านแทน alert */
export function isShopClosedError(e: unknown): boolean {
  const msg = (e as { message?: string } | null)?.message ?? String(e ?? "");
  const hint = (e as { hint?: string } | null)?.hint ?? "";
  return hint === "SHOP_CLOSED" || msg.includes(SHOP_CLOSED_MESSAGE);
}

/** บิลที่ยังไม่ปิด — แสดงตอนปิดร้านไม่ได้ ให้รู้ว่าค้างที่เครื่องไหน */
export interface OpenBill {
  id: string;
  kind: "ps5" | "pc";
  zone: string;
  machine_number: number | null;
  customer_name: string | null;
  started_at: string;
}

const NOT_INSTALLED: ShopStatus = {
  installed: false,
  gate: false,
  open: true,
  role: null,
  active_sessions: 0,
  last_closed: null,
  shift: null,
  cash: null,
};

function isMissing(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? "";
  const msg = (e as { message?: string } | null)?.message ?? String(e ?? "");
  return (
    code === "PGRST202" ||
    code === "PGRST205" ||
    code === "42883" ||
    code === "42P01" ||
    /Could not find the (table|function)/i.test(msg)
  );
}

/** ข้อความจากฐานข้อมูลเป็นภาษาไทยที่เขียนให้พนักงานอ่านอยู่แล้ว ส่งต่อได้เลย */
function toError(e: unknown): Error {
  const msg = (e as { message?: string } | null)?.message;
  return new Error(msg || String(e));
}

export async function getShopStatus(): Promise<ShopStatus> {
  const { data, error } = await supabase.rpc("shop_status");
  if (error) {
    if (isMissing(error)) return NOT_INSTALLED;
    throw toError(error);
  }
  return { installed: true, ...(data as Omit<ShopStatus, "installed">) };
}

export async function openShop(counts: CashCounts): Promise<void> {
  const { error } = await supabase.rpc("shop_open", { p_counts: counts });
  if (error) throw toError(error);
}

export async function closeShop(counts: CashCounts, note?: string): Promise<CloseResult> {
  const { data, error } = await supabase.rpc("shop_close", {
    p_counts: counts,
    p_note: note?.trim() || null,
  });
  if (error) throw toError(error);
  return data as CloseResult;
}

export type WithdrawResult = { before: number; amount: number; after: number };

/** ข้อความแจ้งเตือนหลังถอนเงิน — ใช้ทั้งแถบร้านหน้าแรกและหน้าประวัติลิ้นชัก */
export function withdrawToast(r: WithdrawResult) {
  return {
    kind: "info" as const,
    title: `ถอนเงิน ${formatBaht(Number(r.amount))} บาท`,
    text: `คงเหลือในลิ้นชัก ${formatBaht(Number(r.after))} บาท`,
  };
}

export async function withdrawFromDrawer(amount: number, note?: string): Promise<WithdrawResult> {
  const { data, error } = await supabase.rpc("drawer_withdraw", {
    p_amount: amount,
    p_note: note?.trim() || null,
  });
  if (error) throw toError(error);
  return data as WithdrawResult;
}

/** ประวัติรอบเปิด-ปิดร้าน (ฐานข้อมูลให้อ่านเฉพาะแอดมิน) */
export async function listShifts(limit = 60): Promise<ShopShift[]> {
  const { data, error } = await supabase
    .from("shop_shifts")
    .select("*")
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) throw toError(error);
  return (data ?? []) as ShopShift[];
}

export async function listWithdrawals(limit = 100): Promise<CashWithdrawal[]> {
  const { data, error } = await supabase
    .from("cash_withdrawals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw toError(error);
  return (data ?? []) as CashWithdrawal[];
}

/**
 * รายการบิลที่ทำให้ปิดร้านไม่ได้ — เงื่อนไขเดียวกับ shop_close ในฐานข้อมูล
 * (reservations / pc_sessions ที่ status = 'playing') เรียงจากเก่าสุด
 */
export async function listOpenBills(): Promise<OpenBill[]> {
  const [ps5, pc] = await Promise.all([
    supabase
      .from("reservations")
      .select("id, zone, machine_number, customer_name, start_time, created_at")
      .eq("status", "playing"),
    supabase
      .from("pc_sessions")
      .select("id, machine_id, customer_name, started_at, created_at")
      .eq("status", "playing"),
  ]);
  if (ps5.error) throw toError(ps5.error);
  if (pc.error) throw toError(pc.error);

  type PcRow = {
    id: string;
    machine_id: string;
    customer_name: string | null;
    started_at: string | null;
    created_at: string;
  };
  const pcRows = (pc.data ?? []) as PcRow[];
  const numberOf = new Map<string, number>();
  if (pcRows.length > 0) {
    const { data } = await supabase
      .from("machines")
      .select("id, machine_number")
      .in("id", [...new Set(pcRows.map((r) => r.machine_id))]);
    for (const m of (data ?? []) as { id: string; machine_number: number }[]) {
      numberOf.set(m.id, m.machine_number);
    }
  }

  type ResRow = {
    id: string;
    zone: string;
    machine_number: number | null;
    customer_name: string | null;
    start_time: string | null;
    created_at: string;
  };
  const bills: OpenBill[] = [
    ...((ps5.data ?? []) as ResRow[]).map((r) => ({
      id: r.id,
      kind: "ps5" as const,
      zone: r.zone,
      machine_number: r.machine_number,
      customer_name: r.customer_name,
      started_at: r.start_time ?? r.created_at,
    })),
    ...pcRows.map((r) => ({
      id: r.id,
      kind: "pc" as const,
      zone: "pc",
      machine_number: numberOf.get(r.machine_id) ?? null,
      customer_name: r.customer_name,
      started_at: r.started_at ?? r.created_at,
    })),
  ];
  return bills.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

/**
 * เช็กก่อนเริ่ม session — ใช้ในฟังก์ชันเปิดเครื่องทั้งสองทาง
 *
 * นี่เป็นด่านแรกเพื่อให้ข้อความชัดและไม่ไปหักแต้ม/เก็บเงินก่อน
 * ด่านจริงคือ trigger ในฐานข้อมูล ซึ่งกันได้แม้มีคนยิง API ตรง
 * ถ้าเช็กไม่ได้ (เน็ตสะดุด) ปล่อยผ่านให้ฐานข้อมูลเป็นคนตัดสิน
 */
export async function assertShopOpen(): Promise<void> {
  let st: ShopStatus;
  try {
    st = await getShopStatus();
  } catch {
    return;
  }
  if (st.installed && st.gate && !st.open) throw new Error(SHOP_CLOSED_MESSAGE);
}

export function fmtShiftTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    numberingSystem: "latn",
  }).format(new Date(iso));
}

export function fmtShiftDate(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(new Date(iso));
}
