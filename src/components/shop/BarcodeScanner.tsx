import { useEffect, useRef, useState } from "react";

interface Props {
  onDetected: (code: string) => void;
  onClose: () => void;
}

type DetectorLike = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** สแกนบาร์โค้ดด้วยกล้อง — ใช้ BarcodeDetector ของเบราว์เซอร์ ถ้าไม่รองรับจะ fallback เป็น @zxing/browser */
export function BarcodeScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState<string>("");
  const stoppedRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let zxingControls: { stop: () => void } | null = null;

    async function start() {
      try {
        if (typeof window !== "undefined" && !window.isSecureContext) {
          setErr("เบราว์เซอร์อนุญาตให้ใช้กล้องเฉพาะเว็บที่เป็น https เท่านั้น");
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setErr("เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง");
          return;
        }
        const w = window as unknown as { BarcodeDetector?: new (o?: unknown) => DetectorLike };
        const video = videoRef.current;
        if (!video) return;

        if (w.BarcodeDetector) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
          video.srcObject = stream;
          await video.play();
          const detector = new w.BarcodeDetector({
            formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code", "itf"],
          });
          const tick = async () => {
            if (stoppedRef.current) return;
            try {
              const found = await detector.detect(video);
              if (found.length > 0 && found[0]?.rawValue) {
                hit(found[0].rawValue);
                return;
              }
            } catch {
              /* ignore per-frame errors */
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        } else {
          // zxing จัดการเปิดกล้องเอง — อย่าเปิด stream ซ้อน
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: "environment" } }, audio: false },
            video,
            (result?: { getText?: () => string }) => {
              const text = result?.getText?.();
              if (text) hit(text);
            },
          );
        }
      } catch (e) {
        const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        setErr(
          /NotAllowedError|Permission/i.test(m)
            ? "ไม่ได้รับอนุญาตให้ใช้กล้อง — กดอนุญาตกล้องในเบราว์เซอร์แล้วลองอีกครั้ง"
            : m,
        );
      }
    }


    function hit(code: string) {
      if (stoppedRef.current) return;
      stoppedRef.current = true;
      cleanup();
      onDetected(code.trim());
    }

    function cleanup() {
      cancelAnimationFrame(raf);
      zxingControls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    }

    start();
    return () => {
      stoppedRef.current = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header bg-dark text-white">
          <h5 className="modal-title fw-bold m-0">📷 สแกนบาร์โค้ดด้วยกล้อง</h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <div className="p-3">
          {err ? (
            <div className="alert alert-danger small mb-0">
              เปิดกล้องไม่ได้: {err}
              <div className="mt-1">ลองใช้เครื่องสแกนบาร์โค้ด USB หรืออนุญาตสิทธิ์กล้องในเบราว์เซอร์</div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                style={{ width: "100%", borderRadius: 12, background: "#000", maxHeight: 340, objectFit: "cover" }}
              />
              <div className="text-center small text-muted mt-2">เล็งบาร์โค้ดให้อยู่กลางจอ</div>
            </>
          )}
          <div className="d-flex justify-content-end mt-3">
            <button className="btn btn-secondary" onClick={onClose}>ปิด</button>
          </div>
        </div>
      </div>
    </div>
  );
}
