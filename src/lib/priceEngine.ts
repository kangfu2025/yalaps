/**
 * Price Engine — แหล่งราคา "ที่เดียว" ของระบบ
 * คำนวณเป็นหน่วยครึ่งชั่วโมง (half-hour units) เพื่อไม่ให้คูณเลขผิด
 *
 *  โซฟา:   0.5h = 50,  1h = 99
 *  รถแข่ง:  0.5h = 60,  1h = 119
 *
 *  สูตร: 1 ชม. = 2 × half-hour unit แต่ราคา 1 ชม. ไม่เท่ากับ 0.5h × 2
 *        จึงคิด "จำนวนชั่วโมงเต็ม" × ราคา/ชม.  + "เศษ 0.5" × ราคา/half
 *
 *  รองรับ override ราคาจากโปรโมชั่น (override = { half, hour })
 */

import type { Zone } from "./supabase";

export const PRICES: Record<Zone, { half: number; hour: number }> = {
  sofa: { half: 50, hour: 99 },
  racing: { half: 60, hour: 119 },
  pc: { half: 20, hour: 40 },
};

export const HOUR_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3] as const;
export type HourOption = (typeof HOUR_OPTIONS)[number];

export interface PriceOverride {
  half: number;
  hour: number;
}

export function calcPrice(zone: Zone, hours: number, override?: PriceOverride | null): number {
  if (hours <= 0) return 0;
  const halves = Math.round(hours * 2);
  const fullHours = Math.floor(halves / 2);
  const extraHalf = halves % 2;
  const p = override ?? PRICES[zone];
  return fullHours * p.hour + extraHalf * p.half;
}

export function formatBaht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatHours(n: number): string {
  return Number(n).toFixed(1);
}
