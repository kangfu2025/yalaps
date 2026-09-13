import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Server,
  Wallet,
  History,
} from "lucide-react";
import {
  pingPayWatch,
  payWatchEnabled,
  setPayWatchEnabled,
  type PayWatchFailed,
} from "@/lib/payWatch";
import { supabase } from "@/lib/supabase";
import { formatBaht } from "@/lib/priceEngine";

interface WatchRow {
  id: string;
  ref: string;
  amount: number;
  unique_amount: number;
  status: string;
  bank: string | null;
  memo: string | null;
  confirmed_at: string | null;
  created_at: string;
}

type Ping = Awaited<ReturnType<typeof pingPayWatch>>;

export function PayWatchPanel() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [ping, setPing] = useState<Ping | null>(null);
  const [rows, setRows] = useState<WatchRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEnabled(await payWatchEnabled(true));
      const { data, error } = await supabase
        .from("payment_watches")
        .select("id,ref,amount,unique_amount,status,bank,memo,confirmed_at,created_at")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      setRows((data ?? []) as WatchRow[]);
      setNotReady(false);
    } catch (e) {
      const code = (e as { code?: string } | null)?.code ?? "";
      const msg = e instanceof Error ? e.message : String(e);
      if (code === "PGRST205" || code === "42P01" || /Could not find the table/i.test(msg)) {
        setNotReady(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      await setPayWatchEnabled(on);
      setEnabled(on);
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-center py-5 text-muted">กำลังโหลด...</div>;

  if (notReady) {
    return (
      <div className="alert alert-warning">
        <b>ยังไม่ได้ติดตั้งระบบตรวจเงินเข้า</b>
        <div className="small mt-1">
          เปิด Supabase SQL Editor แล้วรัน <code>supabase/payment_watch_migration.sql</code>{" "}
          จากนั้นรีเฟรชหน้านี้
        </div>
      </div>
    );
  }

  const failed = ping && !ping.ok ? (ping as PayWatchFailed) : null;

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="alert alert-secondary small">
        ระบบจะขอ QR ที่มี <b>ยอดลงท้ายไม่ซ้ำกัน</b> ให้แต่ละบิล (เช่น 100.47) พอเงินเข้าบัญชีจริง
        ผู้ให้บริการจะแจ้งกลับมา ระบบจึงจับคู่กับบิลได้แน่นอนโดยไม่ต้องสแกนสลิป · ค่าบริการ{" "}
        <b>฿0.59</b> ต่อรายการที่สำเร็จ
      </div>

      <div className="card p-3 mb-3">
        <div className="form-check form-switch">
          <input
            className="form-check-input"
            type="checkbox"
            id="pwEnabled"
            checked={enabled}
            disabled={busy}
            onChange={(e) => toggle(e.target.checked)}
          />
          <label className="form-check-label fw-bold" htmlFor="pwEnabled">
            <BellRing size={16} /> เปิดใช้งานตรวจเงินเข้าอัตโนมัติ
          </label>
        </div>
        <div className="small text-muted mt-2">
          ปิดอยู่ = ใช้การสแกนสลิปแบบเดิมทั้งหมด · เปิดแล้วปุ่ม “รอเงินเข้าอัตโนมัติ”
          จะโผล่ในหน้าเปิดบิลและปิดบิล ส่วนการสแกนสลิปยังใช้ได้ตามปกติเป็นตัวสำรอง
        </div>
      </div>

      <div className="d-flex align-items-center gap-3 flex-wrap mb-3">
        <button
          className="btn btn-outline-primary d-inline-flex align-items-center gap-1"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            setPing(null);
            try {
              setPing(await pingPayWatch());
            } finally {
              setChecking(false);
            }
          }}
        >
          <Activity size={15} /> {checking ? "กำลังตรวจ..." : "ตรวจการเชื่อมต่อ"}
        </button>
        <button className="btn btn-outline-secondary" onClick={load}>
          รีเฟรชรายการ
        </button>
      </div>

      {ping?.ok && (
        <div className="alert alert-success py-2 small">
          <div className="fw-bold d-inline-flex align-items-center gap-2 mb-1">
            <CheckCircle2 size={16} /> เชื่อมต่อ PlernPay ได้
          </div>
          {ping.clientId && <div>Client ID: {ping.clientId}</div>}
          {ping.note && <div className="text-muted">{ping.note}</div>}
          <ServerLine server={ping.server} />
        </div>
      )}

      {failed && (
        <div className="alert alert-danger py-2 small">
          <div className="fw-bold d-inline-flex align-items-center gap-2 mb-1">
            <AlertTriangle size={16} /> {failed.error}
            {failed.httpStatus ? ` (HTTP ${failed.httpStatus})` : ""}
          </div>
          <ServerLine server={failed.server} />
        </div>
      )}

      <div className="card p-3 mb-3">
        <div className="fw-bold mb-2 d-inline-flex align-items-center gap-1">
          <Wallet size={15} /> ตั้งค่าฝั่งเซิร์ฟเวอร์
        </div>
        <div className="small text-muted" style={{ lineHeight: 1.9 }}>
          คีย์ไม่ได้เก็บในฐานข้อมูล — ใส่เป็น environment variable สองตัว:
          <br />
          <code>PLERNPAY_CLIENT_ID</code> (ขึ้นต้น <code>pi_</code>) และ{" "}
          <code>PLERNPAY_CLIENT_SECRET</code> (ขึ้นต้น <code>ps_</code>)
        </div>
        <div className="alert alert-warning small mt-2 mb-0" style={{ lineHeight: 1.9 }}>
          <b>ต้องใส่ 2 ที่เหมือนกับคีย์ตัวอื่น</b> — ไฟล์ <code>.env</code> บนเครื่องร้าน และ
          Environment variables ของโฮสต์สำหรับเว็บที่ deploy (ไฟล์ .env ไม่ได้ขึ้น git)
        </div>
      </div>

      <div className="fw-bold mb-2 d-inline-flex align-items-center gap-1">
        <History size={16} /> รายการล่าสุด
      </div>
      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>เวลา</th>
              <th>รายการ</th>
              <th className="text-end">ยอดบิล</th>
              <th className="text-end">ยอดที่ให้โอน</th>
              <th className="text-center">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted py-4">
                  ยังไม่มีรายการ
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small text-muted" style={{ whiteSpace: "nowrap" }}>
                  {new Date(r.created_at).toLocaleString("th-TH", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="small">
                  {r.memo || <span className="text-muted">—</span>}
                  {r.bank && <div className="text-muted">ผ่าน {r.bank}</div>}
                </td>
                <td className="text-end">{formatBaht(Number(r.amount))}</td>
                <td className="text-end fw-bold">{Number(r.unique_amount).toFixed(2)}</td>
                <td className="text-center">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    confirmed: { cls: "bg-success", label: "เงินเข้าแล้ว" },
    pending: { cls: "bg-warning text-dark", label: "รอเงินเข้า" },
    expired: { cls: "bg-secondary", label: "หมดเวลา" },
    cancelled: { cls: "bg-secondary", label: "ยกเลิก" },
  };
  const m = map[status] ?? { cls: "bg-light text-dark", label: status };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function ServerLine({ server }: { server?: { host: string; isLocal: boolean } }) {
  if (!server) return null;
  return (
    <div className="text-muted mt-1">
      <Server size={13} /> เซิร์ฟเวอร์ที่ตอบ: <b>{server.host}</b>{" "}
      {server.isLocal ? "(เครื่องที่ร้าน)" : "(เว็บที่ deploy)"}
    </div>
  );
}
