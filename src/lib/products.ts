import { supabase } from "./supabase";

export interface Product {
  id: string;
  barcode: string;
  name: string;
  price: number;
  stock: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type ProductPayMethod = "cash" | "transfer" | "mixed" | "points" | "on_machine";

export interface ProductSale {
  id: string;
  sale_no: number;
  sold_at: string;
  sale_date: string;
  payment_method: ProductPayMethod;
  paid_cash: number;
  paid_transfer: number;
  total: number;
  reservation_id: string | null;
  pc_session_id: string | null;
  machine_label: string | null;
  settled: boolean;
  status: "paid" | "cancelled";
  created_at: string;
}

export interface ProductSaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  name: string;
  barcode: string | null;
  unit_price: number;
  qty: number;
  subtotal: number;
}

export interface CartLine {
  product: Product;
  qty: number;
}

export const LOW_STOCK = 5;

// ================= สินค้า / สต็อก =================

export async function listProducts(includeInactive = true): Promise<Product[]> {
  let q = supabase.from("products").select("*").order("name", { ascending: true });
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function findProductByBarcode(barcode: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("barcode", barcode.trim())
    .maybeSingle();
  if (error) throw error;
  return (data as Product) ?? null;
}

export async function createProduct(input: { barcode: string; name: string; price: number; stock: number }) {
  const { data, error } = await supabase
    .from("products")
    .insert({
      barcode: input.barcode.trim(),
      name: input.name.trim(),
      price: input.price,
      stock: input.stock,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Product;
}

export async function updateProduct(id: string, patch: Partial<Pick<Product, "name" | "price" | "stock" | "active" | "barcode">>) {
  const { error } = await supabase
    .from("products")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function addStock(id: string, current: number, amount: number) {
  await updateProduct(id, { stock: Math.max(0, current + amount) });
}

// ================= ขายสินค้า =================

export interface SellInput {
  lines: CartLine[];
  method: ProductPayMethod;
  paidCash?: number;
  paidTransfer?: number;
  reservationId?: string | null;
  pcSessionId?: string | null;
  machineLabel?: string | null;
}

export async function sellProducts(input: SellInput): Promise<string> {
  const total = cartTotal(input.lines);
  let cash = 0;
  let transfer = 0;
  if (input.method === "cash") cash = total;
  else if (input.method === "transfer") transfer = total;
  else if (input.method === "mixed") {
    cash = input.paidCash ?? 0;
    transfer = input.paidTransfer ?? 0;
  }

  const { data, error } = await supabase.rpc("sell_products", {
    p_items: input.lines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
    p_payment_method: input.method,
    p_paid_cash: cash,
    p_paid_transfer: transfer,
    p_reservation_id: input.reservationId ?? null,
    p_pc_session_id: input.pcSessionId ?? null,
    p_machine_label: input.machineLabel ?? null,
  });
  if (error) throw error;
  return data as string;
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((s, l) => s + Number(l.product.price) * l.qty, 0);
}

/** รายการสินค้าที่ลงบิลไว้ที่เครื่อง (ยังไม่ปิดยอด) */
export async function listOpenSalesForBill(opts: { reservationId?: string | null; pcSessionId?: string | null }) {
  let q = supabase
    .from("product_sales")
    .select("*, product_sale_items(*)")
    .eq("status", "paid")
    .eq("settled", false);
  if (opts.reservationId) q = q.eq("reservation_id", opts.reservationId);
  else if (opts.pcSessionId) q = q.eq("pc_session_id", opts.pcSessionId);
  else return [];
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as (ProductSale & { product_sale_items: ProductSaleItem[] })[];
}

export async function settleSalesForBill(opts: {
  reservationId?: string | null;
  pcSessionId?: string | null;
  method: "cash" | "transfer" | "mixed" | "points";
  cash?: number;
  transfer?: number;
}) {
  const { error } = await supabase.rpc("settle_product_sales_for_bill", {
    p_reservation_id: opts.reservationId ?? null,
    p_pc_session_id: opts.pcSessionId ?? null,
    p_method: opts.method,
    p_cash: opts.cash ?? null,
    p_transfer: opts.transfer ?? null,
  });
  if (error) throw error;
}

export async function cancelSalesForBill(opts: { reservationId?: string | null; pcSessionId?: string | null }) {
  const { error } = await supabase.rpc("cancel_product_sales_for_bill", {
    p_reservation_id: opts.reservationId ?? null,
    p_pc_session_id: opts.pcSessionId ?? null,
  });
  if (error) throw error;
}

export async function cancelSale(saleId: string) {
  const { error } = await supabase.rpc("cancel_product_sale", { p_sale_id: saleId });
  if (error) throw error;
}

// ================= รายงาน =================

export async function listSalesByDateRange(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from("product_sales")
    .select("*, product_sale_items(*)")
    .gte("sale_date", startDate)
    .lte("sale_date", endDate)
    .order("sold_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as (ProductSale & { product_sale_items: ProductSaleItem[] })[];
}

export function topSellers(sales: (ProductSale & { product_sale_items: ProductSaleItem[] })[]) {
  const map = new Map<string, { name: string; qty: number; amount: number }>();
  for (const s of sales) {
    if (s.status !== "paid") continue;
    for (const it of s.product_sale_items ?? []) {
      const key = it.product_id ?? it.name;
      const cur = map.get(key) ?? { name: it.name, qty: 0, amount: 0 };
      cur.qty += it.qty;
      cur.amount += Number(it.subtotal);
      map.set(key, cur);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

// ================= สถานะการติดตั้งฐานข้อมูล =================

/** ตรวจว่า error เกิดจากยังไม่ได้รัน migration (ไม่พบตาราง/ฟังก์ชัน) */
export function isSetupMissing(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const code = (e as { code?: string } | null)?.code ?? "";
  return (
    code === "PGRST205" ||
    code === "PGRST202" ||
    code === "42P01" ||
    /Could not find the (table|function)/i.test(msg)
  );
}

/** ตารางสินค้าพร้อมใช้งานหรือยัง */
export async function productsReady(): Promise<boolean> {
  try {
    const { error } = await supabase.from("products").select("id").limit(1);
    if (error) throw error;
    return true;
  } catch (e) {
    if (isSetupMissing(e)) return false;
    return true;
  }
}
