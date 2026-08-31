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
  /** กลับภาพซ้าย-ขวา (ปกติปิด เปิดเฉพาะกล้องที่ให้ภาพกลับด้านมาเอง) */
  mirror?: boolean;
  /** ส่งรายชื่อกล้องกลับไปให้หน้าจอทำตัวเลือก */
  onDevices?: (devices: CameraDevice[]) => void;
}

type DetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

/** ระยะห่างระหว่างรอบอ่าน — ถี่กว่านี้กิน CPU ฟรี ช้ากว่านี้ลูกค้ารู้สึกว่าไม่ตอบสนอง */
const SCAN_INTERVAL_MS = 120;

/**
 * กล้องอ่าน QR บนสลิป
 *
 * อ่านสองแบบสลับกันทุกรอบ: เฟรมเต็ม และเฉพาะกลางภาพที่ครอปมา
 * การครอปช่วยมากเวลา QR เล็กหรืออยู่ไกล เพราะได้ความละเอียดต่อโมดูลสูงขึ้น
 */
export function SlipQrCamera({
  onDetected,
  paused = false,
  deviceId = null,
  mirror = false,
  onDevices,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState<string>("");
  const [ready, setReady] = useState(false);

  // เก็บ callback ไว้ใน ref — ถ้าใส่ลง dependency ของ effect ตรง ๆ
  // กล้องจะถูกปิด/เปิดใหม่ทุกครั้งที่ component แม่ re-render
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let zxingControls: { stop: () => void } | null = null;
    let stopped = false;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    function hit(value: string) {
      if (firedRef.current || pausedRef.current) return;
      const v = (value || "").trim();
      if (!v) return;
      firedRef.current = true;
      detectedRef.current(v);
    }

    /** ครอปกลางภาพ 60% เพื่อให้ QR ใหญ่ขึ้นในสายตาตัวถอดรหัส */
    function centerCrop(video: HTMLVideoElement): HTMLCanvasElement | null {
      if (!ctx || !video.videoWidth || !video.videoHeight) return null;
      const size = Math.floor(Math.min(video.videoWidth, video.videoHeight) * 0.6);
      if (size < 40) return null;
      const sx = Math.floor((video.videoWidth - size) / 2);
      const sy = Math.floor((video.videoHeight - size) / 2);
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
      return canvas;
    }

    async function openStream(): Promise<MediaStream> {
      const base: MediaTrackConstraints = {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
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

    /** ขอโฟกัสอัตโนมัติต่อเนื่อง ถ้ากล้องรองรับ (เว็บแคมถูก ๆ มักไม่รองรับ) */
    async function tryContinuousFocus(s: MediaStream) {
      try {
        const track = s.getVideoTracks()[0];
        const caps = track.getCapabilities?.() as { focusMode?: string[] } | undefined;
        if (caps?.focusMode?.includes("continuous")) {
          await track.applyConstraints({
            advanced: [{ focusMode: "continuous" }],
          } as unknown as MediaTrackConstraints);
        }
      } catch {
        /* กล้องไม่รองรับก็ปล่อยไป */
      }
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
        await tryContinuousFocus(stream);
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
          let useCrop = false;
          // ใช้ setTimeout ไม่ใช้ requestAnimationFrame เพราะจอลูกค้าเป็นหน้าต่างที่
          // ไม่ได้โฟกัส Chrome จะหน่วง rAF จนแทบไม่ทำงาน
          const tick = async () => {
            if (stopped) return;
            try {
              if (!pausedRef.current && video.readyState >= 2) {
                const source: CanvasImageSource | null = useCrop ? centerCrop(video) : video;
                useCrop = !useCrop;
                if (source) {
                  const codes = await detector.detect(source);
                  if (codes.length) hit(codes[0].rawValue);
                }
              }
            } catch {
              /* เฟรมนี้อ่านไม่ได้ ข้ามไป */
            }
            if (!stopped) timer = setTimeout(tick, SCAN_INTERVAL_MS);
          };
          timer = setTimeout(tick, SCAN_INTERVAL_MS);
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
      if (timer) clearTimeout(timer);
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
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={mirror ? { transform: "scaleX(-1)" } : undefined}
      />
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
