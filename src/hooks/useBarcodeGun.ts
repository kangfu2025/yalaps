import { useEffect, useRef } from "react";

/**
 * รับข้อมูลจากเครื่องสแกนบาร์โค้ดแบบ USB (HID keyboard wedge)
 *
 * เครื่องสแกนพวกนี้ทำตัวเหมือนคีย์บอร์ด: อ่านโค้ดได้แล้วก็ "พิมพ์" ตัวอักษร
 * รัว ๆ ตามด้วย Enter เราจึงแยกจากการพิมพ์มือด้วยความเร็วระหว่างตัวอักษร
 *
 * รองรับเฉพาะหัวอ่านแบบ 2D (area imager) เท่านั้น หัวอ่านเลเซอร์ 1D
 * อ่าน QR ไม่ได้ตั้งแต่ต้น
 */
export function useBarcodeGun(
  onScan: (code: string) => void,
  opts: { enabled?: boolean; minLength?: number; maxGapMs?: number } = {},
) {
  const { enabled = true, minLength = 15, maxGapMs = 100 } = opts;
  const bufRef = useRef("");
  const lastRef = useRef(0);
  const cbRef = useRef(onScan);

  useEffect(() => {
    cbRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      const now = Date.now();
      // ห่างจากตัวก่อนหน้านานเกิน = เริ่มชุดใหม่ (กันคนพิมพ์มือปนเข้ามา)
      if (now - lastRef.current > maxGapMs) bufRef.current = "";
      lastRef.current = now;

      if (e.key === "Enter") {
        const code = bufRef.current;
        bufRef.current = "";
        if (code.length >= minLength) {
          e.preventDefault();
          cbRef.current(code);
        }
        return;
      }

      // เอาเฉพาะตัวอักษรเดี่ยว ๆ (ข้าม Shift, Tab, ลูกศร ฯลฯ)
      if (e.key.length === 1) bufRef.current += e.key;
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, minLength, maxGapMs]);
}
