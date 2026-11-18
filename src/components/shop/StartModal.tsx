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
import { Gift, Package, PiggyBank, Clock } from "lucide-react";
import { useShop } from "@/hooks/useShop";
import {
  listOpenPackages,
  getHourBank,
  fmtMinutes,
  fmtThaiDate,
  minutesToHours,
  type PricePackage,
  type HourBankBalance,
} from "@/lib/packages";

/** รายชั่วโมงแบบเดิม / แพ็กเกจราคา / ใช้ชั่วโมงสะสมของสมาชิก (สองแบบหลังเฉพาะโซฟา) */
type PriceMode = "hourly" | "package" | "bank";

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
  const { handleStartError } = useShop();
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
  const [mode, setMode] = useState<PriceMode>("hourly");
  const [packages, setPackages] = useState<PricePackage[]>([]);
  const [pkgId, setPkgId] = useState<string | null>(null);
  const [bank, setBank] = useState<HourBankBalance | null>(null);
  const [bankMin, setBankMin] = useState<number>(0);

  const isSofa = machine?.zone === "sofa";

  // แพ็กเกจที่เปิดขายวันนี้ (ยังไม่ได้รัน SQL = ได้รายการว่าง แท็บแพ็กเกจไม่ขึ้น)
  useEffect(() => {
    if (!machine || machine.zone !== "sofa") {
      setPackages([]);
      return;
    }
    let alive = true;
    listOpenPackages().then((list) => {
      if (alive) setPackages(list);
    });
    return () => {
      alive = false;
    };
  }, [machine]);

  // ชั่วโมงสะสมของสมาชิกที่เลือก
  const memberId = member?.id ?? null;
  useEffect(() => {
    setBank(null);
    if (!memberId || !isSofa) return;
    let alive = true;
    getHourBank(memberId)
      .then((b) => {
        if (!alive) return;
        setBank(b);
        // ค่าเริ่มต้น: ใช้ทั้งหมดถ้าไม่เกิน 3 ชม. ไม่งั้น 1 ชม.
        if (b && b.minutes > 0) setBankMin(b.minutes <= 180 ? b.minutes : 60);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [memberId, isSofa]);

  // โหมดที่เลือกใช้ไม่ได้แล้ว (ถอดสมาชิก / ชั่วโมงหมด / ไม่มีแพ็กเกจ) -> กลับรายชั่วโมง
  const bankAvail = bank?.minutes ?? 0;
  useEffect(() => {
    if (mode === "bank" && bankAvail <= 0) setMode("hourly");
    if (mode === "package" && packages.length === 0) setMode("hourly");
  }, [mode, bankAvail, packages.length]);

  const pkg = mode === "package" ? (packages.find((p) => p.id === pkgId) ?? null) : null;
  const bankUse = mode === "bank" ? Math.min(Math.max(0, bankMin), bankAvail) : 0;
  /** นาทีเล่นจริงของบิลนี้ */
  const playMinutes = pkg ? pkg.minutes : mode === "bank" ? bankUse : hours * 60;
  const playHours = playMinutes / 60;

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
  const fullPrice = !machine
    ? 0
    : mode === "package"
      ? (pkg?.price ?? 0)
      : mode === "bank"
        ? 0
        : calcPrice(machine.zone, hours, override);

  // แลกแต้มได้ก็ต่อเมื่อ: เป็นสมาชิก + โซนนี้แลกได้ + แต้มถึงจริง ๆ
  // เงื่อนไขสุดท้ายคือจุดที่เคยขาด ทำให้สมาชิกแต้มไม่พอกดแลกได้
  const zoneRedeemable = machine ? canRedeemZone(machine.zone, cfg) : false;
  const canRedeem =
    mode === "hourly" && !!member && zoneRedeemable && member.points >= cfg.redeem_cost;
  const redeemActive = useFreeHour && canRedeem;
  // ส่วนลดหักได้ไม่เกินค่าบริการ (เล่น 1 ชม. แล้วแลกฟรี 1 ชม. = จ่าย 0 ไม่ใช่ติดลบ)
  const redeemValue = machine ? Math.min(freeHourValue(machine.zone, promotion), fullPrice) : 0;
  const price = Math.max(0, fullPrice - (redeemActive ? redeemValue : 0));

  const qrAmount =
    mode === "bank"
      ? 0
      : payMode === "transfer"
        ? price
        : payMode === "mixed"
          ? Number(transfer) || 0
          : 0;

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
    setMode("hourly");
    setPkgId(null);
  }, [machine]);

  useEffect(() => {
    if (!machine) return;
    const now = new Date();
    const end = new Date(now.getTime() + playMinutes * 60_000);
    pushDisplay({
      kind: "start",
      zone: machine.zone,
      machine_number: machine.machine_number,
      customer_name: name,
      start_time: toHHMM(now),
      end_time: toHHMM(end),
      play_hours: Math.round(playHours * 10) / 10,
      food_amount: 0,
      amount: price,
      charge_type: "start",
      payment_method: payModeToMethod(payMode),
      message:
        mode === "bank"
          ? `ใช้ชั่วโมงสะสม ${fmtMinutes(bankUse)}`
          : pkg
            ? `แพ็กเกจ ${pkg.group_name} · ${pkg.label}${payMode === "credit" ? " (ค้างจ่าย)" : ""}`
            : payMode === "credit"
              ? `เปิดเครื่อง ${hours} ชม. (ค้างจ่าย)`
              : redeemActive
                ? `เปิดเครื่อง ${hours} ชม. · แลกแต้มฟรี 1 ชม.`
                : `เปิดเครื่อง ${hours} ชม.`,
      // ไม่ส่ง member ตอนไม่ใช่สมาชิก เพื่อให้จอกลับไปโหมดปกติทันทีที่ถอดสมาชิกออก
      member: member
        ? {
            name: member.name,
            // หักแต้มที่กำลังจะใช้แลกออกให้เห็นยอดจริงที่จะเหลือ
            points: Math.max(0, member.points - (redeemActive ? cfg.redeem_cost : 0)),
            visits: member.visits,
            will_earn: mode === "bank" ? 0 : pointsForPlay(machine.zone, { hours: playHours }, cfg),
            redeem_cost: cfg.redeem_cost,
            redeeming: redeemActive,
            zone_redeemable: zoneRedeemable,
          }
        : undefined,
    });
  }, [
    machine,
    name,
    hours,
    payMode,
    qrAmount,
    price,
    redeemActive,
    member,
    cfg,
    zoneRedeemable,
    mode,
    pkg,
    bankUse,
    playMinutes,
    playHours,
  ]);

  if (!machine) return null;

  async function handleSubmit(e?: React.FormEvent, opts: { keepDisplay?: boolean } = {}) {
    e?.preventDefault();
    if (!machine || busy) return;
    if (mode === "package" && !pkg) {
      alert("เลือกแพ็กเกจก่อน");
      return;
    }
    if (mode === "bank" && bankUse < 1) {
      alert("เลือกจำนวนชั่วโมงสะสมที่จะใช้");
      return;
    }
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
      if (mode === "bank") {
        finalCash = 0;
        finalTransfer = 0;
      }
      await startSession({
        machineId: machine.id,
        zone: machine.zone,
        machineNumber: machine.machine_number,
        customerName: name.trim(),
        baseHours: mode === "hourly" ? hours : minutesToHours(playMinutes),
        advanceCash: finalCash,
        advanceTransfer: finalTransfer,
        memberId: member?.id ?? null,
        // ฐานข้อมูลตรวจแต้มซ้ำอีกชั้น ถ้าแต้มไม่พอจะโยน error ออกมา
        // และยังไม่มีบิลถูกสร้าง พนักงานเก็บเงินเต็มแล้วเปิดใหม่ได้เลย
        useFreeHour: redeemActive,
        freeHourValue: redeemValue,
        pkg: pkg ? { id: pkg.id, minutes: pkg.minutes } : null,
        hourBankMinutes: mode === "bank" ? bankUse : 0,
      });
      // เปิดอัตโนมัติหลังตรวจสลิป: ปล่อยให้จอลูกค้าโชว์ "ชำระเงินเรียบร้อย" ต่อจนครบเวลา
      if (!opts.keepDisplay) await clearDisplay();
      onSuccess();
      onClose();
    } catch (err) {
      // ร้านปิด (เช่นอีกเครื่องเพิ่งกดปิดร้าน) -> ปิดหน้าต่างนี้แล้วขึ้นหน้าต่างเปิดร้านแทน
      if (handleStartError(err)) {
        onClose();
        return;
      }
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
                    บิลนี้จะได้{" "}
                    <b>
                      {mode === "bank" ? 0 : pointsForPlay(machine.zone, { hours: playHours }, cfg)}
                    </b>{" "}
                    แต้ม เมื่อปิดบิล
                  </span>
                  <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">
                    แต้มคงเหลือ {member.points}
                  </span>
                  {bankAvail > 0 && (
                    <span className="badge bg-info-subtle text-info-emphasis border border-info-subtle">
                      <PiggyBank size={11} className="yl-ic" /> ชั่วโมงสะสม {fmtMinutes(bankAvail)}
                    </span>
                  )}
                </div>

                {mode !== "hourly" ? null : zoneRedeemable ? (
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

          {isSofa && (packages.length > 0 || bankAvail > 0) && (
            <div className="yl-pmode mb-3" role="tablist" aria-label="รูปแบบราคา">
              <button
                type="button"
                className={mode === "hourly" ? "is-on" : ""}
                onClick={() => setMode("hourly")}
              >
                <Clock size={15} /> รายชั่วโมง
              </button>
              {packages.length > 0 && (
                <button
                  type="button"
                  className={mode === "package" ? "is-on" : ""}
                  onClick={() => {
                    setMode("package");
                    setUseFreeHour(false);
                    if (!pkgId) setPkgId(packages[0].id);
                  }}
                >
                  <Package size={15} /> แพ็กเกจ
                </button>
              )}
              {bankAvail > 0 && (
                <button
                  type="button"
                  className={mode === "bank" ? "is-on" : ""}
                  onClick={() => {
                    setMode("bank");
                    setUseFreeHour(false);
                  }}
                >
                  <PiggyBank size={15} /> ชั่วโมงสะสม
                </button>
              )}
            </div>
          )}

          {mode === "package" && (
            <div className="mb-3">
              <label className="form-label fw-bold">🎮 เลือกแพ็กเกจ</label>
              <div className="yl-pkg-grid">
                {packages.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className={`yl-pkg-opt ${p.id === pkgId ? "is-on" : ""}`}
                    onClick={() => setPkgId(p.id)}
                  >
                    <span className="yl-pkg-group">{p.group_name}</span>
                    <span className="yl-pkg-label">{p.label}</span>
                    <span className="yl-pkg-price">{formatBaht(p.price)} บ.</span>
                    <span className="yl-pkg-min">เล่นได้ {fmtMinutes(p.minutes)}</span>
                  </button>
                ))}
              </div>
              <div className="text-center mt-2">
                💰 ค่าแพ็กเกจ: <b className="text-danger">{formatBaht(price)}</b> บาท
                <div className="small text-muted mt-1">
                  เล่นไม่หมด เก็บเวลาที่เหลือเข้าบัญชีสมาชิกได้ตอนเช็คบิล (ใช้ได้ 30 วัน)
                  {!member && " — ต้องผูกเบอร์สมาชิก"}
                </div>
              </div>
            </div>
          )}

          {mode === "bank" && bank && (
            <div className="mb-3">
              <label className="form-label fw-bold">⏳ ใช้ชั่วโมงสะสม</label>
              <select
                className="form-select form-select-lg"
                value={bankUse}
                onChange={(e) => setBankMin(Number(e.target.value))}
              >
                {bankOptions(bankAvail).map((m) => (
                  <option key={m} value={m}>
                    {fmtMinutes(m)}
                    {m === bankAvail ? " (ใช้ทั้งหมด)" : ""}
                  </option>
                ))}
              </select>
              <div className="small text-muted mt-1">
                มีอยู่ {fmtMinutes(bankAvail)}
                {bank.next_expiry && <> · ก้อนแรกหมดอายุ {fmtThaiDate(bank.next_expiry)}</>} ·
                ไม่เสียเงิน · ไม่ได้แต้มเพิ่ม (ได้ไปแล้วตอนซื้อแพ็กเกจ)
              </div>
            </div>
          )}

          <div className="mb-3" hidden={mode !== "hourly"}>
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

          {mode === "bank" ? (
            <div className="alert alert-info py-2 small">
              ⏳ เปิดด้วยชั่วโมงสะสม — ไม่ต้องเก็บเงิน (ต่อเวลาเพิ่มคิดราคาปกติ)
            </div>
          ) : (
            <div className="mb-3">
              <label className="form-label fw-bold">💳 ช่องทางชำระมัดจำ</label>
              <PayModeRadio value={payMode} onChange={setPayMode} />
            </div>
          )}

          {mode !== "bank" && payMode === "mixed" && (
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

          {mode !== "bank" && payMode === "credit" && (
            <div className="alert alert-warning py-2 small">
              📝 ลูกค้าค้างจ่าย — ระบบจะเปิดเครื่องโดยไม่หักยอดมัดจำ
            </div>
          )}

          <PromptPayQR
            amount={qrAmount}
            memo={`${machine.zone} ${machine.machine_number}${name.trim() ? " · " + name.trim() : ""}`}
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

/** ตัวเลือกนาทีที่ใช้ได้: ทีละ 30 นาที + ใช้ทั้งหมด (ยอดจริงที่อาจเป็นเศษนาที) */
function bankOptions(avail: number): number[] {
  const out: number[] = [];
  for (let m = 30; m < avail; m += 30) out.push(m);
  if (avail > 0) out.push(avail);
  return out;
}
