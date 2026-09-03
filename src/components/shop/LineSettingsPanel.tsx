import { useCallback, useEffect, useState } from "react";
import {
  MessageCircle,
  Send,
  Save,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Activity,
} from "lucide-react";
import {
  getLineConfig,
  saveLineConfig,
  sendLineTest,
  lineUsageThisMonth,
  checkLineStatus,
  LINE_EVENT_LABELS,
  type LineConfig,
  type LineEvent,
  type LineStatus,
} from "@/lib/lineNotify";
import { buildTestMessage } from "@/lib/lineMessages";

/** แพ็กฟรีของ LINE OA ให้ 300 ข้อความ/เดือน */
const FREE_QUOTA = 300;

export function LineSettingsPanel() {
  const [cfg, setCfg] = useState<LineConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [status, setStatus] = useState<LineStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const c = await getLineConfig(true);
    if (!c) setNotReady(true);
    setCfg(c);
    lineUsageThisMonth()
      .then(setUsage)
      .catch(() => setUsage(null));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(patch: Partial<LineConfig>) {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    setBusy(true);
    setMsg(null);
    try {
      await saveLineConfig(patch);
      setMsg({ ok: true, text: "บันทึกแล้ว" });
    } catch (e) {
      setMsg({
        ok: false,
        text: "บันทึกไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendLineTest(buildTestMessage());
      setMsg(
        r.ok
          ? { ok: true, text: "ส่งแล้ว — เช็คใน LINE ได้เลย" }
          : { ok: false, text: r.error ?? "ส่งไม่สำเร็จ" },
      );
      lineUsageThisMonth()
        .then(setUsage)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-center py-5 text-muted">กำลังโหลด...</div>;

  if (notReady || !cfg) {
    return (
      <div className="alert alert-warning">
        <b>ยังไม่ได้ติดตั้งระบบแจ้งเตือน LINE</b>
        <div className="small mt-1">
          เปิด Supabase SQL Editor แล้วรัน <code>supabase/line_migration.sql</code>{" "}
          จากนั้นรีเฟรชหน้านี้
        </div>
      </div>
    );
  }

  const events = cfg.events ?? {};
  const overQuota = usage != null && usage >= FREE_QUOTA;

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="alert alert-secondary small">
        <b>LINE Notify ปิดบริการไปแล้ว</b> ตั้งแต่ 31 มี.ค. 2568 ระบบนี้ใช้ LINE Official Account +
        Messaging API แทน · แพ็กฟรีส่งได้ <b>{FREE_QUOTA}</b> ข้อความ/เดือน
        ส่งเข้ากลุ่มจะนับตามจำนวนคนในกลุ่ม
      </div>

      <div className="card p-3 mb-3">
        <div className="form-check form-switch mb-3">
          <input
            className="form-check-input"
            type="checkbox"
            id="lineEnabled"
            checked={cfg.enabled}
            disabled={busy}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          <label className="form-check-label fw-bold" htmlFor="lineEnabled">
            <MessageCircle size={16} /> เปิดใช้งานแจ้งเตือน LINE
          </label>
        </div>

        <label className="form-label fw-bold small">ปลายทาง (User ID หรือ Group ID)</label>
        <input
          className="form-control font-monospace"
          value={cfg.target_id ?? ""}
          placeholder="Uxxxxxxxxxxxxxxxx หรือ Cxxxxxxxxxxxxxxxx"
          onChange={(e) => setCfg({ ...cfg, target_id: e.target.value })}
          onBlur={(e) => save({ target_id: e.target.value.trim() || null })}
        />
        <div className="small text-muted mt-1">
          หา ID ได้จาก LINE Developers Console หรือใช้ webhook.site รับ event ตอนทักหา OA ครั้งแรก
        </div>

        <label className="form-label fw-bold small mt-3">ชื่อเรียกปลายทาง (ไว้จำเฉย ๆ)</label>
        <input
          className="form-control"
          value={cfg.target_label ?? ""}
          placeholder="เช่น กลุ่มเจ้าของร้าน"
          onChange={(e) => setCfg({ ...cfg, target_label: e.target.value })}
          onBlur={(e) => save({ target_label: e.target.value.trim() || null })}
        />
      </div>

      <div className="card p-3 mb-3">
        <div className="fw-bold mb-2">แจ้งเตือนเหตุการณ์ไหนบ้าง</div>
        {(Object.keys(LINE_EVENT_LABELS) as Exclude<LineEvent, "test">[]).map((k) => (
          <div className="form-check" key={k}>
            <input
              className="form-check-input"
              type="checkbox"
              id={`ev-${k}`}
              checked={events[k] !== false}
              disabled={busy}
              onChange={(e) => save({ events: { ...events, [k]: e.target.checked } })}
            />
            <label className="form-check-label" htmlFor={`ev-${k}`}>
              {LINE_EVENT_LABELS[k]}
            </label>
          </div>
        ))}
        <div className="small text-muted mt-2">
          เปิดทุกอย่างจะกินโควตาเร็วมาก — ร้านที่มีบิลวันละ 20 ใบ ถ้าเปิดทั้งเปิดเครื่องและปิดบิล
          จะใช้ราว 1,200 ข้อความ/เดือน เกินแพ็กฟรีไปมาก แนะนำให้เปิดเฉพาะที่จำเป็นจริง ๆ
        </div>
      </div>

      <div className="d-flex align-items-center gap-3 flex-wrap mb-3">
        <button
          className="btn btn-outline-primary d-inline-flex align-items-center gap-1"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            setStatus(null);
            setMsg(null);
            try {
              setStatus(await checkLineStatus());
            } finally {
              setChecking(false);
            }
          }}
        >
          <Activity size={15} /> {checking ? "กำลังตรวจ..." : "ตรวจโทเคน"}
        </button>
        <button
          className="btn btn-primary d-inline-flex align-items-center gap-1"
          onClick={test}
          disabled={busy}
        >
          <Send size={15} /> ส่งข้อความทดสอบ
        </button>
        {usage != null && (
          <span
            className={`small d-inline-flex align-items-center gap-1 ${overQuota ? "text-danger fw-bold" : "text-muted"}`}
          >
            <Gauge size={14} /> เดือนนี้ส่งไปแล้ว {usage} / {FREE_QUOTA} ข้อความ
            {overQuota && " — เกินแพ็กฟรีแล้ว"}
          </span>
        )}
      </div>

      {status && <StatusBox status={status} />}

      {msg && (
        <div
          className={`alert ${msg.ok ? "alert-success" : "alert-danger"} py-2 d-flex align-items-center gap-2`}
        >
          {msg.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {msg.text}
        </div>
      )}

      <div className="card p-3">
        <div className="fw-bold mb-2 d-inline-flex align-items-center gap-1">
          <Save size={15} /> ตั้งค่าฝั่งเซิร์ฟเวอร์
        </div>
        <div className="small text-muted" style={{ lineHeight: 1.9 }}>
          Channel access token ไม่ได้เก็บในฐานข้อมูล เพราะพนักงานทุกคนอ่านตารางนี้ได้ — ต้องใส่เป็น
          environment variable ชื่อ <code>LINE_CHANNEL_ACCESS_TOKEN</code> ในไฟล์ <code>.env</code>{" "}
          แล้วรีสตาร์ตเซิร์ฟเวอร์ (หรือตั้งใน environment variables ของโฮสต์)
        </div>
      </div>
    </div>
  );
}

/** ผลการตรวจโทเคน — บอกให้ชัดว่าโทเคนผูกกับ OA ตัวไหน */
function StatusBox({ status }: { status: LineStatus }) {
  if (status.ok) {
    return (
      <div className="alert alert-success py-2 small">
        <div className="fw-bold d-inline-flex align-items-center gap-2 mb-1">
          <CheckCircle2 size={16} /> โทเคนใช้ได้
        </div>
        <div>
          ผูกกับ Official Account: <b>{status.bot?.displayName ?? "-"}</b>
          {status.bot?.basicId ? ` (${status.bot.basicId})` : ""}
        </div>
        {status.quota?.value != null && <div>โควตาเดือนนี้: {status.quota.value} ข้อความ</div>}
        <div className="text-muted mt-1">
          ถ้าส่งทดสอบแล้วยังไม่เข้า แปลว่าปลายทาง (User ID) ผิด หรือยังไม่ได้เพิ่ม OA นี้เป็นเพื่อน
        </div>
      </div>
    );
  }

  return (
    <div className="alert alert-danger py-2 small">
      <div className="fw-bold d-inline-flex align-items-center gap-2 mb-1">
        <AlertTriangle size={16} /> {status.error}
        {status.httpStatus ? ` (HTTP ${status.httpStatus})` : ""}
      </div>
      {status.shape && (
        <div className="text-muted">
          โทเคนที่เซิร์ฟเวอร์อ่านได้: ยาว <b>{status.shape.length}</b> ตัวอักษร ·{" "}
          {status.shape.preview}
          {status.shape.hasWhitespace && " · มีช่องว่างปนอยู่"}
        </div>
      )}
      {status.hints && status.hints.length > 0 && (
        <ul className="mt-2 mb-0 ps-3">
          {status.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
