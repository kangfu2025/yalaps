import { useEffect, useState } from "react";
import {
  Store,
  DoorOpen,
  DoorClosed,
  Banknote,
  Coins,
  Minus,
  Plus,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  RefreshCw,
} from "lucide-react";
import { formatBaht } from "@/lib/priceEngine";
import { useShop } from "@/hooks/useShop";
import {
  BANKNOTES,
  COINS,
  countTotal,
  openShop,
  closeShop,
  withdrawFromDrawer,
  getShopStatus,
  listOpenBills,
  fmtShiftTime,
  fmtShiftDate,
  type CashCounts,
  type OpenBill,
  type WithdrawResult,
  withdrawToast,
  type CloseResult,
  type Denom,
  type DrawerCash,
  type ShopStatus,
} from "@/lib/shopShift";

// ============================================================
// แถบสถานะร้าน — อยู่บนสุดของหน้าแรก
// ============================================================

export function ShopBar({ isAdmin }: { isAdmin: boolean }) {
  const { status, refresh, notify } = useShop();
  const [modal, setModal] = useState<"open" | "close" | "withdraw" | null>(null);

  if (!status) return null;

  if (!status.installed) {
    // ยังไม่ได้รัน migration — ระบบเดิมทำงานปกติ ไม่มีการกันเปิดเครื่อง
    if (!isAdmin) return null;
    return (
      <div className="alert alert-warning small py-2">
        <b>ยังไม่ได้ติดตั้งระบบเปิด-ปิดร้าน</b> — รัน <code>supabase/shop_shift_migration.sql</code>{" "}
        ใน Supabase SQL Editor แล้วรีเฟรช (ระหว่างนี้เปิดเครื่องได้ตามปกติ)
      </div>
    );
  }

  const done = async () => {
    setModal(null);
    await refresh();
  };
  const opened = async (openingCash: number) => {
    await done();
    notify(openedToast(openingCash));
  };
  const closed = async (r: CloseResult | null) => {
    await done();
    if (r) notify(closedToast(r));
  };
  const withdrew = async (r?: WithdrawResult) => {
    await done();
    if (r) notify(withdrawToast(r));
  };

  return (
    <>
      <div className={`yl-shop-bar ${status.open ? "is-open" : "is-closed"}`}>
        <div className="yl-shop-state">
          <span className="yl-shop-dot" aria-hidden />
          <div>
            <div className="yl-shop-title">
              <Store size={16} /> {status.open ? "ร้านเปิดอยู่" : "ร้านปิด"}
            </div>
            <div className="yl-shop-sub">
              {status.open && status.shift ? (
                <>
                  เปิดเมื่อ {fmtShiftTime(status.shift.opened_at)} น. โดย{" "}
                  {status.shift.opened_by_name ?? "—"} · เงินเริ่มต้น{" "}
                  {formatBaht(status.shift.opening_cash)} บาท
                </>
              ) : status.gate ? (
                "ต้องเปิดร้านก่อน จึงจะเปิดเครื่องเล่นได้"
              ) : (
                "ตัวกันเปิดเครื่องถูกปิดไว้ชั่วคราว"
              )}
            </div>
          </div>
        </div>

        {status.open && isAdmin && status.cash && (
          <div className="yl-shop-cash">
            <span>เงินในลิ้นชักตอนนี้</span>
            <b>฿{formatBaht(status.cash.expected)}</b>
          </div>
        )}

        <div className="yl-shop-actions">
          {status.open && isAdmin && (
            <button className="btn btn-outline-warning" onClick={() => setModal("withdraw")}>
              <Wallet size={15} /> ถอนเงินจากลิ้นชัก
            </button>
          )}
          {status.open ? (
            <button className="btn btn-danger fw-bold" onClick={() => setModal("close")}>
              <DoorClosed size={16} /> ปิดร้าน
            </button>
          ) : (
            <button className="btn btn-success fw-bold" onClick={() => setModal("open")}>
              <DoorOpen size={16} /> เปิดร้าน
            </button>
          )}
        </div>
      </div>

      {modal === "open" && (
        <OpenShopModal status={status} onClose={() => setModal(null)} onDone={opened} />
      )}
      {modal === "close" && <CloseShopModal onClose={() => setModal(null)} onDone={closed} />}
      {modal === "withdraw" && <WithdrawModal onClose={() => setModal(null)} onDone={withdrew} />}
    </>
  );
}

// ============================================================
// หน้าต่าง "ร้านยังปิดอยู่" + แถบแจ้งเตือนมุมจอ
// วางไว้ครั้งเดียวใต้ ShopProvider — ทุกปุ่มเปิดเครื่องเรียกผ่าน useShop()
// ============================================================

function openedToast(openingCash: number) {
  return {
    kind: "success" as const,
    title: "เปิดร้านเรียบร้อย",
    text: `เงินเริ่มต้นในลิ้นชัก ${formatBaht(openingCash)} บาท · เปิดเครื่องให้ลูกค้าได้แล้ว`,
  };
}

function closedToast(r: CloseResult) {
  const d = Number(r.diff) || 0;
  const diffText =
    Math.abs(d) < 0.005
      ? "เงินตรง"
      : d < 0
        ? `เงินขาด ${formatBaht(-d)} บาท`
        : `เงินเกิน ${formatBaht(d)} บาท`;
  return {
    kind: Math.abs(d) < 0.005 || d > 0 ? ("success" as const) : ("warning" as const),
    title: "ปิดร้านเรียบร้อย",
    text: `นับได้ ${formatBaht(r.counted)} บาท · ${diffText}`,
  };
}

export function ShopOverlays() {
  const { status, closedPrompt, hideClosedPrompt, refresh, notify, toast, dismissToast } =
    useShop();
  const [opening, setOpening] = useState(false);

  // ปิดด้วยปุ่ม Esc ได้เหมือนหน้าต่างอื่น
  useEffect(() => {
    if (!closedPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideClosedPrompt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closedPrompt, hideClosedPrompt]);

  return (
    <>
      {closedPrompt && !opening && (
        <div className="modal-backdrop-custom" onClick={hideClosedPrompt}>
          <div
            className="modal-custom yl-notice is-closed"
            role="alertdialog"
            aria-labelledby="yl-notice-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="yl-notice-icon" aria-hidden>
              <Store size={30} />
            </div>
            <h5 id="yl-notice-title" className="yl-notice-title">
              ร้านยังปิดอยู่
            </h5>
            <p className="yl-notice-text">
              กรุณาเปิดร้านก่อนเริ่มใช้งานเครื่อง
              <br />
              <span>กด “เปิดร้านเลย” แล้วนับเงินในลิ้นชัก จากนั้นค่อยเปิดเครื่องให้ลูกค้า</span>
            </p>
            <div className="yl-notice-actions">
              <button className="btn btn-secondary flex-fill" onClick={hideClosedPrompt}>
                ไว้ก่อน
              </button>
              {status?.installed && (
                <button
                  className="btn btn-success fw-bold flex-fill"
                  onClick={() => setOpening(true)}
                  autoFocus
                >
                  <DoorOpen size={16} /> เปิดร้านเลย
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {opening && status && (
        <OpenShopModal
          status={status}
          onClose={() => {
            setOpening(false);
            hideClosedPrompt();
          }}
          onDone={async (openingCash) => {
            setOpening(false);
            hideClosedPrompt();
            await refresh();
            notify(openedToast(openingCash));
          }}
        />
      )}

      {toast && (
        <div className="yl-toast-wrap" aria-live="polite">
          <div key={toast.id} className={`yl-toast is-${toast.kind}`} role="status">
            <span className="yl-toast-icon" aria-hidden>
              {toast.kind === "success" ? (
                <CheckCircle2 size={22} />
              ) : toast.kind === "warning" ? (
                <AlertTriangle size={22} />
              ) : (
                <Info size={22} />
              )}
            </span>
            <div className="yl-toast-body">
              <b>{toast.title}</b>
              {toast.text && <span>{toast.text}</span>}
            </div>
            <button className="yl-toast-x" onClick={dismissToast} aria-label="ปิดแจ้งเตือน">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// ตารางนับธนบัตร/เหรียญ
// ============================================================

function CashCounter({
  counts,
  onChange,
}: {
  counts: CashCounts;
  onChange: (c: CashCounts) => void;
}) {
  function set(d: Denom, raw: string | number) {
    // รับเฉพาะจำนวนเต็มไม่ติดลบ — พิมพ์อย่างอื่นมาถือเป็น 0
    const n = Math.max(0, Math.min(999999, Math.floor(Number(raw) || 0)));
    onChange({ ...counts, [`${d}`]: n });
  }

  const row = (d: Denom, unit: string) => {
    const n = Number(counts[`${d}`]) || 0;
    return (
      <div className="yl-cash-row" key={d}>
        <span className="yl-cash-denom">{d.toLocaleString("th-TH")} บาท</span>
        <div className="yl-cash-qty">
          <button type="button" onClick={() => set(d, n - 1)} disabled={n <= 0} aria-label="ลด">
            <Minus size={14} />
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={n === 0 ? "" : n}
            placeholder="0"
            onChange={(e) => set(d, e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={`จำนวน${unit} ${d} บาท`}
          />
          <button type="button" onClick={() => set(d, n + 1)} aria-label="เพิ่ม">
            <Plus size={14} />
          </button>
        </div>
        <span className="yl-cash-sub">{n > 0 ? formatBaht(n * d) : "—"}</span>
      </div>
    );
  };

  return (
    <div className="yl-cash">
      <div className="yl-cash-head">
        <Banknote size={15} /> ธนบัตร <em>(จำนวนใบ)</em>
      </div>
      {BANKNOTES.map((d) => row(d, "ใบ"))}
      <div className="yl-cash-head">
        <Coins size={15} /> เหรียญ <em>(จำนวนเหรียญ)</em>
      </div>
      {COINS.map((d) => row(d, "เหรียญ"))}
    </div>
  );
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ============================================================
// เปิดร้าน
// ============================================================

function OpenShopModal({
  status,
  onClose,
  onDone,
}: {
  status: ShopStatus;
  onClose: () => void;
  onDone: (openingCash: number) => void;
}) {
  const [counts, setCounts] = useState<CashCounts>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = countTotal(counts);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await openShop(counts);
      onDone(total);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop-custom" onClick={busy ? undefined : onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header bg-success text-white">
          <h5 className="modal-title fw-bold m-0 d-flex align-items-center gap-2">
            <DoorOpen size={18} /> เปิดร้าน — นับเงินสดในลิ้นชัก
          </h5>
          <button className="btn-close btn-close-white" onClick={onClose} disabled={busy} />
        </div>
        <div className="p-3">
          {status.last_closed && (
            <div className="alert alert-secondary small py-2">
              ปิดร้านครั้งก่อน ({fmtShiftDate(status.last_closed.closed_at)}) นับเงินได้{" "}
              <b>{formatBaht(status.last_closed.counted_cash)}</b> บาท — ถ้าวันนี้นับได้ไม่เท่ากัน
              ให้กรอกตามที่นับได้จริง
            </div>
          )}

          <CashCounter counts={counts} onChange={setCounts} />

          <div className="yl-cash-total">
            <span>ยอดเงินสดเริ่มต้น</span>
            <b>{formatBaht(total)} บาท</b>
          </div>

          {error && <div className="alert alert-danger py-2 small mt-3 mb-0">{error}</div>}

          <div className="d-flex gap-2 mt-3">
            <button className="btn btn-secondary flex-fill" onClick={onClose} disabled={busy}>
              ยกเลิก
            </button>
            <button className="btn btn-success fw-bold flex-fill" onClick={confirm} disabled={busy}>
              {busy ? "กำลังเปิดร้าน..." : "ยืนยันเปิดร้าน"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ปิดร้าน: นับเงิน -> ดูสรุป -> ยืนยัน -> ผลลัพธ์
// ============================================================

/** ป้ายเงินขาด/เกิน/ตรง ใช้ทั้งตอนสรุปก่อนปิดและในประวัติ */
export function DiffBadge({ diff, expected }: { diff: number; expected?: number }) {
  if (Math.abs(diff) < 0.005) {
    return (
      <span className="yl-diff is-ok">
        🟢 เงินตรง{expected !== undefined ? ` ${formatBaht(expected)} บาท` : ""}
      </span>
    );
  }
  return diff < 0 ? (
    <span className="yl-diff is-short">🔴 เงินขาด {formatBaht(-diff)} บาท</span>
  ) : (
    <span className="yl-diff is-over">🟢 เงินเกิน {formatBaht(diff)} บาท</span>
  );
}

/** ตารางสรุปลิ้นชัก — ใช้ร่วมกันทุกที่ จะได้เรียงบรรทัดเหมือนกันหมด */
export function DrawerSummary({
  cash,
  counted,
}: {
  cash: Pick<DrawerCash, "opening" | "cash_in" | "cash_out" | "withdrawn" | "expected"> &
    Partial<Pick<DrawerCash, "ps5" | "pc" | "pos" | "other_in">>;
  counted?: number;
}) {
  const parts = [
    { label: "PS5", v: cash.ps5 },
    { label: "PC", v: cash.pc },
    { label: "POS", v: cash.pos },
    { label: "รายรับอื่น", v: cash.other_in },
  ].filter((p) => Number(p.v) > 0);

  return (
    <div className="yl-drawer-sum">
      <div className="yl-drawer-row">
        <span>ยอดเปิดร้าน</span>
        <b>{formatBaht(cash.opening)}</b>
      </div>
      <div className="yl-drawer-row">
        <span>
          รายรับเงินสด
          {parts.length > 0 && (
            <em>{parts.map((p) => `${p.label} ${formatBaht(Number(p.v))}`).join(" · ")}</em>
          )}
        </span>
        <b className="pos">+{formatBaht(cash.cash_in)}</b>
      </div>
      <div className="yl-drawer-row">
        <span>รายจ่ายเงินสดจากลิ้นชัก</span>
        <b className="neg">-{formatBaht(cash.cash_out)}</b>
      </div>
      <div className="yl-drawer-row">
        <span>ยอดถอนเงิน</span>
        <b className="neg">-{formatBaht(cash.withdrawn)}</b>
      </div>
      <div className="yl-drawer-row is-total">
        <span>เงินที่ควรเหลือ</span>
        <b>{formatBaht(cash.expected)}</b>
      </div>
      {counted !== undefined && (
        <>
          <div className="yl-drawer-row">
            <span>เงินที่นับจริง</span>
            <b>{formatBaht(counted)}</b>
          </div>
          <div className="yl-drawer-row is-diff">
            <span>ผลต่าง</span>
            <DiffBadge diff={counted - cash.expected} expected={cash.expected} />
          </div>
        </>
      )}
    </div>
  );
}

/** รายการบิลที่ยังไม่ปิด — ใช้ทั้งตอนเปิดหน้าต่างปิดร้านและตอนยืนยัน */
function OpenBillsCard({
  bills,
  count,
  checking,
  onRecheck,
}: {
  bills: OpenBill[] | null;
  count: number;
  checking: boolean;
  onRecheck: () => void;
}) {
  const DAY = 24 * 60 * 60 * 1000;
  return (
    <div className="yl-block">
      <div className="yl-block-head">
        <span className="yl-block-icon" aria-hidden>
          <AlertTriangle size={20} />
        </span>
        <div>
          <b>ยังปิดร้านไม่ได้ — มีบิลค้าง {count} รายการ</b>
          <span>ปิดบิลให้ครบก่อน ไม่งั้นเงินจากบิลเหล่านี้จะไม่อยู่ในรอบไหนเลย</span>
        </div>
      </div>

      {bills && bills.length > 0 && (
        <ul className="yl-block-list">
          {bills.map((b) => {
            const stale = Date.now() - new Date(b.started_at).getTime() > DAY;
            return (
              <li key={b.id}>
                <span className="yl-block-zone">
                  {b.kind === "pc" ? "💻 PC" : b.zone === "racing" ? "🏎️ รถแข่ง" : "🛋️ โซฟา"}
                  {b.machine_number !== null && <> เครื่อง {b.machine_number}</>}
                </span>
                <span className="yl-block-meta">
                  {b.customer_name || "ไม่ระบุชื่อ"} · เปิด {fmtShiftDate(b.started_at)}{" "}
                  {fmtShiftTime(b.started_at)} น.
                </span>
                {stale && <span className="yl-block-stale">ค้างนานผิดปกติ — แจ้งแอดมิน</span>}
              </li>
            );
          })}
        </ul>
      )}

      <button className="btn btn-sm btn-outline-light mt-2" onClick={onRecheck} disabled={checking}>
        <RefreshCw size={13} /> {checking ? "กำลังตรวจ..." : "ปิดบิลแล้ว ตรวจอีกครั้ง"}
      </button>
    </div>
  );
}

function CloseShopModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (result: CloseResult | null) => void;
}) {
  const [step, setStep] = useState<"count" | "summary" | "done">("count");
  const [counts, setCounts] = useState<CashCounts>({});
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<ShopStatus | null>(null);
  const [result, setResult] = useState<CloseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // บิลค้าง: ตรวจตั้งแต่เปิดหน้าต่าง จะได้ไม่ต้องนับเงินเสร็จแล้วค่อยรู้ว่าปิดไม่ได้
  const [openCount, setOpenCount] = useState(0);
  const [bills, setBills] = useState<OpenBill[] | null>(null);
  const [checking, setChecking] = useState(true);
  const counted = countTotal(counts);

  async function checkBills(): Promise<number> {
    setChecking(true);
    try {
      const st = await getShopStatus();
      setFresh(st);
      const n = st.active_sessions ?? 0;
      setOpenCount(n);
      setBills(n > 0 ? await listOpenBills().catch(() => null) : []);
      return n;
    } catch (e) {
      setError(errText(e));
      return 0;
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void checkBills();
  }, []);

  // ไปหน้าสรุป: ถามยอดล่าสุดจากฐานข้อมูลก่อนเสมอ ไม่ใช้ตัวเลขที่ค้างอยู่บนจอ
  async function toSummary() {
    setBusy(true);
    setError(null);
    try {
      const st = await getShopStatus();
      if (!st.open) throw new Error("ร้านปิดอยู่แล้ว");
      setFresh(st);
      const n = st.active_sessions ?? 0;
      setOpenCount(n);
      if (n > 0) setBills(await listOpenBills().catch(() => null));
      setStep("summary");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      setResult(await closeShop(counts, note));
      setStep("done");
    } catch (e) {
      setError(errText(e));
      // อาจมีคนเพิ่งเปิดบิลใหม่ระหว่างนั้น — ดึงรายการค้างมาแสดง
      void checkBills();
    } finally {
      setBusy(false);
    }
  }

  const blocked = openCount > 0;
  const closeModal = step === "done" ? () => onDone(result) : onClose;

  return (
    <div className="modal-backdrop-custom" onClick={busy ? undefined : closeModal}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header bg-danger text-white">
          <h5 className="modal-title fw-bold m-0 d-flex align-items-center gap-2">
            <DoorClosed size={18} />{" "}
            {step === "count"
              ? "ปิดร้าน — นับเงินจริงในลิ้นชัก"
              : step === "summary"
                ? "ปิดร้าน — ตรวจสรุปก่อนยืนยัน"
                : "ปิดร้านเรียบร้อย"}
          </h5>
          <button className="btn-close btn-close-white" onClick={closeModal} disabled={busy} />
        </div>

        <div className="p-3">
          {step !== "done" && blocked && (
            <OpenBillsCard
              bills={bills}
              count={openCount}
              checking={checking}
              onRecheck={() => void checkBills()}
            />
          )}

          {step === "count" && (
            <>
              <CashCounter counts={counts} onChange={setCounts} />
              <div className="yl-cash-total">
                <span>เงินจริงที่นับได้</span>
                <b>{formatBaht(counted)} บาท</b>
              </div>
            </>
          )}

          {step === "summary" && fresh?.cash && (
            <>
              <DrawerSummary cash={fresh.cash} counted={counted} />
              <label className="form-label small fw-bold mt-3">หมายเหตุ (ไม่บังคับ)</label>
              <input
                className="form-control"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="เช่น สาเหตุที่เงินขาด/เกิน"
              />
            </>
          )}

          {step === "done" && result && (
            <>
              <div className="yl-done">
                <CheckCircle2 size={34} />
                <b>ปิดร้านเรียบร้อย</b>
                <DiffBadge diff={Number(result.diff) || 0} expected={result.expected} />
              </div>
              <DrawerSummary cash={result} counted={result.counted} />
              <div className="form-text mt-2">
                บันทึกไว้ในประวัติแล้ว · เปิดเครื่องใหม่ไม่ได้จนกว่าจะเปิดร้านครั้งถัดไป
              </div>
            </>
          )}

          {error && <div className="alert alert-danger py-2 small mt-3 mb-0">{error}</div>}

          <div className="d-flex gap-2 mt-3">
            {step === "count" && (
              <>
                <button className="btn btn-secondary flex-fill" onClick={onClose} disabled={busy}>
                  ยกเลิก
                </button>
                <button
                  className="btn btn-primary flex-fill"
                  onClick={toSummary}
                  disabled={busy || checking || blocked}
                >
                  {busy ? "กำลังคำนวณ..." : "ถัดไป: ดูสรุป"}
                </button>
              </>
            )}
            {step === "summary" && (
              <>
                <button
                  className="btn btn-secondary flex-fill"
                  onClick={() => setStep("count")}
                  disabled={busy}
                >
                  กลับไปนับใหม่
                </button>
                <button
                  className="btn btn-danger fw-bold flex-fill"
                  onClick={confirm}
                  disabled={busy || blocked}
                >
                  {busy ? "กำลังปิดร้าน..." : "ยืนยันปิดร้าน"}
                </button>
              </>
            )}
            {step === "done" && (
              <button className="btn btn-primary flex-fill" onClick={() => onDone(result)}>
                เสร็จสิ้น
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ถอนเงินจากลิ้นชัก (แอดมิน)
// ============================================================

const WITHDRAW_NOTES = ["นำเงินเก็บ", "นำฝากธนาคาร", "อื่น ๆ"];

export function WithdrawModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (result?: WithdrawResult) => void;
}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState(WITHDRAW_NOTES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WithdrawResult | null>(null);

  useEffect(() => {
    getShopStatus()
      .then((st) => {
        if (!st.open || !st.cash) setError("ร้านปิดอยู่ — เปิดร้านก่อนจึงจะถอนเงินจากลิ้นชักได้");
        else setBalance(st.cash.expected);
      })
      .catch((e) => setError(errText(e)));
  }, []);

  const amt = Number(amount) || 0;
  const over = balance !== null && amt > balance;
  const canSubmit = balance !== null && amt > 0 && !over && !busy;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      setResult(await withdrawFromDrawer(amt, note));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const closeModal = result ? () => onDone(result) : onClose;

  return (
    <div className="modal-backdrop-custom" onClick={busy ? undefined : closeModal}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header bg-primary text-white">
          <h5 className="modal-title fw-bold m-0 d-flex align-items-center gap-2">
            <Wallet size={18} /> ถอนเงินจากลิ้นชัก
          </h5>
          <button className="btn-close btn-close-white" onClick={closeModal} disabled={busy} />
        </div>

        <div className="p-3">
          {result ? (
            <>
              <div className="yl-drawer-sum">
                <div className="yl-drawer-row">
                  <span>ยอดเดิม</span>
                  <b>{formatBaht(result.before)}</b>
                </div>
                <div className="yl-drawer-row">
                  <span>ถอนออก</span>
                  <b className="neg">-{formatBaht(result.amount)}</b>
                </div>
                <div className="yl-drawer-row is-total">
                  <span>คงเหลือในลิ้นชัก</span>
                  <b>{formatBaht(result.after)} บาท</b>
                </div>
              </div>
              <div className="form-text mt-2">
                บันทึกในประวัติถอนเงินแล้ว · รายการนี้ไม่ใช่รายจ่าย ไม่กระทบกำไรสุทธิ
              </div>
              <button className="btn btn-primary w-100 mt-3" onClick={() => onDone(result)}>
                เสร็จสิ้น
              </button>
            </>
          ) : (
            <>
              <div className="yl-cash-total mt-0">
                <span>ยอดเงินในลิ้นชักปัจจุบัน</span>
                <b>{balance === null ? "…" : `฿${formatBaht(balance)}`}</b>
              </div>

              <label className="form-label small fw-bold mt-3">จำนวนเงินที่ถอน (บาท)</label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                className={`form-control form-control-lg ${over ? "is-invalid" : ""}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                autoFocus
              />
              {over && (
                <div className="invalid-feedback d-block">
                  ถอนเกินยอดในลิ้นชักไม่ได้ (มีอยู่ {formatBaht(balance ?? 0)} บาท)
                </div>
              )}

              <label className="form-label small fw-bold mt-3">หมายเหตุ</label>
              <div className="d-flex gap-2 flex-wrap mb-2">
                {WITHDRAW_NOTES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`btn btn-sm ${note === n ? "btn-primary" : "btn-outline-primary"}`}
                    onClick={() => setNote(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <input
                className="form-control"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="ระบุเพิ่มเติมได้"
              />

              {balance !== null && amt > 0 && !over && (
                <div className="yl-drawer-sum mt-3">
                  <div className="yl-drawer-row">
                    <span>ยอดเดิม</span>
                    <b>{formatBaht(balance)}</b>
                  </div>
                  <div className="yl-drawer-row">
                    <span>ถอนออก</span>
                    <b className="neg">-{formatBaht(amt)}</b>
                  </div>
                  <div className="yl-drawer-row is-total">
                    <span>คงเหลือ</span>
                    <b>{formatBaht(balance - amt)} บาท</b>
                  </div>
                </div>
              )}

              {error && <div className="alert alert-danger py-2 small mt-3 mb-0">{error}</div>}

              <div className="d-flex gap-2 mt-3">
                <button className="btn btn-secondary flex-fill" onClick={onClose} disabled={busy}>
                  ยกเลิก
                </button>
                <button
                  className="btn btn-warning fw-bold flex-fill"
                  onClick={confirm}
                  disabled={!canSubmit}
                >
                  {busy ? "กำลังบันทึก..." : "ยืนยันถอนเงิน"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
