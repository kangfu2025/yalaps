import { useEffect, useMemo, useState } from "react";
import { listBillingByDate, listBillingByDateRange } from "@/lib/billing";
import { listSalesByDateRange, topSellers, type ProductSale, type ProductSaleItem } from "@/lib/products";
import { listPcSessionsByDateRange } from "@/lib/pcControl";
import { formatBaht, formatHours } from "@/lib/priceEngine";
import type { BillingLog, PcSession } from "@/lib/supabase";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

// ใช้ Asia/Bangkok เสมอเพื่อให้ตรงกับคอลัมน์ checkout_date ใน DB
const BKK_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function bkkDateStr(d: Date | string) {
  return BKK_FMT.format(typeof d === "string" ? new Date(d) : d);
}
function todayStr() {
  return bkkDateStr(new Date());
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return bkkDateStr(d);
}

type Mode = "day" | "range";

export function ReportPanel({ hideTotals = false }: { hideTotals?: boolean } = {}) {
  const [mode, setMode] = useState<Mode>("day");
  const [date, setDate] = useState(todayStr());
  const [startDate, setStartDate] = useState(daysAgoStr(6));
  const [endDate, setEndDate] = useState(todayStr());
  const [rows, setRows] = useState<BillingLog[]>([]);
  const [chartRows, setChartRows] = useState<BillingLog[]>([]);
  const [pcRows, setPcRows] = useState<PcSession[]>([]);
  const [pcChartRows, setPcChartRows] = useState<PcSession[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      if (mode === "day") {
        const [b, p] = await Promise.all([
          listBillingByDate(date),
          listPcSessionsByDateRange(date, date),
        ]);
        setRows(b);
        setPcRows(p);
      } else {
        const [b, p] = await Promise.all([
          listBillingByDateRange(startDate, endDate),
          listPcSessionsByDateRange(startDate, endDate),
        ]);
        setRows(b);
        setPcRows(p);
      }
      // โหลด 7 วันล่าสุดสำหรับกราฟเสมอ
      const [b7, p7] = await Promise.all([
        listBillingByDateRange(daysAgoStr(6), todayStr()),
        listPcSessionsByDateRange(daysAgoStr(6), todayStr()),
      ]);
      setChartRows(b7);
      setPcChartRows(p7);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [mode, date, startDate, endDate]);

  const paidRows = rows.filter((r) => !r.redeemed_points);
  const pointsRows = rows.filter((r) => r.redeemed_points);
  const sumCash = paidRows.reduce((s, r) => s + Number(r.advance_cash) + Number(r.final_cash), 0);
  const sumTransfer = paidRows.reduce((s, r) => s + Number(r.advance_transfer) + Number(r.final_transfer), 0);
  const sumFood = paidRows.reduce((s, r) => s + Number(r.food_price), 0);
  const sofa = paidRows.filter((r) => r.zone === "sofa");
  const racing = paidRows.filter((r) => r.zone === "racing");
  const sumSofaHours = sofa.reduce((s, r) => s + Number(r.duration_hours), 0);
  const sumRacingHours = racing.reduce((s, r) => s + Number(r.duration_hours), 0);
  const sumSofaPrice = sofa.reduce((s, r) => s + Number(r.machine_price), 0);
  const sumRacingPrice = racing.reduce((s, r) => s + Number(r.machine_price), 0);
  const zoneCash = (list: BillingLog[]) => list.reduce((s, r) => s + Number(r.advance_cash) + Number(r.final_cash), 0);
  const zoneTransfer = (list: BillingLog[]) => list.reduce((s, r) => s + Number(r.advance_transfer) + Number(r.final_transfer), 0);
  const sofaCash = zoneCash(sofa);
  const sofaTransfer = zoneTransfer(sofa);
  const racingCash = zoneCash(racing);
  const racingTransfer = zoneTransfer(racing);


  // PC zone revenue (จาก pc_sessions ตามช่วงวันที่) — ไม่รวมบิลที่ยกเลิก / แลกแต้ม
  const cancelledPcRows = pcRows.filter((r) => r.status === "cancelled");
  const pcVisibleRows = pcRows.filter((r) => r.status !== "cancelled");
  const paidPcRows = pcVisibleRows.filter((r) => !r.redeemed_points);
  const sumPcMinutes = paidPcRows.reduce((s, r) => s + Number(r.minutes_purchased), 0);
  const sumPcPrice = paidPcRows.reduce((s, r) => s + Number(r.price), 0);
  const sumPcFood = pcVisibleRows.reduce((s, r) => s + Number(r.food_amount ?? 0), 0);
  const sumPcCash = paidPcRows.reduce((s, r) => s + Number(r.paid_cash ?? 0), 0);
  const sumPcTransfer = paidPcRows.reduce((s, r) => s + Number(r.paid_transfer ?? 0), 0);
  // ---- รายได้สินค้า (POS) ----
  const [productSales, setProductSales] = useState<(ProductSale & { product_sale_items: ProductSaleItem[] })[]>([]);
  useEffect(() => {
    const from = mode === "range" ? startDate : date;
    const to = mode === "range" ? endDate : date;
    listSalesByDateRange(from, to)
      .then(setProductSales)
      .catch((e) => console.warn("[report] product sales:", e));
  }, [mode, date, startDate, endDate]);
  const paidProductSales = productSales.filter((x) => x.status === "paid");
  const sumProducts = paidProductSales.reduce((s2, x) => s2 + Number(x.total), 0);
  const sumProductCash = paidProductSales.reduce((s2, x) => s2 + Number(x.paid_cash ?? 0), 0);
  const sumProductTransfer = paidProductSales.reduce((s2, x) => s2 + Number(x.paid_transfer ?? 0), 0);
  const soldItems = topSellers(paidProductSales);

  const totalCash = sumCash + sumPcCash + sumProductCash;
  const totalTransfer = sumTransfer + sumPcTransfer + sumProductTransfer;
  const sumTotal = totalCash + totalTransfer;
  const foodOnBill = sumFood + sumPcFood;
  const foodAndProductTotal = foodOnBill + sumProducts;


  // กราฟ 7 วัน (รวม billing_logs + pc_sessions)
  const chartData = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      map.set(daysAgoStr(i), 0);
    }
    for (const r of chartRows) {
      if (r.redeemed_points) continue;
      const key = r.checkout_date;
      if (map.has(key)) {
        const v = Number(r.advance_cash) + Number(r.final_cash) +
                  Number(r.advance_transfer) + Number(r.final_transfer);
        map.set(key, (map.get(key) ?? 0) + v);
      }
    }
    for (const p of pcChartRows) {
      if (p.status === "cancelled") continue;
      const key = bkkDateStr(p.started_at);
      if (!map.has(key)) continue;
      let v = Number(p.food_amount ?? 0);
      if (!p.redeemed_points) v += Number(p.price);
      map.set(key, (map.get(key) ?? 0) + v);
    }
    return Array.from(map.entries()).map(([d, total]) => ({
      date: d.slice(5), // MM-DD
      total,
    }));
  }, [chartRows, pcChartRows]);

  return (
    <div>
      <div className="row g-2 align-items-center mb-3">
        <div className="col-auto">
          <div className="btn-group" role="group">
            <button
              className={`btn btn-sm ${mode === "day" ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setMode("day")}
            >📅 รายวัน</button>
            <button
              className={`btn btn-sm ${mode === "range" ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setMode("range")}
            >📆 ย้อนหลัง</button>
          </div>
        </div>
        {mode === "day" ? (
          <>
            <div className="col-auto"><label className="form-label small fw-bold m-0">วันที่:</label></div>
            <div className="col-auto"><input type="date" className="form-control" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </>
        ) : (
          <>
            <div className="col-auto"><label className="form-label small fw-bold m-0">จาก:</label></div>
            <div className="col-auto"><input type="date" className="form-control" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div className="col-auto"><label className="form-label small fw-bold m-0">ถึง:</label></div>
            <div className="col-auto"><input type="date" className="form-control" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          </>
        )}
        <div className="col-auto"><button className="btn btn-outline-primary" onClick={load}>🔄 รีเฟรช</button></div>
      </div>

      {!hideTotals && (
        <>
          <div className="yl-rep-kpis mb-3">
            <div className="yl-rep-kpi is-total">
              <span className="yl-rep-kpi-label">📊 รายได้รวม{mode === "range" ? "ช่วงที่เลือก" : "วันนี้"}</span>
              <strong className="yl-rep-kpi-value">{formatBaht(sumTotal)}</strong>
              <span className="yl-rep-kpi-unit">บาท</span>
            </div>
            <div className="yl-rep-kpi is-cash">
              <span className="yl-rep-kpi-label">💵 เงินสด</span>
              <strong className="yl-rep-kpi-value">{formatBaht(totalCash)}</strong>
              <span className="yl-rep-kpi-unit">บาท</span>
            </div>
            <div className="yl-rep-kpi is-transfer">
              <span className="yl-rep-kpi-label">📱 เงินโอน</span>
              <strong className="yl-rep-kpi-value">{formatBaht(totalTransfer)}</strong>
              <span className="yl-rep-kpi-unit">บาท</span>
            </div>
          </div>

          <div className="yl-rep-card mb-3">
            <div className="yl-rep-title">📈 รายได้ย้อนหลัง 7 วัน</div>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,.18)" />
                  <XAxis dataKey="date" stroke="#a1a1c5" fontSize={12} />
                  <YAxis stroke="#a1a1c5" fontSize={12} />
                  <Tooltip
                    contentStyle={{ background: "#1c1233", border: "1px solid rgba(168,85,247,.35)", borderRadius: 12, color: "#fff" }}
                    formatter={(v: number) => [`${formatBaht(v)} บาท`, "รายได้"]}
                    labelFormatter={(l) => `วันที่ ${l}`}
                  />
                  <Line type="monotone" dataKey="total" stroke="#a855f7" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      <div className="yl-rep-card mb-3">
        <div className="yl-rep-title">🎮 รายได้แยกโซน</div>
        <div className="yl-rep-zones">
          <div className="yl-rep-zone">
            <div className="yl-rep-zone-head"><span>🛋️ โซน PS5 (โซฟา)</span><b>{formatBaht(sumSofaPrice)} บาท</b></div>
            <div className="yl-rep-zone-meta">{sofa.length} บิล · เล่นรวม {formatHours(sumSofaHours)} ชม.</div>
            <div className="yl-rep-zone-pay"><span>💵 สด {formatBaht(sofaCash)}</span><span>📱 โอน {formatBaht(sofaTransfer)}</span></div>
          </div>
          <div className="yl-rep-zone">
            <div className="yl-rep-zone-head"><span>🏎️ โซนเรสซิ่ง</span><b>{formatBaht(sumRacingPrice)} บาท</b></div>
            <div className="yl-rep-zone-meta">{racing.length} บิล · เล่นรวม {formatHours(sumRacingHours)} ชม.</div>
            <div className="yl-rep-zone-pay"><span>💵 สด {formatBaht(racingCash)}</span><span>📱 โอน {formatBaht(racingTransfer)}</span></div>
          </div>
          <div className="yl-rep-zone">
            <div className="yl-rep-zone-head"><span>🖥️ โซน PC</span><b>{formatBaht(sumPcPrice)} บาท</b></div>
            <div className="yl-rep-zone-meta">{pcVisibleRows.length} session · เล่นรวม {sumPcMinutes} นาที</div>
            <div className="yl-rep-zone-pay"><span>💵 สด {formatBaht(sumPcCash)}</span><span>📱 โอน {formatBaht(sumPcTransfer)}</span></div>
          </div>
        </div>
        {(pointsRows.length > 0 || cancelledPcRows.length > 0) && (
          <div className="yl-rep-notes">
            {pointsRows.length > 0 && <span>🎁 บิลแลกแต้ม {pointsRows.length} บิล (ไม่นับเข้ารายได้)</span>}
            {cancelledPcRows.length > 0 && <span>🚫 บิล PC ที่ยกเลิก {cancelledPcRows.length} บิล (ไม่นับเข้ารายได้)</span>}
          </div>
        )}
      </div>

      <div className="yl-rep-card mb-3">
        <div className="yl-rep-title">🍔 รายได้อาหาร / สินค้า</div>
        <div className="yl-rep-foodtotal">
          รวมทั้งหมด <b>{formatBaht(foodAndProductTotal)}</b> บาท
        </div>
        <div className="yl-rep-sub">รายการอาหาร/สินค้าที่ขายได้ (POS {paidProductSales.length} บิล — {formatBaht(sumProducts)} บาท)</div>
        {soldItems.length === 0 ? (
          <div className="yl-rep-empty">ยังไม่มีรายการขายสินค้าในช่วงนี้</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle yl-rep-table m-0">
              <thead>
                <tr><th style={{ width: 48 }}>#</th><th>รายการ</th><th className="text-center">จำนวน</th><th className="text-end">ยอดเงิน</th></tr>
              </thead>
              <tbody>
                {soldItems.map((it, i) => (
                  <tr key={`${it.name}-${i}`}>
                    <td>{i + 1}.</td>
                    <td>{it.name}</td>
                    <td className="text-center">{it.qty} ชิ้น</td>
                    <td className="text-end">{formatBaht(it.amount)} บาท</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="yl-rep-foodpay">
          <span>💵 เงินสด <b>{formatBaht(sumProductCash)}</b> บาท</span>
          <span>📱 เงินโอน <b>{formatBaht(sumProductTransfer)}</b> บาท</span>
        </div>
        <div className="yl-rep-hint">
          🧾 อาหาร/ขนมที่ลงบิลรวมกับเครื่อง (ไม่ผ่าน POS): <b>{formatBaht(foodOnBill)}</b> บาท — ยอดเงินสด/โอนถูกนับรวมอยู่ในโซนที่ปิดบิลแล้ว
        </div>
      </div>


      <div className="table-responsive">
        <table className="table table-hover align-middle">
          <thead>
            <tr>
              {mode === "range" && <th>วันที่</th>}
              <th>เวลา</th><th>โซน</th><th>เครื่อง</th><th>ลูกค้า</th><th>ชม./นาที</th><th>ค่าเครื่อง</th><th>อาหาร</th><th>สด</th><th>โอน</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={mode === "range" ? 10 : 9} className="text-center text-muted py-3">กำลังโหลด...</td></tr>
            ) : rows.length === 0 && pcVisibleRows.length === 0 ? (
              <tr><td colSpan={mode === "range" ? 10 : 9} className="text-center text-muted py-3">ไม่มีข้อมูล</td></tr>
            ) : (
              <>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {mode === "range" && <td>{r.checkout_date}</td>}
                    <td>{r.checkout_time?.slice(0, 5)}</td>
                    <td>{r.zone === "sofa" ? "🛋️" : "🏎️"}</td>
                    <td>{r.machine_number}</td>
                    <td>{r.customer_name}</td>
                    <td>{formatHours(r.duration_hours)} ชม.</td>
                    <td>{formatBaht(r.machine_price)}</td>
                    <td>{formatBaht(r.food_price)}</td>
                    <td className="text-success">{r.redeemed_points ? <span className="badge" style={{ background: "#a855f7" }}>🎁 แลกแต้ม</span> : formatBaht(Number(r.advance_cash) + Number(r.final_cash))}</td>
                    <td className="text-primary">{r.redeemed_points ? "—" : formatBaht(Number(r.advance_transfer) + Number(r.final_transfer))}</td>
                  </tr>
                ))}
                {pcVisibleRows.map((p) => {
                  const started = new Date(p.started_at);
                  const dateStr = bkkDateStr(started);
                  const timeStr = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(started);
                  return (
                    <tr key={`pc-${p.id}`} className="pc-zone-row">
                      {mode === "range" && <td>{dateStr}</td>}
                      <td>{timeStr}</td>
                      <td>🖥️</td>
                      <td>PC</td>
                      <td>{p.customer_name ?? "-"}</td>
                      <td>{p.minutes_purchased} นาที</td>
                      <td>{formatBaht(Number(p.price))}</td>
                      <td>{formatBaht(Number(p.food_amount ?? 0))}</td>
                      <td className="text-success">{p.redeemed_points ? <span className="badge" style={{ background: "#a855f7" }}>🎁 แลกแต้ม</span> : formatBaht(Number(p.paid_cash ?? 0))}</td>
                      <td className="text-primary">{p.redeemed_points ? "—" : formatBaht(Number(p.paid_transfer ?? 0))}</td>
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
