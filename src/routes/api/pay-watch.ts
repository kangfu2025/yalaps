import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * ตรวจเงินเข้าอัตโนมัติผ่าน PlernPay
 *
 * คีย์อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น (env: PLERNPAY_CLIENT_ID / PLERNPAY_CLIENT_SECRET)
 * client_id เขาบอกว่าเปิดเผยได้ แต่ client_secret ห้ามหลุดไปฝั่งเบราว์เซอร์เด็ดขาด
 *
 * จุดสำคัญด้านความปลอดภัย: การ "เปิดเครื่องอัตโนมัติ" ต้องเชื่อผลจากที่นี่เท่านั้น
 * เบราว์เซอร์ฟัง SSE ได้เพื่อให้ UI ไว แต่ห้ามใช้ผลนั้นตัดสินใจ เพราะใครเปิด
 * DevTools ก็ปลอมได้ ทุกครั้งที่จะเปิดเครื่องต้องวิ่งมาถาม action=confirm ที่นี่
 */

const SUPABASE_URL = "https://teyvwnnrchjnffyjtljl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRleXZ3bm5yY2hqbmZmeWp0bGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODMzOTQsImV4cCI6MjA5Njc1OTM5NH0.rykYOT9NS4LLgvbjqpoAMuBqMEeX9_aivlfCa_77xo8";

const PLERNPAY_BASE = "https://api.plernpay.com";
const TIMEOUT_MS = 15_000;

/** ยอมรับความคลาดเคลื่อน 1 สตางค์ (ปัดเศษของธนาคาร) */
const AMOUNT_TOLERANCE = 0.01;

interface Body {
  action: "create" | "confirm" | "cancel" | "ping";
  ref?: string;
  amount?: number;
  memo?: string;
  zone?: string;
  machineNumber?: number;
  reservationId?: string | null;
  pcSessionId?: string | null;
  productSaleId?: string | null;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function creds(): { id: string; secret: string } | null {
  const id = process.env.PLERNPAY_CLIENT_ID?.trim();
  const secret = process.env.PLERNPAY_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  return { id, secret };
}

/** ข้อความ error ของ PlernPay แปลไทยให้พนักงานอ่านรู้เรื่อง */
const ERROR_TH: Record<string, string> = {
  "1000": "ยังไม่ได้ตั้งค่าคีย์ PlernPay บนเซิร์ฟเวอร์",
  "1001": "คีย์ PlernPay ไม่ถูกต้อง",
  "1002": "แอปใน PlernPay ถูกปิดใช้งาน — ติดต่อแอดมิน PlernPay เพื่อเปิดใหม่",
  "1003": "บัญชี PlernPay ถูกปิดใช้งาน",
  "1010": "ยอดเงินไม่ถูกต้อง (ต้องอยู่ระหว่าง 1 - 999,999 บาท)",
  "1011": "ยังตั้งค่าใน PlernPay ไม่ครบ — เข้า Dashboard ตั้งค่าให้เสร็จก่อน",
  "1012": "เครดิตใน PlernPay หมด — เติมเงินในระบบ PlernPay ก่อน",
  "1013": "ระบบ PlernPay ขัดข้องชั่วคราว ลองใหม่อีกครั้ง",
  "1020": "ไม่พบรายการนี้ที่ PlernPay",
  "1021": "สถานะรายการไม่ถูกต้อง",
  "1022":
    "LINE Bot ยังไม่ได้เชื่อมกับบัญชีธนาคาร — เข้า Dashboard ของ PlernPay เมนู LINE Bot แล้วเชื่อมให้เรียบร้อยก่อน",
  "1030":
    "เรียกถี่เกินไป (จำกัด 30 ครั้ง/นาที) — PlernPay ปิดใช้งานแอปอัตโนมัติ ต้องติดต่อแอดมินเพื่อเปิดใหม่",
};

async function callPlernPay(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const c = creds();
  if (!c) throw new Error("NO_CREDS");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PLERNPAY_BASE}${path}`, {
      method: init.method,
      headers: {
        "X-Client-ID": c.id,
        "X-Client-Secret": c.secret,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ac.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function providerError(data: Record<string, unknown>, fallback: string): string {
  const code = data.code != null ? String(data.code) : "";
  const raw = typeof data.error === "string" ? data.error : "";
  return ERROR_TH[code] ?? (raw ? `${fallback} (${raw})` : fallback);
}

export const Route = createFileRoute("/api/pay-watch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ---------- ต้องเป็นพนักงานที่ล็อกอินแล้วเท่านั้น ----------
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.toLowerCase().startsWith("bearer ")) {
          return json(401, { error: "unauthorized" });
        }
        const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData } = await db.auth.getUser();
        const user = userData?.user;
        if (!user) return json(401, { error: "unauthorized" });

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return json(400, { error: "bad request" });
        }

        const host = new URL(request.url).host;
        const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
        const server = { host, isLocal };

        if (!creds()) {
          return json(200, {
            ok: false,
            code: "NO_CREDS",
            server,
            error: isLocal
              ? "ยังไม่ได้ตั้งค่า PLERNPAY_CLIENT_ID / PLERNPAY_CLIENT_SECRET — ใส่ใน .env แล้วรีสตาร์ต"
              : `เว็บที่ deploy (${host}) ยังไม่มีคีย์ PlernPay — ต้องไปใส่ใน Environment variables ของโฮสต์แล้ว deploy ใหม่`,
          });
        }

        // ================= ping: เช็คว่าคีย์ใช้ได้ไหม =================
        if (body.action === "ping") {
          // ไม่มี endpoint สำหรับเช็คคีย์โดยเฉพาะ จึงลองสร้างรายการยอดต่ำสุด
          // แล้วยกเลิกทิ้งทันที ถ้าคีย์ผิดจะรู้ตั้งแต่ขั้นสร้าง
          try {
            const r = await callPlernPay("/v1/topup/create", {
              method: "POST",
              body: { amount: 1, memo: "yala-connection-test" },
            });
            if (!r.ok) {
              return json(200, {
                ok: false,
                server,
                httpStatus: r.status,
                error: providerError(r.data, "PlernPay ปฏิเสธคำขอ"),
                debug: r.data,
              });
            }
            const ref = String(r.data.ref ?? "");
            if (ref)
              await callPlernPay(`/v1/topup/${ref}/cancel`, { method: "POST" }).catch(() => {});
            return json(200, {
              ok: true,
              server,
              clientId: creds()!.id.slice(0, 8) + "…",
              note: "สร้างรายการทดสอบ 1 บาทแล้วยกเลิกทิ้งเรียบร้อย",
            });
          } catch (e) {
            return json(200, {
              ok: false,
              server,
              error: "ติดต่อ PlernPay ไม่ได้: " + (e instanceof Error ? e.message : String(e)),
            });
          }
        }

        // ================= create: ขอ QR ยอดไม่ซ้ำ =================
        if (body.action === "create") {
          const amount = Number(body.amount) || 0;
          if (amount < 1) return json(400, { error: "ยอดเงินต้องมากกว่า 0" });

          let r;
          try {
            r = await callPlernPay("/v1/topup/create", {
              method: "POST",
              body: { amount, memo: (body.memo ?? "").slice(0, 255) },
            });
          } catch (e) {
            const aborted = (e as { name?: string } | null)?.name === "AbortError";
            return json(200, {
              ok: false,
              server,
              error: aborted
                ? `ต่อ PlernPay ไม่ติดภายใน ${TIMEOUT_MS / 1000} วินาที`
                : "ติดต่อ PlernPay ไม่ได้: " + (e instanceof Error ? e.message : String(e)),
            });
          }
          if (!r.ok) {
            return json(200, {
              ok: false,
              server,
              httpStatus: r.status,
              error: providerError(r.data, "ขอ QR ไม่สำเร็จ"),
              debug: r.data,
            });
          }

          const ref = String(r.data.ref ?? "");
          const uniqueAmount = Number(r.data.unique_amount ?? amount);
          const qr = String(r.data.qr_code ?? "");
          if (!ref || !qr) {
            return json(200, {
              ok: false,
              server,
              error: "PlernPay ตอบกลับไม่ครบ (ไม่มี ref หรือ qr_code)",
              debug: r.data,
            });
          }

          const { error: insErr } = await db.from("payment_watches").insert({
            ref,
            amount,
            unique_amount: uniqueAmount,
            status: "pending",
            memo: body.memo ?? null,
            zone: body.zone ?? null,
            machine_number: body.machineNumber ?? null,
            reservation_id: body.reservationId ?? null,
            pc_session_id: body.pcSessionId ?? null,
            product_sale_id: body.productSaleId ?? null,
            expires_at: r.data.expires_at ?? null,
            created_by: user.id,
            raw: r.data,
          });
          if (insErr) {
            console.error("[pay-watch] insert failed", insErr);
            return json(200, {
              ok: false,
              server,
              code: insErr.code,
              error:
                insErr.code === "PGRST205" || insErr.code === "42P01"
                  ? "ยังไม่ได้ติดตั้งระบบตรวจเงินเข้า — รัน supabase/payment_watch_migration.sql ก่อน"
                  : "บันทึกรายการไม่สำเร็จ: " + insErr.message,
            });
          }

          return json(200, {
            ok: true,
            server,
            ref,
            amount,
            uniqueAmount,
            qrCode: qr,
            expiresAt: r.data.expires_at ?? null,
            // เลขพร้อมเพย์ปลายทาง — ให้พนักงานเห็นว่าเงินเข้าบัญชีร้านจริง
            promptpayId: r.data.promptpay_id ?? null,
            // client_id เปิดเผยได้ตามเอกสาร ส่งไปให้เบราว์เซอร์ต่อ SSE เองได้
            clientId: creds()!.id,
          });
        }

        // ================= confirm: ยืนยันจากฝั่งเซิร์ฟเวอร์เท่านั้น =================
        if (body.action === "confirm") {
          const ref = String(body.ref ?? "").trim();
          if (!ref) return json(400, { error: "ต้องส่ง ref" });

          const { data: row, error: rowErr } = await db
            .from("payment_watches")
            .select("*")
            .eq("ref", ref)
            .maybeSingle();
          if (rowErr) return json(200, { ok: false, error: rowErr.message });
          if (!row) return json(200, { ok: false, error: "ไม่พบรายการนี้ในระบบ" });

          // จ่ายแล้วและถูกใช้ไปกับบิลแล้ว ห้ามใช้ซ้ำ
          if (row.consumed_at) {
            return json(200, {
              ok: false,
              code: "ALREADY_USED",
              error: "เงินก้อนนี้ถูกใช้กับบิลอื่นไปแล้ว",
            });
          }

          let r;
          try {
            r = await callPlernPay(`/v1/topup/${encodeURIComponent(ref)}`, { method: "GET" });
          } catch (e) {
            return json(200, {
              ok: false,
              error: "ติดต่อ PlernPay ไม่ได้: " + (e instanceof Error ? e.message : String(e)),
            });
          }
          if (!r.ok) {
            return json(200, {
              ok: false,
              httpStatus: r.status,
              error: providerError(r.data, "ตรวจสถานะไม่สำเร็จ"),
              debug: r.data,
            });
          }

          const status = String(r.data.status ?? "");
          const paidAmount = Number(r.data.unique_amount ?? 0);

          if (status !== "confirmed") {
            await db
              .from("payment_watches")
              .update({ status: status || "pending", updated_at: new Date().toISOString() })
              .eq("ref", ref);
            return json(200, { ok: false, status, error: statusTh(status) });
          }

          // ยอดที่เข้าจริงต้องตรงกับยอดที่เราขอไว้ ไม่งั้นไม่นับ
          if (Math.abs(paidAmount - Number(row.unique_amount)) > AMOUNT_TOLERANCE) {
            return json(200, {
              ok: false,
              code: "AMOUNT_MISMATCH",
              error: `ยอดที่เข้าไม่ตรง (เข้า ${paidAmount} ต้องเป็น ${row.unique_amount})`,
            });
          }

          const now = new Date().toISOString();
          // ปิดรายการแบบกันแข่งกัน: อัปเดตได้ต่อเมื่อยังไม่ถูกใช้
          const { data: claimed, error: upErr } = await db
            .from("payment_watches")
            .update({
              status: "confirmed",
              bank: (r.data.bank as string) ?? null,
              confirmed_at: (r.data.confirmed_at as string) ?? now,
              consumed_at: now,
              updated_at: now,
              raw: r.data,
            })
            .eq("ref", ref)
            .is("consumed_at", null)
            .select()
            .maybeSingle();
          if (upErr) return json(200, { ok: false, error: upErr.message });
          if (!claimed) {
            return json(200, {
              ok: false,
              code: "ALREADY_USED",
              error: "เงินก้อนนี้ถูกใช้กับบิลอื่นไปแล้ว",
            });
          }

          return json(200, {
            ok: true,
            status: "confirmed",
            amount: Number(row.amount),
            uniqueAmount: paidAmount,
            bank: r.data.bank ?? null,
            confirmedAt: r.data.confirmed_at ?? now,
          });
        }

        // ================= cancel =================
        if (body.action === "cancel") {
          const ref = String(body.ref ?? "").trim();
          if (!ref) return json(400, { error: "ต้องส่ง ref" });
          await callPlernPay(`/v1/topup/${encodeURIComponent(ref)}/cancel`, {
            method: "POST",
          }).catch(() => {});
          await db
            .from("payment_watches")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("ref", ref)
            .eq("status", "pending");
          return json(200, { ok: true });
        }

        return json(400, { error: "unknown action" });
      },
    },
  },
});

function statusTh(status: string): string {
  if (status === "pending") return "ยังไม่มีเงินเข้า";
  if (status === "expired") return "หมดเวลารอแล้ว (QR มีอายุ 15 นาที) — กดขอ QR ใหม่";
  if (status === "cancelled") return "รายการถูกยกเลิกไปแล้ว";
  return `สถานะไม่คาดคิด: ${status || "ไม่ทราบ"}`;
}
