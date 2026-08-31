import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://teyvwnnrchjnffyjtljl.supabase.co";
const USERNAME_DOMAIN = "yala.local";

function usernameToEmail(input: string): string {
  const s = input.trim();
  if (s.includes("@")) return s.toLowerCase();
  return `${s.toLowerCase()}@${USERNAME_DOMAIN}`;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function admin() {
  const key = process.env.YALA_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("YALA_SERVICE_ROLE_KEY is not configured");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireAdmin(actorId: string | undefined): Promise<void> {
  if (!actorId) throw new Error("Unauthorized");
  const a = await admin();
  const { data, error } = await a
    .from("user_roles")
    .select("role")
    .eq("user_id", actorId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Forbidden: admin only");
}

export const Route = createFileRoute("/api/admin-users")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            action: "create" | "delete" | "reset_password" | "set_role";
            actor?: string;
            username?: string;
            password?: string;
            role?: "admin" | "staff";
            user_id?: string;
          };
          await requireAdmin(body.actor);
          const a = await admin();

          if (body.action === "create") {
            if (!body.username || !body.password) return json(400, { error: "missing username or password" });
            const email = usernameToEmail(body.username);
            const { data, error } = await a.auth.admin.createUser({
              email,
              password: body.password,
              email_confirm: true,
              user_metadata: { username: body.username.trim().toLowerCase() },
            });
            if (error) return json(400, { error: error.message });
            const uid = data.user?.id;
            if (uid && body.role) {
              await a.from("user_roles").insert({ user_id: uid, role: body.role });
            }
            return json(200, { ok: true, user_id: uid });
          }

          if (body.action === "delete") {
            if (!body.user_id) return json(400, { error: "missing user_id" });
            if (body.user_id === body.actor) return json(400, { error: "cannot delete self" });
            const { error } = await a.auth.admin.deleteUser(body.user_id);
            if (error) return json(400, { error: error.message });
            return json(200, { ok: true });
          }

          if (body.action === "reset_password") {
            if (!body.user_id || !body.password) return json(400, { error: "missing user_id or password" });
            const { error } = await a.auth.admin.updateUserById(body.user_id, { password: body.password });
            if (error) return json(400, { error: error.message });
            return json(200, { ok: true });
          }

          if (body.action === "set_role") {
            if (!body.user_id || !body.role) return json(400, { error: "missing user_id or role" });
            if (body.user_id === body.actor && body.role !== "admin") {
              return json(400, { error: "cannot demote self" });
            }
            await a.from("user_roles").delete().eq("user_id", body.user_id);
            const { error } = await a.from("user_roles").insert({ user_id: body.user_id, role: body.role });
            if (error) return json(400, { error: error.message });
            return json(200, { ok: true });
          }

          return json(400, { error: "unknown action" });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const status = /unauthor/i.test(msg) ? 401 : /forbidden/i.test(msg) ? 403 : 400;
          return json(status, { error: msg });
        }
      },
    },
  },
});
