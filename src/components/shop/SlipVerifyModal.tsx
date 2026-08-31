import { useEffect, useRef, useState } from "react";
import { ScanLine, Upload, CheckCircle2, XCircle, AlertTriangle, X, Barcode } from "lucide-react";
import { BarcodeScanner } from "./BarcodeScanner";
import { verifySlip, type SlipVerifyResult } from "@/lib/slipVerify";
import { formatBaht } from "@/lib/priceEngine";
import { useBarcodeGun } from "@/hooks/useBarcodeGun";

interface Props {
  expectedAmount: number;
  reservationId?: string | null;
  pcSessionId?: string | null;
  productSaleId?: string | null;
  onClose: () => void;
  onVerified?: (result: SlipVerifyResult) => void;
}

/** อ่านไฟล์รูปเป็น data URL */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
    fr.readAsDataURL(file);
  });
}

export function SlipVerifyModal({
  expectedAmount,
  reservationId = null,
  pcSessionId = null,
  productSaleId = null,
  onClose,
  onVerified,
}: Props) {
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SlipVerifyResult | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const gunRef = useRef<HTMLInputElement | null>(null);

  // โฟกัสช่องยิงไว้ตั้งแต่เปิด — เครื่องสแกนจะพิมพ์ลงช่องนี้ทันที
  useEffect(() => {
    gunRef.current?.focus();
  }, []);

  // เผื่อโฟกัสหลุดไปที่อื่น ก็ยังรับจากเครื่องสแกนได้
  useBarcodeGun((code) => run({ payload: code }), { enabled: !scanning && !busy });

  async function run(input: { payload?: string; imageBase64?: string }) {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await verifySlip({
        ...input,
        expectedAmount,
        reservationId,
        pcSessionId,
        productSaleId,
      });
      setResult(r);
      if (r.ok) onVerified?.(r);
    } catch (e) {
      setResult({
        ok: false,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setResult({ ok: false, status: "failed", error: "ไฟล์ใหญ่เกิน 5 MB ลองถ่ายใหม่ให้เล็กลง" });
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      await run({ imageBase64: dataUrl });
    } catch (err) {
      setResult({ ok: false, status: "failed", error: (err as Error).message });
    }
  }

  return (
    <div className="modal-backdrop-custom" onClick={onClose} style={{ zIndex: 1080 }}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header bg-primary text-white">
          <h5 className="modal-title fw-bold m-0 d-inline-flex align-items-center gap-2">
            <ScanLine size={18} /> ตรวจสลิปโอนเงิน
          </h5>
          <button className="btn-close btn-close-white" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="p-4">
          <div className="alert alert-secondary py-2 text-center mb-3">
            ยอดที่ต้องชำระ{" "}
            <b className="text-danger" style={{ fontSize: "1.25rem" }}>
              {formatBaht(expectedAmount)}
            </b>{" "}
            บาท
          </div>

          {!scanning && (
            <div className="mb-3">
              <label className="form-label fw-bold d-flex align-items-center gap-2">
                <Barcode size={16} /> ยิง QR บนสลิปด้วยเครื่องสแกน
              </label>
              <input
                ref={gunRef}
                className="form-control form-control-lg text-center"
                placeholder="ยิงได้เลย..."
                autoComplete="off"
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const code = (e.target as HTMLInputElement).value.trim();
                  (e.target as HTMLInputElement).value = "";
                  if (code.length >= 15) run({ payload: code });
                }}
              />
              <div className="small text-muted mt-1">
                ต้องเป็นหัวอ่านแบบ 2D เท่านั้น หัวอ่านเลเซอร์เส้นเดียวอ่าน QR ไม่ได้
              </div>
              <hr className="my-3" />
            </div>
          )}

          {scanning ? (
            <BarcodeScanner
              onDetected={(code) => {
                setScanning(false);
                run({ payload: code });
              }}
              onClose={() => setScanning(false)}
            />
          ) : (
            <>
              <div className="d-grid gap-2">
                <button
                  className="btn btn-primary btn-lg d-inline-flex align-items-center justify-content-center gap-2"
                  onClick={() => setScanning(true)}
                  disabled={busy}
                >
                  <ScanLine size={18} /> สแกน QR บนสลิป
                </button>
                <button
                  className="btn btn-outline-secondary d-inline-flex align-items-center justify-content-center gap-2"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  <Upload size={16} /> เลือกรูปสลิปแทน
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="d-none"
                  onChange={onPickFile}
                />
              </div>
              <div className="small text-muted text-center mt-2">
                สแกน QR แม่นกว่าและอ่านไวกว่าการถ่ายรูป
              </div>
            </>
          )}

          {busy && <div className="text-center text-muted mt-3">กำลังตรวจกับธนาคาร...</div>}

          {result && <ResultBox result={result} expectedAmount={expectedAmount} />}
        </div>
      </div>
    </div>
  );
}

function ResultBox({
  result,
  expectedAmount,
}: {
  result: SlipVerifyResult;
  expectedAmount: number;
}) {
  const slip = result.slip;

  if (result.ok) {
    return (
      <div className="alert alert-success mt-3 mb-0">
        <div className="fw-bold d-inline-flex align-items-center gap-2 mb-2">
          <CheckCircle2 size={20} /> สลิปถูกต้อง เงินเข้าจริง
        </div>
        <SlipDetail slip={slip} />
      </div>
    );
  }

  const isMismatch = result.status === "amount_mismatch";
  const isDuplicate = result.status === "duplicate";

  return (
    <div className={`alert ${isMismatch ? "alert-warning" : "alert-danger"} mt-3 mb-0`}>
      <div className="fw-bold d-inline-flex align-items-center gap-2 mb-2">
        {isMismatch ? <AlertTriangle size={20} /> : <XCircle size={20} />}
        {isDuplicate ? "สลิปใบนี้ถูกใช้ไปแล้ว" : isMismatch ? "ยอดไม่ตรง" : "ตรวจไม่ผ่าน"}
      </div>
      <div className="small mb-2">{result.error}</div>

      {isMismatch && slip && (
        <div className="small">
          ยอดบนสลิป <b>{formatBaht(slip.amount)}</b> บาท · ต้องชำระ{" "}
          <b>{formatBaht(expectedAmount)}</b> บาท
        </div>
      )}

      {isDuplicate && result.previous && (
        <div className="small">
          เคยใช้เมื่อ{" "}
          {new Date(result.previous.created_at).toLocaleString("th-TH", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          กับบิลยอด {formatBaht(result.previous.expected_amount)} บาท
        </div>
      )}

      <SlipDetail slip={slip} />
    </div>
  );
}

function SlipDetail({ slip }: { slip?: SlipVerifyResult["slip"] }) {
  if (!slip) return null;
  return (
    <div className="small mt-2" style={{ lineHeight: 1.8 }}>
      {slip.senderName && (
        <div>
          ผู้โอน: <b>{slip.senderName}</b>
          {slip.senderBank ? ` (${slip.senderBank})` : ""}
        </div>
      )}
      {slip.receiverName && (
        <div>
          เข้าบัญชี: <b>{slip.receiverName}</b>
          {slip.receiverBank ? ` (${slip.receiverBank})` : ""}
        </div>
      )}
      {slip.date && (
        <div>
          เวลาโอน:{" "}
          <b>
            {new Date(slip.date).toLocaleString("th-TH", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </b>
        </div>
      )}
      {slip.transRef && (
        <div className="text-muted" style={{ fontSize: ".78rem", wordBreak: "break-all" }}>
          อ้างอิง: {slip.transRef}
        </div>
      )}
    </div>
  );
}
