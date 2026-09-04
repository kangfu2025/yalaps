import { useEffect, useRef, useState } from "react";
import {
  ScanLine,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  X,
  Barcode,
  Activity,
} from "lucide-react";
import { BarcodeScanner } from "./BarcodeScanner";
import {
  verifySlip,
  checkSlipStatus,
  type SlipVerifyResult,
  type SlipStatus,
} from "@/lib/slipVerify";
import { formatBaht } from "@/lib/priceEngine";
import { useBarcodeGun } from "@/hooks/useBarcodeGun";
import { isCompleteSlipPayload } from "@/lib/slipPayload";

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
  const [status, setStatus] = useState<SlipStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const gunRef = useRef<HTMLInputElement | null>(null);

  /** ทางเข้าเดียวของทุกอย่างที่มาจากเครื่องสแกน */
  function runScanned(code: string) {
    // eslint-disable-next-line no-control-regex -- ตั้งใจตัดอักขระควบคุมที่เครื่องสแกนอาจแถมมา
    const clean = code.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    setLastScan(clean);
    if (clean.length < 15) {
      setResult({
        ok: false,
        status: "failed",
        code: "TOO_SHORT",
        error: `อ่านได้แค่ ${clean.length} ตัวอักษร ซึ่งสั้นเกินกว่าจะเป็น QR สลิป — ลองยิงใหม่`,
      });
      return;
    }
    run({ payload: clean });
  }

  // โฟกัสช่องยิงไว้ตั้งแต่เปิด — เครื่องสแกนจะพิมพ์ลงช่องนี้ทันที
  useEffect(() => {
    gunRef.current?.focus();
  }, []);

  // ตัวจับข้อมูลจากเครื่องสแกน — เหลือทางเดียวเท่านั้น
  //
  // เดิมมีสองทางทำงานพร้อมกัน: hook ระดับหน้าต่าง กับ onKeyDown ของช่องกรอก
  // ผลคือถ้าโฟกัสอยู่ในช่องจะยิงซ้ำสองครั้ง แต่ถ้าโฟกัสไม่เคยลงช่องเลย
  // (เช่น เบราว์เซอร์ไม่ยอมโฟกัสอัตโนมัติ) กลับกลายเป็นไม่มีใครจับเลยสักทาง
  // ตอนนี้ให้ hook จับทั้งหมด ช่องกรอกเหลือหน้าที่แค่ให้เห็นว่ากำลังยิงเข้ามา
  useBarcodeGun(
    (code) => {
      if (gunRef.current) gunRef.current.value = "";
      runScanned(code);
    },
    { enabled: !scanning && !busy, looksComplete: isCompleteSlipPayload },
  );

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
              />
              <div className="small text-muted mt-1">
                ต้องเป็นหัวอ่านแบบ 2D เท่านั้น หัวอ่านเลเซอร์เส้นเดียวอ่าน QR ไม่ได้
              </div>
              {lastScan && (
                <details className="mt-2">
                  <summary className="small text-muted" style={{ cursor: "pointer" }}>
                    ข้อความที่สแกนได้ล่าสุด ({lastScan.length} ตัวอักษร)
                  </summary>
                  <textarea
                    className="form-control form-control-sm mt-2 font-monospace"
                    rows={3}
                    readOnly
                    value={lastScan}
                    style={{ fontSize: ".7rem" }}
                  />
                  <div className="small text-muted mt-1">
                    ถ้าเห็นเป็นภาษาไทยหรืออักขระแปลก ๆ แปลว่าแป้นพิมพ์ของเครื่องตั้งเป็นภาษาไทยอยู่
                  </div>
                </details>
              )}
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

          <div className="text-center mt-3">
            <button
              type="button"
              className="btn btn-link btn-sm text-muted p-0 d-inline-flex align-items-center gap-1"
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                setStatus(null);
                try {
                  setStatus(await checkSlipStatus());
                } finally {
                  setChecking(false);
                }
              }}
            >
              <Activity size={13} /> {checking ? "กำลังตรวจ..." : "ตรวจการเชื่อมต่อ EasySlip"}
            </button>
          </div>

          {status && (
            <div
              className={`alert ${status.ok ? "alert-success" : "alert-danger"} py-2 small mt-2 mb-0 text-start`}
            >
              {status.ok ? (
                <>
                  <CheckCircle2 size={14} /> เชื่อมต่อได้ปกติ ({status.latencyMs} มิลลิวินาที)
                  {status.info != null && (
                    <details className="mt-2">
                      <summary style={{ cursor: "pointer" }}>ข้อมูลบัญชี / โควตา</summary>
                      <pre
                        className="mt-2 mb-0 p-2 rounded"
                        style={{
                          background: "rgba(0,0,0,.06)",
                          fontSize: ".7rem",
                          maxHeight: 180,
                          overflow: "auto",
                        }}
                      >
                        {JSON.stringify(status.info, null, 2)}
                      </pre>
                    </details>
                  )}
                </>
              ) : (
                <>
                  <AlertTriangle size={14} /> {status.error}
                  {status.latencyMs != null && (
                    <span className="text-muted"> ({status.latencyMs} มิลลิวินาที)</span>
                  )}
                </>
              )}
            </div>
          )}

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
      <div className="small mb-2">
        {result.error}
        {result.latencyMs != null && (
          <span className="text-muted">
            {" "}
            · ใช้เวลา {(result.latencyMs / 1000).toFixed(1)} วินาที
          </span>
        )}
      </div>

      {result.retryable && (
        <div className="small mb-2 fw-bold">
          สลิปเพิ่งโอนมา ธนาคารยังบันทึกไม่เสร็จ — รอสักครู่แล้วสแกนใหม่ได้เลย
        </div>
      )}

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

      {result.scanKind && (
        <div className="small mt-2">
          🔎 QR ที่ยิงมาคือ: <b>{result.scanKind.label}</b>
          {result.scanKind.transRef && <> · เลขอ้างอิง {result.scanKind.transRef}</>}
          {result.scanKind.sendingBank && <> · ธนาคาร {result.scanKind.sendingBank}</>}
          {typeof result.scanKind.amount === "number" && (
            <> · ระบุยอด {formatBaht(result.scanKind.amount)} บาท</>
          )}
          {result.scanKind.crcOk === false && (
            <span className="text-danger"> · เลขตรวจสอบท้าย QR ไม่ตรง (อ่านมาเพี้ยน)</span>
          )}
          {(result.scanKind.repeated ?? 1) > 1 && (
            <div className="text-warning-emphasis">
              ⚠️ เครื่องอ่านยิงซ้ำ {result.scanKind.repeated} รอบติดกัน —
              ระบบตัดให้เหลือรอบเดียวแล้ว ถ้าเจอบ่อยให้ปิดโหมดยิงต่อเนื่องที่ตัวเครื่องอ่าน
            </div>
          )}
        </div>
      )}

      {/* เปิดค้างไว้เลยตอนตรวจไม่ผ่าน — ข้อความนี้คือสิ่งเดียวที่บอกได้ว่ายิงอะไรมา */}
      {result.scanned && (
        <details className="mt-2" open={!result.ok}>
          <summary className="small" style={{ cursor: "pointer" }}>
            ข้อความที่อ่านได้จากสลิป ({result.scanned.length} ตัวอักษร)
          </summary>
          <textarea
            className="form-control form-control-sm mt-2 font-monospace"
            rows={3}
            readOnly
            value={result.scanned}
            style={{ fontSize: ".7rem" }}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary mt-1"
            onClick={() => navigator.clipboard?.writeText(result.scanned ?? "").catch(() => {})}
          >
            คัดลอกข้อความนี้
          </button>
        </details>
      )}

      <SlipDetail slip={slip} />
      <DebugBox result={result} />
    </div>
  );
}

/** คำตอบดิบจากผู้ให้บริการ — ซ่อนไว้ ใช้ตอนต้องส่งให้ผู้ดูแลระบบดู */
function DebugBox({ result }: { result: SlipVerifyResult }) {
  if (!result.debug) return null;
  const text = JSON.stringify(result.debug, null, 2);
  return (
    <details className="mt-2">
      <summary className="small text-muted" style={{ cursor: "pointer" }}>
        รายละเอียดทางเทคนิค {result.code ? `(${result.code})` : ""}
      </summary>
      <pre
        className="small mt-2 mb-1 p-2 rounded"
        style={{
          background: "rgba(0,0,0,.06)",
          maxHeight: 220,
          overflow: "auto",
          fontSize: ".72rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {text}
      </pre>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={() => navigator.clipboard?.writeText(text).catch(() => {})}
      >
        คัดลอก
      </button>
    </details>
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
