import { supabase } from "./supabase";
import { buildPromptpayDataUrl, PROMPTPAY_ID } from "./promptpay";

export type PaymentMethod = "cash" | "transfer" | "promptpay" | "mixed" | "credit";

export type ChargeType = "start" | "extend" | "food" | "checkout";

/**
 * ข้อมูลสมาชิกที่ส่งไปโชว์บนจอลูกค้า
 *
 * ส่งเฉพาะที่ลูกค้าควรเห็นตอนยืนอยู่หน้าเคาน์เตอร์ — ไม่ส่งเบอร์โทรหรือ id
 * เพราะจอนี้หันออกหน้าร้าน คนอื่นที่เดินผ่านก็เห็นด้วย
 */
export interface DisplayMember {
  name: string;
  /** แต้มคงเหลือตอนนี้ (หักแต้มที่เพิ่งแลกไปแล้ว) */
  points: number;
  /** มาเล่นมาแล้วกี่ครั้ง */
  visits?: number;
  /** บิลนี้จะได้แต้มเพิ่มอีกเท่าไหร่เมื่อปิดบิล */
  will_earn?: number;
  /** ใช้กี่แต้มถึงแลกเล่นฟรี 1 ชม. ได้ */
  redeem_cost?: number;
  /** บิลนี้แลกแต้มเล่นฟรีไปแล้ว */
  redeeming?: boolean;
  /** โซนนี้แลกแต้มได้ไหม (โซน PC แลกไม่ได้) */
  zone_redeemable?: boolean;
}

export interface DisplayPayload {
  /** join = โชว์ QR สมัครสมาชิกเต็มจอ · join_done = โชว์ "ยินดีต้อนรับ" ก่อนปิดกลับโหมดปกติ */
  kind: "idle" | "start" | "manage" | "join" | "join_done" | "slip_scan" | "slip_result";

  zone?: string;
  machine_number?: number;
  customer_name?: string;

  start_time?: string; // "HH:MM"
  end_time?: string; // "HH:MM"

  play_hours?: number;
  food_amount?: number;
  amount?: number;

  // รายละเอียดของรายการที่กำลังชำระ (ให้หน้า /display แสดง breakdown)
  charge_type?: ChargeType;
  extend_hours?: number; // ชั่วโมงที่ต่อเวลา (เฉพาะ extend)
  food_charge?: number; // ค่าอาหารในรายการนี้ (เฉพาะ food)

  payment_method?: PaymentMethod;
  promptpay_number?: string;
  qr_image_url?: string; // public PNG URL of PromptPay QR (for ESP32 to download)
  qr_code?: string; // data URL of QR image (legacy, used by /display page)
  qr?: string; // legacy: amount as string

  message?: string;

  /** สมาชิกที่ผูกกับรายการนี้ — ไม่มีค่า = ลูกค้าทั่วไป */
  member?: DisplayMember;

  // ---- ตรวจสลิปด้วยกล้องหน้าร้าน ----
  slip_request_id?: string;
  slip_amount?: number;
  slip_ok?: boolean;
  slip_message?: string;
}

function buildPromptpayImageUrl(promptpayNumber: string, amount: number): string {
  // promptpay.io returns a real PNG that ESP32 can download directly
  return `https://promptpay.io/${encodeURIComponent(promptpayNumber)}/${amount.toFixed(2)}.png`;
}

function toHHMM(input: string | number | Date | null | undefined): string | undefined {
  if (!input) return undefined;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export async function pushDisplay(input: DisplayPayload) {
  const payload: DisplayPayload = { ...input };

  // Auto-attach promptpay number whenever a payment_method is provided
  if (payload.payment_method && !payload.promptpay_number) {
    payload.promptpay_number = PROMPTPAY_ID;
  }

  // Generate QR image URL (data URL) for promptpay/transfer/mixed when amount > 0
  const wantsQr =
    payload.payment_method === "promptpay" ||
    payload.payment_method === "transfer" ||
    payload.payment_method === "mixed";
  const amt = Number(payload.amount) || 0;
  if (wantsQr && amt > 0) {
    const ppNumber = payload.promptpay_number || PROMPTPAY_ID;
    if (!payload.qr_image_url) {
      payload.qr_image_url = buildPromptpayImageUrl(ppNumber, amt);
    }
    if (!payload.qr_code) {
      try {
        payload.qr_code = await buildPromptpayDataUrl(amt);
      } catch (e) {
        console.error("buildPromptpayDataUrl failed", e);
      }
    }
    if (!payload.qr) payload.qr = String(amt);
  }

  const { error } = await supabase
    .from("customer_display")
    .update({ payload, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) console.error(error);
}

export async function clearDisplay() {
  return pushDisplay({ kind: "idle" });
}

/** สั่งจอลูกค้าเปิดกล้องให้ลูกค้าโชว์ QR บนสลิป */
export async function showSlipScanScreen(requestId: string, amount: number) {
  return pushDisplay({ kind: "slip_scan", slip_request_id: requestId, slip_amount: amount });
}

/** แสดงผลตรวจสลิปบนจอลูกค้า */
export async function showSlipResultScreen(ok: boolean, message: string, amount?: number) {
  return pushDisplay({
    kind: "slip_result",
    slip_ok: ok,
    slip_message: message,
    slip_amount: amount,
  });
}

/** พนักงานสั่งขึ้นหน้า QR สมัครสมาชิกเต็มจอบนจอลูกค้า */
export async function showJoinScreen() {
  return pushDisplay({ kind: "join" });
}

/** อ่านสถานะจอลูกค้าตอนนี้ (ใช้ให้ปุ่มในหน้าแอดมินรู้ว่ากำลังโชว์ QR อยู่ไหม) */
export async function readDisplayKind(): Promise<DisplayPayload["kind"]> {
  const { data } = await supabase
    .from("customer_display")
    .select("payload")
    .eq("id", 1)
    .maybeSingle();
  const payload = (data?.payload ?? {}) as DisplayPayload;
  return payload.kind ?? "idle";
}

export { toHHMM };
