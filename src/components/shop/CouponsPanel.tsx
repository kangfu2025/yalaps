import { useEffect, useState } from "react";
import { Ticket, Plus, Copy, XCircle, RefreshCw, Search, CalendarPlus } from "lucide-react";
import { supabase, type Coupon, type CouponStatus } from "@/lib/supabase";
import { issueCoupon, listCoupons, cancelCoupon, extendCouponExpiry, couponStatusLabel, couponStatusBadge } from "@/lib/coupons";
import { formatBaht } from "@/lib/priceEngine";
import { PromptPayQR } from "./PromptPayQR";

const MINUTE_OPTIONS = [30, 60, 90, 120, 180, 240];
const DEFAULT_HOUR_PRICE = 40; // บาท/ชม.

type PayMode = "cash" | "transfer" | "mixed";

export function CouponsPanel() {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [filter, setFilter] = useState<CouponStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showIssue, setShowIssue] = useState(false);
  const [issued, setIssued] = useState<Coupon | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await listCoupons({
        status: filter === "all" ? undefined : filter,
        search: search.trim() || undefined,
      });
      setRows(data);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);
  useEffect(() => {
    const ch = supabase.channel("coupons-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "coupons" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, []);

  const totalCash = rows.reduce((s, r) => s + Number(r.paid_cash), 0);
  const totalTransfer = rows.reduce((s, r) => s + Number(r.paid_transfer), 0);
  const totalPrice = rows.reduce((s, r) => s + Number(r.price_paid), 0);

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <button className="btn btn-primary fw-bold d-inline-flex align-items-center gap-1" onClick={() => setShowIssue(true)}>
          <Plus size={16} /> ออกคูปองใหม่
        </button>
        <div className="btn-group">
          {(["all", "active", "in_use", "depleted", "expired", "cancelled"] as const).map((s) => (
            <button key={s}
              className={`btn btn-sm ${filter === s ? "btn-secondary" : "btn-outline-secondary"}`}
              onClick={() => setFilter(s)}>
              {s === "all" ? "ทั้งหมด" : couponStatusLabel(s as CouponStatus)}
            </button>
          ))}
        </div>
        <div className="input-group input-group-sm" style={{ maxWidth: 260 }}>
          <input className="form-control" placeholder="ค้นหา code / ชื่อ..." value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(); }} />
          <button className="btn btn-outline-primary" onClick={load}><Search size={14} /></button>
        </div>
        <button className="btn btn-sm btn-outline-primary" onClick={load}><RefreshCw size={14} /></button>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-md-4"><div className="p-3 bg-white rounded-3 shadow-sm border-start border-success border-4"><small className="text-muted">💵 เงินสดจากคูปอง</small><h4 className="m-0 text-success fw-bold">{formatBaht(totalCash)} บาท</h4></div></div>
        <div className="col-md-4"><div className="p-3 bg-white rounded-3 shadow-sm border-start border-primary border-4"><small className="text-muted">📱 เงินโอนจากคูปอง</small><h4 className="m-0 text-primary fw-bold">{formatBaht(totalTransfer)} บาท</h4></div></div>
        <div className="col-md-4"><div className="p-3 bg-white rounded-3 shadow-sm border-start border-warning border-4"><small className="text-muted">📊 ยอดขายคูปองรวม</small><h4 className="m-0 fw-bold" style={{ color: "#b45309" }}>{formatBaht(totalPrice)} บาท</h4></div></div>
      </div>

      <div className="table-responsive">
        <table className="table table-hover align-middle">
          <thead>
            <tr>
              <th>วันที่</th><th>รหัส</th><th>ลูกค้า</th><th>เวลา (นาที)</th><th>คงเหลือ</th><th>ยอด</th><th>สถานะ</th><th>หมดอายุ</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center text-muted py-3">กำลังโหลด...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-muted py-3">ไม่มีคูปอง</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id}>
                <td className="small">{new Date(c.paid_at).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td>
                  <b className="font-monospace">{c.code}</b>
                  <button className="btn btn-link btn-sm p-0 ms-1" title="คัดลอก" onClick={() => navigator.clipboard.writeText(c.code)}>
                    <Copy size={12} />
                  </button>
                </td>
                <td>{c.customer_name || <span className="text-muted">-</span>}</td>
                <td>{c.total_minutes}</td>
                <td><b className={c.remaining_minutes > 0 ? "text-success" : "text-muted"}>{c.remaining_minutes}</b></td>
                <td>{formatBaht(c.price_paid)}</td>
                <td><span className={`badge ${couponStatusBadge(c.status)}`}>{couponStatusLabel(c.status)}</span></td>
                <td className="small text-muted">{c.expires_at ? new Date(c.expires_at).toLocaleDateString("th-TH") : "-"}</td>
                <td>
                  {c.status !== "cancelled" && c.status !== "in_use" && (
                    <div className="btn-group btn-group-sm">
                      <button className="btn btn-outline-secondary" title="ต่ออายุ 30 วัน"
                        onClick={async () => { if (confirm("ต่ออายุคูปองนี้ 30 วัน?")) { await extendCouponExpiry(c.id, 30); load(); } }}>
                        <CalendarPlus size={13} />
                      </button>
                      <button className="btn btn-outline-danger" title="ยกเลิก"
                        onClick={async () => { if (confirm(`ยกเลิกคูปอง ${c.code}?`)) { await cancelCoupon(c.id); load(); } }}>
                        <XCircle size={13} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showIssue && <IssueModal onClose={() => setShowIssue(false)} onIssued={(c) => { setShowIssue(false); setIssued(c); load(); }} />}
      {issued && <IssuedResultModal coupon={issued} onClose={() => setIssued(null)} />}
    </div>
  );
}

function IssueModal({ onClose, onIssued }: { onClose: () => void; onIssued: (c: Coupon) => void }) {
  const [minutes, setMinutes] = useState(60);
  const [customMinutes, setCustomMinutes] = useState("");
  const [price, setPrice] = useState<number>(DEFAULT_HOUR_PRICE);
  const [priceEdited, setPriceEdited] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [cash, setCash] = useState("");
  const [transfer, setTransfer] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [expireDays, setExpireDays] = useState(30);
  const [busy, setBusy] = useState(false);

  const totalMinutes = customMinutes ? Number(customMinutes) || 0 : minutes;

  // Auto-calc price = ceil to nearest ชม./ครึ่ง ชม. (ตัดง่ายๆ ให้ 40/ชม. หรือ 20/ครึ่งชม.)
  useEffect(() => {
    if (priceEdited) return;
    const halves = Math.round(totalMinutes / 30);
    const fullHours = Math.floor(halves / 2);
    const extraHalf = halves % 2;
    setPrice(fullHours * DEFAULT_HOUR_PRICE + extraHalf * (DEFAULT_HOUR_PRICE / 2));
  }, [totalMinutes, priceEdited]);

  const qrAmount = payMode === "transfer" ? price : payMode === "mixed" ? Number(transfer) || 0 : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (totalMinutes <= 0) { alert("กรุณาระบุจำนวนนาที"); return; }
    if (price <= 0) { alert("กรุณาระบุราคา"); return; }
    let c = 0, t = 0;
    if (payMode === "cash") c = price;
    else if (payMode === "transfer") t = price;
    else { c = Number(cash) || 0; t = Number(transfer) || 0; }
    setBusy(true);
    try {
      const coupon = await issueCoupon({
        minutes: totalMinutes, price, cash: c, transfer: t,
        customerName: name.trim() || undefined,
        customerPhone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
        expireDays,
      });
      onIssued(coupon);
    } catch (err) {
      alert("ออกคูปองไม่สำเร็จ: " + (err instanceof Error ? err.message : String(err)));
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header bg-primary text-white">
          <h5 className="modal-title fw-bold m-0"><Ticket className="me-2" size={18} />ออกคูปองใหม่</h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <form onSubmit={submit} className="p-4">
          <div className="mb-3">
            <label className="form-label fw-bold">⏱️ จำนวนเวลา</label>
            <div className="d-flex flex-wrap gap-2 mb-2">
              {MINUTE_OPTIONS.map((mm) => (
                <button type="button" key={mm}
                  className={`btn btn-sm ${!customMinutes && minutes === mm ? "btn-primary" : "btn-outline-primary"}`}
                  onClick={() => { setMinutes(mm); setCustomMinutes(""); setPriceEdited(false); }}>
                  {mm >= 60 ? `${mm / 60} ชม.` : `${mm} นาที`}
                </button>
              ))}
            </div>
            <input type="number" className="form-control" placeholder="หรือระบุเอง (นาที)"
              value={customMinutes} onChange={(e) => { setCustomMinutes(e.target.value); setPriceEdited(false); }} />
          </div>

          <div className="row g-2 mb-3">
            <div className="col-6">
              <label className="form-label fw-bold small">💰 ราคา (บาท)</label>
              <input type="number" className="form-control" value={price}
                onChange={(e) => { setPrice(Number(e.target.value) || 0); setPriceEdited(true); }} />
            </div>
            <div className="col-6">
              <label className="form-label fw-bold small">📅 อายุคูปอง (วัน)</label>
              <input type="number" className="form-control" value={expireDays}
                onChange={(e) => setExpireDays(Number(e.target.value) || 0)} />
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">💳 ช่องทางชำระ</label>
            <div className="radio-box">
              {(["cash", "transfer", "mixed"] as const).map((m) => (
                <label key={m} className="radio-item">
                  <input type="radio" name="couponPay" checked={payMode === m} onChange={() => setPayMode(m)} />
                  {m === "cash" ? "เงินสด" : m === "transfer" ? "โอน" : "ผสม"}
                </label>
              ))}
            </div>
          </div>

          {payMode === "mixed" && (
            <div className="row g-2 mb-3">
              <div className="col-6">
                <label className="small text-success fw-bold">💵 เงินสด</label>
                <input type="number" className="form-control" value={cash} onChange={(e) => setCash(e.target.value)} />
              </div>
              <div className="col-6">
                <label className="small text-primary fw-bold">📱 เงินโอน</label>
                <input type="number" className="form-control" value={transfer} onChange={(e) => setTransfer(e.target.value)} />
              </div>
            </div>
          )}

          <div className="row g-2 mb-3">
            <div className="col-6">
              <label className="form-label fw-bold small">👤 ชื่อลูกค้า (ไม่บังคับ)</label>
              <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="col-6">
              <label className="form-label fw-bold small">📞 เบอร์ (ไม่บังคับ)</label>
              <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold small">📝 หมายเหตุ</label>
            <input className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <PromptPayQR amount={qrAmount} />

          <div className="modal-footer border-0 mt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
            <button type="submit" className="btn btn-primary fw-bold" disabled={busy}>
              {busy ? "กำลังออก..." : "🎟️ ออกคูปอง"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IssuedResultModal({ coupon, onClose }: { coupon: Coupon; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header bg-success text-white">
          <h5 className="modal-title fw-bold m-0">✅ ออกคูปองสำเร็จ</h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <div className="p-4 text-center">
          <div className="text-muted small mb-2">แจ้งรหัสนี้ให้ลูกค้า:</div>
          <div className="p-3 bg-light rounded-3 mb-3">
            <div className="font-monospace fw-bold" style={{ fontSize: "2rem", letterSpacing: "3px" }}>{coupon.code}</div>
          </div>
          <div className="text-start small mb-3">
            <div>⏱️ เวลา: <b>{coupon.total_minutes} นาที</b></div>
            <div>💰 ราคา: <b>{formatBaht(coupon.price_paid)} บาท</b></div>
            {coupon.expires_at && <div>📅 หมดอายุ: <b>{new Date(coupon.expires_at).toLocaleDateString("th-TH")}</b></div>}
            {coupon.customer_name && <div>👤 ลูกค้า: <b>{coupon.customer_name}</b></div>}
          </div>
          <div className="d-grid gap-2">
            <button className="btn btn-outline-primary" onClick={() => {
              navigator.clipboard.writeText(coupon.code); setCopied(true); setTimeout(() => setCopied(false), 1500);
            }}>
              <Copy size={14} /> {copied ? "คัดลอกแล้ว!" : "คัดลอกรหัส"}
            </button>
            <button className="btn btn-outline-secondary" onClick={() => window.print()}>🖨️ พิมพ์</button>
            <button className="btn btn-success" onClick={onClose}>เสร็จสิ้น</button>
          </div>
        </div>
      </div>
    </div>
  );
}
