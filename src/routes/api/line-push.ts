import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * ส่งข้อความแจ้งเตือนเข้า LINE ผ่าน Messaging API
 *
 * Channel access token อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น (env: LINE_CHANNEL_ACCESS_TOKEN)
 * LINE Notify ปิดบริการไปแล้วตั้งแต่ 31 มี.ค. 2568 จึงต้องใช้ LINE OA + Messaging API
 */

const SUPABASE_URL = "https://teyvwnnrchjnffyjtljl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRleXZ3bm5yY2hqbmZmeWp0bGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODMzOTQsImV4cCI6MjA5Njc1OTM5NH0.rykYOT9NS4LLgvbjqpoAMuBqMEeX9_aivlfCa_77xo8";

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const MAX_LEN = 4900; // LINE จำกัด 5000 ตัวอักษรต่อข้อความ

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/line-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.toLowerCase().startsWith("bearer ")) {
          return json(401, { ok: false, error: "unauthorized" });
        }
        const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData, error: userErr } = await db.auth.getUser();
        if (userErr || !userData?.user) return json(401, { ok: false, error: "unauthorized" });

        let body: { event?: string; message?: string };
        try {
          body = (await request.json()) as { event?: string; message?: string };
        } catch {
          return json(400, { ok: false, error: "bad request" });
        }
        const event = String(body.event ?? "unknown");
        const message = String(body.message ?? "")
          .trim()
          .slice(0, MAX_LEN);
        if (!message) return json(400, { ok: false, error: "ข้อความว่าง" });

        const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        if (!token) {
          // แยกข้อความตามเซิร์ฟเวอร์ที่ตอบ เพราะวิธีแก้คนละทางกัน:
          // เครื่องร้านแก้ที่ไฟล์ .env ส่วนเว็บที่ deploy ต้องไปตั้งที่โฮสต์
          const host = new URL(request.url).host;
          const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
          return json(200, {
            ok: false,
            error: isLocal
              ? "ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN บนเซิร์ฟเวอร์ — ใส่ใน .env แล้วรีสตาร์ต"
              : `เว็บที่ deploy (${host}) ยังไม่มี LINE_CHANNEL_ACCESS_TOKEN — ไฟล์ .env ไม่ได้ขึ้น git ต้องไปใส่ใน Environment variables ของโฮสต์แล้ว deploy ใหม่`,
          });
        }

        const { data: cfg } = await db.from("line_config").select("*").eq("id", 1).maybeSingle();
        const target = (cfg as { target_id?: string } | null)?.target_id;
        if (!target)
          return json(200, { ok: false, error: "ยังไม่ได้ตั้งค่าปลายทาง (User ID / Group ID)" });

        let ok = false;
        let error: string | null = null;
        try {
          const res = await fetch(LINE_PUSH_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ to: target, messages: [{ type: "text", text: message }] }),
          });
          if (res.ok) {
            ok = true;
          } else {
            const detail = (await res.json().catch(() => ({}))) as { message?: string };
            error =
              res.status === 401
                ? "Channel access token ไม่ถูกต้องหรือหมดอายุ"
                : res.status === 403
                  ? "โควตาข้อความของเดือนนี้หมดแล้ว หรือ OA ไม่มีสิทธิ์ส่งหาปลายทางนี้"
                  : res.status === 400
                    ? `ปลายทางไม่ถูกต้อง หรือข้อความผิดรูปแบบ (${detail.message ?? "400"})`
                    : `LINE ตอบกลับ ${res.status} ${detail.message ?? ""}`.trim();
          }
        } catch (e) {
          error = "ติดต่อ LINE ไม่ได้: " + (e instanceof Error ? e.message : String(e));
        }

        // เก็บ log ไว้ดูย้อนหลังและนับโควตา — ล้มเหลวก็ไม่ให้กระทบผลลัพธ์
        db.from("line_logs")
          .insert({ event, message, ok, error })
          .then(undefined, (e: unknown) => console.warn("[line] log insert failed:", e));

        return json(200, ok ? { ok: true } : { ok: false, error });
      },
    },
  },
});
