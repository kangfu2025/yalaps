import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wallet,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  History,
  Home,
  Users,
  ListFilter,
  Eye,
  EyeOff,
  TrendingUp,
  Scale,
} from "lucide-react";
import { formatBaht } from "@/lib/priceEngine";
import { useShop } from "@/hooks/useShop";
import { MonthStepper } from "./MonthStepper";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  EXPENSE_CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_ICON,
  PAY_LABEL,
  INCOME_KIND_LABEL,
  currentMonthKey,
  monthLabel,
  monthRangeLabel,
  getMonthSummary,
  nowLocalInput,
  isoToLocalInput,
  fmtDateTime,
  listExpenses,
  listOtherIncomes,
  listWagesByStaff,
  listStaffNames,
  listAudit,
  addExpense,
  updateExpense,
  voidExpense,
  restoreExpense,
  addOtherIncome,
  voidOtherIncome,
  FinanceNotReady,
  type Expense,
  type ExpenseCategory,
  type ExpenseInput,
  type MonthSummary,
  type OtherIncome,
  type PayMethod,
  type WageRow,
  type AuditRow,
} from "@/lib/finance";

type View = "all" | "wage";

export function ExpensesPanel() {
  const [month, setMonth] = useState(currentMonthKey());
  const [view, setView] = useState<View>("all");
  const [cat, setCat] = useState<ExpenseCategory | "all">("all");
  const [showVoid, setShowVoid] = useState(false);

  const [rows, setRows] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<OtherIncome[]>([]);
  const [wages, setWages] = useState<WageRow[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [staffNames, setStaffNames] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [rentOpen, setRentOpen] = useState(false);
  const [auditFor, setAuditFor] = useState<Expense | OtherIncome | null>(null);
  const [voidTarget, setVoidTarget] = useState<
    { kind: "expense"; row: Expense } | { kind: "income"; row: OtherIncome } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [ex, inc, wg, names, sum] = await Promise.all([
        listExpenses({ month, includeVoid: true }),
        listOtherIncomes(month, true),
        listWagesByStaff(month),
        listStaffNames().catch(() => [] as string[]),
        // ยอดรวมทุกตัวมาจาก RPC ตัวเดียวกับหน้าสรุปกำไรสุทธิ
        // จะได้ไม่มีทางเป็นคนละเลขกับที่หน้านั้นแสดง
        getMonthSummary(month),
      ]);
      setRows(ex);
      setIncomes(inc);
      setWages(wg);
      setStaffNames(names);
      setSummary(sum);
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

  // ---- ยอดรวมของเดือน ----
  // ทุกตัวเลขในแถบสรุปอ่านจาก summary ที่ได้จากฐานข้อมูล ไม่บวกเองซ้ำในหน้านี้
  // (รายการที่ยกเลิกแล้วถูกกรองออกตั้งแต่ในฐานข้อมูล)
  const activeIncomes = useMemo(() => incomes.filter((r) => r.status === "active"), [incomes]);

  const byCategory = useMemo(() => {
    const m = new Map<ExpenseCategory, { amount: number; count: number }>();
    for (const r of summary?.expense.by_category ?? []) {
      m.set(r.category, { amount: Number(r.amount), count: Number(r.count) });
    }
    return m;
  }, [summary]);

  const incomeTotal = summary?.income.total ?? 0;
  const expenseTotal = summary?.expense.total ?? 0;
  const expenseCash = summary?.expense.cash ?? 0;
  const expenseTransfer = summary?.expense.transfer ?? 0;
  const rentTotal = summary?.income.other_total ?? 0;
  const net = summary?.net_profit ?? 0;
  const isProfit = net >= 0;

  const incomeSources = summary
    ? [
        { key: "sofa", label: "🛋️ PS5 Sofa", value: summary.income.sofa },
        { key: "racing", label: "🏎️ Racing", value: summary.income.racing },
        { key: "pc", label: "🖥️ PC", value: summary.income.pc },
        { key: "pos", label: "🛒 POS", value: summary.income.pos },
        ...(summary.income.zone_other > 0
          ? [{ key: "zone_other", label: "🎮 โซนอื่น", value: summary.income.zone_other }]
          : []),
        ...(summary.income.other_total > 0
          ? [{ key: "rent", label: "🏠 ค่าเช่าห้อง", value: summary.income.other_total }]
          : []),
      ]
    : [];

  const visible = useMemo(() => {
    let list = rows;
    if (!showVoid) list = list.filter((r) => r.status === "active");
    if (cat !== "all") list = list.filter((r) => r.category === cat);
    return list;
  }, [rows, cat, showVoid]);

  async function doRestore(r: Expense) {
    try {
      await restoreExpense(r.id);
      await load();
    } catch (e) {
      alert("กู้คืนไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** ยกเลิกรายการที่ยืนยันแล้ว — ไม่ได้ลบทิ้ง ยังกู้คืนและตรวจย้อนหลังได้ */
  async function confirmVoid() {
    if (!voidTarget) return;
    const t = voidTarget;
    setVoidTarget(null);
    try {
      if (t.kind === "expense") await voidExpense(t.row.id);
      else await voidOtherIncome(t.row.id);
      await load();
    } catch (e) {
      alert("ยกเลิกไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

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

  return (
    <div>
      {/* ---------- แถบหัว: เลือกเดือน + ปุ่มเพิ่ม ---------- */}
      <div className="yl-fin-head">
        <MonthStepper value={month} onChange={setMonth} />
        <div className="yl-fin-actions">
          <button
            className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1"
            onClick={() => setRentOpen(true)}
            title="เพิ่มรายรับค่าเช่าห้อง"
          >
            <Plus size={14} />
            <Home size={14} /> ค่าเช่าห้อง
          </button>
          <button
            className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1"
            onClick={() => setEditing("new")}
          >
            <Plus size={15} /> เพิ่มรายจ่าย
          </button>
        </div>
      </div>

      {err && <div className="alert alert-danger py-2 small">{err}</div>}

      {/* ---------- สรุปเดือนนี้ ---------- */}
      <div className="yl-fin-strip">
        <div className="yl-fin-stat is-in">
          <span className="yl-fin-stat-label">
            <TrendingUp size={14} /> รายรับรวม {monthLabel(month)}
          </span>
          <strong className="yl-fin-stat-value">{formatBaht(incomeTotal)}</strong>
          <span className="yl-fin-stat-sub">{monthRangeLabel(month)}</span>
        </div>
        <div className="yl-fin-stat is-out">
          <span className="yl-fin-stat-label">
            <Wallet size={14} /> รายจ่ายรวม
          </span>
          <strong className="yl-fin-stat-value">{formatBaht(expenseTotal)}</strong>
          <span className="yl-fin-stat-sub">
            💵 สด {formatBaht(expenseCash)} · 📱 โอน {formatBaht(expenseTransfer)}
          </span>
        </div>
        <div className={`yl-fin-stat ${isProfit ? "is-profit" : "is-loss"}`}>
          <span className="yl-fin-stat-label">
            <Scale size={14} /> {isProfit ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}
          </span>
          <strong className="yl-fin-stat-value">
            {isProfit ? "" : "-"}
            {formatBaht(Math.abs(net))}
          </strong>
          <span className="yl-fin-stat-sub">รายรับ − รายจ่าย ของช่วงเดียวกัน</span>
        </div>
        <div className="yl-fin-stat is-rent">
          <span className="yl-fin-stat-label">
            <Home size={14} /> รายรับค่าเช่าห้อง
          </span>
          <strong className="yl-fin-stat-value">{formatBaht(rentTotal)}</strong>
          <span className="yl-fin-stat-sub">
            {activeIncomes.length} รายการ · นับรวมอยู่ในรายรับแล้ว
          </span>
        </div>
      </div>

      {/* ---------- รายรับมาจากไหนบ้าง ---------- */}
      {incomeTotal > 0 && (
        <div className="yl-fin-src">
          <span className="yl-fin-src-head">รายรับมาจาก</span>
          {incomeSources
            .filter((s) => s.value > 0)
            .map((s) => (
              <span key={s.key} className="yl-fin-src-pill">
                {s.label} <b>{formatBaht(s.value)}</b>
              </span>
            ))}
        </div>
      )}

      {summary && summary.info.open_bills_count > 0 && (
        <div className="yl-fin-hint">
          ℹ️ มีบิลที่ยังเล่นค้างอยู่ {summary.info.open_bills_count} บิล รับมัดจำมาแล้ว{" "}
          <b>{formatBaht(summary.info.open_bills_advance)}</b> บาท — ยังไม่นับในยอดข้างบน
          จะนับทั้งบิลตอนปิดบิล
        </div>
      )}

      {/* ---------- สลับมุมมอง ---------- */}
      <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
        <div className="btn-group btn-group-sm" role="group">
          <button
            className={`btn ${view === "all" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setView("all")}
          >
            <ListFilter size={14} /> รายการทั้งหมด
          </button>
          <button
            className={`btn ${view === "wage" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setView("wage")}
          >
            <Users size={14} /> ค่าแรงพนักงาน
          </button>
        </div>
        <button
          className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
          onClick={() => setShowVoid((v) => !v)}
          title="รายการที่ยกเลิกไม่ถูกลบจริง ยังดูย้อนหลังได้"
        >
          {showVoid ? <EyeOff size={14} /> : <Eye size={14} />}
          {showVoid ? "ซ่อนรายการที่ยกเลิก" : "ดูรายการที่ยกเลิก"}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-5 text-muted">กำลังโหลด...</div>
      ) : view === "wage" ? (
        <WageView wages={wages} onAdd={() => setEditing("new")} onAudit={setAuditFor} />
      ) : (
        <>
          {/* ---------- ชิปหมวด พร้อมยอดรวมของแต่ละหมวด ---------- */}
          <div className="yl-fin-chips">
            <button
              className={`yl-fin-chip ${cat === "all" ? "active" : ""}`}
              onClick={() => setCat("all")}
            >
              <span>ทุกหมวด</span>
              <b>{formatBaht(expenseTotal)}</b>
            </button>
            {EXPENSE_CATEGORIES.map((c) => {
              const v = byCategory.get(c);
              if (!v) return null;
              return (
                <button
                  key={c}
                  className={`yl-fin-chip ${cat === c ? "active" : ""}`}
                  onClick={() => setCat(cat === c ? "all" : c)}
                  title={`${CATEGORY_LABEL[c]} ${v.count} รายการ — กดเพื่อดูรายละเอียด`}
                >
                  <span>
                    {CATEGORY_ICON[c]} {CATEGORY_LABEL[c]}
                    {v.count > 1 && <em className="yl-fin-chip-n">{v.count}</em>}
                  </span>
                  <b>{formatBaht(v.amount)}</b>
                </button>
              );
            })}
          </div>

          <ExpenseTable
            rows={visible}
            onEdit={setEditing}
            onVoid={(r) => setVoidTarget({ kind: "expense", row: r })}
            onRestore={doRestore}
            onAudit={setAuditFor}
          />

          {/* ---------- รายรับค่าเช่าห้องของเดือนนี้ ---------- */}
          {incomes.length > 0 && (
            <div className="yl-rep-card mt-3">
              <div className="yl-rep-title">🏠 รายรับค่าเช่าห้อง — {monthLabel(month)}</div>
              <div className="yl-rep-sub">
                ค่าเช่า + ค่าไฟผู้เช่า รวมเป็นยอดเดียว · ยอดนี้ถูกนำไปรวมกับรายรับของร้านในเดือนนี้
              </div>
              <div className="table-responsive">
                <table className="table table-sm align-middle yl-rep-table m-0">
                  <thead>
                    <tr>
                      <th>บันทึกเมื่อ</th>
                      <th>ประเภท</th>
                      <th>ช่องทาง</th>
                      <th>หมายเหตุ</th>
                      <th className="text-end">จำนวนเงิน</th>
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomes
                      .filter((r) => showVoid || r.status === "active")
                      .map((r) => (
                        <tr key={r.id} className={r.status === "void" ? "yl-fin-void" : ""}>
                          <td className="small text-muted">{fmtDateTime(r.received_at)}</td>
                          <td>{INCOME_KIND_LABEL[r.kind]}</td>
                          <td className="small">{PAY_LABEL[r.pay_method]}</td>
                          <td className="small text-muted">{r.note || "—"}</td>
                          <td className="text-end fw-bold text-success">{formatBaht(r.amount)}</td>
                          <td className="text-end">
                            {r.status === "active" && (
                              <button
                                className="btn btn-sm btn-link text-danger p-0"
                                onClick={() => setVoidTarget({ kind: "income", row: r })}
                                title="ยกเลิกรายการ"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {editing && (
        <ExpenseModal
          initial={editing === "new" ? null : editing}
          staffNames={staffNames}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {rentOpen && (
        <RoomRentModal
          month={month}
          onClose={() => setRentOpen(false)}
          onSaved={async () => {
            setRentOpen(false);
            await load();
          }}
        />
      )}

      {auditFor && <AuditModal row={auditFor} onClose={() => setAuditFor(null)} />}

      <ConfirmDialog
        open={!!voidTarget}
        title="ยืนยันยกเลิกรายการ"
        icon="🗑️"
        variant="danger"
        confirmLabel="ยกเลิกรายการนี้"
        cancelLabel="ไม่ยกเลิก"
        message={
          voidTarget ? (
            <div>
              {voidTarget.kind === "expense" ? (
                <>
                  {CATEGORY_ICON[voidTarget.row.category]}{" "}
                  <b className="text-primary">{CATEGORY_LABEL[voidTarget.row.category]}</b>
                </>
              ) : (
                <>
                  🏠 <b className="text-primary">{INCOME_KIND_LABEL[voidTarget.row.kind]}</b>
                </>
              )}
              <br />
              <span className="fs-5 fw-bold">{formatBaht(voidTarget.row.amount)} บาท</span>
              <br />
              <span className="text-muted small">
                รายการจะไม่ถูกลบทิ้ง — ยังดูย้อนหลังและกู้คืนได้ แต่จะไม่ถูกนำไปคิดในยอดของเดือนนี้
              </span>
            </div>
          ) : (
            ""
          )
        }
        onConfirm={confirmVoid}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  );
}

// ================= ตารางรายจ่าย =================

function ExpenseTable({
  rows,
  onEdit,
  onVoid,
  onRestore,
  onAudit,
}: {
  rows: Expense[];
  onEdit: (r: Expense) => void;
  onVoid: (r: Expense) => void;
  onRestore: (r: Expense) => void;
  onAudit: (r: Expense) => void;
}) {
  if (rows.length === 0) {
    return <div className="yl-rep-empty">ยังไม่มีรายจ่ายในเดือนนี้</div>;
  }
  return (
    <div className="table-responsive">
      <table className="table table-hover align-middle yl-rep-table">
        <thead>
          <tr>
            <th>วันที่/เวลา</th>
            <th>หมวด</th>
            <th>รายละเอียด</th>
            <th>ช่องทาง</th>
            <th className="text-end">จำนวนเงิน</th>
            <th style={{ width: 110 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.status === "void" ? "yl-fin-void" : ""}>
              <td className="small text-nowrap">{fmtDateTime(r.occurred_at)}</td>
              <td className="text-nowrap">
                {CATEGORY_ICON[r.category]} {CATEGORY_LABEL[r.category]}
              </td>
              <td className="small">
                {r.staff_name && <b className="text-primary">{r.staff_name}</b>}
                {r.staff_name && r.note ? " · " : ""}
                <span className="text-muted">{r.note || (r.staff_name ? "" : "—")}</span>
                {r.status === "void" && <span className="badge bg-secondary ms-2">ยกเลิกแล้ว</span>}
              </td>
              <td className="small text-nowrap">
                {PAY_LABEL[r.pay_method]}
                {r.from_drawer && (
                  <span
                    className="badge bg-warning text-dark ms-1"
                    title="จ่ายจากเงินในลิ้นชักร้าน"
                  >
                    ลิ้นชัก
                  </span>
                )}
              </td>
              <td className="text-end fw-bold text-danger text-nowrap">-{formatBaht(r.amount)}</td>
              <td className="text-end text-nowrap">
                <button
                  className="btn btn-sm btn-link p-0 me-2 text-muted"
                  onClick={() => onAudit(r)}
                  title="ประวัติการแก้ไข"
                >
                  <History size={14} />
                </button>
                {r.status === "active" ? (
                  <>
                    <button
                      className="btn btn-sm btn-link p-0 me-2"
                      onClick={() => onEdit(r)}
                      title="แก้ไข"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn btn-sm btn-link text-danger p-0"
                      onClick={() => onVoid(r)}
                      title="ยกเลิกรายการ"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-sm btn-link text-success p-0"
                    onClick={() => onRestore(r)}
                    title="กู้คืนรายการ"
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ================= มุมมองค่าแรง =================

function WageView({
  wages,
  onAdd,
  onAudit,
}: {
  wages: WageRow[];
  onAdd: () => void;
  onAudit: (r: Expense) => void;
}) {
  const total = wages.reduce((s, w) => s + w.total, 0);

  if (wages.length === 0) {
    return (
      <div className="yl-rep-card">
        <div className="yl-rep-empty">
          ยังไม่มีการจ่ายค่าแรงในเดือนนี้
          <div className="mt-2">
            <button className="btn btn-sm btn-primary" onClick={onAdd}>
              <Plus size={14} /> บันทึกการจ่ายค่าแรง
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="yl-rep-card">
      <div className="yl-rep-title">👤 ค่าแรงพนักงาน — รวม {formatBaht(total)} บาท</div>
      <div className="yl-rep-sub">
        บันทึกเฉพาะเงินที่จ่ายจริง ไม่มีเงินเดือนประจำ ไม่มียอดค้างจ่าย ·
        แต่ละรายการเป็นรายจ่ายหมวดค่าแรงหนึ่งรายการ จึงไม่ถูกนับซ้ำ
      </div>

      {wages.map((w) => (
        <div key={w.staff} className="yl-fin-wage">
          <div className="yl-fin-wage-head">
            <span className="yl-fin-wage-name">👤 {w.staff}</span>
            <span className="yl-fin-wage-meta">{w.count} ครั้ง</span>
            <b className="yl-fin-wage-total">{formatBaht(w.total)} บาท</b>
          </div>
          <div className="table-responsive">
            <table className="table table-sm align-middle yl-rep-table m-0">
              <tbody>
                {w.items.map((it) => (
                  <tr key={it.id}>
                    <td className="small text-nowrap">{fmtDateTime(it.occurred_at)}</td>
                    <td className="small">{PAY_LABEL[it.pay_method]}</td>
                    <td className="small text-muted">{it.note || "—"}</td>
                    <td className="text-end fw-bold">{formatBaht(it.amount)}</td>
                    <td className="text-end" style={{ width: 40 }}>
                      <button
                        className="btn btn-sm btn-link p-0 text-muted"
                        onClick={() => onAudit(it)}
                        title="ประวัติการแก้ไข"
                      >
                        <History size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ================= ฟอร์มรายจ่าย =================

function ExpenseModal({
  initial,
  staffNames,
  onClose,
  onSaved,
}: {
  initial: Expense | null;
  staffNames: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? "other");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [payMethod, setPayMethod] = useState<PayMethod>(initial?.pay_method ?? "cash");
  const [occurred, setOccurred] = useState(
    initial ? isoToLocalInput(initial.occurred_at) : nowLocalInput(),
  );
  const [staffName, setStaffName] = useState(initial?.staff_name ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ระบบเปิด-ปิดร้าน: เงินสดก้อนนี้หยิบจากลิ้นชักหรือเปล่า
  // รายการใหม่ตอนร้านเปิดอยู่ ตั้งต้นเป็น "จากลิ้นชัก" เพราะเป็นกรณีที่เจอบ่อยสุด
  const { status: shop, refresh: refreshShop } = useShop();
  const drawerOn = !!shop?.installed;
  const [fromDrawer, setFromDrawer] = useState<boolean>(
    initial ? !!initial.from_drawer : !!shop?.open,
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const input: ExpenseInput = {
        category,
        amount: Number(amount),
        payMethod,
        occurredLocal: occurred,
        staffName,
        note,
        ...(drawerOn ? { fromDrawer } : {}),
      };
      if (initial) await updateExpense(initial.id, input);
      else await addExpense(input);
      if (drawerOn) void refreshShop();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header bg-primary text-white">
          <h5 className="modal-title fw-bold m-0 d-flex align-items-center gap-2">
            <Wallet size={18} /> {initial ? "แก้ไขรายจ่าย" : "เพิ่มรายจ่าย"}
          </h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>

        <div className="p-3">
          <label className="form-label small fw-bold">หมวด</label>
          <div className="yl-fin-cats mb-3">
            {EXPENSE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`yl-fin-cat ${category === c ? "active" : ""}`}
                onClick={() => setCategory(c)}
              >
                <span className="yl-fin-cat-ico">{CATEGORY_ICON[c]}</span>
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>

          {category === "wage" && (
            <div className="mb-3">
              <label className="form-label small fw-bold">ชื่อพนักงาน</label>
              <input
                className="form-control"
                list="yl-staff-names"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="เช่น พนักงาน A"
              />
              <datalist id="yl-staff-names">
                {staffNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <div className="form-text">
                บันทึกเฉพาะเงินที่จ่ายจริงในครั้งนี้ —
                จ่ายรายวันหรือหลายวันรวมกันก็กรอกยอดที่จ่ายจริง
              </div>
            </div>
          )}

          <div className="row g-2 mb-3">
            <div className="col-sm-6">
              <label className="form-label small fw-bold">จำนวนเงิน (บาท)</label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="form-control form-control-lg"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div className="col-sm-6">
              <label className="form-label small fw-bold">ช่องทาง</label>
              <div className="btn-group w-100" role="group">
                <button
                  type="button"
                  className={`btn ${payMethod === "cash" ? "btn-success" : "btn-outline-success"}`}
                  onClick={() => setPayMethod("cash")}
                >
                  💵 เงินสด
                </button>
                <button
                  type="button"
                  className={`btn ${
                    payMethod === "transfer" ? "btn-primary" : "btn-outline-primary"
                  }`}
                  onClick={() => setPayMethod("transfer")}
                >
                  📱 เงินโอน
                </button>
              </div>
            </div>
          </div>

          {drawerOn && payMethod === "cash" && (
            <div className="mb-3">
              <label className="form-label small fw-bold">เงินสดก้อนนี้มาจากไหน</label>
              <div className="btn-group w-100" role="group">
                <button
                  type="button"
                  className={`btn ${fromDrawer ? "btn-warning" : "btn-outline-warning"}`}
                  onClick={() => setFromDrawer(true)}
                >
                  🗄️ จ่ายจากลิ้นชักร้าน
                </button>
                <button
                  type="button"
                  className={`btn ${!fromDrawer ? "btn-secondary" : "btn-outline-secondary"}`}
                  onClick={() => setFromDrawer(false)}
                >
                  ไม่ได้ใช้เงินในลิ้นชัก
                </button>
              </div>
              <div className="form-text">
                มีผลกับยอด “เงินที่ควรมีในลิ้นชัก” เท่านั้น —
                รายจ่ายและกำไรสุทธิคิดเหมือนเดิมทั้งสองแบบ
              </div>
            </div>
          )}

          <div className="mb-3">
            <label className="form-label small fw-bold">วันที่/เวลา</label>
            <input
              type="datetime-local"
              className="form-control"
              value={occurred}
              onChange={(e) => setOccurred(e.target.value)}
            />
            <div className="form-text">
              ระบบใส่เวลาปัจจุบันให้อัตโนมัติ — แก้ย้อนหลังได้ ยอดจะไปอยู่ในเดือนตามวันที่นี้
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label small fw-bold">หมายเหตุ (ไม่บังคับ)</label>
            <input
              className="form-control"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={category === "ps_plus" ? "เช่น Account 1 รอบ ก.ย." : ""}
            />
          </div>

          {error && <div className="alert alert-danger py-2 small">{error}</div>}

          <div className="d-flex gap-2">
            <button className="btn btn-secondary flex-fill" onClick={onClose} disabled={busy}>
              ยกเลิก
            </button>
            <button
              className="btn btn-primary flex-fill"
              onClick={save}
              disabled={busy || !(Number(amount) > 0)}
            >
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================= ฟอร์มค่าเช่าห้อง =================

function RoomRentModal({
  month,
  onClose,
  onSaved,
}: {
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [m, setM] = useState(month);
  const [payMethod, setPayMethod] = useState<PayMethod>("transfer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status: shop, refresh: refreshShop } = useShop();
  const drawerOn = !!shop?.installed;
  const [toDrawer, setToDrawer] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await addOtherIncome({
        kind: "room_rent",
        amount: Number(amount),
        month: m,
        payMethod,
        note,
        ...(drawerOn ? { toDrawer } : {}),
      });
      if (drawerOn) void refreshShop();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header bg-success text-white">
          <h5 className="modal-title fw-bold m-0 d-flex align-items-center gap-2">
            <Home size={18} /> เพิ่มรายรับค่าเช่าห้อง
          </h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>

        <div className="p-3">
          <div className="alert alert-secondary small py-2">
            กรอก <b>ค่าเช่า + ค่าไฟผู้เช่า รวมเป็นยอดเดียว</b>
            <br />
            เช่น ค่าเช่า 3,500 + ค่าไฟ 850 → กรอก <b>4,350</b>
          </div>

          <div className="mb-3">
            <label className="form-label small fw-bold">จำนวนเงิน (บาท)</label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              className="form-control form-control-lg"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="4350"
              autoFocus
            />
          </div>

          <div className="mb-3">
            <label className="form-label small fw-bold">เดือนที่รับ</label>
            <input
              type="month"
              className="form-control"
              value={m}
              onChange={(e) => setM(e.target.value)}
            />
            <div className="form-text">
              ยอดนี้จะถูกรวมเข้ากับรายรับของร้านในเดือนที่เลือก ไม่ใช่เดือนที่กดบันทึก
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label small fw-bold">ช่องทาง</label>
            <div className="btn-group w-100" role="group">
              <button
                type="button"
                className={`btn ${payMethod === "cash" ? "btn-success" : "btn-outline-success"}`}
                onClick={() => setPayMethod("cash")}
              >
                💵 เงินสด
              </button>
              <button
                type="button"
                className={`btn ${
                  payMethod === "transfer" ? "btn-primary" : "btn-outline-primary"
                }`}
                onClick={() => setPayMethod("transfer")}
              >
                📱 เงินโอน
              </button>
            </div>
          </div>

          {drawerOn && payMethod === "cash" && (
            <div className="form-check mb-3">
              <input
                className="form-check-input"
                type="checkbox"
                id="rentToDrawer"
                checked={toDrawer}
                onChange={(e) => setToDrawer(e.target.checked)}
              />
              <label className="form-check-label small" htmlFor="rentToDrawer">
                เก็บเงินสดก้อนนี้เข้าลิ้นชักร้าน
                <span className="text-muted">
                  {" "}
                  — ติ๊กเฉพาะเมื่อเอาเงินใส่ลิ้นชักจริง (มีผลกับยอดลิ้นชักเท่านั้น)
                </span>
              </label>
            </div>
          )}

          <div className="mb-3">
            <label className="form-label small fw-bold">หมายเหตุ (ไม่บังคับ)</label>
            <input
              className="form-control"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ค่าเช่า 3,500 + ค่าไฟ 850"
            />
          </div>

          {error && <div className="alert alert-danger py-2 small">{error}</div>}

          <div className="d-flex gap-2">
            <button className="btn btn-secondary flex-fill" onClick={onClose} disabled={busy}>
              ยกเลิก
            </button>
            <button
              className="btn btn-success flex-fill"
              onClick={save}
              disabled={busy || !(Number(amount) > 0)}
            >
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================= ประวัติการแก้ไข =================

const ACTION_LABEL: Record<AuditRow["action"], string> = {
  insert: "สร้างรายการ",
  update: "แก้ไข",
  void: "ยกเลิก",
  restore: "กู้คืน",
};

function AuditModal({ row, onClose }: { row: Expense | OtherIncome; onClose: () => void }) {
  const [list, setList] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAudit(row.id)
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [row.id]);

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header bg-primary text-white">
          <h5 className="modal-title fw-bold m-0 d-flex align-items-center gap-2">
            <History size={18} /> ประวัติการแก้ไข
          </h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <div className="p-3">
          {error && <div className="alert alert-danger py-2 small">{error}</div>}
          {!list && !error && <div className="text-center text-muted py-3">กำลังโหลด...</div>}
          {list && list.length === 0 && <div className="yl-rep-empty">ไม่มีประวัติ</div>}
          {list && list.length > 0 && (
            <table className="table table-sm align-middle yl-rep-table m-0">
              <thead>
                <tr>
                  <th>เมื่อ</th>
                  <th>ทำอะไร</th>
                  <th className="text-end">ยอดหลังแก้</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td className="small text-nowrap">{fmtDateTime(a.at)}</td>
                    <td className="small">{ACTION_LABEL[a.action]}</td>
                    <td className="text-end small">
                      {a.after && typeof a.after.amount !== "undefined"
                        ? `${formatBaht(Number(a.after.amount))} บาท`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="form-text mt-2">
            รายการการเงินลบจริงไม่ได้ — การยกเลิกเก็บเป็นประวัติไว้เสมอ
          </div>
        </div>
      </div>
    </div>
  );
}
