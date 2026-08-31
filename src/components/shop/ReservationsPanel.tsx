import { useEffect, useState } from "react";
import {
  createScheduledReservation,
  deleteScheduledReservation,
  listScheduledReservations,
} from "@/lib/reservations";
import type { Reservation, Zone } from "@/lib/supabase";
import { HOUR_OPTIONS, calcPrice, formatBaht, formatHours } from "@/lib/priceEngine";

export function ReservationsPanel() {
  const [list, setList] = useState<Reservation[]>([]);
  const [zone, setZone] = useState<Zone>("sofa");
  const [machineNumber, setMachineNumber] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [time, setTime] = useState("");
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setList(await listScheduledReservations());
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const machineOptions = zone === "sofa" ? [1, 2, 3, 4, 5] : [1, 2, 3];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const today = new Date();
      const [hh, mm] = time.split(":").map(Number);
      today.setHours(hh, mm, 0, 0);
      await createScheduledReservation({
        zone,
        machineNumber,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        scheduledAt: today,
        baseHours: hours,
      });
      setName(""); setPhone(""); setTime("");
      await refresh();
    } catch (err) {
      alert("จองไม่สำเร็จ: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(id: string) {
    if (!confirm("ลบคิวจองนี้?")) return;
    try {
      await deleteScheduledReservation(id);
      await refresh();
    } catch (err) {
      alert("ลบไม่สำเร็จ: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <div className="row g-3">
      <div className="col-md-4">
        <div className="card p-3 shadow-sm border-0 rounded-4">
          <h5 className="fw-bold mb-3">📅 จองล่วงหน้า</h5>
          <form onSubmit={save}>
            <label className="form-label small fw-bold">โซน</label>
            <select className="form-select mb-2" value={zone} onChange={(e) => { setZone(e.target.value as Zone); setMachineNumber(1); }}>
              <option value="sofa">🛋️ โซฟา</option>
              <option value="racing">🏎️ รถแข่ง</option>
            </select>
            <label className="form-label small fw-bold">เครื่อง</label>
            <select className="form-select mb-2" value={machineNumber} onChange={(e) => setMachineNumber(parseInt(e.target.value))}>
              {machineOptions.map((n) => <option key={n} value={n}>เครื่อง {n}</option>)}
            </select>
            <label className="form-label small fw-bold">ชื่อลูกค้า</label>
            <input className="form-control mb-2" value={name} onChange={(e) => setName(e.target.value)} required />
            <label className="form-label small fw-bold">เบอร์โทร</label>
            <input className="form-control mb-2" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <label className="form-label small fw-bold">เวลาจอง</label>
            <input type="time" className="form-control mb-2" value={time} onChange={(e) => setTime(e.target.value)} required />
            <label className="form-label small fw-bold">ระยะเวลา</label>
            <select className="form-select mb-3" value={hours} onChange={(e) => setHours(parseFloat(e.target.value))}>
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>{h} ชม. — {formatBaht(calcPrice(zone, h))} บาท</option>
              ))}
            </select>
            <button className="btn btn-primary w-100 fw-bold" disabled={busy}>💾 บันทึกการจอง</button>
          </form>
        </div>
      </div>
      <div className="col-md-8">
        <div className="card p-3 shadow-sm border-0 rounded-4">
          <h5 className="fw-bold mb-3">📋 คิวจองทั้งหมด</h5>
          <div className="table-responsive">
            <table className="table table-striped align-middle">
              <thead>
                <tr><th>โซน</th><th>เครื่อง</th><th>ลูกค้า</th><th>โทร</th><th>เวลา</th><th>ชม.</th><th></th></tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-muted py-3">ไม่มีคิวจอง</td></tr>
                ) : list.map((r) => (
                  <tr key={r.id}>
                    <td>{r.zone === "sofa" ? "🛋️ โซฟา" : "🏎️ รถแข่ง"}</td>
                    <td>{r.machine_number}</td>
                    <td>{r.customer_name}</td>
                    <td>{r.customer_phone}</td>
                    <td>{r.scheduled_at ? new Date(r.scheduled_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                    <td>{formatHours(r.base_hours)}</td>
                    <td><button className="btn btn-sm btn-outline-danger" onClick={() => removeRow(r.id)}>ลบ</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
