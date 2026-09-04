import { useEffect, useRef } from "react";

/** ตัวอักษรที่ปุ่มแต่ละตัวควรพิมพ์ออกมาเมื่อเป็นแป้นภาษาอังกฤษ */
const CODE_MAP: Record<string, [string, string]> = {
  // [ไม่กด Shift, กด Shift]
  Digit0: ["0", ")"],
  Digit1: ["1", "!"],
  Digit2: ["2", "@"],
  Digit3: ["3", "#"],
  Digit4: ["4", "$"],
  Digit5: ["5", "%"],
  Digit6: ["6", "^"],
  Digit7: ["7", "&"],
  Digit8: ["8", "*"],
  Digit9: ["9", "("],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
  Backquote: ["`", "~"],
  Space: [" ", " "],
  NumpadAdd: ["+", "+"],
  NumpadSubtract: ["-", "-"],
  NumpadMultiply: ["*", "*"],
  NumpadDivide: ["/", "/"],
  NumpadDecimal: [".", "."],
};

/**
 * แปลงปุ่มที่กดให้เป็นตัวอักษรภาษาอังกฤษเสมอ
 *
 * สำคัญมากสำหรับเครื่องที่ตั้งแป้นพิมพ์เป็นภาษาไทยค้างไว้:
 * เครื่องสแกนส่งรหัสปุ่มเหมือนคีย์บอร์ด ถ้าแป้นเป็นไทย e.key จะกลายเป็น
 * "ฟ" แทน "a" ทำให้ payload เพี้ยนทั้งชุด — จึงอ่านจาก e.code แทนเมื่อ
 * e.key ไม่ใช่ ASCII และไม่สนใจ CapsLock ด้วย (ใช้ shiftKey ตัดสินอย่างเดียว)
 */
function keyToAscii(e: KeyboardEvent): string | null {
  // ตัวอักษร A-Z
  if (/^Key[A-Z]$/.test(e.code)) {
    const letter = e.code.slice(3);
    return e.shiftKey ? letter : letter.toLowerCase();
  }
  if (/^Numpad[0-9]$/.test(e.code)) return e.code.slice(6);

  const pair = CODE_MAP[e.code];
  if (pair) return e.shiftKey ? pair[1] : pair[0];

  // ปุ่มที่ไม่รู้จัก: ยอมรับเฉพาะตอนที่ e.key เป็น ASCII อยู่แล้ว
  if (e.key.length === 1 && e.key.charCodeAt(0) >= 32 && e.key.charCodeAt(0) < 127) {
    return e.key;
  }
  return null;
}

/**
 * รับข้อมูลจากเครื่องสแกนบาร์โค้ดแบบ USB (HID keyboard wedge)
 *
 * เครื่องสแกนทำตัวเหมือนคีย์บอร์ด: อ่านโค้ดได้แล้ว "พิมพ์" ตัวอักษรรัว ๆ
 * ตามด้วย Enter เราจึงแยกจากการพิมพ์มือด้วยความเร็วระหว่างตัวอักษร
 *
 * QR บนสลิปยาว 100+ ตัวอักษร ถ้าตั้งช่องว่างระหว่างตัวอักษรแคบเกินไป
 * แค่เครื่องสะดุดเสี้ยววินาทีเดียวก็ตัดสายกลางคัน แล้วส่งไปแค่ท่อนท้าย
 * ซึ่งปลายทางจะตอบว่า "รูปแบบไม่ถูกต้อง" — จึงตั้งไว้กว้างหน่อย
 */
export function useBarcodeGun(
  onScan: (code: string) => void,
  opts: {
    enabled?: boolean;
    minLength?: number;
    /** ช่องว่างสูงสุดระหว่างตัวอักษรที่ยังนับว่าเป็นชุดเดียวกัน */
    maxGapMs?: number;
    /** เครื่องสแกนบางรุ่นไม่ส่ง Enter ปิดท้าย — ถ้าเงียบเกินนี้ให้ถือว่าจบ */
    idleFlushMs?: number;
    /**
     * บอกว่าข้อความที่สะสมมาครบทั้งชุดแล้ว — ครบเมื่อไหร่ยิงทันที
     *
     * จำเป็นมาก เพราะเครื่องอ่านหลายรุ่นยิงโค้ดเดิมซ้ำรอบสองห่างกันไม่ถึง
     * ครึ่งวินาที ถ้ามัวรอจังหวะเงียบ ข้อความรอบสองจะไหลมาต่อท้ายจนกลายเป็น
     * ชุดซ้ำสองเท่า (สลิป 59 ตัว -> 118 ตัว) แล้วปลายทางตีกลับว่าผิดรูปแบบ
     */
    looksComplete?: (buf: string) => boolean;
  } = {},
) {
  const { enabled = true, minLength = 15, maxGapMs = 400, idleFlushMs = 350 } = opts;
  const bufRef = useRef("");
  const lastRef = useRef(0);
  const cbRef = useRef(onScan);
  const completeRef = useRef(opts.looksComplete);
  const flushRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    cbRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    completeRef.current = opts.looksComplete;
  }, [opts.looksComplete]);

  useEffect(() => {
    if (!enabled) return;

    function fire() {
      const code = bufRef.current.trim();
      bufRef.current = "";
      if (code.length >= minLength) cbRef.current(code);
    }

    function onKeyDown(e: KeyboardEvent) {
      // ปุ่มค้าง (Shift/Ctrl/Alt) ไม่ใช่ตัวอักษรและไม่ควรรีเซ็ตจังหวะ
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;

      const now = Date.now();
      if (now - lastRef.current > maxGapMs) bufRef.current = "";
      lastRef.current = now;

      if (flushRef.current) clearTimeout(flushRef.current);

      if (e.key === "Enter" || e.key === "Tab") {
        if (bufRef.current.length >= minLength) e.preventDefault();
        fire();
        return;
      }

      const ch = keyToAscii(e);
      if (ch === null) return;
      bufRef.current += ch;

      // ครบทั้งชุดแล้วยิงเลย ไม่รอ Enter ไม่รอจังหวะเงียบ
      // กันข้อความจากการยิงรอบถัดไปไหลมาต่อท้าย
      if (bufRef.current.length >= minLength && completeRef.current?.(bufRef.current)) {
        fire();
        return;
      }

      // กันเครื่องที่ไม่ส่ง Enter: เงียบครบเวลาแล้วยิงเลย
      flushRef.current = setTimeout(fire, idleFlushMs);
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (flushRef.current) clearTimeout(flushRef.current);
    };
  }, [enabled, minLength, maxGapMs, idleFlushMs]);
}
