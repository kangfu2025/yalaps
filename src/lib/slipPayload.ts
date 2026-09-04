/**
 * แยกแยะว่า QR ที่สแกนมาเป็น "อะไร" ก่อนส่งไปตรวจกับ EasySlip
 *
 * ทำไมต้องมี: แพ็กที่ร้านใช้มีโควตาจำกัด (250 สลิป/เดือน) การส่ง payload ที่ผิด
 * แล้วปล่อยให้ EasySlip ตีกลับเป็น VALIDATION_ERROR คือเสียโควตาฟรี ๆ
 * และพนักงานก็ไม่รู้ว่าผิดตรงไหน
 *
 * โครงสร้าง QR ตรวจสลิปจริง (Slip Verify Mini QR) จากสลิปกสิกร ยาว 59 ตัว:
 *
 *   0041 <ค่า 41 ตัว>   tag 00 — ห่อข้อมูลทั้งหมดไว้ข้างใน
 *        0006 000001       00 = เวอร์ชันสเปค
 *        0103 004          01 = รหัสธนาคารผู้โอน (004 = กสิกรไทย)
 *        0220 <20 ตัว>     02 = เลขอ้างอิงรายการ
 *   5102 TH              tag 51 — ประเทศ
 *   9104 <CRC>           tag 91 — เลขตรวจสอบ (คนละ tag กับ QR จ่ายเงินที่ใช้ 63)
 *
 * ต่างจาก QR รับเงิน (EMVCo/PromptPay) ที่ขึ้นต้น 000201 และปิดท้ายด้วย tag 63
 */

export type SlipPayloadKind =
  "slip_qr" | "payment_qr" | "url" | "thai_keyboard" | "too_short" | "unknown";

export interface SlipPayloadCheck {
  kind: SlipPayloadKind;
  /** ส่งต่อไปให้ EasySlip ตรวจได้ไหม */
  sendable: boolean;
  /** ข้อความที่ควรส่งไปจริง (ตัดส่วนที่ซ้ำออกแล้ว) */
  normalized: string;
  /** ชื่อเรียกสั้น ๆ ของสิ่งที่สแกนมา ไว้โชว์ให้พนักงานเห็น */
  label: string;
  /** เกิดอะไรขึ้น + ต้องทำยังไงต่อ (ภาษาไทย) */
  reason?: string;
  code?: string;
  /** เครื่องอ่านยิงซ้ำกี่รอบแล้วข้อความมาต่อกัน (1 = ปกติ) */
  repeated?: number;
  /** ข้อมูลที่แกะได้ ไว้ช่วยยืนยันว่าอ่านถูกอัน */
  transRef?: string;
  sendingBank?: string;
  amount?: number;
  merchant?: string;
  crcOk?: boolean;
}

/** แกะ TLV แบบ EMVCo: tag 2 หลัก + ความยาว 2 หลัก + ค่า */
function parseTlv(s: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const lenStr = s.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenStr)) return null;
    const len = parseInt(lenStr, 10);
    const val = s.slice(i + 4, i + 4 + len);
    if (val.length !== len) return null;
    out[tag] = val;
    i += 4 + len;
  }
  // เหลือเศษ = โครงสร้างไม่ครบ อ่านมาไม่หมดหรือเป็นคนละรูปแบบ
  return i === s.length ? out : null;
}

/** CRC-16/CCITT-FALSE ตามสเปค EMVCo */
function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * ตรวจเลข CRC ท้าย QR — ไม่ตรง = อ่านมาเพี้ยนหรือไม่ครบ
 * QR ตรวจสลิปใช้ tag 91 ส่วน QR จ่ายเงินใช้ tag 63
 */
function checkCrc(s: string): boolean | undefined {
  for (const tag of ["9104", "6304"]) {
    const at = s.lastIndexOf(tag);
    if (at >= 0 && at + 8 === s.length) {
      return crc16(s.slice(0, at + 4)) === s.slice(at + 4).toUpperCase();
    }
  }
  return undefined;
}

/**
 * เครื่องอ่านบาร์โค้ดบางรุ่นยิงโค้ดเดิมซ้ำติด ๆ กัน (โหมดยิงต่อเนื่อง
 * หรือพนักงานกดปุ่มค้าง) ข้อความสองรอบจึงมาต่อกันเป็นชุดเดียว
 * เช่นสลิป 59 ตัวกลายเป็น 118 ตัว — ตัดให้เหลือรอบเดียว
 */
export function dedupeRepeated(s: string): { text: string; repeated: number } {
  for (let k = 4; k >= 2; k--) {
    if (s.length % k !== 0) continue;
    const unit = s.length / k;
    const head = s.slice(0, unit);
    let same = true;
    for (let i = 1; i < k; i++) {
      if (s.slice(i * unit, (i + 1) * unit) !== head) {
        same = false;
        break;
      }
    }
    if (same && unit >= 20) return { text: head, repeated: k };
  }
  return { text: s, repeated: 1 };
}

export function classifySlipPayload(raw: string): SlipPayloadCheck {
  const trimmed = (raw ?? "").trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return {
      kind: "url",
      sendable: false,
      normalized: trimmed,
      code: "PAYLOAD_IS_URL",
      label: "ลิงก์เว็บ",
      reason:
        "QR ที่ยิงเป็นลิงก์เว็บ ไม่ใช่ QR ตรวจสอบสลิป — สลิปบางแอปมี QR หลายอัน ให้ยิงอันเล็กที่เขียนว่า “ตรวจสอบสลิป”",
    };
  }

  if (/[฀-๿]/.test(trimmed)) {
    return {
      kind: "thai_keyboard",
      sendable: false,
      normalized: trimmed,
      code: "THAI_KEYBOARD",
      label: "ตัวอักษรไทย",
      reason:
        "ข้อความที่อ่านได้เป็นภาษาไทย แปลว่าแป้นพิมพ์ของเครื่องตั้งเป็นภาษาไทยตอนยิง — กด Windows+Space สลับเป็น EN แล้วยิงใหม่",
    };
  }

  // ตัดส่วนที่ยิงซ้ำออกก่อนตัดสินใจอย่างอื่น
  const { text: p, repeated } = dedupeRepeated(trimmed);

  if (p.length < 20) {
    return {
      kind: "too_short",
      sendable: false,
      normalized: p,
      code: "PAYLOAD_TOO_SHORT",
      label: `สั้นผิดปกติ (${p.length} ตัว)`,
      reason: `ข้อความจากสลิปสั้นผิดปกติ (${p.length} ตัวอักษร) อาจอ่านได้ไม่ครบ ลองยิงใหม่`,
      repeated,
    };
  }

  const crcOk = checkCrc(p);
  const root = parseTlv(p);

  // ---- QR รับเงิน (EMVCo/PromptPay) ----
  // tag 00 = "01" คือ Payload Format Indicator ของ QR จ่ายเงิน
  const merchantAcct = root ? (root["29"] ?? root["30"] ?? "") : "";
  const looksPayment =
    !!root &&
    root["00"] === "01" &&
    (root["58"] === "TH" || !!root["53"] || merchantAcct.includes("A00000067701"));

  if (looksPayment && root) {
    const amt = root["54"] ? Number(root["54"]) : undefined;
    return {
      kind: "payment_qr",
      sendable: false,
      normalized: p,
      code: "PAYMENT_QR_NOT_SLIP",
      label: "QR รับเงิน (PromptPay)",
      reason:
        "อันนี้คือ QR สำหรับ “จ่ายเงิน” ไม่ใช่ QR บนสลิปที่เอาไว้ตรวจสอบ — ให้ลูกค้าเปิดสลิปที่โอนเสร็จแล้ว แล้วยิง QR เล็กบนสลิปแทน (ปกติอยู่มุมล่างของสลิป ใต้คำว่าตรวจสอบสลิป)",
      amount: Number.isFinite(amt) ? amt : undefined,
      merchant: root["59"] || undefined,
      repeated,
      crcOk,
    };
  }

  // ---- QR ตรวจสลิป (Slip Verify Mini QR) ----
  if (root && root["00"] && root["00"].length > 6) {
    const inner = parseTlv(root["00"]);
    if (inner && (inner["01"] || inner["02"])) {
      return {
        kind: "slip_qr",
        sendable: true,
        normalized: p,
        label: "QR ตรวจสลิป",
        sendingBank: inner["01"] || undefined,
        transRef: inner["02"] || undefined,
        repeated,
        crcOk,
      };
    }
  }

  // อ่านไม่ออกว่าเป็นอะไร — ยังส่งไปให้ EasySlip ตัดสิน
  // ดีกว่าบล็อกสลิปจริงเพราะเดาผิด (ธนาคาร/วอลเล็ตบางเจ้าใช้รูปแบบเฉพาะ)
  return {
    kind: "unknown",
    sendable: true,
    normalized: p,
    label: "รูปแบบที่ยังไม่รู้จัก",
    repeated,
    crcOk,
  };
}

/**
 * ข้อความที่อ่านมา "ครบทั้งชุดแล้ว" หรือยัง
 *
 * ใช้กับเครื่องอ่านบาร์โค้ด: พอเห็นว่าครบให้ส่งทันที ไม่ต้องรอจังหวะเงียบ
 * เพราะการรอคือช่องให้การยิงรอบที่สองไหลมาต่อท้ายจนกลายเป็นข้อความซ้ำ
 * เช็ค CRC ด้วยจึงมั่นใจได้ว่าครบจริง ไม่ใช่แค่บังเอิญแกะ TLV ผ่าน
 */
export function isCompleteSlipPayload(s: string): boolean {
  const t = (s ?? "").trim();
  if (t.length < 20) return false;
  const c = classifySlipPayload(t);
  return c.kind === "slip_qr" && c.crcOk === true;
}
