import { useEffect, useState } from "react";
import type { Machine } from "@/lib/supabase";
import { HOUR_OPTIONS, calcPrice, formatBaht } from "@/lib/priceEngine";
import { startSession } from "@/lib/reservations";
import { PromptPayQR } from "./PromptPayQR";
import { pushDisplay, clearDisplay, toHHMM, type PaymentMethod } from "@/lib/customerDisplay";
import { getZonePrice, type Promotion } from "@/lib/promotions";
import { MemberSearch } from "./MemberSearch";
import {
  getPointsConfig,
  pointsForPlay,
  canRedeemZone,
  DEFAULT_POINTS_CONFIG,
  type Member,
  type PointsConfig,
} from "@/lib/members";
import { freeHourValue } from "@/lib/billing";
import { Gift } from "lucide-react";

function payModeToMethod(m: "cash" | "transfer" | "mixed" | "credit"): PaymentMethod {
  return m === "transfer" ? "promptpay" : m;
}

type PayMode = "cash" | "transfer" | "mixed" | "credit";

interface Props {
  machine: Machine | null;
  onClose: () => void;
  onSuccess: () => void;
  promotion?: Promotion | null;
}

export function StartModal({ machine, onClose, onSuccess, promotion = null }: Props) {
  const [name, setName] = useState("");
  const [hours, setHours] = useState<number>(1);
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [cash, setCash] = useState<string>("");
  const [transfer, setTransfer] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [cfg, setCfg] = useState<PointsConfig>(DEFAULT_POINTS_CONFIG);
  // ชื่อในช่องนี้มาจากข้อมูลสมาชิกหรือพนักงานพิมพ์เอง (ใช้ตัดสินใจตอนถอดสมาชิกออก)
  const [nameFromMember, setNameFromMember] = useState(false);
  const [autoStarting, setAutoStarting] = useState(false);
  const [useFreeHour, setUseFreeHour] = useState(false);

  useEffect(() => {
    getPointsConfig()
      .then(setCfg)
      .catch(() => {});
  }, []);

  /** ค้นเจอสมาชิก -> เติมชื่อให้อัตโนมัติ, ถอดสมาชิกออก -> ล้างชื่อที่เติมให้ */
  function handleMemberChange(m: Member | null) {
    setMember(m);
    // ถอดสมาชิกออกแล้วต้องยกเลิกการแลกแต้มด้วย ไม่งั้นจะได้ส่วนลดโดยไม่มีเจ้าของแต้ม
    if (!m) setUseFreeHour(false);
    if (m) {
      setName(m.name);
      setNameFromMember(true);
    } else if (nameFromMember) {
      setName("");
      setNameFromMember(false);
    }
  }

  // จ่ายโอนล้วน = สลิปยืนยันยอดทั้งบิล เปิดเครื่องต่อได้เลย
  // จ่ายแบบผสมยังไม่เปิดเอง เพราะสลิปยืนยันได้แค่ส่วนที่โอน
  function handleSlipVerified() {
    if (autoStarting || busy) return;
    setAutoStarting(true);
    // หน่วงสั้น ๆ ให้พนักงานเห็นว่าสลิปผ่านแล้วก่อนหน้าต่างปิด
    setTimeout(() => {
      handleSubmit(undefined, { keepDisplay: true }).catch(() => setAutoStarting(false));
    }, 900);
  }

  const override = machine && promotion ? getZonePrice(machine.zone, promotion) : null;
  const fullPrice = machine ? calcPrice(machine.zone, hours, override) : 0;

  // แลกแต้มได้ก็ต่อเมื่อ: เป็นสมาชิก + โซนนี้แลกได้ + แต้มถึงจริง ๆ
  // เงื่อนไขสุดท้ายคือจุดที่เคยขาด ทำให้สมาชิกแต้มไม่พอกดแลกได้
  const zoneRedeemable = machine ? canRedeemZone(machine.zone, cfg) : false;
  const canRedeem = !!member && zoneRedeemable && member.points >= cfg.redeem_cost;
  const redeemActive = useFreeHour && canRedeem;
  // ส่วนลดหักได้ไม่เกินค่าบริการ (เล่น 1 ชม. แล้วแลกฟรี 1 ชม. = จ่าย 0 ไม่ใช่ติดลบ)
  const redeemValue = machine ? Math.min(freeHourValue(machine.zone, promotion), fullPrice) : 0;
  const price = Math.max(0, fullPrice - (redeemActive ? redeemValue : 0));

  const qrAmount = payMode === "transfer" ? price : payMode === "mixed" ? Number(transfer) || 0 : 0;

  useEffect(() => {
    if (!machine) return;
    setName("");
    setHours(1);
    setPayMode("cash");
    setCash("");
    setTransfer("");
    setMember(null);
    setNameFromMember(false);
    setUseFreeHour(false);
  }, [machine]);

  useEffect(() => {
    if (!machine) return;
    const now = new Date();
    const end = new Date(now.getTime() + hours * 3600_000);
    pushDisplay({
      kind: "start",
      zone: machine.zone,
      machine_number: machine.machine_number,
      customer_name: name,
      start_time: toHHMM(now),
      end_time: toHHMM(end),
      play_hours: hours,
      food_amount: 0,
      amount: price,
      charge_type: "start",
      payment_method: payModeToMethod(payMode),
      message:
        payMode === "credit"
          ? `เปิดเครื่อง ${hours} ชม. (ค้างจ่าย)`
          : redeemActive
            ? `เปิดเครื่อง ${hours} ชม. · แลกแต้มฟรี 1 ชม.`
            : `เปิดเครื่อง ${hours} ชม.`,
    });
  }, [machine, name, hours, payMode, qrAmount, price, redeemActive]);

  if (!machine) return null;

  async function handleSubmit(e?: React.FormEvent, opts: { keepDisplay?: boolean } = {}) {
    e?.preventDefault();
    if (!machine || busy) return;
    setBusy(true);
    try {
      let finalCash = Number(cash) || 0;
      let finalTransfer = Number(transfer) || 0;
      if (payMode === "cash") {
        finalCash = price;
        finalTransfer = 0;
      } else if (payMode === "transfer") {
        finalCash = 0;
        finalTransfer = price;
      } else if (payMode === "credit") {
        finalCash = 0;
        finalTransfer = 0;
      }
      await startSession({
        machineId: machine.id,
        zone: machine.zone,
        machineNumber: machine.machine_number,
        customerName: name.trim(),
        baseHours: hours,
        advanceCash: finalCash,
        advanceTransfer: finalTransfer,
        memberId: member?.id ?? null,
        // ฐานข้อมูลตรวจแต้มซ้ำอีกชั้น ถ้าแต้มไม่พอจะโยน error ออกมา
        // และยังไม่มีบิลถูกสร้าง พนักงานเก็บเงินเต็มแล้วเปิดใหม่ได้เลย
        useFreeHour: redeemActive,
        freeHourValue: redeemValue,
      });
      // เปิดอัตโนมัติหลังตรวจสลิป: ปล่อยให้จอลูกค้าโชว์ "ชำระเงินเรียบร้อย" ต่อจนครบเวลา
      if (!opts.keepDisplay) await clearDisplay();
      onSuccess();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("เปิดเครื่องไม่สำเร็จ: " + msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header bg-success text-white">
          <h5 className="modal-title fw-bold m-0">🟢 เริ่มต้นบันทึกเวลาเปิดเครื่อง</h5>
          <button
            type="button"
            className="btn-close btn-close-white"
            onClick={() => {
              clearDisplay();
              onClose();
            }}
          />
        </div>
        <form onSubmit={handleSubmit} className="p-4">
          <div className="alert alert-info py-2">
            📍 โซน: <b>{machine.zone === "sofa" ? "โซฟา" : "รถแข่ง"}</b> | หมายเลขเครื่อง:{" "}
            <b>{machine.machine_number}</b>
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">🎫 เบอร์โทรสมาชิก</label>
            <MemberSearch value={member} onChange={handleMemberChange} defaultName={name} />
            {member ? (
              <>
                <div className="small mt-1 d-flex flex-wrap gap-2 align-items-center">
                  <span className="text-success">
                    บิลนี้จะได้ <b>{pointsForPlay(machine.zone, { hours }, cfg)}</b> แต้ม
                    เมื่อปิดบิล
                  </span>
                  <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">
                    แต้มคงเหลือ {member.points}
                  </span>
                </div>

                {zoneRedeemable ? (
                  <div className="form-check mt-2">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="startFreeHour"
                      checked={redeemActive}
                      disabled={!canRedeem}
                      onChange={(e) => setUseFreeHour(e.target.checked)}
                    />
                    <label className="form-check-label small" htmlFor="startFreeHour">
                      <Gift size={13} className="text-warning" /> ใช้ <b>{cfg.redeem_cost}</b> แต้ม
                      แลกเล่นฟรี 1 ชม.{" "}
                      <span className="text-danger">(-{formatBaht(redeemValue)} บ.)</span>
                      {!canRedeem && (
                        <span className="text-muted">
                          {" "}
                          — แต้มไม่พอ (มี {member.points} ต้องใช้ {cfg.redeem_cost})
                        </span>
                      )}
                    </label>
                  </div>
                ) : (
                  <div className="small text-muted mt-1">โซนนี้ยังแลกแต้มไม่ได้</div>
                )}
              </>
            ) : (
              <div className="small text-muted mt-1">
                ลูกค้าแจ้งเบอร์โทร ระบบจะดึงชื่อมาใส่ให้อัตโนมัติ — ไม่ใช่สมาชิกก็ข้ามได้
              </div>
            )}
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold d-flex align-items-center gap-2">
              👤 ชื่อผู้เล่น
              {nameFromMember && (
                <span className="badge bg-info-subtle text-info border border-info-subtle fw-normal">
                  จากข้อมูลสมาชิก
                </span>
              )}
            </label>
            <input
              className="form-control form-control-lg"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ระบุชื่อผู้เล่น..."
              required
            />
            {nameFromMember && (
              <div className="small text-muted mt-1">แก้ไขได้ ถ้าคนเล่นจริงไม่ใช่เจ้าของเบอร์</div>
            )}
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">⏱️ เวลาเล่น</label>
            <select
              className="form-select form-select-lg"
              value={hours}
              onChange={(e) => setHours(parseFloat(e.target.value))}
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h} ชั่วโมง — {formatBaht(calcPrice(machine.zone, h, override))} บาท
                </option>
              ))}
            </select>
            <div className="text-center mt-2">
              {redeemActive && (
                <div className="small text-muted">
                  ค่าบริการ {formatBaht(fullPrice)} − แลกแต้ม {formatBaht(redeemValue)}
                </div>
              )}
              💰 ค่าบริการเริ่มต้น: <b className="text-danger">{formatBaht(price)}</b> บาท
              {redeemActive && (
                <div className="small mt-1" style={{ color: "#a855f7" }}>
                  🎁 ใช้ {cfg.redeem_cost} แต้มแลกเล่นฟรี 1 ชม. — หักแต้มตอนกดเปิดเครื่อง
                </div>
              )}
              {promotion && (
                <div className="small text-success mt-1">
                  🎉 ใช้โปร: <b>{promotion.name}</b>
                </div>
              )}
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">💳 ช่องทางชำระมัดจำ</label>
            <PayModeRadio value={payMode} onChange={setPayMode} />
          </div>

          {payMode === "mixed" && (
            <div className="row g-2 mb-3">
              <div className="col-6">
                <label className="small text-success fw-bold">💵 เงินสด (บาท)</label>
                <input
                  type="number"
                  className="form-control"
                  value={cash}
                  placeholder=""
                  onChange={(e) => setCash(e.target.value)}
                />
              </div>
              <div className="col-6">
                <label className="small text-primary fw-bold">📱 เงินโอน (บาท)</label>
                <input
                  type="number"
                  className="form-control"
                  value={transfer}
                  placeholder=""
                  onChange={(e) => setTransfer(e.target.value)}
                />
              </div>
            </div>
          )}

          {payMode === "credit" && (
            <div className="alert alert-warning py-2 small">
              📝 ลูกค้าค้างจ่าย — ระบบจะเปิดเครื่องโดยไม่หักยอดมัดจำ
            </div>
          )}

          <PromptPayQR
            amount={qrAmount}
            onVerified={payMode === "transfer" ? handleSlipVerified : undefined}
          />

          {autoStarting && (
            <div className="alert alert-success py-2 text-center mt-2 mb-0 fw-bold">
              ✅ ตรวจสลิปผ่านแล้ว — กำลังเปิดเครื่อง...
            </div>
          )}

          <div className="modal-footer border-0 mt-3">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                clearDisplay();
                onClose();
              }}
            >
              ปิด
            </button>
            <button type="submit" className="btn btn-success fw-bold" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "✅ เริ่มเปิดเครื่อง"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayModeRadio({ value, onChange }: { value: PayMode; onChange: (v: PayMode) => void }) {
  const opts: { v: PayMode; label: string }[] = [
    { v: "credit", label: "ค้างจ่าย" },
    { v: "transfer", label: "โอน" },
    { v: "cash", label: "เงินสด" },
    { v: "mixed", label: "ผสม" },
  ];
  return (
    <div className="radio-box">
      {opts.map((o) => (
        <label key={o.v} className="radio-item">
          <input
            type="radio"
            name="startPayMode"
            checked={value === o.v}
            onChange={() => onChange(o.v)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
