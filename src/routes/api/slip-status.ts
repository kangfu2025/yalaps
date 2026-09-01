import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * ตรวจสุขภาพการเชื่อมต่อ EasySlip — ไม่เปลืองโควตาตรวจสลิป
 *
 * เรียก GET /v2/info ซึ่งเป็น endpoint สำหรับดูข้อมูลบัญชี/โควตา
 * ใช้แยกให้ออกว่าปัญหาอยู่ชั้นไหน: key ผิด / เน็ตไปไม่ถึง / โควตาหมด / สลิปเอง
 */

const SUPABASE_URL = "https://teyvwnnrchjnffyjtljl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRleXZ3bm5yY2hqbmZmeWp0bGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODMzOTQsImV4cCI6MjA5Njc1OTM5NH0.rykYOT9NS4LLgvbjqpoAMuBqMEeX9_aivlfCa_77xo8";

const INFO_ENDPOINT = "https://api.easyslip.com/v2/info";
const TIMEOUT_MS = 12_000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/slip-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.toLowerCase().startsWith("bearer ")) {
          return json(401, { error: "unauthorized" });
        }
        const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData } = await db.auth.getUser();
        if (!userData?.user) return json(401, { error: "unauthorized" });

        const key = process.env.EASYSLIP_API_KEY;
        if (!key) {
          return json(200, {
            hasKey: false,
            ok: false,
            error: "ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY บนเซิร์ฟเวอร์ (ใส่ใน .env แล้วรีสตาร์ต)",
          });
        }

        const started = Date.now();
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
        try {
          const res = await fetch(INFO_ENDPOINT, {
            headers: { Authorization: `Bearer ${key}` },
            signal: ac.signal,
          });
          const latencyMs = Date.now() - started;
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

          if (!res.ok) {
            return json(200, {
              hasKey: true,
              ok: false,
              latencyMs,
              httpStatus: res.status,
              error:
                res.status === 401
                  ? "API key ไม่ถูกต้อง — คัดลอกใหม่จากหน้า EasySlip แล้วใส่ใน .env"
                  : res.status === 403
                    ? "บัญชีถูกจำกัดสิทธิ์ หรือ IP ของเซิร์ฟเวอร์ไม่อยู่ใน whitelist"
                    : `EasySlip ตอบกลับ ${res.status}`,
              debug: body,
            });
          }

          return json(200, {
            hasKey: true,
            ok: true,
            latencyMs,
            info: body,
          });
        } catch (e) {
          const latencyMs = Date.now() - started;
          const aborted = (e as { name?: string } | null)?.name === "AbortError";
          return json(200, {
            hasKey: true,
            ok: false,
            latencyMs,
            error: aborted
              ? `ต่อ EasySlip ไม่ติดภายใน ${TIMEOUT_MS / 1000} วินาที — เน็ตร้านช้าหรือมีไฟร์วอลล์บล็อก api.easyslip.com`
              : "ติดต่อ EasySlip ไม่ได้: " + (e instanceof Error ? e.message : String(e)),
          });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
