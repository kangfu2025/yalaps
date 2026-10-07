import { supabase } from "./supabase";

/**
 * บัญชีรายรับ-รายจ่าย และกำไรสุทธิรายเดือน
 *
 * กติกาสำคัญ: "กำไรสุทธิ" คำนวณที่เดียวคือฟังก์ชัน finance_month_summary
 * ในฐานข้อมูล ไฟล์นี้ไม่คำนวณยอดรวมเองเลย เพราะถ้ามีสูตรสองที่
 * วันหนึ่งมันจะให้ตัวเลขไม่ตรงกันแน่นอน
 *
 * ฝั่งนี้ทำแค่ CRUD รายการ กับแปลงรูปแบบเดือนให้อ่านง่าย
 */

// ================= หมวดหมู่ =================

export const EXPENSE_CATEGORIES = [
  "rent_shop",
  "electricity",
  "internet",
  "ps_plus",
  "wage",
  "buy_game",
  "buy_stock",
  "repair",
  "marketing",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  rent_shop: "ค่าเช่าร้าน",
  electricity: "ค่าไฟ",
  internet: "Internet",
  ps_plus: "PS Plus",
  wage: "ค่าแรงพนักงาน",
  buy_game: "ซื้อเกม",
  buy_stock: "ซื้อสินค้า",
  repair: "ซ่อม/อุปกรณ์",
  marketing: "การตลาด",
  other: "อื่น ๆ",
};

export const CATEGORY_ICON: Record<ExpenseCategory, string> = {
  rent_shop: "🏠",
  electricity: "💡",
  internet: "🌐",
  ps_plus: "🎮",
  wage: "👤",
  buy_game: "💿",
  buy_stock: "📦",
  repair: "🔧",
  marketing: "📣",
  other: "🧾",
};

export type PayMethod = "cash" | "transfer";
export type RecordStatus = "active" | "void";

export const PAY_LABEL: Record<PayMethod, string> = {
  cash: "เงินสด",
  transfer: "เงินโอน",
};

// ================= ชนิดข้อมูล =================

export interface Expense {
  id: string;
  occurred_at: string;
  occurred_date: string;
  period_month: string;
  category: ExpenseCategory;
  amount: number;
  pay_method: PayMethod;
  staff_name: string | null;
  note: string | null;
  /** จ่ายจากเงินในลิ้นชัก (มีเมื่อรัน shop_shift_migration.sql แล้ว) */
  from_drawer?: boolean;
  status: RecordStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type OtherIncomeKind = "room_rent" | "other";

export interface OtherIncome {
  id: string;
  kind: OtherIncomeKind;
  amount: number;
  period_month: string;
  pay_method: PayMethod;
  note: string | null;
  to_drawer?: boolean;
  status: RecordStatus;
  received_at: string;
  created_at: string;
  updated_at: string;
}

export const INCOME_KIND_LABEL: Record<OtherIncomeKind, string> = {
  room_rent: "ค่าเช่าห้อง",
  other: "รายรับอื่น",
};

export interface MonthSummary {
  month: string;
  income: {
    sofa: number;
    racing: number;
    pc: number;
    pos: number;
    zone_other: number;
    other_total: number;
    other_rows: { kind: OtherIncomeKind; amount: number; count: number }[];
    cash: number;
    transfer: number;
    total: number;
  };
  expense: {
    by_category: { category: ExpenseCategory; amount: number; count: number }[];
    cash: number;
    transfer: number;
    total: number;
  };
  net_profit: number;
  info: {
    open_bills_advance: number;
    open_bills_count: number;
  };
}

export interface YearRow {
  month: string;
  income: number;
  expense: number;
  net_profit: number;
}

/** ยังไม่ได้รัน finance_migration.sql */
export class FinanceNotReady extends Error {
  constructor() {
    super("ยังไม่ได้ติดตั้งระบบบัญชี");
    this.name = "FinanceNotReady";
  }
}

function throwIfMissing(e: unknown): never {
  const code = (e as { code?: string } | null)?.code ?? "";
  const msg = e instanceof Error ? e.message : String(e);
  if (
    code === "PGRST202" ||
    code === "PGRST205" ||
    code === "42P01" ||
    code === "42883" ||
    /Could not find the (table|function)/i.test(msg)
  ) {
    throw new FinanceNotReady();
  }
  throw e instanceof Error ? e : new Error(msg);
}

// ================= เดือน =================

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const THAI_MONTHS_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

/** เดือนปัจจุบันตามเวลาไทย รูปแบบ YYYY-MM */
export function currentMonthKey(): string {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  // en-CA ให้ "2026-09" อยู่แล้ว แต่บาง engine เติมวันมาด้วย จึงตัดให้ชัวร์
  return s.slice(0, 7);
}

/** วันที่+เวลาปัจจุบันตามเวลาไทย ในรูปแบบที่ใส่ใน <input type="datetime-local"> ได้ */
export function nowLocalInput(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** แปลงค่าจาก <input type="datetime-local"> เป็นเวลาไทยจริง ๆ */
export function localInputToIso(v: string): string {
  return new Date(`${v}:00+07:00`).toISOString();
}

/** แปลง timestamptz เป็นค่าที่ใส่กลับใน <input type="datetime-local"> ได้ */
export function isoToLocalInput(iso: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const i = Number(m) - 1;
  return `${THAI_MONTHS[i] ?? m} ${y}`;
}

export function monthLabelShort(key: string): string {
  const [y, m] = key.split("-");
  const i = Number(m) - 1;
  return `${THAI_MONTHS_SHORT[i] ?? m} ${y}`;
}

/** วันที่เท่าไหร่แล้ววันนี้ ตามเวลาไทย */
function todayBangkokDay(): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", day: "2-digit" }).format(
      new Date(),
    ),
  );
}

/**
 * ช่วงวันที่ที่ยอดของเดือนนั้นครอบคลุมอยู่จริง
 *
 * เดือนปัจจุบันข้อมูลมีถึงแค่วันนี้ จึงบอกว่า "1 ก.ย. – 23 ก.ย. 2026"
 * ส่วนเดือนที่ผ่านไปแล้วบอกเต็มเดือน — กันเข้าใจผิดว่ายอดเดือนนี้คือทั้งเดือนแล้ว
 */
export function monthRangeLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const mn = THAI_MONTHS_SHORT[m - 1] ?? String(m);
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = key === currentMonthKey() ? todayBangkokDay() : lastOfMonth;
  return `1 ${mn} – ${last} ${mn} ${y}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthYear(key: string): number {
  return Number(key.slice(0, 4));
}

/** เวลาแบบไทยสั้น ๆ สำหรับตาราง เช่น "22/09/2026 14:35" */
export function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(new Date(iso));
}

// ================= สรุปยอด =================

export async function getMonthSummary(month: string): Promise<MonthSummary> {
  const { data, error } = await supabase.rpc("finance_month_summary", { p_month: month });
  if (error) throwIfMissing(error);
  return data as MonthSummary;
}

export async function getYearSummary(year: number): Promise<YearRow[]> {
  const { data, error } = await supabase.rpc("finance_year_summary", { p_year: year });
  if (error) throwIfMissing(error);
  return (data ?? []) as YearRow[];
}

// ================= รายจ่าย =================

export interface ExpenseFilter {
  month: string;
  category?: ExpenseCategory | "all";
  includeVoid?: boolean;
}

export async function listExpenses(f: ExpenseFilter): Promise<Expense[]> {
  let q = supabase
    .from("expenses")
    .select("*")
    .eq("period_month", f.month)
    .order("occurred_at", { ascending: false });
  if (!f.includeVoid) q = q.eq("status", "active");
  if (f.category && f.category !== "all") q = q.eq("category", f.category);
  const { data, error } = await q;
  if (error) throwIfMissing(error);
  return (data ?? []) as Expense[];
}

export interface ExpenseInput {
  category: ExpenseCategory;
  amount: number;
  payMethod: PayMethod;
  /** ค่าจาก <input type="datetime-local"> — ไม่ใส่ = ใช้เวลาปัจจุบัน */
  occurredLocal?: string;
  staffName?: string | null;
  note?: string | null;
  /**
   * เงินสดก้อนนี้หยิบจากลิ้นชักร้านหรือเปล่า (ระบบเปิด-ปิดร้าน)
   * ไม่ส่งมา = ไม่แตะคอลัมน์นี้ ร้านที่ยังไม่ได้รัน shop_shift_migration.sql จึงใช้ได้ตามเดิม
   * ธงนี้มีผลกับยอดลิ้นชักเท่านั้น ไม่มีผลต่อรายจ่ายหรือกำไรสุทธิ
   */
  fromDrawer?: boolean;
}

function validateExpense(input: ExpenseInput) {
  if (!(Number(input.amount) > 0)) throw new Error("จำนวนเงินต้องมากกว่า 0");
  if (input.category === "wage" && !input.staffName?.trim()) {
    throw new Error("ค่าแรงพนักงานต้องระบุชื่อพนักงาน");
  }
}

/** จ่ายจากลิ้นชักได้เฉพาะเงินสด — เงินโอนไม่เคยผ่านลิ้นชัก */
function drawerFlag(input: ExpenseInput): { from_drawer?: boolean } {
  if (input.fromDrawer === undefined) return {};
  return { from_drawer: input.payMethod === "cash" && input.fromDrawer };
}

export async function addExpense(input: ExpenseInput): Promise<Expense> {
  validateExpense(input);
  const { data: sess } = await supabase.auth.getUser();
  const row = {
    category: input.category,
    amount: Number(input.amount),
    pay_method: input.payMethod,
    occurred_at: input.occurredLocal
      ? localInputToIso(input.occurredLocal)
      : new Date().toISOString(),
    staff_name: input.category === "wage" ? (input.staffName?.trim() ?? null) : null,
    note: input.note?.trim() || null,
    created_by: sess.user?.id ?? null,
    ...drawerFlag(input),
  };
  const { data, error } = await supabase.from("expenses").insert(row).select().single();
  if (error) throwIfMissing(error);
  return data as Expense;
}

export async function updateExpense(id: string, input: ExpenseInput): Promise<Expense> {
  validateExpense(input);
  const patch = {
    category: input.category,
    amount: Number(input.amount),
    pay_method: input.payMethod,
    ...(input.occurredLocal ? { occurred_at: localInputToIso(input.occurredLocal) } : {}),
    staff_name: input.category === "wage" ? (input.staffName?.trim() ?? null) : null,
    note: input.note?.trim() || null,
    ...drawerFlag(input),
  };
  const { data, error } = await supabase
    .from("expenses")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throwIfMissing(error);
  return data as Expense;
}

/**
 * ยกเลิกรายการ — ไม่ลบจริง
 *
 * ฐานข้อมูลไม่ให้สิทธิ์ delete กับใครเลย รายการที่ยกเลิกยังอยู่ครบ
 * และถูกบันทึกใน finance_audit ว่าใครยกเลิกเมื่อไหร่
 */
export async function voidExpense(id: string): Promise<void> {
  const { error } = await supabase.from("expenses").update({ status: "void" }).eq("id", id);
  if (error) throwIfMissing(error);
}

export async function restoreExpense(id: string): Promise<void> {
  const { error } = await supabase.from("expenses").update({ status: "active" }).eq("id", id);
  if (error) throwIfMissing(error);
}

// ================= รายรับอื่น (ค่าเช่าห้อง) =================

export async function listOtherIncomes(month: string, includeVoid = false): Promise<OtherIncome[]> {
  let q = supabase
    .from("other_incomes")
    .select("*")
    .eq("period_month", month)
    .order("received_at", { ascending: false });
  if (!includeVoid) q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) throwIfMissing(error);
  return (data ?? []) as OtherIncome[];
}

export interface OtherIncomeInput {
  kind?: OtherIncomeKind;
  amount: number;
  /** เดือนที่รับ YYYY-MM — ผู้ใช้เลือกเอง ไม่ได้มาจากเวลาที่กดบันทึก */
  month: string;
  payMethod: PayMethod;
  note?: string | null;
  /** เงินสดก้อนนี้เก็บเข้าลิ้นชักร้านหรือเปล่า — ไม่ส่งมา = ไม่แตะคอลัมน์นี้ */
  toDrawer?: boolean;
}

export async function addOtherIncome(input: OtherIncomeInput): Promise<OtherIncome> {
  if (!(Number(input.amount) > 0)) throw new Error("จำนวนเงินต้องมากกว่า 0");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new Error("เดือนไม่ถูกต้อง");
  const { data: sess } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("other_incomes")
    .insert({
      kind: input.kind ?? "room_rent",
      amount: Number(input.amount),
      period_month: input.month,
      pay_method: input.payMethod,
      note: input.note?.trim() || null,
      created_by: sess.user?.id ?? null,
      ...(input.toDrawer === undefined
        ? {}
        : { to_drawer: input.payMethod === "cash" && input.toDrawer }),
    })
    .select()
    .single();
  if (error) throwIfMissing(error);
  return data as OtherIncome;
}

export async function voidOtherIncome(id: string): Promise<void> {
  const { error } = await supabase.from("other_incomes").update({ status: "void" }).eq("id", id);
  if (error) throwIfMissing(error);
}

// ================= ค่าแรงพนักงาน =================

export interface WageRow {
  staff: string;
  total: number;
  count: number;
  items: Expense[];
}

/**
 * ค่าแรงของเดือนนั้น จัดกลุ่มตามชื่อพนักงาน
 *
 * ไม่มีตารางค่าแรงแยกต่างหาก — ใช้รายจ่ายหมวด wage ตรง ๆ
 * เงินหนึ่งก้อนจึงเป็นรายจ่ายหนึ่งแถวเสมอ ไม่มีทางถูกนับสองครั้ง
 */
export async function listWagesByStaff(month: string): Promise<WageRow[]> {
  const rows = await listExpenses({ month, category: "wage" });
  const map = new Map<string, WageRow>();
  for (const r of rows) {
    const key = r.staff_name?.trim() || "ไม่ระบุชื่อ";
    const cur = map.get(key) ?? { staff: key, total: 0, count: 0, items: [] };
    cur.total += Number(r.amount);
    cur.count += 1;
    cur.items.push(r);
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

/** ชื่อพนักงานที่เคยจ่ายมาแล้ว — ใช้เป็นตัวช่วยกรอกให้พิมพ์ชื่อตรงกันทุกครั้ง */
export async function listStaffNames(limitMonths = 6): Promise<string[]> {
  const months: string[] = [];
  let k = currentMonthKey();
  for (let i = 0; i < limitMonths; i++) {
    months.push(k);
    k = shiftMonth(k, -1);
  }
  const { data, error } = await supabase
    .from("expenses")
    .select("staff_name")
    .eq("category", "wage")
    .eq("status", "active")
    .in("period_month", months);
  if (error) throwIfMissing(error);
  const set = new Set<string>();
  for (const r of (data ?? []) as { staff_name: string | null }[]) {
    const n = r.staff_name?.trim();
    if (n) set.add(n);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "th"));
}

// ================= ประวัติการแก้ไข =================

export interface AuditRow {
  id: number;
  table_name: string;
  row_id: string;
  action: "insert" | "update" | "void" | "restore";
  actor: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}

export async function listAudit(rowId: string): Promise<AuditRow[]> {
  const { data, error } = await supabase
    .from("finance_audit")
    .select("*")
    .eq("row_id", rowId)
    .order("at", { ascending: false });
  if (error) throwIfMissing(error);
  return (data ?? []) as AuditRow[];
}
