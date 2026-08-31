import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogIn, User as UserIcon, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "เข้าสู่ระบบ — YALA PLAYSTATION" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { signIn, user, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [loading, user, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signIn(u, p);
      await router.invalidate();
      navigate({ to: "/" });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: "100vh", padding: 16 }}>
      <div
        className="p-4 p-md-5"
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--g-surface)",
          border: "1px solid var(--g-border)",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.35)",
        }}
      >
        <div className="text-center mb-4">
          <h3 className="fw-bold m-0" style={{ letterSpacing: ".5px" }}>
            YALA PLAYSTATION
          </h3>
          <div className="text-muted small mt-1">เข้าสู่ระบบสำหรับพนักงาน</div>
        </div>

        <form onSubmit={onSubmit} className="d-grid gap-3">
          <div>
            <label className="form-label small text-muted mb-1">
              <UserIcon size={13} /> ชื่อผู้ใช้
            </label>
            <input
              className="form-control"
              autoFocus
              autoComplete="username"
              value={u}
              onChange={(e) => setU(e.target.value)}
              placeholder="  "
              required
            />
          </div>
          <div>
            <label className="form-label small text-muted mb-1">
              <Lock size={13} /> รหัสผ่าน
            </label>
            <input
              className="form-control"
              type="password"
              autoComplete="current-password"
              value={p}
              onChange={(e) => setP(e.target.value)}
              required
            />
          </div>

          {err && <div className="alert alert-danger py-2 small m-0">{err}</div>}

          <button
            className="btn btn-primary d-inline-flex justify-content-center align-items-center gap-2"
            type="submit"
            disabled={busy}
          >
            <LogIn size={16} /> {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    </div>
  );
}
