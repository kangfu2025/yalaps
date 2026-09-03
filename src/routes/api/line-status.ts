import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * ตรวจว่า Channel access token ใช้ได้จริงไหม และผูกกับ OA ตัวไหน
 *
 * GET /v2/bot/info เป็น endpoint ที่ไม่กินโควตาข้อความ ใช้เช็ค token ได้ตรง ๆ
 * ถ้าผ่านจะได้ชื่อ OA กลับมา ทำให้รู้ทันทีว่าคัดลอก token มาจากช่องที่ถูกหรือเปล่า
 */

const SUPABASE_URL = "https://teyvwnnrchjnffyjtljl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRleXZ3bm5yY2hqbmZmeWp0bGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODMzOTQsImV4cCI6MjA5Njc1OTM5NH0.rykYOT9NS4LLgvbjqpoAMuBqMEeX9_aivlfCa_77xo8";

const BOT_INFO = "https://api.line.me/v2/bot/info";
const QUOTA = "https://api.line.me/v2/bot/message/quota";
const TIMEOUT_MS = 12_000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** ดูรูปทรงของ token โดยไม่เปิดเผยค่า */
function shapeOf(token: string) {
  const looksJwt = token.split(".").length === 3;
  return {
    length: token.length,
    preview: token.length > 12 ? `${token.slice(0, 6)}...${token.slice(-4)}` : "(สั้นมาก)",
    looksJwt,
    hasWhitespace: /\s/.test(token),
  };
}

export const Route = createFileRoute("/api/line-status")({
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

        const raw = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        if (!raw) {
          return json(200, {
            hasToken: false,
            ok: false,
            error: "ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN บนเซิร์ฟเวอร์",
          });
        }
        const token = raw.trim();
        const shape = shapeOf(token);

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
        try {
          const res = await fetch(BOT_INFO, {
            headers: { Authorization: `Bearer ${token}` },
            signal: ac.signal,
          });
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

          if (res.status === 401) {
            return json(200, {
              hasToken: true,
              ok: false,
              httpStatus: 401,
              shape,
              error: "LINE ปฏิเสธโทเคนนี้",
              hints: [
                shape.length < 100
                  ? `โทเคนยาวแค่ ${shape.length} ตัวอักษร — Channel access token ปกติยาว 150-250 ตัว ค่านี้น่าจะเป็น Channel secret ซึ่งคนละตัวกัน`
                  : null,
                "ตรวจว่าคัดลอกมาจากช่องที่เป็น Messaging API ไม่ใช่ช่อง LINE Login (สองอย่างนี้อยู่ใน console เดียวกันและหน้าตาคล้ายกัน)",
                "ในหน้า Messaging API ต้องกดปุ่ม Issue เพื่อออกโทเคนก่อน ถ้าไม่เคยกด ช่องนั้นจะว่างหรือเป็นของเก่าที่ถูกยกเลิกไปแล้ว",
                "ถ้าเคยกด Reissue ทีหลัง โทเคนเดิมจะใช้ไม่ได้ทันที ต้องเอาตัวใหม่มาใส่",
              ].filter(Boolean),
              debug: body,
            });
          }

          if (!res.ok) {
            return json(200, {
              hasToken: true,
              ok: false,
              httpStatus: res.status,
              shape,
              error: `LINE ตอบกลับ ${res.status}`,
              debug: body,
            });
          }

          // โทเคนใช้ได้ — ดูโควตาต่อให้เลย
          let quota: unknown = null;
          try {
            const q = await fetch(QUOTA, { headers: { Authorization: `Bearer ${token}` } });
            if (q.ok) quota = await q.json();
          } catch {
            /* ไม่ได้โควตาก็ไม่เป็นไร */
          }

          return json(200, {
            hasToken: true,
            ok: true,
            shape,
            bot: body,
            quota,
          });
        } catch (e) {
          const aborted = (e as { name?: string } | null)?.name === "AbortError";
          return json(200, {
            hasToken: true,
            ok: false,
            shape,
            error: aborted
              ? "ต่อ api.line.me ไม่ติดภายใน 12 วินาที — เน็ตหรือไฟร์วอลล์บล็อกอยู่"
              : "ติดต่อ LINE ไม่ได้: " + (e instanceof Error ? e.message : String(e)),
          });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
