import { supabase } from "./supabase";

/** วันที่วันนี้ตามเวลาไทย รูปแบบ YYYY-MM-DD */
export function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** ช่วงเวลาของวันนี้ตามเวลาไทย (ใช้กับคอลัมน์ timestamptz) */
function todayRange(): { start: string; end: string } {
  const d = todayBangkok();
  const start = new Date(`${d}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 86400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function sum(rows: Record<string, unknown>[] | null, keys: string[]): number {
  return (rows ?? []).reduce(
    (acc, r) => acc + keys.reduce((s, k) => s + (Number(r[k]) || 0), 0),
    0,
  );
}

/**
 * เงินที่รับเข้ามาแล้ววันนี้ (บาท)
 *
 * รวมสี่ทาง — แยกกันชัดเจน ไม่มีการนับซ้ำ:
 *   1. บิล PS5 ที่ปิดแล้ววันนี้            (billing_logs)
 *   2. มัดจำของบิล PS5 ที่ยังเล่นค้างอยู่   (reservations ที่ status = playing)
 *      เพราะเงินก้อนนี้รับมาแล้วแต่ยังไม่เข้า billing_logs จนกว่าจะปิดบิล
 *   3. โซน PC วันนี้                        (pc_sessions ไม่นับบิลที่ยกเลิก)
 *   4. ขายสินค้าวันนี้                      (product_sales ที่ยังไม่ถูกยกเลิก)
 *
 * ยอดสินค้าที่ลงบิลเครื่องไว้ถูกหักออกจาก final_cash/final_transfer ตอนปิดบิลแล้ว
 * จึงบวกทั้งสองทางได้โดยไม่ซ้ำ
 */
export async function getTodayRevenue(): Promise<number> {
  const day = todayBangkok();
  const { start, end } = todayRange();

  const [bills, playing, pc, sales] = await Promise.all([
    supabase
      .from("billing_logs")
      .select("advance_cash,advance_transfer,final_cash,final_transfer")
      .eq("checkout_date", day),
    supabase
      .from("reservations")
      .select("advance_cash,advance_transfer")
      .eq("status", "playing")
      .gte("start_time", start),
    supabase
      .from("pc_sessions")
      .select("paid_cash,paid_transfer")
      .neq("status", "cancelled")
      .gte("started_at", start)
      .lt("started_at", end),
    supabase
      .from("product_sales")
      .select("paid_cash,paid_transfer")
      .eq("status", "paid")
      .eq("sale_date", day),
  ]);

  return (
    sum(bills.data, ["advance_cash", "advance_transfer", "final_cash", "final_transfer"]) +
    sum(playing.data, ["advance_cash", "advance_transfer"]) +
    sum(pc.data, ["paid_cash", "paid_transfer"]) +
    sum(sales.data, ["paid_cash", "paid_transfer"])
  );
}
