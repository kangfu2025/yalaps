import { useEffect, useState } from "react";
import { Store, DoorOpen, DoorClosed, Banknote, Coins, Minus, Plus, Wallet } from "lucide-react";
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
  fmtShiftTime,
  fmtShiftDate,
  type CashCounts,
  type CloseResult,
  type Denom,
  type DrawerCash,
  type ShopStatus,
} from "@/lib/shopShift";

// ============================================================
// แถบสถานะร้าน — อยู่บนสุดของหน้าแรก
// ============================================================

export function ShopBar({ isAdmin }: { isAdmin: boolean }) {
  const { status, refresh } = useShop();
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
        <OpenShopModal status={status} onClose={() => setModal(null)} onDone={done} />
      )}
      {modal === "close" && <CloseShopModal onClose={() => setModal(null)} onDone={done} />}
      {modal === "withdraw" && <WithdrawModal onClose={() => setModal(null)} onDone={done} />}
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
  onDone: () => void;
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
      onDone();
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

function CloseShopModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<"count" | "summary" | "done">("count");
  const [counts, setCounts] = useState<CashCounts>({});
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<ShopStatus | null>(null);
  const [result, setResult] = useState<CloseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counted = countTotal(counts);

  // ไปหน้าสรุป: ถามยอดล่าสุดจากฐานข้อมูลก่อนเสมอ ไม่ใช้ตัวเลขที่ค้างอยู่บนจอ
  async function toSummary() {
    setBusy(true);
    setError(null);
    try {
      const st = await getShopStatus();
      if (!st.open) throw new Error("ร้านปิดอยู่แล้ว");
      setFresh(st);
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
    } finally {
      setBusy(false);
    }
  }

  const blockedBy = fresh?.active_sessions ?? 0;
  const closeModal = step === "done" ? onDone : onClose;

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
              {blockedBy > 0 && (
                <div className="alert alert-warning small py-2">
                  <b>ยังปิดร้านไม่ได้</b> — มีบิลที่ยังไม่ปิดอยู่ {blockedBy} รายการ
                  ต้องปิดบิลให้ครบก่อน ไม่งั้นเงินที่จะเก็บจากบิลพวกนั้นจะไม่อยู่ในรอบไหนเลย
                </div>
              )}
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
                <button className="btn btn-primary flex-fill" onClick={toSummary} disabled={busy}>
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
                  disabled={busy || blockedBy > 0}
                >
                  {busy ? "กำลังปิดร้าน..." : "ยืนยันปิดร้าน"}
                </button>
              </>
            )}
            {step === "done" && (
              <button className="btn btn-primary flex-fill" onClick={onDone}>
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

export function WithdrawModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState(WITHDRAW_NOTES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ before: number; amount: number; after: number } | null>(
    null,
  );

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

  const closeModal = result ? onDone : onClose;

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
              <button className="btn btn-primary w-100 mt-3" onClick={onDone}>
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
