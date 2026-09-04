import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://teyvwnnrchjnffyjtljl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRleXZ3bm5yY2hqbmZmeWp0bGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODMzOTQsImV4cCI6MjA5Njc1OTM5NH0.rykYOT9NS4LLgvbjqpoAMuBqMEeX9_aivlfCa_77xo8";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "yala-auth",
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

export type Zone = "sofa" | "racing" | "pc";
export type MachineStatus = "idle" | "playing";

export type CouponStatus = "active" | "in_use" | "expired" | "depleted" | "cancelled";

export interface Coupon {
  id: string;
  code: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_minutes: number;
  remaining_minutes: number;
  price_paid: number;
  paid_cash: number;
  paid_transfer: number;
  paid_at: string;
  expires_at: string | null;
  status: CouponStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type PcCommandType =
  "lock" | "unlock" | "warn" | "shutdown" | "show_countdown" | "end_session";
export type PcSessionStatus = "playing" | "ended" | "force_ended" | "cancelled";

export interface PcSession {
  id: string;
  machine_id: string;
  coupon_id: string | null;
  customer_name: string | null;
  minutes_purchased: number;
  price: number;
  started_at: string;
  ends_at: string;
  ended_at: string | null;
  minutes_used: number;
  status: PcSessionStatus;
  member_id: string | null;
  points_earned: number;
  paid_cash: number;
  paid_transfer: number;
  redeemed_points: boolean;
  food_amount: number;
  created_at: string;
}

export interface PcCommand {
  id: string;
  machine_id: string;
  type: PcCommandType;
  payload: Record<string, unknown>;
  created_at: string;
  ack_at: string | null;
}

export interface PcAgent {
  machine_id: string;
  agent_version: string | null;
  last_heartbeat: string;
  is_locked: boolean;
  current_session_id: string | null;
  updated_at: string;
}
export type ReservationStatus = "scheduled" | "playing" | "completed" | "cancelled";

export interface Machine {
  id: string;
  zone: Zone;
  machine_number: number;
  status: MachineStatus;
  current_reservation_id: string | null;
  updated_at: string;
}

export interface Reservation {
  id: string;
  zone: Zone;
  machine_number: number;
  customer_name: string;
  customer_phone: string | null;
  status: ReservationStatus;
  scheduled_at: string | null;
  base_hours: number;
  extended_hours: number;
  total_hours: number;
  advance_cash: number;
  advance_transfer: number;
  food_revenue: number;
  start_time: string | null;
  end_time_ms: number | null;
  member_id: string | null;
  /** ส่วนลด (บาท) จากการแลกแต้มตอนเปิดเครื่อง — 0 = ยังไม่ได้แลก */
  points_discount?: number;
  /** แต้มที่หักไปกับบิลนี้ */
  points_spent?: number;
  created_at: string;
  updated_at: string;
}

export interface BillingLog {
  id: string;
  reservation_id: string | null;
  checkout_date: string;
  checkout_time: string;
  zone: Zone;
  machine_number: number;
  customer_name: string;
  duration_hours: number;
  machine_price: number;
  food_price: number;
  advance_cash: number;
  advance_transfer: number;
  final_cash: number;
  final_transfer: number;
  redeemed_points?: boolean;
  member_id?: string | null;
  points_earned?: number;
  points_discount?: number;
  created_at: string;
}

export type AppRole = "admin" | "staff";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}
