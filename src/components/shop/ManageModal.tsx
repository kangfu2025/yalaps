import { useEffect, useState } from "react";
import {
  Settings2, MapPin, Monitor, User, Clock, PlayCircle, StopCircle,
  Timer, Plus, Utensils, Wallet, Receipt, BellRing, CreditCard, Tag, ShoppingCart, IdCard, Star, Gift,
} from "lucide-react";
import type { Machine, Reservation } from "@/lib/supabase";
import { HOUR_OPTIONS, calcPrice, formatBaht, formatHours } from "@/lib/priceEngine";
import { addFood, extendTime, setReservationMember } from "@/lib/reservations";
import { checkout, summarizeCheckout, freeHourValue } from "@/lib/billing";
import { MemberSearch } from "./MemberSearch";
import {
  getMember, getPointsConfig, pointsForPlay, canRedeemZone,
  DEFAULT_POINTS_CONFIG, type Member, type PointsConfig,
} from "@/lib/members";
import { PromptPayQR } from "./PromptPayQR";
import { clearDisplay, pushDisplay, toHHMM, type PaymentMethod } from "@/lib/customerDisplay";
import { getZonePrice, type Promotion } from "@/lib/promotions";
import {
  listOpenSalesForBill,
  settleSalesForBill,
  type ProductSale,
  type ProductSaleItem,
} from "@/lib/products";

function payModeToMethod(m: PayMode): PaymentMethod {
  if (m === "transfer") return "promptpay";
  if (m === "points") return "cash";
  return m === "mixed" ? "mixed" : m === "credit" ? "credit" : "cash";
}
import { ConfirmDialog } from "./ConfirmDialog";

type Tab = "food" | "extend" | "checkout";
type PayMode = "cash" | "transfer" | "mixed" | "credit" | "points";

interface Props {
  machine: Machine;
  reservation: Reservation;
  onClose: () => void;
  onSuccess: () => void;
  promotion?: Promotion | null;
}

function formatClock(input: string | number | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDateClock(input: string | number | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time} น.`;
}

export function ManageModal({ machine, reservation, onClose, onSuccess, promotion = null }: Props) {
  const [tab, setTab] = useState<Tab>("food");
  const [busy, setBusy] = useState(false);
  const [confirmCheckout, setConfirmCheckout] = useState(false);
  const [autoRun, setAutoRun] = useState<null | "extend" | "checkout">(null);

  const override = promotion ? getZonePrice(machine.zone, promotion) : null;

  // food
  const [foodAmt, setFoodAmt] = useState<string>("");
  const [foodPay, setFoodPay] = useState<PayMode>("cash");
  const [foodCash, setFoodCash] = useState<string>("");
  const [foodTransfer, setFoodTransfer] = useState<string>("");

  // extend
  const [extHrs, setExtHrs] = useState<number>(0.5);
  const [extPay, setExtPay] = useState<PayMode>("cash");
  const [extCash, setExtCash] = useState<string>("");
  const [extTransfer, setExtTransfer] = useState<string>("");
  const extPrice = calcPrice(machine.zone, extHrs, override);

  // สมาชิก + แต้ม
  const [member, setMember] = useState<Member | null>(null);
  const [cfg, setCfg] = useState<PointsConfig>(DEFAULT_POINTS_CONFIG);
  const [useFreeHour, setUseFreeHour] = useState(false);

  useEffect(() => { getPointsConfig().then(setCfg).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    if (!reservation.member_id) { setMember(null); return; }
    getMember(reservation.member_id)
      .then((m) => { if (alive) setMember(m); })
      .catch((e) => console.warn("[bill] load member failed:", e));
    return () => { alive = false; };
  }, [reservation.member_id]);

  const redeemValue = freeHourValue(machine.zone, promotion);
  const canRedeem = !!member && canRedeemZone(machine.zone, cfg) && member.points >= cfg.redeem_cost;
  const willEarn = member ? pointsForPlay(machine.zone, { hours: Number(reservation.total_hours) }, cfg) : 0;

  async function handleMemberChange(m: Member | null) {
    setMember(m);
    if (!m) setUseFreeHour(false);
    try {
      await setReservationMember(reservation.id, m?.id ?? null);
    } catch (e) {
      console.warn("[bill] set member failed:", e);
    }
  }

  // checkout — ใช้ราคาโปรถ้ามีโปรในวันที่เช็คบิล
  const summary = summarizeCheckout(
    reservation,
    promotion,
    useFreeHour && canRedeem ? redeemValue : 0,
  );
  const [finalPay, setFinalPay] = useState<PayMode>("cash");
  const [finalCash, setFinalCash] = useState<string>(String(summary.remaining));
  const [finalTransfer, setFinalTransfer] = useState<string>("");

  const foodNum = Number(foodAmt) || 0;

  // สินค้าที่ลงบิลไว้ที่เครื่องนี้ (ยังไม่เก็บเงิน)
  const [prodSales, setProdSales] = useState<(ProductSale & { product_sale_items: ProductSaleItem[] })[]>([]);
  useEffect(() => {
    listOpenSalesForBill({ reservationId: reservation.id })
      .then(setProdSales)
      .catch((e) => console.warn("[bill] load product sales failed:", e));
  }, [reservation.id]);
  const productItems = prodSales.flatMap((s2) => s2.product_sale_items ?? []);
  const productTotal = prodSales.reduce((sum, s2) => sum + Number(s2.total), 0);
  const grandRemaining = summary.remaining + productTotal;

  useEffect(() => {
    if (finalPay === "cash") {
      setFinalCash(String(grandRemaining));
      setFinalTransfer("");
    } else if (finalPay === "transfer") {
      setFinalCash("");
      setFinalTransfer(String(grandRemaining));
    } else if (finalPay === "credit" || finalPay === "points") {
      setFinalCash("");
      setFinalTransfer("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalPay, grandRemaining]);

  useEffect(() => {
    const basePlayHours = Number(reservation.total_hours) || 0;
    const baseFood = Number(reservation.food_revenue) || 0;
    const playHours =
      tab === "extend" ? basePlayHours + (Number(extHrs) || 0) : basePlayHours;
    const foodAmount =
      tab === "food" ? baseFood + foodNum : baseFood;

    const currentPay: PayMode =
      tab === "checkout" ? finalPay : tab === "extend" ? extPay : foodPay;

    const amount =
      tab === "checkout" ? grandRemaining : tab === "extend" ? extPrice : foodNum;

    const chargeType: "extend" | "food" | "checkout" =
      tab === "extend" ? "extend" : tab === "food" ? "food" : "checkout";

    pushDisplay({
      kind: "manage",
      zone: machine.zone,
      machine_number: machine.machine_number,
      customer_name: reservation.customer_name,
      start_time: toHHMM(reservation.start_time),
      end_time: toHHMM(reservation.end_time_ms),
      play_hours: playHours,
      food_amount: foodAmount,
      charge_type: chargeType,
      extend_hours: tab === "extend" ? Number(extHrs) || 0 : 0,
      food_charge: tab === "food" ? foodNum : 0,
      message: tab === "checkout" ? `ยอดสุทธิ ${formatBaht(summary.total_due + productTotal)} บาท` : "",
      amount,
      payment_method: payModeToMethod(currentPay),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, foodAmt, foodPay, foodTransfer, extHrs, extPay, extTransfer, finalPay, finalTransfer, finalCash]);

  async function handleFood(e: React.FormEvent) {
    e.preventDefault();
    if (busy || foodNum <= 0) return;
    setBusy(true);
    try {
      let c = Number(foodCash) || 0;
      let t = Number(foodTransfer) || 0;
      if (foodPay === "cash") { c = foodNum; t = 0; }
      else if (foodPay === "transfer") { c = 0; t = foodNum; }
      else if (foodPay === "credit") { c = 0; t = 0; }
      await addFood(reservation, foodNum, c, t);
      await clearDisplay();
      onSuccess();
      onClose();
    } catch (err) {
      alert("เพิ่มค่าอาหารไม่สำเร็จ: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function handleExtend(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      let c = Number(extCash) || 0;
      let t = Number(extTransfer) || 0;
      if (extPay === "cash") { c = extPrice; t = 0; }
      else if (extPay === "transfer") { c = 0; t = extPrice; }
      else if (extPay === "credit") { c = 0; t = 0; }
      await extendTime(reservation, extHrs, c, t);
      await clearDisplay();
      onSuccess();
      onClose();
    } catch (err) {
      alert("ต่อเวลาไม่สำเร็จ: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  /**
   * สลิปผ่านแล้วทำงานต่อให้เลย
   * เรียกเฉพาะตอนจ่ายโอนล้วน — ยอดบนสลิปจึงเท่ากับยอดที่ต้องชำระทั้งก้อน
   * ถ้าจ่ายแบบผสม สลิปยืนยันได้แค่ส่วนที่โอน พนักงานต้องกดเอง
   */
  function runAfterSlip(kind: "extend" | "checkout") {
    if (autoRun || busy) return;
    setAutoRun(kind);
    // หน่วงสั้น ๆ ให้พนักงานเห็นว่าสลิปผ่านก่อนหน้าต่างปิด
    setTimeout(() => {
      const run = kind === "extend" ? handleExtend() : doCheckout({ keepDisplay: true });
      Promise.resolve(run).catch(() => setAutoRun(null));
    }, 900);
  }

  async function doCheckout(opts: { keepDisplay?: boolean } = {}) {
    if (busy) return;
    setBusy(true);
    setConfirmCheckout(false);
    try {
      let c = Number(finalCash) || 0;
      let t = Number(finalTransfer) || 0;
      if (finalPay === "cash") { c = grandRemaining; t = 0; }
      else if (finalPay === "transfer") { c = 0; t = grandRemaining; }
      else if (finalPay === "credit") { c = 0; t = 0; }
      else if (finalPay === "points") { c = 0; t = 0; }

      // แยกเงินส่วนสินค้าออกจากบิลเครื่อง (กันนับรายได้ซ้ำ)
      let prodCash = 0;
      let prodTransfer = 0;
      if (productTotal > 0) {
        if (finalPay === "cash") prodCash = productTotal;
        else if (finalPay === "transfer") prodTransfer = productTotal;
        else if (finalPay === "mixed") {
          prodCash = Math.min(c, productTotal);
          prodTransfer = Math.min(t, productTotal - prodCash);
        }
        c = Math.max(0, c - prodCash);
        t = Math.max(0, t - prodTransfer);
        await settleSalesForBill({
          reservationId: reservation.id,
          method: finalPay === "credit" ? "points" : finalPay,
          cash: prodCash,
          transfer: prodTransfer,
        });
      }

      await checkout({
        machineId: machine.id,
        reservation,
        finalCash: c,
        finalTransfer: t,
        promotion: promotion ?? null,
        redeemedPoints: finalPay === "points",
        member,
        useFreeHour: useFreeHour && canRedeem,
      });
      if (!opts.keepDisplay) await clearDisplay();
      onSuccess();
      onClose();
    } catch (err) {
      alert("ปิดบิลไม่สำเร็จ: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  const headerLabel = machine.zone === "sofa" ? "โซฟา" : "รถแข่ง";
  const extendedMinutes = Math.round(Number(reservation.extended_hours) * 60);

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom modal-lg-custom" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header bg-primary text-white">
          <h5 className="modal-title fw-bold m-0 d-flex align-items-center gap-2">
            <Settings2 size={20} /> จัดการบิลเครื่องเกม
          </h5>
          <button className="btn-close btn-close-white" onClick={() => { clearDisplay(); onClose(); }} />
        </div>

        <div className="p-4">
          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 info-panel">
                <p className="mb-1 d-flex align-items-center gap-2"><MapPin size={16} className="text-info" /> <b>โซน:</b> {headerLabel}</p>
                <p className="mb-1 d-flex align-items-center gap-2"><Monitor size={16} className="text-info" /> <b>เครื่อง:</b> {machine.machine_number}</p>
                <p className="mb-2 d-flex align-items-center gap-2"><User size={16} className="text-info" /> <b>ลูกค้า:</b> <span className="text-primary fw-bold">{reservation.customer_name}</span></p>

                <hr className="my-2" />

                <p className="mb-1 d-flex align-items-center gap-2"><PlayCircle size={16} className="text-success" /> <b>เริ่มเปิดเครื่อง:</b> <span className="text-success fw-bold">{formatDateClock(reservation.start_time)}</span></p>
                <p className="mb-1 d-flex align-items-center gap-2"><StopCircle size={16} className="text-danger" /> <b>หมดเวลา:</b> <span className="text-danger fw-bold">{formatDateClock(reservation.end_time_ms)}</span></p>
                <p className="mb-1 d-flex align-items-center gap-2"><Timer size={16} className="text-warning" /> <b>เวลาตั้งต้น:</b> {formatHours(reservation.base_hours)} ชม. ({formatClock(reservation.start_time)} น.)</p>
                {extendedMinutes > 0 && (
                  <p className="mb-1 d-flex align-items-center gap-2"><Plus size={16} className="text-warning" /> <b>ต่อเวลาแล้ว:</b> <span className="text-warning fw-bold">{extendedMinutes} นาที</span> ({formatHours(reservation.extended_hours)} ชม.)</p>
                )}
                <p className="mb-1 d-flex align-items-center gap-2"><Clock size={16} className="text-primary" /> <b>รวมเวลาเล่น:</b> <span className="text-primary fw-bold">{formatHours(reservation.total_hours)} ชม.</span></p>

                <hr className="my-2" />

                <p className="mb-1 d-flex align-items-center gap-2"><Utensils size={16} className="text-danger" /> <b>ค่าอาหาร/ขนม:</b> <span className="text-danger fw-bold">{formatBaht(reservation.food_revenue)}</span> บาท</p>
                <p className="mb-0 d-flex align-items-center gap-2"><Wallet size={16} className="text-success" /> <b>มัดจำชำระแล้ว:</b> <span className="text-success fw-bold">{formatBaht(Number(reservation.advance_cash) + Number(reservation.advance_transfer))}</span> บาท</p>

                <hr className="my-2" />

                <p className="mb-2 d-flex align-items-center gap-2"><IdCard size={16} className="text-info" /> <b>สมาชิกสะสมแต้ม</b></p>
                <MemberSearch
                  value={member}
                  onChange={handleMemberChange}
                  defaultName={reservation.customer_name}
                  compact
                />
                {member && (
                  <>
                    <div className="small text-success mt-2 d-flex align-items-center gap-1">
                      <Star size={13} /> ปิดบิลนี้จะได้อีก <b>{willEarn}</b> แต้ม (รวมเป็น {member.points + willEarn})
                    </div>
                    {canRedeemZone(machine.zone, cfg) ? (
                      <div className="form-check mt-2">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="useFreeHour"
                          checked={useFreeHour && canRedeem}
                          disabled={!canRedeem}
                          onChange={(e) => setUseFreeHour(e.target.checked)}
                        />
                        <label className="form-check-label small" htmlFor="useFreeHour">
                          <Gift size={13} className="text-warning" /> ใช้ <b>{cfg.redeem_cost}</b> แต้ม แลกเล่นฟรี 1 ชม.
                          {" "}<span className="text-danger">(-{formatBaht(redeemValue)} บ.)</span>
                          {!canRedeem && <span className="text-muted"> — แต้มไม่พอ</span>}
                        </label>
                      </div>
                    ) : (
                      <div className="small text-muted mt-1">โซนนี้ยังแลกแต้มไม่ได้</div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="col-md-6">
              <ul className="nav nav-pills nav-fill mb-3">
                <li className="nav-item">
                  <button className={`nav-link btn-sm d-inline-flex align-items-center gap-1 ${tab === "food" ? "active" : ""}`} onClick={() => setTab("food")}><Utensils size={14} /> อาหาร</button>
                </li>
                <li className="nav-item">
                  <button className={`nav-link btn-sm d-inline-flex align-items-center gap-1 ${tab === "extend" ? "active" : ""}`} onClick={() => setTab("extend")}><Timer size={14} /> ต่อเวลา</button>
                </li>
                <li className="nav-item">
                  <button className={`nav-link btn-sm fw-bold d-inline-flex align-items-center gap-1 ${tab === "checkout" ? "active bg-danger text-white" : "text-danger"}`} onClick={() => setTab("checkout")}><BellRing size={14} /> เช็คบิล</button>
                </li>
              </ul>

              <div className="p-3 border rounded-4 bg-white">
                {tab === "food" && (
                  <form onSubmit={handleFood}>
                    <label className="small fw-bold d-flex align-items-center gap-1"><Utensils size={14} /> ราคาอาหารรวม (บาท)</label>
                    <input
                      type="number"
                      className="form-control mb-2"
                      value={foodAmt}
                      placeholder="ระบุจำนวนเงิน..."
                      onChange={(e) => setFoodAmt(e.target.value)}
                    />
                    <PayModeRadio value={foodPay} onChange={setFoodPay} />
                    {foodPay === "mixed" && (
                      <div className="row g-2 mt-2">
                        <div className="col-6"><input type="number" className="form-control" placeholder="เงินสด" value={foodCash} onChange={(e) => setFoodCash(e.target.value)} /></div>
                        <div className="col-6"><input type="number" className="form-control" placeholder="เงินโอน" value={foodTransfer} onChange={(e) => setFoodTransfer(e.target.value)} /></div>
                      </div>
                    )}
                    {foodPay === "credit" && (
                      <div className="alert alert-warning py-2 small mt-2 mb-0">ค้างจ่าย — เพิ่มยอดอาหารโดยไม่หักเงิน</div>
                    )}
                    <PromptPayQR amount={foodPay === "transfer" ? foodNum : foodPay === "mixed" ? (Number(foodTransfer) || 0) : 0} />
                    <button className="btn btn-success w-100 fw-bold mt-2 d-inline-flex align-items-center justify-content-center gap-1" disabled={busy || foodNum <= 0}><Plus size={16} /> เพิ่มอาหาร</button>
                  </form>
                )}

                {tab === "extend" && (
                  <form onSubmit={handleExtend}>
                    <label className="small fw-bold d-flex align-items-center gap-1"><Timer size={14} /> เวลาที่ต่อเพิ่ม</label>
                    <select className="form-select mb-2" value={extHrs} onChange={(e) => setExtHrs(parseFloat(e.target.value))}>
                      {HOUR_OPTIONS.map((h) => (
                        <option key={h} value={h}>{h} ชม. ({Math.round(h * 60)} นาที) — {formatBaht(calcPrice(machine.zone, h, override))} บาท</option>
                      ))}
                    </select>
                    {promotion && <div className="small text-success mb-2"><Tag size={12} /> ใช้โปร: <b>{promotion.name}</b></div>}
                    <PayModeRadio value={extPay} onChange={setExtPay} />
                    {extPay === "mixed" && (
                      <div className="row g-2 mt-2">
                        <div className="col-6"><input type="number" className="form-control" placeholder="เงินสด" value={extCash} onChange={(e) => setExtCash(e.target.value)} /></div>
                        <div className="col-6"><input type="number" className="form-control" placeholder="เงินโอน" value={extTransfer} onChange={(e) => setExtTransfer(e.target.value)} /></div>
                      </div>
                    )}
                    {extPay === "credit" && (
                      <div className="alert alert-warning py-2 small mt-2 mb-0">ค้างจ่าย — ต่อเวลาโดยไม่หักเงิน</div>
                    )}
                    <PromptPayQR
                      amount={extPay === "transfer" ? extPrice : extPay === "mixed" ? (Number(extTransfer) || 0) : 0}
                      reservationId={reservation.id}
                      onVerified={extPay === "transfer" ? () => runAfterSlip("extend") : undefined}
                    />
                    {autoRun === "extend" && (
                      <div className="alert alert-success py-2 text-center mt-2 mb-0 fw-bold small">
                        ✅ ตรวจสลิปผ่านแล้ว — กำลังต่อเวลา...
                      </div>
                    )}
                    <button className="btn btn-primary w-100 fw-bold mt-2 d-inline-flex align-items-center justify-content-center gap-1" disabled={busy}><Plus size={16} /> ต่อเวลา {Math.round(extHrs * 60)} นาที</button>
                  </form>
                )}

                {tab === "checkout" && (
                  grandRemaining <= 0 ? (
                    <form onSubmit={(e) => { e.preventDefault(); setConfirmCheckout(true); }}>
                      <div className="bg-light p-2 rounded mb-2 small">
                        <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Clock size={13} /> เวลาเล่นรวม</span><b>{formatHours(summary.duration_hours)} ชม.</b></div>
                        <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Monitor size={13} /> ค่าเครื่อง</span><b>{formatBaht(summary.machine_price)} บ.</b></div>
                        <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Utensils size={13} /> ค่าอาหาร</span><b>{formatBaht(summary.food_price)} บ.</b></div>
                        {productTotal > 0 && (
                          <>
                            {productItems.map((it) => (
                              <div key={it.id} className="d-flex justify-content-between align-items-center">
                                <span className="d-inline-flex align-items-center gap-1"><ShoppingCart size={13} /> {it.name} x{it.qty}</span>
                                <b>{formatBaht(Number(it.subtotal))} บ.</b>
                              </div>
                            ))}
                            <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><ShoppingCart size={13} /> รวมค่าสินค้า</span><b>{formatBaht(productTotal)} บ.</b></div>
                          </>
                        )}
                        <hr className="my-1" />
                        {summary.points_discount > 0 && (
                          <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Gift size={13} /> ส่วนลดแต้ม</span><b className="text-success">-{formatBaht(summary.points_discount)} บ.</b></div>
                        )}
                        <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Receipt size={13} /> ยอดสุทธิ</span><b className="text-danger">{formatBaht(summary.total_due + productTotal)} บ.</b></div>
                      </div>
                      <div className="alert alert-success py-3 mb-2 text-center">
                        <div className="fw-bold d-inline-flex align-items-center gap-2 mb-2"><Wallet size={18} /> ชำระเงินเรียบร้อยแล้ว</div>
                        <div className="small">
                          {summary.advance_cash > 0 && (
                            <div>เงินสด: <b>{formatBaht(summary.advance_cash)} บ.</b></div>
                          )}
                          {summary.advance_transfer > 0 && (
                            <div>เงินโอน: <b>{formatBaht(summary.advance_transfer)} บ.</b></div>
                          )}
                        </div>
                      </div>
                      <button type="submit" className="btn btn-success w-100 fw-bold mt-2 d-inline-flex align-items-center justify-content-center gap-1" disabled={busy}><BellRing size={16} /> ปิดบิล</button>
                    </form>
                  ) : (
                  <form onSubmit={(e) => { e.preventDefault(); setConfirmCheckout(true); }}>
                    <div className="bg-light p-2 rounded mb-2 small">
                      <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Clock size={13} /> เวลาเล่นรวม</span><b>{formatHours(summary.duration_hours)} ชม.</b></div>
                      <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Monitor size={13} /> ค่าเครื่อง</span><b>{formatBaht(summary.machine_price)} บ.</b></div>
                      <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Utensils size={13} /> ค่าอาหาร</span><b>{formatBaht(summary.food_price)} บ.</b></div>
                      {productTotal > 0 && (
                        <>
                          {productItems.map((it) => (
                            <div key={it.id} className="d-flex justify-content-between align-items-center">
                              <span className="d-inline-flex align-items-center gap-1"><ShoppingCart size={13} /> {it.name} x{it.qty}</span>
                              <b>{formatBaht(Number(it.subtotal))} บ.</b>
                            </div>
                          ))}
                          <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><ShoppingCart size={13} /> รวมค่าสินค้า</span><b>{formatBaht(productTotal)} บ.</b></div>
                        </>
                      )}
                      <hr className="my-1" />
                      {summary.points_discount > 0 && (
                        <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Gift size={13} /> ส่วนลดแต้ม</span><b className="text-success">-{formatBaht(summary.points_discount)} บ.</b></div>
                      )}
                      <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Receipt size={13} /> ยอดสุทธิ</span><b className="text-danger">{formatBaht(summary.total_due + productTotal)} บ.</b></div>
                      <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><Wallet size={13} /> หัก มัดจำ</span><b>-{formatBaht(summary.advance_cash + summary.advance_transfer)} บ.</b></div>
                      <div className="d-flex justify-content-between align-items-center"><span className="d-inline-flex align-items-center gap-1"><CreditCard size={13} /> คงเหลือชำระ</span><b className="text-success">{formatBaht(grandRemaining)} บ.</b></div>
                    </div>
                    <label className="small fw-bold d-flex align-items-center gap-1"><CreditCard size={14} /> ช่องทางรับเงินส่วนที่เหลือ</label>
                    <PayModeRadio value={finalPay === "credit" ? "cash" : finalPay} onChange={setFinalPay} hideCredit showPoints />
                    {finalPay === "mixed" && (
                      <div className="row g-2 mt-2">
                        <div className="col-6"><input type="number" className="form-control" placeholder="เงินสด" value={finalCash} onChange={(e) => setFinalCash(e.target.value)} /></div>
                        <div className="col-6"><input type="number" className="form-control" placeholder="เงินโอน" value={finalTransfer} onChange={(e) => setFinalTransfer(e.target.value)} /></div>
                      </div>
                    )}
                    {finalPay === "points" && (
                      <div className="alert py-2 small mt-2 mb-0" style={{ background: "#f3e8ff", color: "#6b21a8", border: "1px solid #d8b4fe" }}>
                        🎁 ลูกค้าแลกแต้ม — ปิดบิลโดยไม่หักเงิน (ไม่นับเข้ารายได้)
                      </div>
                    )}

                    <PromptPayQR
                      amount={finalPay === "transfer" ? grandRemaining : finalPay === "mixed" ? (Number(finalTransfer) || 0) : 0}
                      reservationId={reservation.id}
                      onVerified={finalPay === "transfer" ? () => runAfterSlip("checkout") : undefined}
                    />
                    {autoRun === "checkout" && (
                      <div className="alert alert-success py-2 text-center mt-2 mb-0 fw-bold small">
                        ✅ ตรวจสลิปผ่านแล้ว — กำลังปิดบิล...
                      </div>
                    )}
                    <button type="submit" className="btn btn-danger w-100 fw-bold mt-2 d-inline-flex align-items-center justify-content-center gap-1" disabled={busy}><BellRing size={16} /> ปิดบิล</button>
                  </form>
                  )
                )}

              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCheckout}
        title="ยืนยันการปิดบิล"
        icon="🔔"
        variant="danger"
        confirmLabel="ปิดบิลเลย"
        cancelLabel="ยังไม่ปิด"
        message={
          <div>
            ปิดบิลของ <b className="text-primary">{reservation.customer_name}</b><br />
            ยอดสุทธิ <b className="text-danger">{formatBaht(summary.total_due + productTotal)}</b> บาท
            {finalPay === "credit" && <div className="text-warning small mt-2">⚠️ ลูกค้าค้างจ่าย {formatBaht(grandRemaining)} บาท</div>}
            {finalPay === "points" && <div className="small mt-2" style={{ color: "#a855f7" }}>🎁 ลูกค้าแลกแต้ม — ไม่หักเงิน</div>}
            {member && (
              <div className="small mt-2 text-success">
                🎫 {member.name}
                {useFreeHour && canRedeem && <> · ใช้ {cfg.redeem_cost} แต้มแลกฟรี 1 ชม.</>}
                {willEarn > 0 && <> · ได้เพิ่ม {willEarn} แต้ม</>}
              </div>
            )}
          </div>
        }
        onConfirm={() => doCheckout()}
        onCancel={() => setConfirmCheckout(false)}
      />
    </div>
  );
}

function PayModeRadio({ value, onChange, hideCredit, showPoints }: { value: PayMode; onChange: (v: PayMode) => void; hideCredit?: boolean; showPoints?: boolean }) {
  const opts: { v: PayMode; label: string }[] = [
    ...(hideCredit ? [] : [{ v: "credit" as PayMode, label: "ค้างจ่าย" }]),
    { v: "transfer", label: "โอน" },
    { v: "cash", label: "เงินสด" },
    { v: "mixed", label: "ผสม" },
    ...(showPoints ? [{ v: "points" as PayMode, label: "🎁 แลกแต้ม" }] : []),
  ];

  return (
    <div className="radio-box">
      {opts.map((o) => (
        <label key={o.v} className="radio-item">
          <input type="radio" checked={value === o.v} onChange={() => onChange(o.v)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
