import { useCallback, useEffect, useRef, useState } from "react";

export interface CameraDevice {
  deviceId: string;
  label: string;
}

interface Props {
  onDetected: (payload: string) => void;
  /** หยุดอ่าน (เช่น ส่งไปตรวจแล้ว) */
  paused?: boolean;
  /** กล้องที่เลือกไว้ — ว่าง = ให้ระบบเลือกให้ */
  deviceId?: string | null;
  /** ส่งรายชื่อกล้องกลับไปให้หน้าจอทำตัวเลือก */
  onDevices?: (devices: CameraDevice[]) => void;
}

type DetectorLike = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/**
 * กล้องอ่าน QR บนสลิป
 *
 * ใช้ BarcodeDetector ของเบราว์เซอร์ก่อน ถ้าไม่มีค่อย fallback เป็น @zxing/browser
 * ภาพแสดงกลับด้านเหมือนกระจกเพื่อให้ลูกค้าขยับสลิปถูกทาง ตัวถอดรหัสอ่านจาก
 * เฟรมจริงไม่ได้อ่านจากภาพที่กลับด้าน จึงไม่กระทบความแม่น
 */
export function SlipQrCamera({ onDetected, paused = false, deviceId = null, onDevices }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState<string>("");
  const [ready, setReady] = useState(false);

  // เก็บ callback ไว้ใน ref — ถ้าใส่ลง dependency ของ effect ตรง ๆ
  // กล้องจะถูกปิด/เปิดใหม่ทุกครั้งที่ component แม่ re-render (ซึ่งเกิดบ่อยมาก)
  // นั่นคือสาเหตุที่กล้องเปิดไม่ติด/กระพริบในเวอร์ชันก่อน
  const detectedRef = useRef(onDetected);
  const devicesRef = useRef(onDevices);
  const pausedRef = useRef(paused);
  const firedRef = useRef(false);

  useEffect(() => {
    detectedRef.current = onDetected;
  }, [onDetected]);
  useEffect(() => {
    devicesRef.current = onDevices;
  }, [onDevices]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    firedRef.current = false;
  }, [deviceId]);

  const listDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `กล้องที่ ${i + 1}` }));
      devicesRef.current?.(cams);
    } catch {
      /* ไม่ได้รายชื่อก็ยังใช้กล้องเริ่มต้นได้ */
    }
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let zxingControls: { stop: () => void } | null = null;
    let stopped = false;

    function hit(value: string) {
      if (firedRef.current || pausedRef.current) return;
      const v = (value || "").trim();
      if (!v) return;
      firedRef.current = true;
      detectedRef.current(v);
    }

    async function openStream(): Promise<MediaStream> {
      const base: MediaTrackConstraints = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      };
      if (deviceId) {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: { ...base, deviceId: { exact: deviceId } },
            audio: false,
          });
        } catch {
          // กล้องที่จำไว้ถูกถอดออกไปแล้ว -> ถอยไปใช้ตัวเริ่มต้น
        }
      }
      return navigator.mediaDevices.getUserMedia({ video: base, audio: false });
    }

    async function start() {
      setErr("");
      setReady(false);
      try {
        if (typeof window !== "undefined" && !window.isSecureContext) {
          setErr("เบราว์เซอร์เปิดกล้องได้เฉพาะเว็บที่เป็น https หรือ localhost เท่านั้น");
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setErr("เครื่องนี้ไม่รองรับการเปิดกล้อง");
          return;
        }
        const video = videoRef.current;
        if (!video) return;

        stream = await openStream();
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        setReady(true);
        listDevices(); // ต้องเรียกหลังได้สิทธิ์แล้ว ไม่งั้นชื่อกล้องจะว่าง

        const w = window as unknown as { BarcodeDetector?: new (o?: unknown) => DetectorLike };
        let detector: DetectorLike | null = null;
        if (w.BarcodeDetector) {
          try {
            detector = new w.BarcodeDetector({ formats: ["qr_code"] });
          } catch {
            detector = null; // เบราว์เซอร์มี API แต่ไม่รองรับ qr_code
          }
        }

        if (detector) {
          const tick = async () => {
            if (stopped) return;
            try {
              if (!pausedRef.current && video.readyState >= 2) {
                const codes = await detector.detect(video);
                if (codes.length) hit(codes[0].rawValue);
              }
            } catch {
              /* เฟรมนี้อ่านไม่ได้ ข้ามไป */
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
          return;
        }

        // fallback: @zxing/browser อ่านจาก stream ที่เปิดไว้แล้ว
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        zxingControls = reader.decodeFromVideoElement(video, (res) => {
          if (res) hit(res.getText());
        }) as unknown as { stop: () => void };
      } catch (e) {
        const name = (e as { name?: string } | null)?.name ?? "";
        setErr(
          name === "NotAllowedError" || name === "SecurityError"
            ? "ยังไม่ได้อนุญาตให้เว็บใช้กล้อง — กดรูปกล้องที่แถบ address bar เลือก Allow แล้วรีเฟรชหน้านี้"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "ไม่พบกล้องที่ใช้ได้ — ตรวจว่าเสียบกล้องแล้วและไม่มีโปรแกรมอื่นเปิดค้างอยู่"
              : name === "NotReadableError"
                ? "กล้องถูกโปรแกรมอื่นใช้อยู่ — ปิดโปรแกรมนั้นแล้วรีเฟรชหน้านี้"
                : "เปิดกล้องไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)),
        );
      }
    }

    start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try {
        zxingControls?.stop();
      } catch {
        /* ปิดไปแล้ว */
      }
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId, listDevices]);

  if (err) {
    return <div className="slip-cam-error">{err}</div>;
  }

  return (
    <div className="slip-cam">
      <video ref={videoRef} muted playsInline autoPlay />
      <div className="slip-cam-frame" aria-hidden="true">
        <span className="c tl" />
        <span className="c tr" />
        <span className="c bl" />
        <span className="c br" />
      </div>
      {!ready && <div className="slip-cam-loading">กำลังเปิดกล้อง...</div>}
    </div>
  );
}
