import { supabase, type Zone } from "./supabase";

export interface Promotion {
  id: string;
  name: string;
  sofa_half: number;
  sofa_hour: number;
  racing_half: number;
  racing_hour: number;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  active: boolean;
  created_at: string;
}

export interface PromotionInput {
  name: string;
  sofa_half: number;
  sofa_hour: number;
  racing_half: number;
  racing_hour: number;
  start_date: string;
  end_date: string;
  active?: boolean;
}

/** วันที่ปัจจุบันตามโซน Asia/Bangkok ในรูปแบบ YYYY-MM-DD */
export function todayBangkok(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export async function listPromotions(): Promise<Promotion[]> {
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Promotion[];
}

export async function createPromotion(p: PromotionInput): Promise<Promotion> {
  const { data, error } = await supabase
    .from("promotions")
    .insert({ ...p, active: p.active ?? true })
    .select()
    .single();
  if (error) throw error;
  return data as Promotion;
}

export async function setPromotionActive(id: string, active: boolean) {
  const { error } = await supabase
    .from("promotions")
    .update({ active })
    .eq("id", id);
  if (error) throw error;
}

export async function deletePromotion(id: string) {
  const { error } = await supabase.from("promotions").delete().eq("id", id);
  if (error) throw error;
}

export type PromotionStatus = "active" | "upcoming" | "expired" | "disabled";

export function promotionStatus(p: Promotion, today = todayBangkok()): PromotionStatus {
  if (!p.active) return "disabled";
  if (today < p.start_date) return "upcoming";
  if (today > p.end_date) return "expired";
  return "active";
}

/** หา Promotion ที่ active อยู่ ณ วันที่ระบุ (ค่าปริยาย: วันนี้ Asia/Bangkok)
 *  ถ้ามีหลายตัว เลือกตัวที่สร้างล่าสุด (created_at desc — รายการที่อยู่บนสุดของ list) */
export function getActivePromotion(promos: Promotion[], today = todayBangkok()): Promotion | null {
  const candidates = promos.filter((p) => promotionStatus(p, today) === "active");
  if (candidates.length === 0) return null;
  // promos already ordered created_at desc from listPromotions; pick the most recent
  return candidates[0];
}

export interface ZonePrice {
  half: number;
  hour: number;
}

export function getZonePrice(zone: Zone, promo: Promotion | null): ZonePrice {
  if (promo && zone !== "pc") {
    return zone === "sofa"
      ? { half: Number(promo.sofa_half), hour: Number(promo.sofa_hour) }
      : { half: Number(promo.racing_half), hour: Number(promo.racing_hour) };
  }
  // ราคาปกติ (อ้างอิง PRICES ใน priceEngine)
  if (zone === "sofa") return { half: 50, hour: 99 };
  if (zone === "racing") return { half: 60, hour: 119 };
  return { half: 20, hour: 40 }; // pc
}
