import type { Zone } from "./supabase";
import { formatBaht, formatHours } from "./priceEngine";

const ZONE_LABEL: Record<Zone, string> = {
  sofa: "🛋️ โซฟา",
  racing: "🏎️ รถแข่ง",
  pc: "🖥️ PC",
};

export function zoneLabel(zone: Zone): string {
  return ZONE_LABEL[zone] ?? String(zone);
}

/** เส้นคั่น — ยาวพอดีจอมือถือ ไม่ตกบรรทัด */
export const DIVIDER = "━━━━━━━━━━━━━━";

export function clock(input?: string | number | Date | null): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function stamp(): string {
  return new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Row = [label: string, value: string | null | undefined | false];

/**
 * ประกอบข้อความให้หน้าตาเหมือนกันทุกเหตุการณ์
 *
 * LINE ใช้ฟอนต์ไม่คงความกว้าง การเคาะช่องว่างให้ตรงคอลัมน์จึงไม่มีทางตรง
 * ใช้รูปแบบ "ป้าย : ค่า" บรรทัดต่อบรรทัดแทน อ่านง่ายและไม่เพี้ยนทุกเครื่อง
 */
function compose(title: string, rows: Row[]): string {
  const body = rows
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "")
    .map(([label, v]) => `${label} : ${v}`)
    .join("\n");
  return `${title}\n${DIVIDER}\n${body}`;
}

/** ข้อความบอกวิธีชำระเงินให้อ่านรู้เรื่องในบรรทัดเดียว */
function payText(cash: number, transfer: number, redeemedPoints = false): string {
  if (redeemedPoints) return "🎁 แลกแต้ม (ไม่คิดเงิน)";
  if (cash > 0 && transfer > 0) {
    return `ผสม — เงินสด ${formatBaht(cash)} + โอน ${formatBaht(transfer)} บาท`;
  }
  if (transfer > 0) return `โอน ${formatBaht(transfer)} บาท`;
  if (cash > 0) return `เงินสด ${formatBaht(cash)} บาท`;
  return "ค้างจ่าย";
}

function durationText(zone: Zone, hours?: number, minutes?: number): string {
  if (zone === "pc") {
    const m = minutes ?? 0;
    return m >= 60 ? `${(m / 60).toFixed(1)} ชม. (${m} นาที)` : `${m} นาที`;
  }
  return `${formatHours(hours ?? 0)} ชม.`;
}

function pointsText(points?: number | null, earned?: number): string | null {
  if (points == null) return null;
  return earned && earned > 0 ? `${points} แต้ม (+${earned} จากบิลนี้)` : `${points} แต้ม`;
}

// ================= เปิดเครื่อง =================

export interface StartMsg {
  zone: Zone;
  machineNumber: number;
  customerName: string;
  hours?: number;
  minutes?: number;
  price: number;
  cash: number;
  transfer: number;
  memberName?: string | null;
  memberPoints?: number | null;
  endAt?: string | number | Date | null;
}

export function buildStartMessage(m: StartMsg): string {
  return compose(`🎮 เปิดเครื่อง — ${zoneLabel(m.zone)} เครื่อง ${m.machineNumber}`, [
    ["👤 ลูกค้า", m.customerName || "ไม่ระบุชื่อ"],
    ["💳 รูปแบบชำระ", payText(m.cash, m.transfer)],
    ["⏱️ เวลาเล่น", durationText(m.zone, m.hours, m.minutes)],
    ["🕐 ถึงเวลา", clock(m.endAt)],
    ["🎫 แต้มสะสม", m.memberName ? `${m.memberName} · ${pointsText(m.memberPoints)}` : null],
  ]);
}

// ================= ต่อเวลา =================

export interface ExtendMsg {
  zone: Zone;
  machineNumber: number;
  customerName: string;
  addHours?: number;
  addMinutes?: number;
  price: number;
  cash: number;
  transfer: number;
  totalHours?: number;
}

export function buildExtendMessage(m: ExtendMsg): string {
  return compose(`⏳ ต่อเวลา — ${zoneLabel(m.zone)} เครื่อง ${m.machineNumber}`, [
    ["👤 ลูกค้า", m.customerName || "ไม่ระบุชื่อ"],
    ["💳 รูปแบบชำระ", payText(m.cash, m.transfer)],
    ["➕ ต่อเพิ่ม", durationText(m.zone, m.addHours, m.addMinutes)],
    ["⏱️ เวลาเล่นรวม", m.totalHours != null ? `${formatHours(m.totalHours)} ชม.` : null],
  ]);
}

// ================= ปิดบิล =================

export interface CheckoutMsg {
  zone: Zone;
  machineNumber: number;
  customerName: string;
  hours?: number;
  minutes?: number;
  machinePrice: number;
  foodPrice?: number;
  productPrice?: number;
  pointsDiscount?: number;
  total: number;
  cash: number;
  transfer: number;
  redeemedPoints?: boolean;
  memberName?: string | null;
  pointsEarned?: number;
  pointsBalance?: number | null;
}

export function buildCheckoutMessage(m: CheckoutMsg): string {
  const items: string[] = [`ค่าเครื่อง ${formatBaht(m.machinePrice)}`];
  if ((m.foodPrice ?? 0) > 0) items.push(`อาหาร ${formatBaht(m.foodPrice ?? 0)}`);
  if ((m.productPrice ?? 0) > 0) items.push(`สินค้า ${formatBaht(m.productPrice ?? 0)}`);
  if ((m.pointsDiscount ?? 0) > 0) items.push(`ลดแต้ม -${formatBaht(m.pointsDiscount ?? 0)}`);

  return compose(`🧾 ปิดบิล — ${zoneLabel(m.zone)} เครื่อง ${m.machineNumber}`, [
    ["👤 ลูกค้า", m.customerName || "ไม่ระบุชื่อ"],
    ["💳 รูปแบบชำระ", payText(m.cash, m.transfer, m.redeemedPoints)],
    ["⏱️ เวลาเล่น", durationText(m.zone, m.hours, m.minutes)],
    ["📋 รายการ", items.join(" · ")],
    ["🧮 ยอดบิลนี้", `${formatBaht(m.total)} บาท`],
    [
      "🎫 แต้มสะสม",
      m.memberName ? `${m.memberName} · ${pointsText(m.pointsBalance, m.pointsEarned)}` : null,
    ],
  ]);
}

// ================= ยกเลิกบิล =================

export interface CancelMsg {
  zone: Zone;
  machineNumber: number;
  customerName: string;
  reason?: string;
}

export function buildCancelMessage(m: CancelMsg): string {
  return compose(`❌ ยกเลิกบิล — ${zoneLabel(m.zone)} เครื่อง ${m.machineNumber}`, [
    ["👤 ลูกค้า", m.customerName || "ไม่ระบุชื่อ"],
    ["📝 หมายเหตุ", m.reason ?? "ยอดนี้ไม่ถูกนับเป็นรายได้"],
  ]);
}

// ================= สมาชิกใหม่ =================

export function buildMemberMessage(name: string, phone: string): string {
  return compose("🎫 สมาชิกใหม่", [
    ["👤 ชื่อ", name],
    ["📞 เบอร์โทร", phone],
  ]);
}

export function buildTestMessage(shopName = "YALA PLAYSTATION"): string {
  return compose("✅ ทดสอบการแจ้งเตือน", [
    ["🏪 ร้าน", shopName],
    ["📶 สถานะ", "เชื่อมต่อเรียบร้อย พร้อมใช้งาน"],
  ]);
}
