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

function clock(input?: string | number | Date | null): string {
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

function stamp(): string {
  return new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** ตัดบรรทัดที่ไม่มีค่าออก จะได้ไม่มีบรรทัดว่างเปล่าใน LINE */
function lines(...rows: (string | null | undefined | false)[]): string {
  return rows.filter(Boolean).join("\n");
}

function payLabel(cash: number, transfer: number): string {
  if (cash > 0 && transfer > 0) {
    return `💵 เงินสด ${formatBaht(cash)} · 📱 โอน ${formatBaht(transfer)}`;
  }
  if (transfer > 0) return `📱 โอน ${formatBaht(transfer)} บาท`;
  if (cash > 0) return `💵 เงินสด ${formatBaht(cash)} บาท`;
  return "📝 ค้างจ่าย";
}

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
  const duration =
    m.zone === "pc" ? `⏱️ ${m.minutes ?? 0} นาที` : `⏱️ ${formatHours(m.hours ?? 0)} ชม.`;
  return lines(
    "🎮 เปิดเครื่อง",
    `${zoneLabel(m.zone)} เครื่อง ${m.machineNumber}`,
    `👤 ${m.customerName || "ไม่ระบุชื่อ"}`,
    `${duration}  (${clock(new Date())} - ${clock(m.endAt)})`,
    `💰 ${formatBaht(m.price)} บาท`,
    payLabel(m.cash, m.transfer),
    m.memberName
      ? `🎫 สมาชิก ${m.memberName}${m.memberPoints != null ? ` · ${m.memberPoints} แต้ม` : ""}`
      : null,
    `🕒 ${stamp()}`,
  );
}

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
  const added =
    m.zone === "pc"
      ? `➕ ต่อเวลา ${m.addMinutes ?? 0} นาที`
      : `➕ ต่อเวลา ${formatHours(m.addHours ?? 0)} ชม.`;
  return lines(
    "⏳ ต่อเวลา",
    `${zoneLabel(m.zone)} เครื่อง ${m.machineNumber}`,
    `👤 ${m.customerName || "ไม่ระบุชื่อ"}`,
    added,
    m.totalHours != null ? `⏱️ รวมเป็น ${formatHours(m.totalHours)} ชม.` : null,
    `💰 ${formatBaht(m.price)} บาท`,
    payLabel(m.cash, m.transfer),
    `🕒 ${stamp()}`,
  );
}

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
  const duration =
    m.zone === "pc" ? `⏱️ ${m.minutes ?? 0} นาที` : `⏱️ รวม ${formatHours(m.hours ?? 0)} ชม.`;
  const parts: string[] = [`ค่าเครื่อง ${formatBaht(m.machinePrice)}`];
  if ((m.foodPrice ?? 0) > 0) parts.push(`อาหาร ${formatBaht(m.foodPrice ?? 0)}`);
  if ((m.productPrice ?? 0) > 0) parts.push(`สินค้า ${formatBaht(m.productPrice ?? 0)}`);
  if ((m.pointsDiscount ?? 0) > 0) parts.push(`ส่วนลดแต้ม -${formatBaht(m.pointsDiscount ?? 0)}`);

  return lines(
    "🧾 ปิดบิล",
    `${zoneLabel(m.zone)} เครื่อง ${m.machineNumber}`,
    `👤 ${m.customerName || "ไม่ระบุชื่อ"}`,
    duration,
    `📋 ${parts.join(" · ")}`,
    `💰 รวมสุทธิ ${formatBaht(m.total)} บาท`,
    m.redeemedPoints ? "🎁 ชำระด้วยการแลกแต้ม" : payLabel(m.cash, m.transfer),
    m.memberName
      ? `🎫 ${m.memberName}${(m.pointsEarned ?? 0) > 0 ? ` · ได้ ${m.pointsEarned} แต้ม` : ""}${m.pointsBalance != null ? ` (รวม ${m.pointsBalance})` : ""}`
      : null,
    `🕒 ${stamp()}`,
  );
}

export interface CancelMsg {
  zone: Zone;
  machineNumber: number;
  customerName: string;
  reason?: string;
}

export function buildCancelMessage(m: CancelMsg): string {
  return lines(
    "❌ ยกเลิกบิล",
    `${zoneLabel(m.zone)} เครื่อง ${m.machineNumber}`,
    `👤 ${m.customerName || "ไม่ระบุชื่อ"}`,
    m.reason ? `📝 ${m.reason}` : null,
    "⚠️ ยอดนี้ไม่ถูกนับเป็นรายได้",
    `🕒 ${stamp()}`,
  );
}

export function buildMemberMessage(name: string, phone: string): string {
  return lines("🎫 สมาชิกใหม่", `👤 ${name}`, `📞 ${phone}`, `🕒 ${stamp()}`);
}

export function buildTestMessage(shopName = "YALA PLAYSTATION"): string {
  return lines(
    "✅ ทดสอบการแจ้งเตือน",
    `ร้าน ${shopName}`,
    "ถ้าเห็นข้อความนี้แปลว่าตั้งค่าถูกต้องแล้ว",
    `🕒 ${stamp()}`,
  );
}
