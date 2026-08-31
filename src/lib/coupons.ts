import { supabase, type Coupon, type CouponStatus } from "./supabase";

/** สุ่ม code รูปแบบ PC-XXXXXX (base32 no confusable chars) */
export function generateCouponCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // ตัด 0/O/1/I/L
  let s = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) s += chars[b % chars.length];
  return `PC-${s}`;
}

export interface IssueCouponInput {
  minutes: number;
  price: number;
  cash: number;
  transfer: number;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  expireDays?: number;
}

export async function issueCoupon(input: IssueCouponInput): Promise<Coupon> {
  const code = generateCouponCode();
  const expires = input.expireDays && input.expireDays > 0
    ? new Date(Date.now() + input.expireDays * 86400_000).toISOString()
    : null;
  const { data, error } = await supabase
    .from("coupons")
    .insert({
      code,
      customer_name: input.customerName || null,
      customer_phone: input.customerPhone || null,
      total_minutes: input.minutes,
      remaining_minutes: input.minutes,
      price_paid: input.price,
      paid_cash: input.cash,
      paid_transfer: input.transfer,
      expires_at: expires,
      notes: input.notes || null,
      status: "active" as CouponStatus,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Coupon;
}

export async function listCoupons(opts?: { status?: CouponStatus; search?: string; limit?: number }): Promise<Coupon[]> {
  let q = supabase.from("coupons").select("*").order("created_at", { ascending: false }).limit(opts?.limit ?? 200);
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.search) q = q.or(`code.ilike.%${opts.search}%,customer_name.ilike.%${opts.search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Coupon[];
}

export async function findCouponByCode(code: string): Promise<Coupon | null> {
  const { data, error } = await supabase.from("coupons").select("*").eq("code", code.trim().toUpperCase()).maybeSingle();
  if (error) throw error;
  return data as Coupon | null;
}

export async function cancelCoupon(id: string) {
  const { error } = await supabase
    .from("coupons")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function extendCouponExpiry(id: string, days: number) {
  const newExp = new Date(Date.now() + days * 86400_000).toISOString();
  const { error } = await supabase
    .from("coupons")
    .update({ expires_at: newExp, status: "active", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export function couponStatusLabel(s: CouponStatus): string {
  return { active: "พร้อมใช้", in_use: "กำลังใช้", expired: "หมดอายุ", depleted: "ใช้หมดแล้ว", cancelled: "ยกเลิก" }[s];
}
export function couponStatusBadge(s: CouponStatus): string {
  return { active: "bg-success", in_use: "bg-info", expired: "bg-secondary", depleted: "bg-secondary", cancelled: "bg-danger" }[s];
}
