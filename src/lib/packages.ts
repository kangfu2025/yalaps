import { supabase } from "./supabase";

/**
 * แพ็กเกจราคา + ชั่วโมงสะสม (Hour Bank)
 *
 * กติกาทั้งหมดอยู่ที่ฐานข้อมูล (supabase/package_hourbank_migration.sql):
 *  - ราคา/นาทีของแพ็กเกจในบิล trigger อ่านจากตาราง price_packages เอง
 *    หน้าเว็บส่งแค่ package_id ไป จึงแก้ราคาจากเบราว์เซอร์ไม่ได้
 *  - เวลาที่เหลือตอนเก็บชั่วโมง ฐานข้อมูลคิดเองจากเวลาหมดของบิล
 *  - หักชั่วโมงก้อนที่ใกล้หมดอายุก่อน และคืนเข้าก้อนเดิมถ้าเปิดเครื่องไม่สำเร็จ
 * ไฟล์นี้แค่เรียกใช้ ไม่คำนวณยอดเองซ้ำอีกชุด
 */

export interface PricePackage {
  id: string;
  group_name: string;
  label: string;
  zone: "sofa";
  minutes: number;
  price: number;
  start_date: string;
  end_date: string | null;
  active: boolean;
  sort_order: number;
  created_at?: string;
}

export type PackageInput = Omit<PricePackage, "id" | "zone" | "created_at">;

export interface HourBankLot {
  id: string;
  minutes_left: number;
  minutes_total: number;
  expires_at: string;
  created_at: string;
}

export interface HourBankBalance {
  minutes: number;
  next_expiry: string | null;
  lots: HourBankLot[];
}

export interface HourBankTx {
  id: string;
  delta_min: number;
  balance_after: number;
  reason: "save" | "redeem" | "refund";
  reservation_id: string | null;
  refunded: boolean;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export const PACKAGES_SQL_FILE = "supabase/package_hourbank_migration.sql";

/** ยังไม่ได้รัน SQL ของฟีเจอร์นี้ — หน้าเว็บซ่อนฟีเจอร์ แทนที่จะพังทั้งหน้า */
export function isPackagesMissing(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? "";
  const msg = (e as { message?: string } | null)?.message ?? String(e ?? "");
  return (
    code === "PGRST202" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    code === "42883" ||
    code === "42P01" ||
    code === "42703" ||
    /Could not find the (table|function)|price_packages|hour_bank/i.test(msg)
  );
}

function toError(e: unknown): Error {
  const msg = (e as { message?: string } | null)?.message;
  return new Error(msg || String(e));
}

/** วันที่วันนี้ตามเวลาไทย (YYYY-MM-DD) — ต้องตรงกับที่ trigger ในฐานข้อมูลใช้ตัดสิน */
export function bangkokToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function packageOpenOn(p: PricePackage, day = bangkokToday()): boolean {
  return p.active && p.start_date <= day && (!p.end_date || p.end_date >= day);
}

export type PackageState = "live" | "upcoming" | "ended" | "off";

export function packageState(p: PricePackage, day = bangkokToday()): PackageState {
  if (!p.active) return "off";
  if (p.start_date > day) return "upcoming";
  if (p.end_date && p.end_date < day) return "ended";
  return "live";
}

/** 540 -> "9 ชม.", 200 -> "3 ชม. 20 นาที", 45 -> "45 นาที" */
export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} นาที`;
  return r === 0 ? `${h} ชม.` : `${h} ชม. ${r} นาที`;
}

/** ชั่วโมงทศนิยม 1 ตำแหน่งสำหรับคอลัมน์ base_hours (numeric(4,1)) */
export function minutesToHours(min: number): number {
  return Math.round((min / 60) * 10) / 10;
}

export function fmtThaiDate(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "2-digit",
  }).format(new Date(iso.length === 10 ? `${iso}T12:00:00+07:00` : iso));
}

// ---------------- แพ็กเกจ ----------------

/** null = ยังไม่ได้รัน SQL */
export async function listPackages(): Promise<PricePackage[] | null> {
  const { data, error } = await supabase
    .from("price_packages")
    .select("*")
    .order("start_date", { ascending: false })
    .order("group_name")
    .order("sort_order")
    .order("minutes");
  if (error) {
    if (isPackagesMissing(error)) return null;
    throw toError(error);
  }
  return ((data ?? []) as PricePackage[]).map((p) => ({
    ...p,
    price: Number(p.price),
    minutes: Number(p.minutes),
  }));
}

/** แพ็กเกจที่ใช้เปิดเครื่องได้วันนี้ (โซฟา) เรียงตามกลุ่มแล้วตามลำดับ */
export async function listOpenPackages(): Promise<PricePackage[]> {
  const all = await listPackages().catch(() => null);
  if (!all) return [];
  const day = bangkokToday();
  return all
    .filter((p) => packageOpenOn(p, day))
    .sort(
      (a, b) =>
        a.group_name.localeCompare(b.group_name, "th") ||
        a.sort_order - b.sort_order ||
        a.minutes - b.minutes,
    );
}

export async function savePackage(input: PackageInput, id?: string): Promise<void> {
  const row = {
    group_name: input.group_name.trim(),
    label: input.label.trim(),
    zone: "sofa",
    minutes: Math.round(input.minutes),
    price: input.price,
    start_date: input.start_date,
    end_date: input.end_date || null,
    active: input.active,
    sort_order: input.sort_order,
    updated_at: new Date().toISOString(),
  };
  const q = id
    ? supabase.from("price_packages").update(row).eq("id", id)
    : supabase.from("price_packages").insert(row);
  const { error } = await q;
  if (error) throw toError(error);
}

export async function setPackageActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from("price_packages")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw toError(error);
}

/** บิลเก่าที่ใช้แพ็กเกจนี้ยังเก็บชื่อและราคาไว้ในบิลเอง ลบแล้วรายงานไม่เพี้ยน */
export async function deletePackage(id: string): Promise<void> {
  const { error } = await supabase.from("price_packages").delete().eq("id", id);
  if (error) throw toError(error);
}

// ---------------- ชั่วโมงสะสม ----------------

/** null = ยังไม่ได้รัน SQL */
export async function getHourBank(memberId: string): Promise<HourBankBalance | null> {
  const { data, error } = await supabase.rpc("hour_bank_balance", { p_member_id: memberId });
  if (error) {
    if (isPackagesMissing(error)) return null;
    throw toError(error);
  }
  const d = data as HourBankBalance;
  return { minutes: Number(d.minutes) || 0, next_expiry: d.next_expiry, lots: d.lots ?? [] };
}

export async function listHourBankTx(memberId: string, limit = 50): Promise<HourBankTx[]> {
  const { data, error } = await supabase
    .from("hour_bank_tx")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isPackagesMissing(error)) return [];
    throw toError(error);
  }
  return (data ?? []) as HourBankTx[];
}

export interface SaveResult {
  saved_minutes: number;
  balance: number;
  expires_at: string;
}

/** เก็บเวลาที่เหลือของบิลเข้าบัญชีสมาชิก — ฐานข้อมูลคิดนาทีเองจากเวลาหมดของบิล */
export async function saveHourBank(reservationId: string): Promise<SaveResult> {
  const { data, error } = await supabase.rpc("hour_bank_save", {
    p_reservation_id: reservationId,
  });
  if (error) throw toError(error);
  return data as SaveResult;
}

export interface RedeemResult {
  tx_id: string;
  minutes: number;
  expires_at: string;
  balance: number;
}

export async function redeemHourBank(memberId: string, minutes: number): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc("hour_bank_redeem", {
    p_member_id: memberId,
    p_minutes: Math.round(minutes),
  });
  if (error) throw toError(error);
  return data as RedeemResult;
}

export async function linkHourBank(txId: string, reservationId: string): Promise<void> {
  const { error } = await supabase.rpc("hour_bank_link", {
    p_tx_id: txId,
    p_reservation_id: reservationId,
  });
  if (error) throw toError(error);
}

export async function refundHourBank(txId: string): Promise<void> {
  const { error } = await supabase.rpc("hour_bank_refund", { p_tx_id: txId });
  if (error) throw toError(error);
}

export function hourBankToast(r: SaveResult) {
  return {
    kind: "success" as const,
    title: `เก็บเวลา ${fmtMinutes(r.saved_minutes)} เข้าบัญชีสมาชิกแล้ว`,
    text: `คงเหลือ ${fmtMinutes(r.balance)} · ใช้ได้ถึง ${fmtThaiDate(r.expires_at)}`,
  };
}
