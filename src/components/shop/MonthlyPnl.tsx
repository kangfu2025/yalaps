import { useCallback, useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Scale, Info, CalendarDays } from "lucide-react";
import { formatBaht } from "@/lib/priceEngine";
import { MonthStepper } from "./MonthStepper";
import {
  CATEGORY_LABEL,
  CATEGORY_ICON,
  INCOME_KIND_LABEL,
  currentMonthKey,
  monthLabel,
  monthLabelShort,
  monthYear,
  getMonthSummary,
  getYearSummary,
  FinanceNotReady,
  type MonthSummary,
  type YearRow,
} from "@/lib/finance";

/**
 * สรุปกำไรสุทธิรายเดือน
 *
 * ตัวเลขทุกตัวในหน้านี้มาจาก RPC finance_month_summary ตัวเดียว
 * ไม่มีการบวกลบซ้ำในฝั่งเบราว์เซอร์ — กันไม่ให้สูตรสองที่ให้คำตอบต่างกัน
 */
export function MonthlyPnl() {
  const [month, setMonth] = useState(currentMonthKey());
  const [sum, setSum] = useState<MonthSummary | null>(null);
  const [year, setYear] = useState<YearRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [m, y] = await Promise.all([getMonthSummary(month), getYearSummary(monthYear(month))]);
      setSum(m);
      setYear(y);
      setNotReady(false);
    } catch (e) {
      if (e instanceof FinanceNotReady) setNotReady(true);
      else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  if (notReady) {
    return (
      <div className="alert alert-warning">
        <b>ยังไม่ได้ติดตั้งระบบบัญชี</b>
        <div className="small mt-1">
          เปิด Supabase SQL Editor แล้วรัน <code>supabase/finance_migration.sql</code>{" "}
          จากนั้นรีเฟรชหน้านี้
        </div>
      </div>
    );
  }

  const incomeRows = sum
    ? [
        { key: "sofa", label: "🛋️ PS5 Sofa", value: sum.income.sofa },
        { key: "racing", label: "🏎️ Racing", value: sum.income.racing },
        { key: "pc", label: "🖥️ PC", value: sum.income.pc },
        { key: "pos", label: "🛒 POS / สินค้า", value: sum.income.pos },
        ...(sum.income.zone_other > 0
          ? [{ key: "zone_other", label: "🎮 โซนอื่น", value: sum.income.zone_other }]
          : []),
        ...sum.income.other_rows.map((r) => ({
          key: `oi-${r.kind}`,
          label: `🏠 ${INCOME_KIND_LABEL[r.kind] ?? r.kind}`,
          value: Number(r.amount),
        })),
      ]
    : [];

  const expenseRows = sum
    ? sum.expense.by_category.map((r) => ({
        key: r.category,
        label: `${CATEGORY_ICON[r.category] ?? "🧾"} ${CATEGORY_LABEL[r.category] ?? r.category}`,
        value: Number(r.amount),
        count: Number(r.count),
      }))
    : [];

  const net = sum?.net_profit ?? 0;
  const profit = net >= 0;

  return (
    <div>
      <div className="yl-fin-head">
        <MonthStepper value={month} onChange={setMonth} />
      </div>

      {err && <div className="alert alert-danger py-2 small">{err}</div>}

      {loading || !sum ? (
        <div className="text-center py-5 text-muted">กำลังโหลด...</div>
      ) : (
        <>
          {/* ---------- ตัวเลขใหญ่สามตัว ---------- */}
          <div className="yl-pnl-kpis">
            <div className="yl-pnl-kpi is-in">
              <span className="yl-pnl-kpi-label">
                <TrendingUp size={15} /> รายรับรวม
              </span>
              <strong className="yl-pnl-kpi-value">{formatBaht(sum.income.total)}</strong>
              <span className="yl-pnl-kpi-unit">บาท</span>
            </div>
            <div className="yl-pnl-kpi is-out">
              <span className="yl-pnl-kpi-label">
                <TrendingDown size={15} /> รายจ่ายรวม
              </span>
              <strong className="yl-pnl-kpi-value">{formatBaht(sum.expense.total)}</strong>
              <span className="yl-pnl-kpi-unit">บาท</span>
            </div>
            <div className={`yl-pnl-kpi ${profit ? "is-profit" : "is-loss"}`}>
              <span className="yl-pnl-kpi-label">
                <Scale size={15} /> {profit ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}
              </span>
              <strong className="yl-pnl-kpi-value">{formatBaht(Math.abs(net))}</strong>
              <span className="yl-pnl-kpi-unit">บาท</span>
            </div>
          </div>

          {/* ---------- รายละเอียดสองคอลัมน์ ---------- */}
          <div className="yl-pnl-cols">
            <div className="yl-rep-card">
              <div className="yl-rep-title">📥 รายรับ — {monthLabel(month)}</div>
              <table className="yl-pnl-table">
                <tbody>
                  {incomeRows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="num">{formatBaht(r.value)}</td>
                    </tr>
                  ))}
                  {incomeRows.every((r) => r.value === 0) && (
                    <tr>
                      <td colSpan={2} className="yl-pnl-none">
                        ยังไม่มีรายรับในเดือนนี้
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td>รวมรายรับ</td>
                    <td className="num">{formatBaht(sum.income.total)}</td>
                  </tr>
                </tfoot>
              </table>
              <div className="yl-pnl-pay">
                <span>💵 เงินสด {formatBaht(sum.income.cash)}</span>
                <span>📱 เงินโอน {formatBaht(sum.income.transfer)}</span>
              </div>
            </div>

            <div className="yl-rep-card">
              <div className="yl-rep-title">📤 รายจ่าย — {monthLabel(month)}</div>
              <table className="yl-pnl-table">
                <tbody>
                  {expenseRows.map((r) => (
                    <tr key={r.key}>
                      <td>
                        {r.label}
                        {r.count > 1 && <em className="yl-pnl-n">{r.count} รายการ</em>}
                      </td>
                      <td className="num">{formatBaht(r.value)}</td>
                    </tr>
                  ))}
                  {expenseRows.length === 0 && (
                    <tr>
                      <td colSpan={2} className="yl-pnl-none">
                        ยังไม่มีรายจ่ายในเดือนนี้
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td>รวมรายจ่าย</td>
                    <td className="num">{formatBaht(sum.expense.total)}</td>
                  </tr>
                </tfoot>
              </table>
              <div className="yl-pnl-pay">
                <span>💵 เงินสด {formatBaht(sum.expense.cash)}</span>
                <span>📱 เงินโอน {formatBaht(sum.expense.transfer)}</span>
              </div>
            </div>
          </div>

          {/* ---------- บรรทัดสรุป ---------- */}
          <div className={`yl-pnl-final ${profit ? "is-profit" : "is-loss"}`}>
            <div className="yl-pnl-final-row">
              <span>รายรับ</span>
              <b>{formatBaht(sum.income.total)}</b>
            </div>
            <div className="yl-pnl-final-row">
              <span>รายจ่าย</span>
              <b className="neg">-{formatBaht(sum.expense.total)}</b>
            </div>
            <div className="yl-pnl-final-row is-net">
              <span>{profit ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}</span>
              <b>
                {profit ? "" : "-"}
                {formatBaht(Math.abs(net))} บาท
              </b>
            </div>
          </div>

          {sum.info.open_bills_count > 0 && (
            <div className="yl-pnl-note">
              <Info size={15} />
              <span>
                มีบิลที่ยังเล่นค้างอยู่ {sum.info.open_bills_count} บิล รับมัดจำมาแล้ว{" "}
                <b>{formatBaht(sum.info.open_bills_advance)}</b> บาท — <b>ยังไม่นับในยอดข้างบน</b>{" "}
                ระบบจะนับทั้งบิลในเดือนที่ปิดบิล เพื่อไม่ให้เงินก้อนเดียวถูกนับสองเดือน
              </span>
            </div>
          )}

          {/* ---------- สรุปรายปี ---------- */}
          <div className="yl-rep-card mt-3">
            <div className="yl-rep-title">
              <CalendarDays size={16} /> สรุปรายปี {monthYear(month)}
            </div>
            <div className="table-responsive">
              <table className="table table-sm align-middle yl-rep-table m-0 yl-pnl-year">
                <thead>
                  <tr>
                    <th>เดือน</th>
                    <th className="text-end">รายรับ</th>
                    <th className="text-end">รายจ่าย</th>
                    <th className="text-end">กำไรสุทธิ</th>
                  </tr>
                </thead>
                <tbody>
                  {year.map((r) => {
                    const empty = r.income === 0 && r.expense === 0;
                    const pos = r.net_profit >= 0;
                    return (
                      <tr
                        key={r.month}
                        className={`${r.month === month ? "is-current" : ""} ${
                          empty ? "is-empty" : ""
                        }`}
                        onClick={() => setMonth(r.month)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{monthLabelShort(r.month)}</td>
                        <td className="text-end">{empty ? "—" : formatBaht(r.income)}</td>
                        <td className="text-end">{empty ? "—" : formatBaht(r.expense)}</td>
                        <td className={`text-end fw-bold ${pos ? "text-success" : "text-danger"}`}>
                          {empty ? "—" : `${pos ? "" : "-"}${formatBaht(Math.abs(r.net_profit))}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>รวมทั้งปี</td>
                    <td className="text-end">
                      {formatBaht(year.reduce((s, r) => s + Number(r.income), 0))}
                    </td>
                    <td className="text-end">
                      {formatBaht(year.reduce((s, r) => s + Number(r.expense), 0))}
                    </td>
                    <td className="text-end">
                      {formatBaht(year.reduce((s, r) => s + Number(r.net_profit), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="yl-rep-hint">กดที่แถวเดือนไหน เพื่อดูรายละเอียดของเดือนนั้น</div>
          </div>
        </>
      )}
    </div>
  );
}
