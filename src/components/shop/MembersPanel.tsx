import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Search,
  Star,
  UserPlus,
  RefreshCw,
  History,
  Plus,
  Minus,
  QrCode,
  Users,
  Phone,
  Gift,
  X,
  MonitorSmartphone,
} from "lucide-react";
import {
  searchMembers,
  registerMember,
  adjustPoints,
  updateMember,
  listMemberTransactions,
  getPointsConfig,
  formatPhone,
  normalizePhone,
  DEFAULT_POINTS_CONFIG,
  type Member,
  type PointsConfig,
  type PointTransaction,
} from "@/lib/members";
import { supabase } from "@/lib/supabase";
import { showJoinScreen, clearDisplay, readDisplayKind } from "@/lib/customerDisplay";

export function MembersPanel() {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<PointsConfig>(DEFAULT_POINTS_CONFIG);
  const [detail, setDetail] = useState<Member | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [joinOnScreen, setJoinOnScreen] = useState(false);
  const [screenBusy, setScreenBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await searchMembers(term));
      setErr(null);
    } catch (e) {
      setErr(setupHint(e) ?? errText(e));
    } finally {
      setLoading(false);
    }
  }, [term]);

  useEffect(() => {
    getPointsConfig()
      .then(setCfg)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // ปุ่มต้องรู้ว่าจอลูกค้ากำลังโชว์ QR อยู่หรือเปล่า
  useEffect(() => {
    let alive = true;
    const sync = () => {
      readDisplayKind()
        .then((k) => {
          if (alive) setJoinOnScreen(k === "join" || k === "join_done");
        })
        .catch(() => {});
    };
    sync();
    const ch = supabase
      .channel("members-display-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_display" }, sync)
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, []);

  async function toggleJoinScreen() {
    if (screenBusy) return;
    setScreenBusy(true);
    try {
      if (joinOnScreen) await clearDisplay();
      else await showJoinScreen();
    } catch (e) {
      alert("สั่งจอลูกค้าไม่สำเร็จ: " + errText(e));
    } finally {
      setScreenBusy(false);
    }
  }

  useEffect(() => {
    const ch = supabase
      .channel("members-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const totalPoints = rows.reduce((s, m) => s + m.points, 0);

  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <div className="input-group" style={{ maxWidth: 360 }}>
          <span className="input-group-text">
            <Search size={15} />
          </span>
          <input
            className="form-control"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="ค้นหาด้วยชื่อหรือเบอร์โทร"
          />
        </div>
        <button className="btn btn-outline-secondary" onClick={load} title="รีเฟรช">
          <RefreshCw size={15} />
        </button>
        <button
          className="btn btn-success d-inline-flex align-items-center gap-1"
          onClick={() => setShowNew(true)}
        >
          <UserPlus size={15} /> เพิ่มสมาชิก
        </button>
        <button
          className={`btn d-inline-flex align-items-center gap-1 ${joinOnScreen ? "btn-warning" : "btn-info text-white"}`}
          onClick={toggleJoinScreen}
          disabled={screenBusy}
          title="ขึ้น QR สมัครสมาชิกเต็มจอบนจอลูกค้า"
        >
          <MonitorSmartphone size={15} />
          {joinOnScreen ? "ปิด QR บนจอลูกค้า" : "ขึ้น QR บนจอลูกค้า"}
        </button>
        <button
          className="btn btn-outline-info d-inline-flex align-items-center gap-1"
          onClick={() => setShowQr(true)}
        >
          <QrCode size={15} /> QR สำหรับปริ้น
        </button>
        <div className="ms-auto small text-muted d-flex align-items-center gap-3">
          <span className="d-inline-flex align-items-center gap-1">
            <Users size={14} /> {rows.length} คน
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <Star size={14} /> {totalPoints} แต้มค้างในระบบ
          </span>
        </div>
      </div>

      <div className="alert alert-secondary py-2 small d-flex flex-wrap gap-3">
        <span>
          <Gift size={14} /> โซฟา/รถแข่ง เล่น <b>{cfg.hours_per_point_ps5}</b> ชม. = 1 แต้ม
        </span>
        <span>
          โซน PC เล่น <b>{cfg.hours_per_point_pc}</b> ชม. = 1 แต้ม
        </span>
        <span>
          แลก <b>{cfg.redeem_cost}</b> แต้ม = เล่นฟรี 1 ชม. (เฉพาะ {zonesLabel(cfg.redeem_zones)})
        </span>
      </div>

      {err && <div className="alert alert-danger">{err}</div>}

      <div className="table-responsive">
        <table className="table table-hover align-middle">
          <thead>
            <tr>
              <th>ชื่อ</th>
              <th>เบอร์โทร</th>
              <th className="text-center">แต้มคงเหลือ</th>
              <th className="text-center">สะสมทั้งหมด</th>
              <th className="text-center">มาแล้ว</th>
              <th>มาล่าสุด</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted py-4">
                  กำลังโหลด...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted py-4">
                  ยังไม่มีสมาชิก
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="fw-bold">{m.name}</td>
                <td className="font-monospace">{formatPhone(m.phone)}</td>
                <td className="text-center">
                  <span className="badge bg-warning text-dark" style={{ fontSize: ".95rem" }}>
                    <Star size={12} /> {m.points}
                  </span>
                </td>
                <td className="text-center text-muted">{m.lifetime_points}</td>
                <td className="text-center text-muted">{m.visits} ครั้ง</td>
                <td className="small text-muted">
                  {m.last_visit_at ? new Date(m.last_visit_at).toLocaleDateString("th-TH") : "—"}
                </td>
                <td className="text-end">
                  <button className="btn btn-sm btn-outline-primary" onClick={() => setDetail(m)}>
                    <History size={14} /> รายละเอียด
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && <MemberDetail member={detail} onClose={() => setDetail(null)} onChanged={load} />}
      {showQr && <JoinQrModal onClose={() => setShowQr(false)} />}
      {showNew && <NewMemberModal onClose={() => setShowNew(false)} onDone={load} />}
    </>
  );
}

// ================= รายละเอียดสมาชิก =================

function MemberDetail({
  member,
  onClose,
  onChanged,
}: {
  member: Member;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tx, setTx] = useState<PointTransaction[]>([]);
  const [name, setName] = useState(member.name);
  const [phone, setPhone] = useState(member.phone);
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState(member.points);

  useEffect(() => {
    listMemberTransactions(member.id)
      .then(setTx)
      .catch((e) => console.warn("[members] tx:", e));
  }, [member.id]);

  async function saveProfile() {
    if (busy) return;
    setBusy(true);
    try {
      await updateMember(member.id, { name: name.trim(), phone: normalizePhone(phone) });
      onChanged();
      onClose();
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doAdjust(sign: 1 | -1) {
    const n = Math.abs(parseInt(delta, 10) || 0);
    if (!n || busy) return;
    setBusy(true);
    try {
      const left = await adjustPoints(member.id, sign * n, note.trim() || undefined);
      setPoints(left);
      setDelta("");
      setNote("");
      setTx(await listMemberTransactions(member.id));
      onChanged();
    } catch (e) {
      alert("ปรับแต้มไม่สำเร็จ: " + errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom modal-lg-custom" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header bg-primary text-white">
          <h5 className="modal-title fw-bold m-0">🎫 {member.name}</h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <div className="p-4">
          <div className="row g-3">
            <div className="col-md-5">
              <div className="p-3 bg-light rounded-3">
                <div className="text-center mb-3">
                  <div className="small text-muted">แต้มคงเหลือ</div>
                  <div
                    className="fw-bold text-warning"
                    style={{ fontSize: "2.4rem", lineHeight: 1.1 }}
                  >
                    {points}
                  </div>
                  <div className="small text-muted">
                    สะสมทั้งหมด {member.lifetime_points} · มา {member.visits} ครั้ง
                  </div>
                </div>

                <label className="small fw-bold">ชื่อ</label>
                <input
                  className="form-control mb-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                />
                <label className="small fw-bold">เบอร์โทร</label>
                <input
                  className="form-control mb-2"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={20}
                />
                <button
                  className="btn btn-primary w-100 btn-sm"
                  onClick={saveProfile}
                  disabled={busy}
                >
                  บันทึกข้อมูล
                </button>

                <hr />

                <label className="small fw-bold">ปรับแต้มด้วยมือ</label>
                <input
                  className="form-control mb-2"
                  type="number"
                  min={1}
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="จำนวนแต้ม"
                />
                <input
                  className="form-control mb-2"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="เหตุผล (เช่น ชดเชยเครื่องเสีย)"
                  maxLength={100}
                />
                <div className="d-flex gap-2">
                  <button
                    className="btn btn-success btn-sm flex-fill"
                    onClick={() => doAdjust(1)}
                    disabled={busy}
                  >
                    <Plus size={14} /> เพิ่ม
                  </button>
                  <button
                    className="btn btn-outline-danger btn-sm flex-fill"
                    onClick={() => doAdjust(-1)}
                    disabled={busy}
                  >
                    <Minus size={14} /> หัก
                  </button>
                </div>
              </div>
            </div>

            <div className="col-md-7">
              <div className="fw-bold mb-2 d-flex align-items-center gap-1">
                <History size={16} /> ประวัติแต้ม
              </div>
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                <table className="table table-sm align-middle">
                  <tbody>
                    {tx.length === 0 && (
                      <tr>
                        <td className="text-center text-muted py-3">ยังไม่มีรายการ</td>
                      </tr>
                    )}
                    {tx.map((t) => (
                      <tr key={t.id}>
                        <td className="small text-muted" style={{ whiteSpace: "nowrap" }}>
                          {new Date(t.created_at).toLocaleString("th-TH", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="small">
                          {reasonLabel(t)}
                          {t.note && (
                            <div className="text-muted" style={{ fontSize: ".78rem" }}>
                              {t.note}
                            </div>
                          )}
                        </td>
                        <td className="text-end fw-bold" style={{ whiteSpace: "nowrap" }}>
                          <span className={t.delta >= 0 ? "text-success" : "text-danger"}>
                            {t.delta >= 0 ? "+" : ""}
                            {t.delta}
                          </span>
                          <div className="small text-muted fw-normal">เหลือ {t.balance_after}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================= สมัครสมาชิกจากหน้าแอดมิน =================

function NewMemberModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await registerMember(name, phone);
      if (r.status === "created") {
        onDone();
        onClose();
        return;
      }
      setMsg(r.message);
    } catch (e) {
      setMsg(setupHint(e) ?? errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header bg-success text-white">
          <h5 className="modal-title fw-bold m-0">➕ เพิ่มสมาชิกใหม่</h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <div className="p-4">
          <label className="form-label fw-bold">ชื่อ</label>
          <input
            className="form-control mb-3"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
          <label className="form-label fw-bold">
            <Phone size={14} /> เบอร์โทร
          </label>
          <input
            className="form-control mb-2"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="numeric"
            maxLength={20}
          />
          {msg && <div className="alert alert-warning py-2 small">{msg}</div>}
          <button
            className="btn btn-success w-100 fw-bold mt-2"
            onClick={submit}
            disabled={busy || name.trim().length < 2 || normalizePhone(phone).length < 9}
          >
            {busy ? "กำลังบันทึก..." : "สมัครสมาชิก"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ================= QR สมัครสมาชิก (ไว้ปริ้นติดหน้าร้าน) =================

export function JoinQrModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [img, setImg] = useState("");

  useEffect(() => {
    const target = `${window.location.origin}/join`;
    setUrl(target);
    QRCode.toDataURL(target, { width: 460, margin: 2 }).then(setImg).catch(console.error);
  }, []);

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header bg-info text-white">
          <h5 className="modal-title fw-bold m-0">📱 QR สมัครสมาชิก</h5>
          <button className="btn-close btn-close-white" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="p-4 text-center">
          {img ? (
            <img
              src={img}
              alt="QR สมัครสมาชิก"
              style={{ width: "100%", maxWidth: 320, borderRadius: 12 }}
            />
          ) : (
            "กำลังสร้าง QR..."
          )}
          <div className="small text-muted mt-3 font-monospace" style={{ wordBreak: "break-all" }}>
            {url}
          </div>
          <div className="small text-muted mt-2">
            ลูกค้าสแกนแล้วกรอกชื่อ + เบอร์โทร เป็นสมาชิกทันที
          </div>
          <button className="btn btn-outline-secondary mt-3" onClick={() => window.print()}>
            ปริ้น
          </button>
        </div>
      </div>
    </div>
  );
}

function reasonLabel(t: PointTransaction): string {
  if (t.reason === "earn_play") {
    const z =
      t.zone === "sofa" ? "โซฟา" : t.zone === "racing" ? "รถแข่ง" : t.zone === "pc" ? "PC" : "";
    const dur =
      t.zone === "pc" && t.minutes ? `${t.minutes} นาที` : t.hours ? `${t.hours} ชม.` : "";
    return `เล่น${z ? " " + z : ""} ${dur}`.trim();
  }
  if (t.reason === "redeem_free_hour") return "แลกเล่นฟรี 1 ชั่วโมง";
  return "ปรับแต้มโดยพนักงาน";
}

function zonesLabel(zones: string): string {
  return zones
    .split(",")
    .map((z) => z.trim())
    .map((z) => (z === "sofa" ? "โซฟา" : z === "racing" ? "รถแข่ง" : z === "pc" ? "PC" : z))
    .join(" / ");
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function setupHint(e: unknown): string | null {
  const msg = errText(e);
  const code = (e as { code?: string } | null)?.code ?? "";
  if (
    code === "PGRST205" ||
    code === "PGRST202" ||
    code === "42P01" ||
    /Could not find the (table|function)/i.test(msg)
  ) {
    return "ยังไม่ได้ติดตั้งระบบสมาชิก — เปิด Supabase SQL Editor แล้วรัน supabase/members_migration.sql";
  }
  return null;
}
