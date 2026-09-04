import { supabase, type Reservation, type Zone } from "./supabase";
import { resetMachineToIdle } from "./machines";
import { calcPrice } from "./priceEngine";
import { getZonePrice, type Promotion } from "./promotions";
import { awardPoints, redeemFreeHour, getMember, type Member } from "./members";
import { notifyLine } from "./lineNotify";
import { buildCheckoutMessage } from "./lineMessages";

export interface CheckoutInput {
  machineId: string;
  reservation: Reservation;
  finalCash: number;
  finalTransfer: number;
  promotion?: Promotion | null;
  /**
   * ร้านแถมให้ทั้งบิล (คอมพ์) — ไม่คิดเงิน ไม่แตะแต้มสมาชิก
   * คนละเรื่องกับ useFreeHour ด้านล่างซึ่งเป็นการแลกแต้มจริง
   */
  redeemedPoints?: boolean;
  /** สมาชิกที่ผูกกับบิลนี้ (ถ้ามี) */
  member?: Member | null;
  /** ใช้แต้มสมาชิกแลกเล่นฟรี 1 ชั่วโมง */
  useFreeHour?: boolean;
  /** ยอดสินค้าที่ปิดพร้อมบิลนี้ (ใช้แสดงในข้อความแจ้งเตือน) */
  productTotal?: number;
}

export interface CheckoutSummary {
  duration_hours: number;
  machine_price: number;
  food_price: number;
  advance_cash: number;
  advance_transfer: number;
  points_discount: number;
  total_due: number;
  remaining: number;
  promotion_applied?: { id: string; name: string } | null;
}

/** มูลค่าของ "เล่นฟรี 1 ชั่วโมง" = ราคา 1 ชม. ของโซนนั้น (คิดราคาโปรด้วยถ้ามี) */
export function freeHourValue(zone: Zone, promotion?: Promotion | null): number {
  const p = promotion ? getZonePrice(zone, promotion) : null;
  return p ? Number(p.hour) : calcPrice(zone, 1, null);
}

export function summarizeCheckout(
  r: Reservation,
  promotion?: Promotion | null,
  freeHourDiscount = 0,
): CheckoutSummary {
  const duration = Number(r.total_hours);
  const override = promotion ? getZonePrice(r.zone, promotion) : null;
  const machinePrice = calcPrice(r.zone, duration, override);
  const foodPrice = Number(r.food_revenue);
  const advCash = Number(r.advance_cash);
  const advTransfer = Number(r.advance_transfer);
  // ส่วนลดแต้มหักได้ไม่เกินค่าเครื่อง (ไม่เอาไปหักค่าอาหาร)
  const discount = Math.min(Math.max(freeHourDiscount, 0), machinePrice);
  const totalDue = machinePrice + foodPrice - discount;
  const remaining = Math.max(0, totalDue - advCash - advTransfer);
  return {
    duration_hours: duration,
    machine_price: machinePrice,
    food_price: foodPrice,
    advance_cash: advCash,
    advance_transfer: advTransfer,
    points_discount: discount,
    total_due: totalDue,
    remaining,
    promotion_applied: promotion ? { id: promotion.id, name: promotion.name } : null,
  };
}

export interface CheckoutResult {
  pointsEarned: number;
  pointsSpent: number;
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const r = input.reservation;
  const memberId = input.member?.id ?? r.member_id ?? null;

  // 1) แลกแต้ม — ขั้นนี้ล้มเหลวได้ (แต้มไม่พอ) จึงต้องทำก่อนปิดบิล
  //
  // บิลที่แลกแต้มไปแล้วตั้งแต่ตอนเปิดเครื่อง จะมี points_spent ติดมากับบิล
  // ต้องให้ส่วนลดต่อ (ไม่งั้นตอนปิดบิลจะคิดเงินเต็มอีกรอบ) และห้ามหักแต้มซ้ำ
  const spentAtStart = Number(r.points_spent) || 0;
  let pointsSpent = spentAtStart;
  let discount = spentAtStart > 0 ? Number(r.points_discount) || 0 : 0;

  if (input.useFreeHour && memberId && spentAtStart === 0) {
    const res = await redeemFreeHour({ memberId, zone: r.zone, reservationId: r.id });
    if (!res.ok) throw new Error(res.message || "ใช้แต้มไม่สำเร็จ");
    pointsSpent = Number(res.cost) || 0;
    discount = freeHourValue(r.zone, input.promotion ?? null);
  }

  const s = summarizeCheckout(r, input.promotion ?? null, discount);

  // 2) ให้แต้มตามเวลาเล่น (ฐานข้อมูลกันให้ซ้ำจากบิลเดียวกันอยู่แล้ว)
  let pointsEarned = 0;
  if (memberId) {
    try {
      pointsEarned = await awardPoints({
        memberId,
        zone: r.zone,
        hours: s.duration_hours,
        reservationId: r.id,
      });
    } catch (e) {
      // ให้แต้มไม่สำเร็จต้องไม่ทำให้ปิดบิลไม่ได้ — แก้ด้วยมือทีหลังได้
      console.error("[billing] award points failed:", e);
    }
  }

  // 3) บันทึกบิล
  const { error: logErr } = await supabase.from("billing_logs").insert({
    reservation_id: r.id,
    zone: r.zone,
    machine_number: r.machine_number,
    customer_name: r.customer_name,
    duration_hours: s.duration_hours,
    machine_price: s.machine_price,
    food_price: s.food_price,
    advance_cash: s.advance_cash,
    advance_transfer: s.advance_transfer,
    final_cash: input.finalCash,
    final_transfer: input.finalTransfer,
    redeemed_points: input.redeemedPoints ?? false,
    member_id: memberId,
    points_earned: pointsEarned,
    points_discount: s.points_discount,
  });
  if (logErr) throw logErr;

  const { error: resErr } = await supabase
    .from("reservations")
    .update({ status: "completed", member_id: memberId, updated_at: new Date().toISOString() })
    .eq("id", r.id);
  if (resErr) throw resErr;

  await resetMachineToIdle(input.machineId);

  // แจ้งเตือน LINE — ห้ามให้ล้มเหลวแล้วกระทบการปิดบิล
  void (async () => {
    const member = memberId ? await getMember(memberId).catch(() => null) : null;
    await notifyLine(
      "checkout",
      buildCheckoutMessage({
        zone: r.zone,
        machineNumber: r.machine_number,
        customerName: r.customer_name,
        hours: s.duration_hours,
        machinePrice: s.machine_price,
        foodPrice: s.food_price,
        productPrice: input.productTotal ?? 0,
        pointsDiscount: s.points_discount,
        total: s.total_due + (input.productTotal ?? 0),
        cash: s.advance_cash + input.finalCash,
        transfer: s.advance_transfer + input.finalTransfer,
        redeemedPoints: input.redeemedPoints ?? false,
        memberName: member?.name ?? null,
        pointsEarned,
        pointsBalance: member?.points ?? null,
      }),
    );
  })();

  return { pointsEarned, pointsSpent };
}

export async function listBillingByDate(date: string) {
  const { data, error } = await supabase
    .from("billing_logs")
    .select("*")
    .eq("checkout_date", date)
    .order("checkout_time", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listBillingByDateRange(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from("billing_logs")
    .select("*")
    .gte("checkout_date", startDate)
    .lte("checkout_date", endDate)
    .order("checkout_date", { ascending: false })
    .order("checkout_time", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
