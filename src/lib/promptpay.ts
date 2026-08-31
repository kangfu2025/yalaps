import QRCode from "qrcode";

export const PROMPTPAY_ID = "0819698842";

// EMVCo / PromptPay payload builder (no Node Buffer dependency)
function f(id: string, value: string): string {
  return id + value.length.toString().padStart(2, "0") + value;
}

function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function formatTarget(target: string): { value: string; isTaxId: boolean } {
  const digits = target.replace(/\D/g, "");
  // Tax ID (นิติบุคคล) = 13 digits ตั้งแต่ต้น
  if (digits.length === 13) return { value: digits, isTaxId: true };
  // เบอร์โทร -> 0066 + ตัด 0 นำหน้า (ผลลัพธ์ 13 หลักแต่ยังคือ phone → tag 01)
  return { value: "0066" + digits.replace(/^0/, ""), isTaxId: false };
}

export function buildPromptpayPayload(amount: number): string {
  const { value, isTaxId } = formatTarget(PROMPTPAY_ID);
  const merchantAccount =
    f("00", "A000000677010111") + f(isTaxId ? "02" : "01", value);
  const payload =
    f("00", "01") +
    f("01", amount > 0 ? "12" : "11") +
    f("29", merchantAccount) +
    f("53", "764") +
    (amount > 0 ? f("54", amount.toFixed(2)) : "") +
    f("58", "TH");
  const toSign = payload + "6304";
  return toSign + crc16(toSign);
}

export async function buildPromptpayDataUrl(amount: number): Promise<string> {
  const payload = buildPromptpayPayload(amount);
  return QRCode.toDataURL(payload, { margin: 1, width: 240 });
}
