import { useEffect, useState } from "react";
import { Tag, Plus, Trash2, Power, AlertTriangle, CalendarDays } from "lucide-react";
import {
  createPromotion,
  deletePromotion,
  listPromotions,
  promotionStatus,
  setPromotionActive,
  todayBangkok,
  type Promotion,
  type PromotionStatus,
} from "@/lib/promotions";
import { formatBaht } from "@/lib/priceEngine";
import { supabase } from "@/lib/supabase";

const STATUS_LABEL: Record<PromotionStatus, { label: string; cls: string }> = {
  active: { label: "กำลังใช้งาน", cls: "bg-success" },
  upcoming: { label: "กำลังจะเริ่ม", cls: "bg-info" },
  expired: { label: "หมดอายุ", cls: "bg-secondary" },
  disabled: { label: "ปิดใช้งาน", cls: "bg-dark" },
};

export function PromotionPanel() {
  const [items, setItems] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = todayBangkok();

  // form state
  const [name, setName] = useState("");
  const [sofaHalf, setSofaHalf] = useState<string>("");
  const [sofaHour, setSofaHour] = useState<string>("");
  const [racingHalf, setRacingHalf] = useState<string>("");
  const [racingHour, setRacingHour] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(today);
  const [endDate, setEndDate] = useState<string>(today);

  async function refresh() {
    try {
      const data = await listPromotions();
      setItems(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("promo-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "promotions" }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return alert("กรุณาระบุชื่อโปรโมชั่น");
    const sH = Number(sofaHalf), sHr = Number(sofaHour);
    const rH = Number(racingHalf), rHr = Number(racingHour);
    if ([sH, sHr, rH, rHr].some((n) => !Number.isFinite(n) || n < 0)) {
      return alert("กรุณาระบุราคาให้ครบทุกช่อง (ตัวเลข ≥ 0)");
    }
    if (endDate < startDate) return alert("วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่ม");

    setBusy(true);
    try {
      await createPromotion({
        name: name.trim(),
        sofa_half: sH,
        sofa_hour: sHr,
        racing_half: rH,
        racing_hour: rHr,
        start_date: startDate,
        end_date: endDate,
        active: true,
      });
      setName("");
      setSofaHalf(""); setSofaHour("");
      setRacingHalf(""); setRacingHour("");
      await refresh();
    } catch (e) {
      alert("สร้างโปรโมชั่นไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(p: Promotion) {
    try {
      await setPromotionActive(p.id, !p.active);
      await refresh();
    } catch (e) {
      alert("ไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleDelete(p: Promotion) {
    if (!confirm(`ลบโปรโมชั่น "${p.name}" ?`)) return;
    try {
      await deletePromotion(p.id);
      await refresh();
    } catch (e) {
      alert("ลบไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div>
      <h5 className="d-flex align-items-center gap-2 mb-3"><Tag size={18} /> โปรโมชั่น (กำหนดราคาเครื่องตามช่วงวันที่)</h5>

      {error && (
        <div className="alert alert-danger d-flex align-items-center gap-2">
          <AlertTriangle size={16} /> {error}
          <span className="ms-2 small text-muted">(หากเป็นครั้งแรก ให้รัน SQL สร้างตาราง <code>promotions</code> ใน Supabase ก่อน — ดูใน <code>supabase/schema.sql</code>)</span>
        </div>
      )}

      <div className="card mb-4">
        <div className="card-header bg-light fw-bold d-flex align-items-center gap-2"><Plus size={16} /> เพิ่มโปรโมชั่นใหม่</div>
        <form onSubmit={handleSubmit} className="card-body">
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label fw-bold small">ชื่อโปรโมชั่น</label>
              <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น โปรเปิดเทอม" />
            </div>
            <div className="col-md-3">
              <label className="form-label fw-bold small d-inline-flex align-items-center gap-1"><CalendarDays size={13} /> วันเริ่ม</label>
              <input type="date" className="form-control" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label fw-bold small d-inline-flex align-items-center gap-1"><CalendarDays size={13} /> วันสิ้นสุด</label>
              <input type="date" className="form-control" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>

            <div className="col-md-6">
              <div className="border rounded p-3 bg-light">
                <div className="fw-bold mb-2">🛋️ โซนโซฟา</div>
                <div className="row g-2">
                  <div className="col-6">
                    <label className="small">0.5 ชม. (บาท)</label>
                    <input type="number" className="form-control" value={sofaHalf} onChange={(e) => setSofaHalf(e.target.value)} placeholder="เช่น 40" />
                  </div>
                  <div className="col-6">
                    <label className="small">1 ชม. (บาท)</label>
                    <input type="number" className="form-control" value={sofaHour} onChange={(e) => setSofaHour(e.target.value)} placeholder="เช่น 79" />
                  </div>
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="border rounded p-3 bg-light">
                <div className="fw-bold mb-2">🏎️ โซนรถแข่ง</div>
                <div className="row g-2">
                  <div className="col-6">
                    <label className="small">0.5 ชม. (บาท)</label>
                    <input type="number" className="form-control" value={racingHalf} onChange={(e) => setRacingHalf(e.target.value)} placeholder="เช่น 50" />
                  </div>
                  <div className="col-6">
                    <label className="small">1 ชม. (บาท)</label>
                    <input type="number" className="form-control" value={racingHour} onChange={(e) => setRacingHour(e.target.value)} placeholder="เช่น 99" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="text-end mt-3">
            <button className="btn btn-primary fw-bold d-inline-flex align-items-center gap-1" disabled={busy}>
              <Plus size={16} /> {busy ? "กำลังบันทึก..." : "บันทึกโปรโมชั่น"}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-header bg-light fw-bold">รายการโปรโมชั่น</div>
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>ชื่อ</th>
                <th>ช่วงวันที่</th>
                <th className="text-end">โซฟา (0.5/1 ชม.)</th>
                <th className="text-end">รถแข่ง (0.5/1 ชม.)</th>
                <th className="text-center">สถานะ</th>
                <th className="text-end">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="text-center text-muted py-3">กำลังโหลด...</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted py-3">— ยังไม่มีโปรโมชั่น —</td></tr>
              )}
              {items.map((p) => {
                const st = promotionStatus(p, today);
                const cfg = STATUS_LABEL[st];
                return (
                  <tr key={p.id}>
                    <td className="fw-bold">{p.name}</td>
                    <td className="small">{p.start_date} → {p.end_date}</td>
                    <td className="text-end">{formatBaht(Number(p.sofa_half))} / {formatBaht(Number(p.sofa_hour))}</td>
                    <td className="text-end">{formatBaht(Number(p.racing_half))} / {formatBaht(Number(p.racing_hour))}</td>
                    <td className="text-center"><span className={`badge ${cfg.cls}`}>{cfg.label}</span></td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => toggleActive(p)} title={p.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}>
                        <Power size={14} />
                      </button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(p)} title="ลบ">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
