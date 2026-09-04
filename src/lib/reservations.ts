import { supabase, type Reservation, type Zone } from "./supabase";
import { markMachinePlaying, resetMachineToIdle } from "./machines";
import { notifyLine } from "./lineNotify";
import { buildStartMessage, buildExtendMessage, buildCancelMessage } from "./lineMessages";
import { getMember, redeemFreeHour, refundPoints } from "./members";

export async function getActiveReservation(machineId: string): Promise<Reservation | null> {
  // ค้นจาก machines.current_reservation_id ก่อน เพื่อความถูกต้อง
  const { data: m, error: mErr } = await supabase
    .from("machines")
    .select("current_reservation_id")
    .eq("id", machineId)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!m?.current_reservation_id) return null;
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", m.current_reservation_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getReservationById(id: string): Promise<Reservation | null> {
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface StartSessionInput {
  machineId: string;
  zone: Zone;
  machineNumber: number;
  customerName: string;
  baseHours: number;
  advanceCash: number;
  advanceTransfer: number;
  memberId?: string | null;
  /** ลูกค้าใช้แต้มแลกเล่นฟรี 1 ชม. ตั้งแต่ตอนเปิดเครื่อง */
  useFreeHour?: boolean;
  /** มูลค่าส่วนลด 1 ชม. ของโซนนี้ (บาท) — ผู้เรียกคำนวณมาแล้วเพราะรู้ราคาโปรด้วย */
  freeHourValue?: number;
}

export async function startSession(input: StartSessionInput): Promise<Reservation> {
  const now = new Date();
  const endMs = now.getTime() + input.baseHours * 3600 * 1000;

  // หักแต้มก่อนสร้างบิล — ขั้นนี้ล้มเหลวได้ (แต้มไม่พอ / โซนแลกไม่ได้)
  // ถ้าล้มที่นี่ยังไม่มีอะไรถูกสร้าง พนักงานเก็บเงินเต็มแล้วเปิดใหม่ได้เลย
  let pointsSpent = 0;
  let pointsDiscount = 0;
  if (input.useFreeHour && input.memberId) {
    const res = await redeemFreeHour({ memberId: input.memberId, zone: input.zone });
    if (!res.ok) throw new Error(res.message || "ใช้แต้มไม่สำเร็จ");
    pointsSpent = Number(res.cost) || 0;
    pointsDiscount = Math.max(0, Number(input.freeHourValue) || 0);
  }

  const row: Record<string, unknown> = {
    zone: input.zone,
    machine_number: input.machineNumber,
    customer_name: input.customerName,
    base_hours: input.baseHours,
    extended_hours: 0,
    advance_cash: input.advanceCash,
    advance_transfer: input.advanceTransfer,
    food_revenue: 0,
    status: "playing",
    start_time: now.toISOString(),
    end_time_ms: endMs,
    member_id: input.memberId ?? null,
  };
  // ใส่สองคอลัมน์นี้เฉพาะตอนแลกแต้มจริง ๆ
  // ร้านที่ยังไม่ได้รัน points_start_redeem_migration.sql จะยังเปิดเครื่องปกติได้
  if (pointsSpent > 0) {
    row.points_discount = pointsDiscount;
    row.points_spent = pointsSpent;
  }

  const { data, error } = await supabase.from("reservations").insert(row).select().single();
  // หักแต้มไปแล้วแต่สร้างบิลไม่ได้ -> คืนแต้มให้ก่อน ไม่งั้นลูกค้าเสียแต้มฟรี
  if (error) {
    if (pointsSpent > 0 && input.memberId) {
      await refundPoints(input.memberId, pointsSpent, "คืนแต้ม — เปิดเครื่องไม่สำเร็จ");
      const code = (error as { code?: string }).code ?? "";
      if (code === "42703" || code === "PGRST204") {
        throw new Error(
          "ยังไม่ได้เตรียมฐานข้อมูลสำหรับแลกแต้มตอนเปิดเครื่อง — เปิด Supabase SQL Editor แล้วรัน supabase/points_start_redeem_migration.sql (คืนแต้มให้ลูกค้าแล้ว)",
        );
      }
    }
    throw error;
  }

  await markMachinePlaying(input.machineId, data.id);

  // แจ้งเตือน LINE — ห้ามให้ล้มเหลวแล้วกระทบการเปิดเครื่อง
  void (async () => {
    const member = input.memberId ? await getMember(input.memberId).catch(() => null) : null;
    await notifyLine(
      "start",
      buildStartMessage({
        zone: input.zone,
        machineNumber: input.machineNumber,
        customerName: input.customerName,
        hours: input.baseHours,
        price: input.advanceCash + input.advanceTransfer,
        cash: input.advanceCash,
        transfer: input.advanceTransfer,
        memberName: member?.name ?? null,
        memberPoints: member?.points ?? null,
        pointsSpent,
        pointsDiscount,
        endAt: endMs,
      }),
    );
  })();

  return data as Reservation;
}

export async function extendTime(
  reservation: Reservation,
  addHours: number,
  addCash: number,
  addTransfer: number,
) {
  const newExt = Number(reservation.extended_hours) + addHours;
  const newEndMs = (reservation.end_time_ms ?? Date.now()) + addHours * 3600 * 1000;
  const { error } = await supabase
    .from("reservations")
    .update({
      extended_hours: newExt,
      end_time_ms: newEndMs,
      advance_cash: Number(reservation.advance_cash) + addCash,
      advance_transfer: Number(reservation.advance_transfer) + addTransfer,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservation.id);
  if (error) throw error;

  void notifyLine(
    "extend",
    buildExtendMessage({
      zone: reservation.zone,
      machineNumber: reservation.machine_number,
      customerName: reservation.customer_name,
      addHours,
      price: addCash + addTransfer,
      cash: addCash,
      transfer: addTransfer,
      totalHours: Number(reservation.total_hours) + addHours,
    }),
  );
}

/** ผูก (หรือถอด) สมาชิกกับบิลที่กำลังเล่นอยู่ — ใช้ตอนลูกค้าเพิ่งแจ้งเบอร์ตอนเช็คบิล */
export async function setReservationMember(reservationId: string, memberId: string | null) {
  const { error } = await supabase
    .from("reservations")
    .update({ member_id: memberId, updated_at: new Date().toISOString() })
    .eq("id", reservationId);
  if (error) throw error;
}

export async function addFood(
  reservation: Reservation,
  amount: number,
  cash: number,
  transfer: number,
) {
  const { error } = await supabase
    .from("reservations")
    .update({
      food_revenue: Number(reservation.food_revenue) + amount,
      advance_cash: Number(reservation.advance_cash) + cash,
      advance_transfer: Number(reservation.advance_transfer) + transfer,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservation.id);
  if (error) throw error;
}

/** ยกเลิกบิล: UPDATE เป็น cancelled + reset machine (ห้าม DELETE) */
export async function cancelReservation(machineId: string, reservationId: string) {
  const { cancelSalesForBill } = await import("./products");
  await cancelSalesForBill({ reservationId }).catch((e) =>
    console.warn("[cancel] product sales:", e),
  );
  const { error } = await supabase
    .from("reservations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", reservationId);
  if (error) throw error;
  await resetMachineToIdle(machineId);

  const r = await getReservationById(reservationId).catch(() => null);
  if (r) {
    void notifyLine(
      "cancel",
      buildCancelMessage({
        zone: r.zone,
        machineNumber: r.machine_number,
        customerName: r.customer_name,
      }),
    );
  }
}

// ============== จองล่วงหน้า ==============

export async function listScheduledReservations(): Promise<Reservation[]> {
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createScheduledReservation(input: {
  zone: Zone;
  machineNumber: number;
  customerName: string;
  customerPhone: string;
  scheduledAt: Date;
  baseHours: number;
}) {
  const { data, error } = await supabase
    .from("reservations")
    .insert({
      zone: input.zone,
      machine_number: input.machineNumber,
      customer_name: input.customerName,
      customer_phone: input.customerPhone,
      scheduled_at: input.scheduledAt.toISOString(),
      base_hours: input.baseHours,
      status: "scheduled",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteScheduledReservation(id: string) {
  // เฉพาะคิวจอง (ยังไม่เริ่มเล่น) ลบทิ้งได้
  const { error } = await supabase
    .from("reservations")
    .delete()
    .eq("id", id)
    .eq("status", "scheduled");
  if (error) throw error;
}
