import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, XCircle, Loader2, ScanLine } from "lucide-react";
import { buildPromptpayDataUrl, PROMPTPAY_ID } from "@/lib/promptpay";
import { formatBaht } from "@/lib/priceEngine";
import { SlipVerifyModal } from "./SlipVerifyModal";
import { startSlipScan, cancelSlipScan, watchSlipScan } from "@/lib/slipScan";
import { verifySlip } from "@/lib/slipVerify";
import { useBarcodeGun } from "@/hooks/useBarcodeGun";
import { isCompleteSlipPayload } from "@/lib/slipPayload";
import {
  clearDisplay,
  showSlipResultScreen,
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

type Phase = "idle" | "waiting" | "verifying" | "done";

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
  const slipGeneration = useRef(0);
  const directBusy = useRef(false);
  const requestRef = useRef<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  // Invalidate only EasySlip work when its payment context changes or unmounts.
  useEffect(() => {
    const generationRef = slipGeneration;
    setResult(null);
    setPhase("idle");
    return () => {
      generationRef.current++;
      stopRef.current?.();
      stopRef.current = null;
      const id = requestRef.current;
      requestRef.current = null;
      if (id) void cancelSlipScan(id).catch(() => {});
    };
  }, [amount, reservationId, pcSessionId, productSaleId]);

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
    };
  }, []);

  // ยิงด้วยเครื่องสแกนบาร์โค้ด 2D ได้ตลอดช่วงที่รอสลิป — ไม่ต้องรอกล้อง
  useBarcodeGun(
    (code) => {
      if (phase !== "waiting") return;
      void runDirect(code);
    },
    { enabled: phase === "waiting", looksComplete: isCompleteSlipPayload },
  );

  if (amount <= 0) return null;

  const isVerified = verifiedAmount !== null && Math.abs(verifiedAmount - amount) <= 0.01;

  async function beginCameraScan() {
    if (directBusy.current) return;
    stopRef.current?.();
    const generation = ++slipGeneration.current;
    setErr(null);
    setResult(null);
    setPhase("waiting");
    try {
      const req = await startSlipScan({
        expectedAmount: amount,
        reservationId,
        pcSessionId,
      });
      if (generation !== slipGeneration.current) {
        await cancelSlipScan(req.id).catch(() => {});
        return;
      }
      requestRef.current = req.id;
      stopRef.current = watchSlipScan(
        req.id,
        (r) => {
          if (generation !== slipGeneration.current) return;
          requestRef.current = null;
          setResult(r);
          setPhase("done");
          if (r.ok) markVerified();
        },
        (m) => {
          if (generation !== slipGeneration.current) return;
          requestRef.current = null;
          setErr(m);
          setPhase("done");
        },
        productSaleId,
      );
    } catch (e) {
      if (generation !== slipGeneration.current) return;
      setPhase("idle");
      setErr(setupHint(e) ?? (e instanceof Error ? e.message : String(e)));
    }
  }

  /** ได้ payload มาตรง ๆ (จากเครื่องสแกน) — ตรวจเลยไม่ต้องผ่านคิวจอลูกค้า */
  async function runDirect(code: string) {
    if (directBusy.current) return;
    directBusy.current = true;
    const generation = ++slipGeneration.current;
    stopRef.current?.();
    stopRef.current = null;
    const scanId = requestRef.current;
    requestRef.current = null;
    setPhase("verifying");
    setErr(null);
    try {
      if (scanId) await cancelSlipScan(scanId).catch(() => {});
      if (generation !== slipGeneration.current) return;
      const r = await verifySlip({
        payload: code,
        expectedAmount: amount,
        reservationId,
        pcSessionId,
        productSaleId,
      });
      if (generation !== slipGeneration.current) return;
      setResult(r);
      setPhase("done");
      if (r.ok) markVerified();
      await showSlipResultScreen(
        r.ok,
        r.ok ? "ยืนยันการชำระเงินเรียบร้อย" : (r.error ?? "ตรวจสลิปไม่ผ่าน"),
        amount,
      );
    } catch (e) {
      if (generation !== slipGeneration.current) return;
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("done");
    } finally {
      directBusy.current = false;
    }
  }

  async function stopScan() {
    slipGeneration.current++;
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

      {!hideVerify && (
        <div className="mt-2">
          {isVerified ? (
            <div className="badge bg-success d-inline-flex align-items-center gap-1 py-2 px-3">
              <CheckCircle2 size={14} /> ตรวจสลิปแล้ว เงินเข้าจริง
            </div>
          ) : phase === "verifying" ? (
            <div className="text-muted py-2"><Loader2 size={16} className="spin" /> กำลังตรวจสลิปกับ EasySlip...</div>
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
              <button
                type="button"
                className="btn btn-sm d-inline-flex align-items-center gap-1 btn-primary"
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
          key={JSON.stringify([amount, reservationId, pcSessionId, productSaleId])}
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
