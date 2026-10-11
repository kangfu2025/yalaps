import { useCallback, useEffect, useRef, useState } from "react";
import { Trophy, RefreshCw, ExternalLink, ImagePlus, Trash2, Eye, EyeOff } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  getRanking,
  getRankingProfile,
  saveRankingConsent,
  uploadMemberAvatar,
  removeMemberAvatar,
  currentRankMonth,
  rankMonthLabel,
  RankingNotReady,
  DISPLAY_NAME_MAX,
  type RankPeriod,
  type RankResult,
  type RankingProfile,
} from "@/lib/ranking";
import { MonthStepper } from "./MonthStepper";
import { ConfirmDialog } from "./ConfirmDialog";
import { RankAvatar, RankList, RankPodium, type BoardEntry } from "./RankingBoard";

const REFRESH_MS = 30_000;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ============================================================
// แท็บ "อันดับลูกค้า" ในหน้าแอดมิน
// ============================================================

export function RankingPanel() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [period, setPeriod] = useState<RankPeriod>("month");
  const [month, setMonth] = useState(currentRankMonth());
  const [data, setData] = useState<RankResult | null>(null);
  const [consented, setConsented] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [editing, setEditing] = useState<BoardEntry | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const [r, c] = await Promise.all([
        getRanking(period, month, 20),
        supabase
          .from("members")
          .select("id", { count: "exact", head: true })
          .eq("show_on_ranking", true)
          .eq("active", true),
      ]);
      if (id !== reqId.current) return; // ผลของคำขอเก่าที่ตอบช้า ทิ้งไป
      setData(r);
      setConsented(c.count ?? null);
      setErr(null);
      setNotReady(false);
    } catch (e) {
      if (id !== reqId.current) return;
      if (e instanceof RankingNotReady) setNotReady(true);
      else setErr(errText(e));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [period, month]);

  useEffect(() => {
    setLoading(true);
    void load();
    // อันดับอัปเดตเองจากข้อมูลจริง: ถามใหม่เป็นระยะ + ทันทีที่แต้มสมาชิกเปลี่ยน
    const t = setInterval(load, REFRESH_MS);
    const ch = supabase
      .channel("ranking-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => load())
      .subscribe();
    return () => {
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, [load]);

  if (notReady) {
    return (
      <div className="alert alert-warning">
        <b>ยังไม่ได้ติดตั้งระบบอันดับลูกค้า</b>
        <div className="small mt-1">
          เปิด Supabase SQL Editor แล้วรัน <code>supabase/ranking_migration.sql</code>{" "}
          จากนั้นรีเฟรชหน้านี้
        </div>
      </div>
    );
  }

  const entries: BoardEntry[] = (data?.rows ?? []).map((r) => ({
    key: r.member_id,
    rank: r.rank,
    name: r.display_name || r.name,
    sub: r.display_name ? r.name : undefined,
    avatarUrl: r.avatar_url,
    points: r.points,
    hidden: !r.show_on_ranking,
  }));
  const topPoints = entries[0]?.points ?? 0;

  return (
    <div className="yl-rk-admin">
      <div className="yl-rk-toolbar">
        <div className="yl-rk-seg" role="tablist" aria-label="ช่วงเวลา">
          <button
            role="tab"
            aria-selected={period === "month"}
            className={period === "month" ? "active" : ""}
            onClick={() => setPeriod("month")}
          >
            ประจำเดือน
          </button>
          <button
            role="tab"
            aria-selected={period === "all"}
            className={period === "all" ? "active" : ""}
            onClick={() => setPeriod("all")}
          >
            ตลอดกาล
          </button>
        </div>
        {period === "month" && <MonthStepper value={month} onChange={setMonth} />}
        <div className="ms-auto d-flex gap-2">
          <button
            className="btn btn-outline-secondary"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            title="รีเฟรช"
          >
            <RefreshCw size={15} />
          </button>
          <Link
            to="/ranking"
            target="_blank"
            className="btn btn-primary d-inline-flex align-items-center gap-1"
          >
            <ExternalLink size={15} /> เปิดจออันดับ
          </Link>
        </div>
      </div>

      <div className="yl-rk-meta">
        <span>
          <Trophy size={14} />{" "}
          {period === "month"
            ? `แต้มจากการเล่นในเดือน${rankMonthLabel(month)}`
            : "แต้มสะสมทั้งหมดตั้งแต่เป็นสมาชิก"}
        </span>
        {data && <span>มีแต้มในช่วงนี้ {data.total} คน</span>}
        {consented !== null && <span>ยินยอมแสดงบนจอลูกค้า {consented} คน</span>}
        <span className="text-muted">กดที่ชื่อเพื่อตั้งชื่อที่แสดง / รูป / ความยินยอม</span>
      </div>

      {err && <div className="alert alert-danger py-2 small">{err}</div>}

      {loading && !data ? (
        <div className="text-center py-5 text-muted">กำลังโหลดอันดับ...</div>
      ) : entries.length === 0 ? (
        <div className="yl-rk-empty">
          <Trophy size={40} />
          <b>ยังไม่มีอันดับในช่วงนี้</b>
          <span>
            {period === "month"
              ? "ยังไม่มีสมาชิกได้แต้มจากการเล่นในเดือนนี้"
              : "ยังไม่มีสมาชิกที่มีแต้มสะสม"}
          </span>
        </div>
      ) : (
        <div className="yl-rk-stage is-panel">
          <RankPodium entries={entries} onPick={setEditing} />
          <RankList entries={entries.slice(3)} topPoints={topPoints} onPick={setEditing} />
        </div>
      )}

      <div className="yl-rk-legend">
        <span className="yl-rk-hidden-tag">ไม่แสดงบนจอ</span> = ลูกค้ายังไม่ยินยอม
        จออันดับในร้านจะข้ามคนนี้และเลื่อนอันดับคนถัดไปขึ้นมาแทน
      </div>

      {editing && (
        <RankingProfileModal
          memberId={editing.key}
          realName={editing.sub ?? editing.name}
          isAdmin={isAdmin}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}

// ============================================================
// ตั้งค่าโปรไฟล์บนจออันดับ — ใช้ทั้งในแท็บอันดับและหน้ารายละเอียดสมาชิก
// ============================================================

function RankingProfileModal({
  memberId,
  realName,
  isAdmin,
  onClose,
  onSaved,
}: {
  memberId: string;
  realName: string;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header bg-primary text-white">
          <h5 className="modal-title fw-bold m-0 d-flex align-items-center gap-2">
            <Trophy size={18} /> โปรไฟล์บนจออันดับ
          </h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <div className="p-3">
          <div className="small text-muted mb-2">สมาชิก: {realName}</div>
          <RankingProfileEditor memberId={memberId} isAdmin={isAdmin} onSaved={onSaved} />
        </div>
      </div>
    </div>
  );
}

export function RankingProfileEditor({
  memberId,
  isAdmin,
  onSaved,
}: {
  memberId: string;
  isAdmin: boolean;
  onSaved?: () => void;
}) {
  const [profile, setProfile] = useState<RankingProfile | null>(null);
  const [nick, setNick] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "photo">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    getRankingProfile(memberId)
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        setNick(p.display_name ?? "");
        setShow(!!p.show_on_ranking);
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof RankingNotReady) setNotReady(true);
        else setMsg({ ok: false, text: errText(e) });
      });
    return () => {
      alive = false;
    };
  }, [memberId]);

  if (notReady) {
    return (
      <div className="small text-warning">
        ยังไม่ได้รัน <code>ranking_migration.sql</code> — ตั้งค่าจออันดับไม่ได้
      </div>
    );
  }
  if (!profile) return <div className="small text-muted">กำลังโหลด...</div>;

  const dirty = (profile.display_name ?? "") !== nick.trim() || !!profile.show_on_ranking !== show;
  const needName = show && !nick.trim();

  async function save() {
    if (!profile || busy) return;
    setBusy("save");
    setMsg(null);
    try {
      await saveRankingConsent(profile.id, nick, show);
      setProfile({ ...profile, display_name: nick.trim() || null, show_on_ranking: show });
      setNick(nick.trim());
      setMsg({
        ok: true,
        text: show ? "บันทึกแล้ว — ขึ้นจออันดับในร้าน" : "บันทึกแล้ว — ไม่แสดงบนจอ",
      });
      onSaved?.();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file || !profile) return;
    setBusy("photo");
    setMsg(null);
    try {
      setProfile(await uploadMemberAvatar(profile, file));
      setMsg({ ok: true, text: "อัปโหลดรูปแล้ว" });
      onSaved?.();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    if (!profile) return;
    setConfirmRemove(false);
    setBusy("photo");
    setMsg(null);
    try {
      setProfile(await removeMemberAvatar(profile));
      setMsg({ ok: true, text: "ลบรูปแล้ว — ใช้รูปเริ่มต้นแทน" });
      onSaved?.();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="yl-rk-editor">
      <div className="yl-rk-editor-photo">
        <RankAvatar url={profile.avatar_url ?? null} name={nick || "?"} className="is-lg" />
        <div className="d-flex flex-column gap-2">
          {isAdmin ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => void pickFile(e.target.files?.[0])}
              />
              <button
                type="button"
                className="btn btn-sm btn-outline-info d-inline-flex align-items-center gap-1"
                onClick={() => fileRef.current?.click()}
                disabled={!!busy}
              >
                <ImagePlus size={14} />
                {busy === "photo"
                  ? "กำลังอัปโหลด..."
                  : profile.avatar_url
                    ? "เปลี่ยนรูป"
                    : "เพิ่มรูป"}
              </button>
              {profile.avatar_url && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                  onClick={() => setConfirmRemove(true)}
                  disabled={!!busy}
                >
                  <Trash2 size={14} /> ลบรูป
                </button>
              )}
              <span className="form-text m-0">ระบบย่อรูปและครอปเป็นสี่เหลี่ยมให้อัตโนมัติ</span>
            </>
          ) : (
            <span className="form-text m-0">เฉพาะแอดมินเท่านั้นที่เพิ่ม/เปลี่ยน/ลบรูปได้</span>
          )}
        </div>
      </div>

      <label className="form-label small fw-bold mt-3 mb-1" htmlFor={`rk-nick-${memberId}`}>
        ชื่อที่แสดงบนจออันดับ (ชื่อเล่น)
      </label>
      <input
        id={`rk-nick-${memberId}`}
        className={`form-control ${needName ? "is-invalid" : ""}`}
        value={nick}
        maxLength={DISPLAY_NAME_MAX}
        onChange={(e) => setNick(e.target.value)}
        placeholder="เช่น บอส, KongZ, น้องดาว"
      />
      <div className="form-text">
        ห้ามใช้ชื่อ-นามสกุลจริงหรือเบอร์โทร · ไม่เกิน {DISPLAY_NAME_MAX} ตัวอักษร
      </div>

      <label className="yl-rk-consent mt-2" htmlFor={`rk-show-${memberId}`}>
        <input
          id={`rk-show-${memberId}`}
          type="checkbox"
          className="form-check-input"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
        />
        <span>
          {show ? <Eye size={15} /> : <EyeOff size={15} />} ลูกค้ายินยอมให้แสดงชื่อนี้ รูป และแต้ม
          บนจออันดับในร้าน
        </span>
      </label>
      {needName && <div className="invalid-feedback d-block">ตั้งชื่อที่แสดงก่อน</div>}

      {msg && (
        <div className={`small mt-2 ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</div>
      )}

      <button
        className="btn btn-primary w-100 btn-sm mt-2"
        onClick={() => void save()}
        disabled={!dirty || needName || !!busy}
      >
        {busy === "save" ? "กำลังบันทึก..." : "บันทึกการตั้งค่าจออันดับ"}
      </button>

      <ConfirmDialog
        open={confirmRemove}
        title="ลบรูปสมาชิก"
        icon="🗑️"
        variant="danger"
        confirmLabel="ลบรูป"
        cancelLabel="ไม่ลบ"
        message="ลบรูปนี้แล้วจะกลับไปใช้รูปเริ่มต้น"
        onConfirm={() => void removePhoto()}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
