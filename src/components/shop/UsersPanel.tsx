import { useEffect, useState } from "react";
import { UserPlus, Trash2, KeyRound, Shield, User as UserIcon } from "lucide-react";
import { supabase, type AppRole } from "@/lib/supabase";
import { usernameToEmail, useAuth } from "@/lib/auth";
import { ConfirmDialog } from "./ConfirmDialog";

interface Row {
  id: string;
  username: string;
  display_name: string | null;
  created_at: string;
  role: AppRole | null;
}

export function UsersPanel() {
  const { user: me } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newU, setNewU] = useState("");
  const [newP, setNewP] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("staff");
  const [busy, setBusy] = useState(false);

  const [resetTarget, setResetTarget] = useState<Row | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [delTarget, setDelTarget] = useState<Row | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data: profs, error: e1 } = await supabase
        .from("profiles")
        .select("id, username, display_name, created_at")
        .order("created_at", { ascending: true });
      if (e1) throw e1;
      const { data: roles, error: e2 } = await supabase.from("user_roles").select("user_id, role");
      if (e2) throw e2;
      const roleMap = new Map<string, AppRole>();
      for (const r of (roles ?? []) as Array<{ user_id: string; role: AppRole }>) {
        // admin ชนะ staff
        if (roleMap.get(r.user_id) === "admin") continue;
        roleMap.set(r.user_id, r.role);
      }
      setRows(
        ((profs ?? []) as Array<{ id: string; username: string; display_name: string | null; created_at: string }>).map(
          (p) => ({ ...p, role: roleMap.get(p.id) ?? null }),
        ),
      );
      setErr(null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createUser() {
    if (!newU.trim() || !newP.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          username: newU.trim(),
          password: newP,
          role: newRole,
          actor: me?.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "สร้างบัญชีไม่สำเร็จ");
      setNewU(""); setNewP(""); setNewRole("staff"); setShowAdd(false);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function toggleRole(r: Row) {
    setErr(null);
    try {
      const next: AppRole = r.role === "admin" ? "staff" : "admin";
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_role", user_id: r.id, role: next, actor: me?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "เปลี่ยนสิทธิ์ไม่สำเร็จ");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function doReset() {
    if (!resetTarget || !resetPw) return;
    try {
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset_password", user_id: resetTarget.id, password: resetPw, actor: me?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "รีเซ็ตรหัสผ่านไม่สำเร็จ");
      setResetTarget(null); setResetPw("");
      alert("รีเซ็ตรหัสผ่านเรียบร้อย");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function doDelete() {
    if (!delTarget) return;
    try {
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", user_id: delTarget.id, actor: me?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "ลบไม่สำเร็จ");
      setDelTarget(null);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="m-0"><UserIcon size={16} className="me-1" /> จัดการผู้ใช้งาน</h5>
        <button className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1" onClick={() => setShowAdd((v) => !v)}>
          <UserPlus size={14} /> เพิ่มผู้ใช้งาน
        </button>
      </div>

      {err && <div className="alert alert-danger py-2 small">{err}</div>}

      {showAdd && (
        <div className="p-3 mb-3" style={{ background: "var(--g-surface-2)", border: "1px solid var(--g-border)", borderRadius: 12 }}>
          <div className="row g-2 align-items-end">
            <div className="col-md-3">
              <label className="form-label small text-muted mb-1">ชื่อผู้ใช้</label>
              <input className="form-control" value={newU} onChange={(e) => setNewU(e.target.value)} placeholder="เช่น somchai" />
            </div>
            <div className="col-md-3">
              <label className="form-label small text-muted mb-1">รหัสผ่าน</label>
              <input className="form-control" type="text" value={newP} onChange={(e) => setNewP(e.target.value)} />
            </div>
            <div className="col-md-2">
              <label className="form-label small text-muted mb-1">สิทธิ์</label>
              <select className="form-select" value={newRole} onChange={(e) => setNewRole(e.target.value as AppRole)}>
                <option value="staff">พนักงาน</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="col-md-4 d-flex gap-2">
              <button className="btn btn-success flex-fill" disabled={busy} onClick={createUser}>{busy ? "กำลังบันทึก..." : "บันทึก"}</button>
              <button className="btn btn-outline-light" onClick={() => setShowAdd(false)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-4 text-muted">กำลังโหลด...</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>ชื่อผู้ใช้</th>
                <th>สิทธิ์</th>
                <th>สร้างเมื่อ</th>
                <th className="text-end">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="fw-semibold">{r.username}</div>
                    <div className="text-muted small">{usernameToEmail(r.username)}</div>
                  </td>
                  <td>
                    {r.role === "admin" ? (
                      <span className="badge bg-danger d-inline-flex align-items-center gap-1"><Shield size={12} /> Admin</span>
                    ) : r.role === "staff" ? (
                      <span className="badge bg-info">พนักงาน</span>
                    ) : (
                      <span className="badge bg-secondary">—</span>
                    )}
                  </td>
                  <td className="text-muted small">{new Date(r.created_at).toLocaleString("th-TH")}</td>
                  <td className="text-end">
                    <div className="d-inline-flex gap-1">
                      <button
                        className="btn btn-sm btn-outline-warning"
                        title="เปลี่ยนสิทธิ์"
                        disabled={r.id === me?.id}
                        onClick={() => toggleRole(r)}
                      >
                        <Shield size={13} /> {r.role === "admin" ? "→ พนักงาน" : "→ Admin"}
                      </button>
                      <button
                        className="btn btn-sm btn-outline-info"
                        onClick={() => { setResetTarget(r); setResetPw(""); }}
                      >
                        <KeyRound size={13} /> รีเซ็ตรหัส
                      </button>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        disabled={r.id === me?.id}
                        onClick={() => setDelTarget(r)}
                      >
                        <Trash2 size={13} /> ลบ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="text-center text-muted py-4">ยังไม่มีผู้ใช้งาน</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Reset password modal (inline) */}
      {resetTarget && (
        <div className="modal d-block" style={{ background: "rgba(0,0,0,.6)" }} onClick={() => setResetTarget(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content" style={{ background: "var(--g-surface)", border: "1px solid var(--g-border)" }}>
              <div className="modal-header"><h5 className="modal-title">รีเซ็ตรหัสผ่านของ {resetTarget.username}</h5></div>
              <div className="modal-body">
                <label className="form-label small text-muted">รหัสผ่านใหม่</label>
                <input className="form-control" value={resetPw} onChange={(e) => setResetPw(e.target.value)} autoFocus />
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-light" onClick={() => setResetTarget(null)}>ยกเลิก</button>
                <button className="btn btn-primary" onClick={doReset} disabled={!resetPw}>บันทึก</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!delTarget}
        title="ยืนยันลบผู้ใช้"
        icon="🗑️"
        variant="danger"
        confirmLabel="ลบ"
        cancelLabel="ยกเลิก"
        message={delTarget ? <div>ลบผู้ใช้ <b>{delTarget.username}</b> ถาวร ไม่สามารถกู้คืนได้</div> : ""}
        onConfirm={doDelete}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  );
}
