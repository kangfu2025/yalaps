import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { classifySlipPayload, type SlipPayloadCheck } from "@/lib/slipPayload";

/**
 * ตรวจสลิปโอนเงินผ่าน EasySlip
 *
 * API key อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น (env: EASYSLIP_API_KEY)
 * ห้ามย้ายไปฝั่ง client เด็ดขาด ไม่งั้นใครเปิด DevTools ก็เอา key ไปใช้จนโควตาหมดได้
 */

const SUPABASE_URL = "https://teyvwnnrchjnffyjtljl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRleXZ3bm5yY2hqbmZmeWp0bGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODMzOTQsImV4cCI6MjA5Njc1OTM5NH0.rykYOT9NS4LLgvbjqpoAMuBqMEeX9_aivlfCa_77xo8";

const EASYSLIP_ENDPOINT = "https://api.easyslip.com/v2/verify/bank";

/** ยอมรับความคลาดเคลื่อนของยอดได้ 1 สตางค์ (ปัดเศษของธนาคาร) */
const AMOUNT_TOLERANCE = 1; // satang
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** ไม่ให้พนักงานยืนรอไม่รู้จบถ้าเน็ตไปไม่ถึง EasySlip */
const EASYSLIP_TIMEOUT_MS = 15_000;

interface VerifyBody {
  /** ข้อความใน QR บนสลิป (ได้จากการสแกน) — ทางที่แม่นและถูกที่สุด */
  payload?: string;
  /** รูปสลิปเป็น base64 (data URL หรือ base64 ล้วน) — ใช้เมื่อสแกน QR ไม่ได้ */
  imageBase64?: string;
  expectedAmount: number;
  reservationId?: string | null;
  pcSessionId?: string | null;
  productSaleId?: string | null;
  note?: string | null;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function firstString(obj: unknown, paths: string[]): string | null {
  for (const p of paths) {
    const v = pick(obj, p);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function firstNumber(obj: unknown, paths: string[]): number | null {
  for (const p of paths) {
    const n = num(pick(obj, p));
    if (n !== null) return n;
  }
  return null;
}

/**
 * หา object ที่เก็บข้อมูลสลิปจริง ๆ
 *
 * v2 ตอบเป็น { success, data: { rawSlip: {...} } }  <-- ข้อมูลอยู่ลึกอีกชั้น
 * v1 ตอบเป็น { status, data: {...} }
 * เผื่อไว้ทั้งสองแบบและแบบที่ยัดมาที่ root เลย
 */
function slipRoot(body: Record<string, unknown>): unknown {
  const data = body.data as Record<string, unknown> | undefined;
  if (data && typeof data === "object") {
    if (data.rawSlip && typeof data.rawSlip === "object") return data.rawSlip;
    return data;
  }
  return body;
}

/**
 * EasySlip เคยปรับรูปแบบ response ระหว่างเวอร์ชัน จึงอ่านแบบเผื่อไว้หลายทาง
 * ดีกว่าผูกกับ path เดียวแล้ววันหนึ่งพังเงียบ ๆ
 */
function normalize(data: unknown) {
  return {
    transRef: firstString(data, ["transRef", "reference", "transactionId", "ref1"]),
    amount: firstNumber(data, ["amount.amount", "amount.local.amount", "amount", "amountInSlip"]),
    date: firstString(data, ["date", "transactionDate", "transDate"]),
    senderName: firstString(data, [
      "sender.account.name.th",
      "sender.account.name.en",
      "sender.name.th",
      "sender.name",
    ]),
    senderBank: firstString(data, ["sender.bank.name", "sender.bank.nameTh", "sender.bank.short"]),
    receiverName: firstString(data, [
      "receiver.account.name.th",
      "receiver.account.name.en",
      "receiver.name.th",
      "receiver.name",
    ]),
    receiverBank: firstString(data, [
      "receiver.bank.name",
      "receiver.bank.nameTh",
      "receiver.bank.short",
    ]),
  };
}

/** v2: { success:false, error:{ code, message } } · v1: { status:4xx, message:"code" } */
function errorCode(body: Record<string, unknown>): string | null {
  const err = body.error;
  if (err && typeof err === "object") {
    const code = (err as Record<string, unknown>).code;
    if (typeof code === "string" && code) return code;
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === "string" && msg) return msg;
  }
  if (typeof err === "string" && err) return err;
  const status = Number(body.status);
  if (Number.isFinite(status) && status >= 400 && typeof body.message === "string") {
    return body.message;
  }
  if (body.success === false) return typeof body.message === "string" ? body.message : "API_SERVER_ERROR";
  return null;
}

const ERROR_TH: Record<string, string> = {
  MISSING_API_KEY: "ยังไม่ได้ตั้งค่า API key ของ EasySlip",
  INVALID_API_KEY: "API key ของ EasySlip ไม่ถูกต้อง",
  QUOTA_EXCEEDED: "โควตาตรวจสลิปของเดือนนี้หมดแล้ว",
  SLIP_NOT_FOUND: "ไม่พบรายการโอนนี้ในระบบธนาคาร — สลิปอาจเป็นของปลอม",
  SLIP_PENDING: "ธนาคารยังไม่บันทึกรายการนี้ รอสัก 10-30 วินาทีแล้วลองใหม่",
  slip_pending: "ธนาคารยังไม่บันทึกรายการนี้ รอสัก 10-30 วินาทีแล้วลองใหม่",
  slip_not_found: "ไม่พบรายการโอนนี้ในระบบธนาคาร — สลิปอาจเป็นของปลอม",
  qrcode_not_found: "อ่าน QR บนสลิปไม่ได้ ลองสแกนใหม่ให้ชัดขึ้น",
  VALIDATION_ERROR: "ข้อมูลที่ส่งไปไม่ถูกรูปแบบ",
  RATE_LIMIT_EXCEEDED: "เรียกถี่เกินไป รอสักครู่แล้วลองใหม่",
  IP_NOT_ALLOWED: "IP ของเซิร์ฟเวอร์ไม่อยู่ใน whitelist ของ EasySlip",
  ACCOUNT_NOT_VERIFIED: "บัญชี EasySlip ยังยืนยันตัวตนไม่ครบ",
  account_not_verified: "บัญชี EasySlip ยังยืนยันตัวตนไม่ครบ",
  application_expired: "แพ็กเกจ EasySlip หมดอายุ",
  API_SERVER_ERROR: "ระบบ EasySlip ขัดข้องชั่วคราว",
  INVALID_PAYLOAD: "อ่านข้อมูลจากสลิปไม่ได้ ลองสแกน QR บนสลิปใหม่อีกครั้ง",
  INVALID_IMAGE: "อ่านรูปสลิปไม่ได้ ลองถ่ายใหม่ให้เห็น QR ชัด ๆ",
  IMAGE_SIZE_TOO_LARGE: "ไฟล์รูปใหญ่เกินไป",
  SLIP_EXPIRED: "สลิปนี้เก่าเกินกว่าที่ธนาคารจะตรวจสอบได้",
};

export const Route = createFileRoute("/api/verify-slip")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ---------- 1) ต้องเป็นพนักงานที่ล็อกอินแล้วเท่านั้น ----------
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.toLowerCase().startsWith("bearer ")) {
          return json(401, { error: "unauthorized" });
        }
        const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData, error: userErr } = await db.auth.getUser();
        const user = userData?.user;
        if (userErr || !user) return json(401, { error: "unauthorized" });
        const { data: roles, error: roleError } = await db.from("user_roles")
          .select("role").eq("user_id", user.id);
        if (roleError || !roles?.some((r) => r.role === "admin" || r.role === "staff")) {
          return json(403, { ok: false, status: "failed", error: "เฉพาะพนักงานหรือผู้ดูแลระบบเท่านั้น" });
        }

        // ---------- 2) อ่าน request ----------
        let body: VerifyBody;
        try {
          body = (await request.json()) as VerifyBody;
        } catch {
          return json(400, { error: "bad request" });
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return json(400, { error: "bad request" });
        }
        const expected = body.expectedAmount;
        if (typeof expected !== "number" || !Number.isFinite(expected) || expected <= 0 || expected > 99999999.99) {
          return json(400, { error: "ยอดที่ต้องตรวจต้องเป็นตัวเลขมากกว่า 0" });
        }
        if ((body.payload != null && typeof body.payload !== "string") ||
            (body.imageBase64 != null && typeof body.imageBase64 !== "string") ||
            (!!body.payload === !!body.imageBase64)) {
          return json(400, { error: "ส่ง QR หรือรูปสลิปอย่างใดอย่างหนึ่งเท่านั้น" });
        }
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const links = [body.reservationId, body.pcSessionId, body.productSaleId].filter((v) => v != null);
        if (links.length > 1 || links.some((v) => typeof v !== "string" || !uuid.test(v)) ||
            (body.note != null && (typeof body.note !== "string" || body.note.length > 255))) {
          return json(400, { error: "ข้อมูลอ้างอิงบิลไม่ถูกต้อง" });
        }
        let imageBase64: string | undefined;
        if (body.imageBase64) {
          const value = body.imageBase64.trim();
          const dataUrl = /^data:image\/(jpeg|png|gif|webp);base64,/i;
          if (value.startsWith("data:") && !dataUrl.test(value)) {
            return json(400, { error: "รองรับรูป JPEG, PNG, GIF และ WebP เท่านั้น" });
          }
          imageBase64 = value.replace(dataUrl, "");
          if (!imageBase64 || imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
            return json(400, { error: "ข้อมูลรูปสลิปไม่ใช่ Base64 ที่ถูกต้อง" });
          }
          const bytes = imageBase64.length * 3 / 4 - (imageBase64.endsWith("==") ? 2 : imageBase64.endsWith("=") ? 1 : 0);
          if (bytes > MAX_IMAGE_BYTES) return json(413, { error: "รูปสลิปต้องไม่เกิน 4 MB" });
        }
        if (!body.payload && !body.imageBase64) {
          return json(400, { error: "ต้องส่ง payload จาก QR หรือรูปสลิปมาอย่างใดอย่างหนึ่ง" });
        }

        // ตรวจก่อนส่ง: QR ผิดอันจะโดน EasySlip ตีกลับเป็น VALIDATION_ERROR
        // แล้วเสียโควตาฟรี ๆ (แพ็กที่ใช้มี 250 สลิป/เดือน)
        // ตัวแยกแยะจะบล็อกเฉพาะกรณีที่มั่นใจว่ายิงผิดอันเท่านั้น
        // อย่างอื่นปล่อยผ่านให้ EasySlip ตัดสิน จะได้ไม่บล็อกสลิปจริงเพราะเดาผิด
        let scanKind: SlipPayloadCheck | null = null;
        if (body.payload) {
          const p = body.payload.trim();
          scanKind = classifySlipPayload(p);
          if (scanKind.normalized.length > 128) {
            return json(400, { error: "ข้อความ QR ยาวเกินรูปแบบที่ EasySlip รองรับ กรุณาสแกนใหม่" });
          }
          if (!scanKind.sendable) {
            return json(200, {
              ok: false,
              status: "failed",
              code: scanKind.code ?? "PAYLOAD_REJECTED",
              error: scanKind.reason ?? "QR ที่ยิงมาไม่ใช่ QR ตรวจสอบสลิป",
              scanned: p.slice(0, 400),
              scanKind,
            });
          }
        }

        const apiKey = process.env.EASYSLIP_API_KEY?.trim();
        if (!apiKey) {
          return json(500, {
            error:
              "ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY บนเซิร์ฟเวอร์ — ใส่ใน .env แล้วรีสตาร์ต หรือตั้งใน environment variables ของโฮสต์",
          });
        }

        // ---------- 3) เรียก EasySlip ----------
        let slipJson: Record<string, unknown>;
        const startedAt = Date.now();
        const ac = new AbortController();
        const timeoutId = setTimeout(() => ac.abort(), EASYSLIP_TIMEOUT_MS);
        try {
          // ส่งข้อความที่ตัดส่วนซ้ำออกแล้ว — เครื่องอ่านบางรุ่นยิงโค้ดเดิมสองรอบ
          // ทำให้ payload ยาวเป็นสองเท่าแล้ว EasySlip ตีกลับว่าผิดรูปแบบ
          const payloadBody: Record<string, unknown> = body.payload
            ? { payload: scanKind?.normalized ?? body.payload.trim() }
            : { base64: imageBase64 };
          payloadBody.matchAccount = true;
          // Local unique trans_ref guards consumption; failed amount checks must remain retryable.
          payloadBody.checkDuplicate = false;
          if (body.note) payloadBody.remark = body.note;

          const res = await fetch(EASYSLIP_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payloadBody),
            signal: ac.signal,
          });
          const responseBody: unknown = await res.json().catch(() => null);
          if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) {
            return json(200, { ok: false, status: "failed", code: "INVALID_RESPONSE", error: "EasySlip ตอบข้อมูลไม่สมบูรณ์ กรุณาลองใหม่" });
          }
          slipJson = responseBody as Record<string, unknown>;
          console.log(
            "[verify-slip] easyslip",
            res.status,
            `${Date.now() - startedAt}ms`,

          );

          // EasySlip ตอบ error ได้ทั้งแบบ HTTP 4xx และแบบ HTTP 200 ที่มี success:false
          const code = errorCode(slipJson);
          if (!res.ok || code || slipJson.success !== true) {
            const c = code ?? (res.ok ? "INVALID_RESPONSE" : `HTTP_${res.status}`);
            return json(200, {
              ok: false,
              status: "failed",
              code: c,
              retryable: /PENDING|pending/.test(c),
              error: ERROR_TH[c] ?? `ตรวจสลิปไม่สำเร็จ (${c})`,
              latencyMs: Date.now() - startedAt,
              debug: slipJson,
              scanned: body.payload ? body.payload.trim().slice(0, 400) : undefined,
              scanKind,
            });
          }
        } catch (e) {
          const aborted = (e as { name?: string } | null)?.name === "AbortError";
          const latencyMs = Date.now() - startedAt;
          console.error("[verify-slip] easyslip failed", `${latencyMs}ms`, e);
          return json(200, {
            ok: false,
            status: "failed",
            code: aborted ? "TIMEOUT" : "NETWORK",
            latencyMs,
            error: aborted
              ? `ต่อ EasySlip ไม่ติดภายใน ${EASYSLIP_TIMEOUT_MS / 1000} วินาที — กด "ตรวจการเชื่อมต่อ" ในหน้านี้เพื่อดูว่าเน็ตหรือ API key มีปัญหา`
              : "ติดต่อ EasySlip ไม่ได้: " + (e instanceof Error ? e.message : String(e)),
          });
        } finally {
          clearTimeout(timeoutId);
        }

        const slip = normalize(slipRoot(slipJson));
        if (!slip.transRef) {
          return json(200, {
            ok: false,
            status: "failed",
            code: "NO_TRANS_REF",
            error: "อ่านเลขอ้างอิงจากสลิปไม่ได้ — ส่งรายละเอียดทางเทคนิคให้ผู้ดูแลระบบดู",
            debug: slipJson,
          });
        }

        if (!firstString(slipJson, ["data.matchedAccount.bankNumber"])) {
          return json(200, { ok: false, status: "failed", code: "RECEIVER_NOT_MATCHED",
            error: "บัญชีผู้รับไม่ตรงกับบัญชีร้านที่ลงทะเบียนใน EasySlip — ตรวจบัญชีรับเงินใน EasySlip ก่อนยืนยัน",
            slip, expectedAmount: expected });
        }
        if (slip.amount === null || slip.amount <= 0 || !slip.date || !Number.isFinite(Date.parse(slip.date))) {
          return json(200, { ok: false, status: "failed", code: "INVALID_SLIP_DATA", error: "EasySlip ส่งยอดเงินหรือวันที่ไม่สมบูรณ์ กรุณาลองใหม่" });
        }
        const slipAmount = slip.amount;
        const matched = Math.abs(Math.round(slipAmount * 100) - Math.round(expected * 100)) <= AMOUNT_TOLERANCE;
        const status = "verified";
        if (!matched) {
          // Do not consume a slip rejected for the expected amount.
          return json(200, { ok: false, status: "amount_mismatch", slip, expectedAmount: expected,
            error: "ยอดบนสลิปไม่ตรงกับยอดที่ต้องชำระ (สลิป " + slipAmount.toFixed(2) + " / ต้องชำระ " + expected.toFixed(2) + ")" });
        }

        // ---------- 4) บันทึกผล (unique trans_ref กันสลิปใบเดิมใช้ซ้ำ) ----------
        const { error: insErr } = await db.from("slip_verifications").insert({
          trans_ref: slip.transRef,
          status,
          amount: slipAmount,
          expected_amount: expected,
          amount_matched: matched,
          slip_date: slip.date,
          sender_name: slip.senderName,
          sender_bank: slip.senderBank,
          receiver_name: slip.receiverName,
          receiver_bank: slip.receiverBank,
          reservation_id: body.reservationId ?? null,
          pc_session_id: body.pcSessionId ?? null,
          product_sale_id: body.productSaleId ?? null,
          note: body.note ?? null,
          provider: "easyslip",
          raw: slipJson,
          verified_by: user.id,
        });

        if (insErr) {
          // 23505 = unique violation -> สลิปใบนี้เคยถูกใช้ไปแล้ว
          if ((insErr as { code?: string }).code === "23505") {
            const { data: prev } = await db
              .from("slip_verifications")
              .select("created_at, expected_amount, reservation_id, pc_session_id")
              .eq("trans_ref", slip.transRef)
              .maybeSingle();
            return json(200, {
              ok: false,
              status: "duplicate",
              error: "สลิปใบนี้ถูกใช้ไปแล้ว",
              slip: { ...slip, amount: slipAmount },
              previous: prev ?? null,
            });
          }
          // Never authorize a payment without persisting the duplicate guard.
          console.error("[verify-slip] insert failed:", insErr.code);
          return json(200, { ok: false, status: "failed", code: "SAVE_FAILED", slip,
            expectedAmount: expected, error: "ตรวจข้อมูลสลิปได้ แต่บันทึกหลักฐานไม่สำเร็จ ยังไม่ยืนยันการชำระ กรุณาลองใหม่หรือติดต่อผู้ดูแล" });
        }

        return json(200, {
          ok: matched,
          status,
          slip: { ...slip, amount: slipAmount },
          expectedAmount: expected,
          error: matched
            ? undefined
            : `ยอดบนสลิปไม่ตรงกับยอดที่ต้องชำระ (สลิป ${slipAmount.toFixed(2)} / ต้องชำระ ${expected.toFixed(2)})`,
          debug: matched ? undefined : slipJson,
        });
      },
    },
  },
});
