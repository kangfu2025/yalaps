import { supabase, type Reservation, type Zone } from "./supabase";
import { markMachinePlaying, resetMachineToIdle } from "./machines";

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
  const { data, error } = await supabase.from("reservations").select("*").eq("id", id).maybeSingle();
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
}

export async function startSession(input: StartSessionInput): Promise<Reservation> {
  const now = new Date();
  const endMs = now.getTime() + input.baseHours * 3600 * 1000;

  const { data, error } = await supabase
    .from("reservations")
    .insert({
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
    })
    .select()
    .single();
  if (error) throw error;

  await markMachinePlaying(input.machineId, data.id);
  return data as Reservation;
}

export async function extendTime(reservation: Reservation, addHours: number, addCash: number, addTransfer: number) {
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
}

/** ผูก (หรือถอด) สมาชิกกับบิลที่กำลังเล่นอยู่ — ใช้ตอนลูกค้าเพิ่งแจ้งเบอร์ตอนเช็คบิล */
export async function setReservationMember(reservationId: string, memberId: string | null) {
  const { error } = await supabase
    .from("reservations")
    .update({ member_id: memberId, updated_at: new Date().toISOString() })
    .eq("id", reservationId);
  if (error) throw error;
}

export async function addFood(reservation: Reservation, amount: number, cash: number, transfer: number) {
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
  await cancelSalesForBill({ reservationId }).catch((e) => console.warn("[cancel] product sales:", e));
  const { error } = await supabase
    .from("reservations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", reservationId);
  if (error) throw error;
  await resetMachineToIdle(machineId);
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
  const { error } = await supabase.from("reservations").delete().eq("id", id).eq("status", "scheduled");
  if (error) throw error;
}
