import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Camera, CheckCircle2, XCircle, Loader2, ScanLine, BellRing } from "lucide-react";
import { buildPromptpayDataUrl, PROMPTPAY_ID } from "@/lib/promptpay";
import {
  createPayWatch,
  confirmPayWatch,
  cancelPayWatch,
  payWatchEnabled,
  watchPayment,
} from "@/lib/payWatch";
import { formatBaht } from "@/lib/priceEngine";
import { SlipVerifyModal } from "./SlipVerifyModal";
import { startSlipScan, cancelSlipScan, watchSlipScan } from "@/lib/slipScan";
import { verifySlip } from "@/lib/slipVerify";
import { useBarcodeGun } from "@/hooks/useBarcodeGun";
import { isCompleteSlipPayload } from "@/lib/slipPayload";
import {
  clearDisplay,
  showSlipResultScreen,
  pushDisplay,
  lockDisplay,
  unlockDisplay,
} from "@/lib/customerDisplay";
import type { SlipVerifyResult } from "@/lib/slipVerify";

interface Props {
  amount: number;
  /** ผูกผลตรวจสลิปกับบิล เพื่อกันสลิปใบเดิมถูกใช้ซ้ำและย้อนดูได้ทีหลัง */
  reservationId?: string | null;
  pcSessionId?: string | null;
  productSaleId?: string | null;
  /** ซ่อนปุ่มตรวจสลิป */
  hideVerify?: boolean;
  /** ข้อความกำกับรายการ ไว้ดูย้อนหลังในระบบผู้ให้บริการ เช่น "โซฟา 3 · สมชาย" */
  memo?: string;
  /**
   * เรียกเมื่อตรวจสลิปผ่าน — ผู้เรียกเอาไปทำงานต่อได้เลย เช่น เปิดเครื่องอัตโนมัติ
   * ควรส่งมาเฉพาะตอนที่ยอดใน QR = ยอดที่ต้องชำระทั้งหมด (จ่ายโอนล้วน)
   * ถ้าเป็นการจ่ายแบบผสม สลิปยืนยันได้แค่ส่วนที่โอน ยังไม่ควรทำงานต่อเอง
   */
  onVerified?: () => void;
}

type Phase = "idle" | "waiting" | "done";

/** สถานะการรอเงินเข้าอัตโนมัติ */
interface AutoState {
  ref: string;
  uniqueAmount: number;
  qrDataUrl: string;
  clientId: string;
  expiresAt: string | null;
}

const DISPLAY_OWNER = "pay-watch";
/**
 * ถามเซิร์ฟเวอร์เป็นระยะเผื่อ SSE หลุด
 *
 * ตั้งไว้ห่าง ๆ ตั้งใจ: PlernPay จำกัด 30 ครั้ง/นาที และถ้าเกิน
 * "แอปจะถูก deactivate อัตโนมัติทันที ต้องติดต่อแอดมินเพื่อเปิดใหม่"
 * ซึ่งแปลว่าร้านรับเงินอัตโนมัติไม่ได้จนกว่าจะติดต่อเขาได้
 * ทางหลักคือ SSE ตัวนี้เป็นแค่ตาข่ายกันพลาด และมีปุ่ม "ตรวจเดี๋ยวนี้" ให้กดเอง
 * 45 วิ = 1.3 ครั้ง/นาทีต่อบิล เปิดพร้อมกัน 10 บิลก็ยังไม่ถึงครึ่งของลิมิต
 */
const POLL_MS = 45_000;

export function PromptPayQR({
  amount,
  reservationId = null,
  pcSessionId = null,
  productSaleId = null,
  hideVerify = false,
  memo,
  onVerified,
}: Props) {
  const [url, setUrl] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SlipVerifyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [verifiedAmount, setVerifiedAmount] = useState<number | null>(null);
  const amountRef = useRef(amount);
  useEffect(() => {
    amountRef.current = amount;
  }, [amount]);
  const requestRef = useRef<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  // ---- รอเงินเข้าอัตโนมัติ ----
  const [autoOn, setAutoOn] = useState(false);
  const [auto, setAuto] = useState<AutoState | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const autoRef = useRef<AutoState | null>(null);
  const sseStopRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const checkingRef = useRef(false);
  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);
  const verifiedCbRef = useRef(onVerified);
  useEffect(() => {
    verifiedCbRef.current = onVerified;
  }, [onVerified]);

  /** จุดเดียวที่บันทึกว่า "สลิปผ่านแล้ว" ทุกทางที่ตรวจผ่านต้องมาที่นี่ */
  const markVerified = useCallback(() => {
    setVerifiedAmount(amountRef.current);
    verifiedCbRef.current?.();
  }, []);

  useEffect(() => {
    if (amount <= 0) {
      setUrl("");
      return;
    }
    buildPromptpayDataUrl(amount).then(setUrl).catch(console.error);
  }, [amount]);

  useEffect(() => {
    payWatchEnabled()
      .then(setAutoOn)
      .catch(() => setAutoOn(false));
  }, []);

  // เปลี่ยนยอด = ผลตรวจเดิมใช้ไม่ได้แล้ว
  useEffect(() => {
    setVerifiedAmount((v) => (v !== null && Math.abs(v - amount) > 0.01 ? null : v));
  }, [amount]);

  // ปิด modal ระหว่างรอ = เลิกรอ และเคลียร์จอลูกค้า
  useEffect(() => {
    return () => {
      stopRef.current?.();
      if (requestRef.current) {
        cancelSlipScan(requestRef.current).catch(() => {});
        requestRef.current = null;
      }
      // เลิกรอเงินเข้า: ปิด SSE ปลดล็อกจอ และบอก PlernPay ว่ายกเลิก
      sseStopRef.current?.();
      sseStopRef.current = null;
      if (pollRef.current) clearInterval(pollRef.current);
      const a = autoRef.current;
      if (a) {
        cancelPayWatch(a.ref).catch(() => {});
        autoRef.current = null;
      }
      unlockDisplay(DISPLAY_OWNER);
    };
  }, []);

  // ยิงด้วยเครื่องสแกนบาร์โค้ด 2D ได้ตลอดช่วงที่รอสลิป — ไม่ต้องรอกล้อง
  useBarcodeGun(
    (code) => {
      if (phase !== "waiting") return;
      stopScan().catch(() => {});
      runDirect(code);
    },
    { enabled: phase === "waiting", looksComplete: isCompleteSlipPayload },
  );

  // ================= รอเงินเข้าอัตโนมัติ =================

  /** เลิกรอ ปลดล็อกจอ และคืน QR ให้ผู้ให้บริการ */
  const stopAuto = useCallback(async (opts: { keepDisplay?: boolean } = {}) => {
    sseStopRef.current?.();
    sseStopRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
    const a = autoRef.current;
    autoRef.current = null;
    setAuto(null);
    unlockDisplay(DISPLAY_OWNER);
    if (a) await cancelPayWatch(a.ref).catch(() => {});
    if (!opts.keepDisplay) await clearDisplay().catch(() => {});
  }, []);

  /**
   * ถามเซิร์ฟเวอร์ว่าเงินเข้าจริงหรือยัง
   *
   * นี่คือจุดเดียวที่ตัดสินใจ — SSE เป็นแค่สัญญาณให้มาถามเร็วขึ้น
   * กัน re-entrant ด้วย checkingRef เพราะ SSE กับตัวจับเวลาอาจยิงพร้อมกัน
   */
  const checkAuto = useCallback(async () => {
    const a = autoRef.current;
    if (!a || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const r = await confirmPayWatch(a.ref);
      if (r.ok) {
        await stopAuto({ keepDisplay: true });
        setAutoNote(null);
        markVerified();
        await showSlipResultScreen(true, "ชำระเงินเรียบร้อย", a.uniqueAmount).catch(() => {});
        return;
      }
      // ยังไม่เข้าเป็นเรื่องปกติระหว่างรอ ไม่ต้องรบกวนพนักงาน
      if (r.status && r.status !== "pending") {
        setAutoNote(r.error);
        if (r.status === "expired" || r.status === "cancelled") await stopAuto();
      } else if (r.code === "ALREADY_USED" || r.code === "AMOUNT_MISMATCH") {
        setAutoNote(r.error);
      }
    } catch (e) {
      console.warn("[pay-watch] confirm failed:", e);
    } finally {
      checkingRef.current = false;
    }
  }, [markVerified, stopAuto]);

  if (amount <= 0) return null;

  const isVerified = verifiedAmount !== null && Math.abs(verifiedAmount - amount) <= 0.01;

  async function beginCameraScan() {
    setErr(null);
    setResult(null);
    setPhase("waiting");
    try {
      const req = await startSlipScan({
        expectedAmount: amount,
        reservationId,
        pcSessionId,
      });
      requestRef.current = req.id;
      stopRef.current = watchSlipScan(
        req.id,
        (r) => {
          requestRef.current = null;
          setResult(r);
          setPhase("done");
          if (r.ok) markVerified();
        },
        (m) => {
          requestRef.current = null;
          setErr(m);
          setPhase("done");
        },
      );
    } catch (e) {
      setPhase("idle");
      setErr(setupHint(e) ?? (e instanceof Error ? e.message : String(e)));
    }
  }

  /** ได้ payload มาตรง ๆ (จากเครื่องสแกน) — ตรวจเลยไม่ต้องผ่านคิวจอลูกค้า */
  async function runDirect(code: string) {
    setPhase("waiting");
    setErr(null);
    try {
      const r = await verifySlip({
        payload: code,
        expectedAmount: amount,
        reservationId,
        pcSessionId,
        productSaleId,
      });
      setResult(r);
      setPhase("done");
      if (r.ok) markVerified();
      await showSlipResultScreen(
        r.ok,
        r.ok ? "ยืนยันการชำระเงินเรียบร้อย" : (r.error ?? "ตรวจสลิปไม่ผ่าน"),
        amount,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("done");
    }
  }

  /** ขอ QR ยอดไม่ซ้ำ แล้วเริ่มรอ */
  async function beginAuto() {
    if (autoBusy) return;
    setAutoBusy(true);
    setErr(null);
    setAutoNote(null);
    try {
      const r = await createPayWatch({
        amount,
        memo: memo ?? undefined,
        reservationId,
        pcSessionId,
        productSaleId,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      const qrDataUrl = await QRCode.toDataURL(r.qrCode, { margin: 1, width: 320 });
      const next: AutoState = {
        ref: r.ref,
        uniqueAmount: r.uniqueAmount,
        qrDataUrl,
        clientId: r.clientId,
        expiresAt: r.expiresAt,
      };
      autoRef.current = next;
      setAuto(next);

      // จองจอลูกค้าไว้ ไม่ให้ฟอร์มที่เปิดอยู่เขียนทับ QR ยอดไม่ซ้ำ
      lockDisplay(DISPLAY_OWNER);
      await pushDisplay(
        {
          kind: "start",
          amount: r.uniqueAmount,
          charge_type: "start",
          payment_method: "promptpay",
          qr_code: qrDataUrl,
          qr: String(r.uniqueAmount),
          message: `สแกนจ่าย ${r.uniqueAmount.toFixed(2)} บาท — ระบบจะตรวจให้อัตโนมัติ`,
        },
        { owner: DISPLAY_OWNER },
      ).catch(() => {});

      sseStopRef.current = watchPayment(
        r.ref,
        r.clientId,
        () => void checkAuto(),
        undefined,
        () => {
          setAutoNote("หมดเวลารอแล้ว (QR มีอายุ 15 นาที) — กดขอ QR ใหม่ได้เลย");
          void stopAuto();
        },
      );
      pollRef.current = setInterval(() => void checkAuto(), POLL_MS);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoBusy(false);
    }
  }

  async function stopScan() {
    stopRef.current?.();
    stopRef.current = null;
    if (requestRef.current) {
      await cancelSlipScan(requestRef.current).catch(() => {});
      requestRef.current = null;
    } else {
      await clearDisplay().catch(() => {});
    }
    setPhase("idle");
  }

  return (
    <div className="text-center p-2 border rounded-3 bg-light my-2">
      <div className="fw-bold text-primary mb-1">📱 สแกนจ่ายผ่าน PromptPay</div>
      <div className="small text-muted mb-2">{PROMPTPAY_ID}</div>
      {url && (
        <div className="qr-container">
          <img src={url} alt="PromptPay QR" />
        </div>
      )}
      <div className="fw-bold mt-2">฿ {formatBaht(amount)}</div>

      {!hideVerify && auto && (
        <div
          className="pw-wait mt-2 p-2 rounded-3"
          style={{ background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.35)" }}
        >
          <div className="d-inline-flex align-items-center gap-2 fw-bold text-success">
            <Loader2 size={16} className="spin" /> รอเงินเข้า — ระบบตรวจให้อัตโนมัติ
          </div>
          <div className="qr-container mt-2">
            <img src={auto.qrDataUrl} alt="QR รับเงินยอดเฉพาะบิลนี้" />
          </div>
          <div className="fw-bold mt-1" style={{ fontSize: "1.3rem" }}>
            ฿ {auto.uniqueAmount.toFixed(2)}
          </div>
          <div className="small text-muted">
            ยอดนี้ลงท้ายไม่ซ้ำกับบิลอื่น ระบบจึงจับคู่ได้แน่นอน — ลูกค้าสแกนจ่ายได้เลย
          </div>
          <div className="small text-muted">QR มีอายุ 15 นาที</div>
          {autoNote && (
            <div className="alert alert-warning py-1 px-2 small mt-2 mb-0">{autoNote}</div>
          )}
          <div className="mt-2 d-flex gap-2 justify-content-center">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => void stopAuto()}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              onClick={() => void checkAuto()}
            >
              ตรวจเดี๋ยวนี้
            </button>
          </div>
        </div>
      )}

      {!hideVerify && !auto && (
        <div className="mt-2">
          {isVerified ? (
            <div className="badge bg-success d-inline-flex align-items-center gap-1 py-2 px-3">
              <CheckCircle2 size={14} /> ตรวจสลิปแล้ว เงินเข้าจริง
            </div>
          ) : phase === "waiting" ? (
            <div className="slip-wait">
              <div className="d-inline-flex align-items-center gap-2 fw-bold text-primary">
                <Loader2 size={16} className="spin" /> รอลูกค้าโชว์สลิปที่กล้อง
              </div>
              <div className="small text-muted mt-1">
                จอลูกค้าเปิดกล้องแล้ว — ให้ลูกค้าหัน QR บนสลิปเข้าหากล้อง
              </div>
              <div className="small text-muted">หรือยิง QR บนสลิปด้วยเครื่องสแกนได้เลย</div>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary mt-2"
                onClick={stopScan}
              >
                ยกเลิก
              </button>
            </div>
          ) : (
            <>
              {autoOn && (
                <div className="mb-2">
                  <button
                    type="button"
                    className="btn btn-success d-inline-flex align-items-center gap-1 fw-bold"
                    onClick={beginAuto}
                    disabled={autoBusy}
                  >
                    <BellRing size={15} />
                    {autoBusy ? "กำลังขอ QR..." : "รอเงินเข้าอัตโนมัติ"}
                  </button>
                  <div className="small text-muted mt-1">
                    ไม่ต้องสแกนสลิป — เงินเข้าแล้วระบบทำต่อเอง
                  </div>
                </div>
              )}
              <button
                type="button"
                className={`btn btn-sm d-inline-flex align-items-center gap-1 ${autoOn ? "btn-outline-primary" : "btn-primary"}`}
                onClick={beginCameraScan}
              >
                <Camera size={15} /> ให้ลูกค้าโชว์สลิปที่กล้อง
              </button>
              <div className="mt-1">
                <button
                  type="button"
                  className="btn btn-link btn-sm text-muted p-0 d-inline-flex align-items-center gap-1"
                  onClick={() => setManual(true)}
                >
                  <ScanLine size={13} /> สแกนเองที่เครื่องนี้
                </button>
              </div>
            </>
          )}

          {phase === "done" && result && !result.ok && (
            <div className="alert alert-warning py-2 small mt-2 mb-0 text-start">
              <XCircle size={14} /> {result.error}
              {result.code && <span className="text-muted"> ({result.code})</span>}
              <div className="mt-2 d-flex gap-2">
                <button type="button" className="btn btn-sm btn-primary" onClick={beginCameraScan}>
                  ลองใหม่
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setManual(true)}
                >
                  ดูรายละเอียด / สแกนเอง
                </button>
              </div>
            </div>
          )}
          {err && <div className="alert alert-danger py-2 small mt-2 mb-0 text-start">{err}</div>}
        </div>
      )}

      {manual && (
        <SlipVerifyModal
          expectedAmount={amount}
          reservationId={reservationId}
          pcSessionId={pcSessionId}
          productSaleId={productSaleId}
          onClose={() => setManual(false)}
          onVerified={() => {
            setManual(false);
            markVerified();
          }}
        />
      )}
    </div>
  );
}

/** ยังไม่ได้รัน slip_migration.sql */
function setupHint(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const code = (e as { code?: string } | null)?.code ?? "";
  if (
    code === "PGRST205" ||
    code === "PGRST202" ||
    code === "42P01" ||
    /Could not find the (table|function)/i.test(msg)
  ) {
    return "ยังไม่ได้ติดตั้งระบบตรวจสลิป — รัน supabase/slip_migration.sql ก่อน";
  }
  return null;
}
