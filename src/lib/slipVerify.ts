import { supabase } from "./supabase";

export interface SlipInfo {
  transRef: string | null;
  amount: number;
  date: string | null;
  senderName: string | null;
  senderBank: string | null;
  receiverName: string | null;
  receiverBank: string | null;
}

export interface SlipVerifyResult {
  ok: boolean;
  status?: "verified" | "amount_mismatch" | "duplicate" | "failed";
  slip?: SlipInfo;
  expectedAmount?: number;
  error?: string;
  code?: string;
  /** true = ยังไม่ถึงคิวธนาคาร ลองใหม่ได้ */
  retryable?: boolean;
  /** คำตอบดิบจาก EasySlip — ใช้ตอนมีปัญหาเท่านั้น */
  debug?: unknown;
  /** ข้อความที่อ่านได้จากสลิปจริง ๆ ที่ส่งไปตรวจ — ใช้ไล่ปัญหาเครื่องสแกน */
  scanned?: string;
  /** เวลาที่รอ EasySlip (มิลลิวินาที) */
  latencyMs?: number;
  previous?: {
    created_at: string;
    expected_amount: number;
    reservation_id: string | null;
    pc_session_id: string | null;
  } | null;
}

export interface SlipVerifyInput {
  /** ข้อความจาก QR บนสลิป (แม่นที่สุด ใช้โควตาเท่ากัน) */
  payload?: string;
  /** รูปสลิปเป็น data URL — ใช้เมื่อสแกน QR ไม่ได้ */
  imageBase64?: string;
  expectedAmount: number;
  reservationId?: string | null;
  pcSessionId?: string | null;
  productSaleId?: string | null;
  note?: string | null;
}

/** ส่งสลิปไปตรวจที่เซิร์ฟเวอร์ของเราเอง (API key ไม่เคยออกมาถึงเบราว์เซอร์) */
export async function verifySlip(input: SlipVerifyInput): Promise<SlipVerifyResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, status: "failed", error: "กรุณาเข้าสู่ระบบใหม่" };

  const res = await fetch("/api/verify-slip", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  let body: SlipVerifyResult & { error?: string };
  try {
    body = (await res.json()) as SlipVerifyResult;
  } catch {
    return { ok: false, status: "failed", error: `ตรวจสลิปไม่สำเร็จ (HTTP ${res.status})` };
  }
  if (!res.ok && !body.status) {
    return {
      ok: false,
      status: "failed",
      error: body.error ?? `ตรวจสลิปไม่สำเร็จ (HTTP ${res.status})`,
    };
  }
  return body;
}

export interface SlipVerification {
  id: string;
  trans_ref: string;
  status: "verified" | "amount_mismatch" | "duplicate" | "failed";
  amount: number;
  expected_amount: number;
  amount_matched: boolean;
  slip_date: string | null;
  sender_name: string | null;
  sender_bank: string | null;
  receiver_name: string | null;
  receiver_bank: string | null;
  reservation_id: string | null;
  pc_session_id: string | null;
  created_at: string;
}

/** สลิปที่ตรวจผ่านแล้วของบิลนี้ */
export async function listSlipsForBill(opts: {
  reservationId?: string | null;
  pcSessionId?: string | null;
}): Promise<SlipVerification[]> {
  let q = supabase.from("slip_verifications").select("*").order("created_at", { ascending: false });
  if (opts.reservationId) q = q.eq("reservation_id", opts.reservationId);
  else if (opts.pcSessionId) q = q.eq("pc_session_id", opts.pcSessionId);
  else return [];
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SlipVerification[];
}

/** ตารางพร้อมใช้งานหรือยัง (ยังไม่ได้รัน slip_migration.sql = false) */
export async function slipsReady(): Promise<boolean> {
  try {
    const { error } = await supabase.from("slip_verifications").select("id").limit(1);
    if (error) throw error;
    return true;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code ?? "";
    const msg = e instanceof Error ? e.message : String(e ?? "");
    if (code === "PGRST205" || code === "42P01" || /Could not find the table/i.test(msg))
      return false;
    return true;
  }
}

export interface SlipStatus {
  hasKey: boolean;
  ok: boolean;
  latencyMs?: number;
  httpStatus?: number;
  error?: string;
  info?: unknown;
  debug?: unknown;
}

/** ตรวจว่าเซิร์ฟเวอร์ต่อ EasySlip ได้ไหม — ไม่เปลืองโควตาตรวจสลิป */
export async function checkSlipStatus(): Promise<SlipStatus> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { hasKey: false, ok: false, error: "กรุณาเข้าสู่ระบบใหม่" };

  const res = await fetch("/api/slip-status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  try {
    return (await res.json()) as SlipStatus;
  } catch {
    return { hasKey: false, ok: false, error: `ตรวจไม่สำเร็จ (HTTP ${res.status})` };
  }
}
