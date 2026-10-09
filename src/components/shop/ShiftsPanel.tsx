import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, History, RefreshCw, Wallet } from "lucide-react";
import { formatBaht } from "@/lib/priceEngine";
import { useShop } from "@/hooks/useShop";
import { DiffBadge, DrawerSummary, WithdrawModal } from "./ShopDrawer";
import {
  DENOMS,
  listShifts,
  listWithdrawals,
  withdrawToast,
  fmtShiftDate,
  fmtShiftTime,
  type CashCounts,
  type CashWithdrawal,
  type ShopShift,
} from "@/lib/shopShift";

/** ประวัติเปิด-ปิดร้าน และเงินในลิ้นชัก — เฉพาะแอดมิน */
export function ShiftsPanel() {
  const { status, refresh, notify } = useShop();
  const [shifts, setShifts] = useState<ShopShift[]>([]);
  const [withdrawals, setWithdrawals] = useState<CashWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([listShifts(), listWithdrawals()]);
      setShifts(s);
      setWithdrawals(w);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status?.installed) load();
    else setLoading(false);
  }, [load, status?.installed, status?.open]);

  const byShift = useMemo(() => {
    const m = new Map<string, CashWithdrawal[]>();
    for (const w of withdrawals) {
      const list = m.get(w.shift_id) ?? [];
      list.push(w);
      m.set(w.shift_id, list);
    }
    return m;
  }, [withdrawals]);

  if (status && !status.installed) {
    return (
      <div className="alert alert-warning">
        <b>ยังไม่ได้ติดตั้งระบบเปิด-ปิดร้าน</b>
        <div className="small mt-1">
          เปิด Supabase SQL Editor แล้วรัน <code>supabase/shop_shift_migration.sql</code>{" "}
          จากนั้นรีเฟรชหน้านี้
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ---------- ลิ้นชักตอนนี้ ---------- */}
      <div className="yl-rep-card mb-3">
        <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
          <div className="yl-rep-title m-0">
            {status?.open ? "🟢 ร้านเปิดอยู่ — เงินในลิ้นชักตอนนี้" : "🔴 ร้านปิดอยู่"}
          </div>
          <div className="ms-auto d-flex gap-2">
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => {
                refresh();
                load();
              }}
            >
              <RefreshCw size={13} /> รีเฟรช
            </button>
            <button
              className="btn btn-sm btn-warning fw-bold"
              disabled={!status?.open}
              onClick={() => setWithdrawing(true)}
              title={status?.open ? "" : "เปิดร้านก่อนจึงจะถอนเงินได้"}
            >
              <Wallet size={14} /> ถอนเงินจากลิ้นชัก
            </button>
          </div>
        </div>

        {status?.open && status.cash && status.shift ? (
          <>
            <div className="yl-rep-sub mt-0">
              เปิดเมื่อ {fmtShiftDate(status.shift.opened_at)}{" "}
              {fmtShiftTime(status.shift.opened_at)} น. โดย {status.shift.opened_by_name ?? "—"}
            </div>
            <DrawerSummary cash={status.cash} />
          </>
        ) : (
          <div className="yl-rep-sub mt-0">
            ยอดในลิ้นชักจะเริ่มนับเมื่อพนักงานกด “เปิดร้าน” ที่หน้าแรก
            {status?.last_closed && (
              <>
                {" "}
                · ปิดร้านครั้งล่าสุดนับได้ <b>{formatBaht(status.last_closed.counted_cash)}</b> บาท
              </>
            )}
          </div>
        )}
        <div className="yl-rep-hint">
          ยอดลิ้นชักไม่ใช่รายรับ และการถอนเงินไม่ใช่รายจ่าย — ทั้งสองอย่างไม่ถูกนำไปคิดกำไรสุทธิ ·
          นับเฉพาะเงินสด เงินโอนไม่เกี่ยว
        </div>
      </div>

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {/* ---------- ประวัติรอบ ---------- */}
      <div className="fw-bold mb-2 d-flex align-items-center gap-2">
        <History size={16} /> ประวัติเปิด-ปิดร้าน
      </div>

      {loading ? (
        <div className="text-center py-4 text-muted">กำลังโหลด...</div>
      ) : shifts.length === 0 ? (
        <div className="yl-rep-empty">ยังไม่มีประวัติ — เริ่มจากกด “เปิดร้าน” ที่หน้าแรก</div>
      ) : (
        shifts.map((s) => {
          const expanded = openId === s.id;
          const wds = byShift.get(s.id) ?? [];
          const closed = s.status === "closed";
          return (
            <div key={s.id} className="yl-shift">
              <button
                type="button"
                className="yl-shift-head"
                onClick={() => setOpenId(expanded ? null : s.id)}
              >
                <div className="yl-shift-date">
                  <b>{fmtShiftDate(s.opened_at)}</b>
                  <span>
                    {fmtShiftTime(s.opened_at)} –{" "}
                    {closed ? fmtShiftTime(s.closed_at) : "ยังเปิดอยู่"}
                  </span>
                </div>
                <div className="yl-shift-who">
                  เปิด: {s.opened_by_name ?? "—"}
                  {closed && <> · ปิด: {s.closed_by_name ?? "—"}</>}
                </div>
                <div className="yl-shift-result">
                  {closed && s.diff !== null ? (
                    <DiffBadge diff={Number(s.diff)} />
                  ) : (
                    <span className="yl-diff is-over">🟢 กำลังเปิด</span>
                  )}
                </div>
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {expanded && (
                <div className="yl-shift-body">
                  {closed && s.expected_cash !== null ? (
                    <DrawerSummary
                      cash={{
                        opening: Number(s.opening_cash),
                        cash_in: Number(s.cash_in),
                        cash_out: Number(s.cash_out),
                        withdrawn: Number(s.withdrawn),
                        expected: Number(s.expected_cash),
                        ps5: s.breakdown?.ps5,
                        pc: s.breakdown?.pc,
                        pos: s.breakdown?.pos,
                        other_in: s.breakdown?.other_in,
                      }}
                      counted={Number(s.counted_cash)}
                    />
                  ) : (
                    <div className="yl-rep-sub mt-0">
                      เงินเริ่มต้น {formatBaht(s.opening_cash)} บาท — รอบนี้ยังไม่ปิด
                      ดูยอดสดได้ที่การ์ดด้านบน
                    </div>
                  )}

                  <div className="yl-shift-counts">
                    <CountTable title="นับตอนเปิดร้าน" counts={s.opening_counts} />
                    {s.closing_counts && (
                      <CountTable title="นับตอนปิดร้าน" counts={s.closing_counts} />
                    )}
                  </div>

                  {wds.length > 0 && (
                    <div className="mt-3">
                      <div className="small fw-bold mb-1">ถอนเงินระหว่างรอบ</div>
                      <WithdrawTable rows={wds} />
                    </div>
                  )}
                  {s.note && <div className="small text-muted mt-2">หมายเหตุ: {s.note}</div>}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* ---------- ประวัติถอนเงินทั้งหมด ---------- */}
      {withdrawals.length > 0 && (
        <div className="yl-rep-card mt-3">
          <div className="yl-rep-title">💸 ประวัติถอนเงินจากลิ้นชัก</div>
          <WithdrawTable rows={withdrawals} withDate />
        </div>
      )}

      {withdrawing && (
        <WithdrawModal
          onClose={() => setWithdrawing(false)}
          onDone={async (r) => {
            setWithdrawing(false);
            await refresh();
            await load();
            if (r) notify(withdrawToast(r));
          }}
        />
      )}
    </div>
  );
}

function CountTable({ title, counts }: { title: string; counts: CashCounts }) {
  const rows = DENOMS.map((d) => ({ d, n: Number(counts[`${d}`]) || 0 })).filter((r) => r.n > 0);
  const total = rows.reduce((s, r) => s + r.d * r.n, 0);
  return (
    <div className="yl-shift-count">
      <div className="small fw-bold mb-1">{title}</div>
      {rows.length === 0 ? (
        <div className="small text-muted">ไม่มีเงินในลิ้นชัก (0 บาท)</div>
      ) : (
        <table className="yl-pnl-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.d}>
                <td>
                  {r.d.toLocaleString("th-TH")} × {r.n}
                </td>
                <td className="num">{formatBaht(r.d * r.n)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>รวม</td>
              <td className="num">{formatBaht(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

function WithdrawTable({ rows, withDate = false }: { rows: CashWithdrawal[]; withDate?: boolean }) {
  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle yl-rep-table m-0">
        <thead>
          <tr>
            <th>เวลา</th>
            <th>ผู้ถอน</th>
            <th>หมายเหตุ</th>
            <th className="text-end">ยอดเดิม</th>
            <th className="text-end">ถอนออก</th>
            <th className="text-end">คงเหลือ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id}>
              <td className="small text-nowrap">
                {withDate && `${fmtShiftDate(w.created_at)} `}
                {fmtShiftTime(w.created_at)}
              </td>
              <td className="small">{w.withdrawn_by_name ?? "—"}</td>
              <td className="small text-muted">{w.note || "—"}</td>
              <td className="text-end small">{formatBaht(w.balance_before)}</td>
              <td className="text-end fw-bold text-warning">-{formatBaht(w.amount)}</td>
              <td className="text-end small">{formatBaht(w.balance_after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
