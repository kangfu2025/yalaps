import { supabase } from "./supabase";

/**
 * ตรวจเงินเข้าอัตโนมัติ (PlernPay)
 *
 * ลำดับการทำงาน:
 *   1. ขอ QR ที่มี "ยอดไม่ซ้ำใคร" จากเซิร์ฟเวอร์เรา (เซิร์ฟเวอร์คุยกับ PlernPay)
 *   2. โชว์ QR + ยอดที่ต้องโอนให้ลูกค้าสแกน
 *   3. ฟัง SSE เพื่อให้หน้าจอตอบสนองไว
 *   4. *** พอ SSE บอกว่าเงินเข้า ต้องวิ่งไปถามเซิร์ฟเวอร์เราอีกที ***
 *      ห้ามเชื่อ SSE ตรง ๆ เพราะเปิด DevTools ปลอม event ได้
 *      เซิร์ฟเวอร์เท่านั้นที่ถือ client_secret และตัดสินว่าเงินเข้าจริง
 */

export interface PayWatchCreated {
  ok: true;
  ref: string;
  amount: number;
  uniqueAmount: number;
  qrCode: string;
  expiresAt: string | null;
  /** client_id ของ PlernPay (เปิดเผยได้) ใช้ต่อ SSE จากเบราว์เซอร์ */
  clientId: string;
  /** เลขพร้อมเพย์ปลายทางที่เงินจะเข้า — ต้องเป็นของร้านเสมอ */
  promptpayId?: string | null;
}

export interface PayWatchFailed {
  ok: false;
  code?: string;
  status?: string;
  error: string;
  httpStatus?: number;
  server?: { host: string; isLocal: boolean };
  debug?: unknown;
}

export interface PayWatchConfirmed {
  ok: true;
  status: "confirmed";
  amount: number;
  uniqueAmount: number;
  bank?: string | null;
  confirmedAt?: string;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("ยังไม่ได้ล็อกอิน");
  const res = await fetch("/api/pay-watch", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export interface CreateInput {
  amount: number;
  memo?: string;
  zone?: string;
  machineNumber?: number;
  reservationId?: string | null;
  pcSessionId?: string | null;
  productSaleId?: string | null;
}

export function createPayWatch(input: CreateInput) {
  return call<PayWatchCreated | PayWatchFailed>({ action: "create", ...input });
}

/** ยืนยันกับเซิร์ฟเวอร์ว่าเงินเข้าจริง — ที่เดียวที่เชื่อได้ */
export function confirmPayWatch(ref: string) {
  return call<PayWatchConfirmed | PayWatchFailed>({ action: "confirm", ref });
}

export function cancelPayWatch(ref: string) {
  return call<{ ok: boolean }>({ action: "cancel", ref }).catch(() => ({ ok: false }));
}

export function pingPayWatch() {
  return call<
    | { ok: true; server?: { host: string; isLocal: boolean }; clientId?: string; note?: string }
    | PayWatchFailed
  >({ action: "ping" });
}

/** เปิดใช้ระบบตรวจเงินเข้าหรือยัง (เก็บใน store_settings) */
let _enabledCache: boolean | null = null;
export async function payWatchEnabled(force = false): Promise<boolean> {
  if (_enabledCache !== null && !force) return _enabledCache;
  try {
    const { data, error } = await supabase
      .from("store_settings")
      .select("value")
      .eq("key", "paywatch_enabled")
      .maybeSingle();
    if (error) throw error;
    _enabledCache = String(data?.value ?? "false").toLowerCase() === "true";
  } catch {
    // ยังไม่ได้รัน migration หรืออ่านไม่ได้ = ถือว่าปิด ระบบเดิมทำงานต่อได้ตามปกติ
    _enabledCache = false;
  }
  return _enabledCache;
}

export async function setPayWatchEnabled(on: boolean): Promise<void> {
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: "paywatch_enabled", value: on ? "true" : "false" }, { onConflict: "key" });
  if (error) throw error;
  _enabledCache = on;
}

/**
 * ฟังสถานะแบบเรียลไทม์จาก PlernPay
 *
 * client_id เปิดเผยได้ตามเอกสารของเขา จึงให้เบราว์เซอร์ต่อตรงได้
 * แต่ย้ำอีกครั้ง: ผลจากตรงนี้ใช้แค่ "กระตุ้นให้ไปถามเซิร์ฟเวอร์" เท่านั้น
 *
 * คืนฟังก์ชันสำหรับปิดการเชื่อมต่อ
 */
export function watchPayment(
  ref: string,
  clientId: string,
  onHint: () => void,
  onError?: (msg: string) => void,
  onExpired?: () => void,
): () => void {
  if (typeof EventSource === "undefined") return () => {};
  let es: EventSource | null = null;
  try {
    es = new EventSource(
      `https://api.plernpay.com/v1/topup/${encodeURIComponent(ref)}/stream?client_id=${encodeURIComponent(clientId)}`,
    );
  } catch (e) {
    onError?.(e instanceof Error ? e.message : String(e));
    return () => {};
  }

  const hint = () => onHint();
  es.addEventListener("confirmed", hint);
  // ช่องทางหลักตามตัวอย่างในเอกสาร: message ธรรมดาที่มี status อยู่ข้างใน
  es.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    try {
      const d = JSON.parse(ev.data) as { status?: string };
      if (d.status === "confirmed") hint();
      else if (d.status === "expired") onExpired?.();
    } catch {
      // อ่าน JSON ไม่ออก ก็ดูจากข้อความดิบแทน ดีกว่าพลาดสัญญาณไปเฉย ๆ
      if (ev.data.includes("confirmed")) hint();
    }
  };
  es.onerror = () => {
    // SSE หลุดไม่ใช่เรื่องใหญ่ ตัวจับเวลาฝั่งเรียกใช้จะถามเซิร์ฟเวอร์เป็นระยะอยู่แล้ว
    onError?.("การเชื่อมต่อแบบเรียลไทม์หลุด — ระบบจะถามเป็นระยะแทน");
  };

  return () => {
    try {
      es?.removeEventListener("confirmed", hint);
      es?.close();
    } catch {
      /* ปิดไม่ได้ก็ปล่อย */
    }
  };
}
