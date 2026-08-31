import { useEffect, useRef, useState } from "react";
import { BarcodeScanner } from "./BarcodeScanner";
import { ProductsSetupNotice } from "./ProductsSetupNotice";
import { PromptPayQR } from "./PromptPayQR";
import { formatBaht } from "@/lib/priceEngine";
import { listActivePcSessions } from "@/lib/pcControl";
import type { Machine, PcSession, Reservation } from "@/lib/supabase";
import {
  cancelSale,
  cartTotal,
  findProductByBarcode,
  isSetupMissing,
  listProducts,
  listSalesByDateRange,
  sellProducts,
  type CartLine,
  type Product,
  type ProductSale,
  type ProductSaleItem,
} from "@/lib/products";

type PayMode = "cash" | "transfer" | "mixed" | "points" | "machine";

interface Props {
  machines: Machine[];
  resByMachine: Map<string, Reservation>;
}

function todayBkk() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function ProductSalePanel({ machines, resByMachine }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [pcSessions, setPcSessions] = useState<PcSession[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [code, setCode] = useState("");
  const [scan, setScan] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [target, setTarget] = useState<string>(""); // "res:<id>" | "pc:<id>"
  const [cash, setCash] = useState("");
  const [transfer, setTransfer] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [today, setToday] = useState<(ProductSale & { product_sale_items: ProductSaleItem[] })[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function reload() {
    try {
      const [ps, sess, sales] = await Promise.all([
        listProducts(false),
        listActivePcSessions().catch(() => [] as PcSession[]),
        listSalesByDateRange(todayBkk(), todayBkk()).catch(() => []),
      ]);
      setProducts(ps);
      setPcSessions(sess);
      setToday(sales);
      setNeedsSetup(false);
    } catch (e) {
      if (isSetupMissing(e)) setNeedsSetup(true);
      else setMsg("โหลดข้อมูลไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  useEffect(() => {
    reload();
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addToCart(p: Product) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        const line = next[idx]!;
        if (line.qty + 1 > Number(p.stock)) {
          setMsg(`⚠️ สต็อก ${p.name} เหลือ ${p.stock} ชิ้น`);
          return prev;
        }
        next[idx] = { ...line, qty: line.qty + 1 };
        return next;
      }
      if (Number(p.stock) < 1) {
        setMsg(`⚠️ ${p.name} สินค้าหมด`);
        return prev;
      }
      return [...prev, { product: p, qty: 1 }];
    });
  }

  async function handleCode(raw: string) {
    const c = raw.trim();
    if (!c) return;
    setCode("");
    const local = products.find((p) => p.barcode === c);
    if (local) {
      setMsg(`✅ ${local.name} — ฿ ${formatBaht(Number(local.price))}`);
      addToCart(local);
      return;
    }
    try {
      const found = await findProductByBarcode(c);
      if (!found) {
        setMsg(`❌ ไม่พบสินค้าบาร์โค้ด ${c} — เพิ่มสินค้าในแท็บคลังสินค้าก่อน`);
        return;
      }
      setProducts((prev) => [...prev, found]);
      setMsg(`✅ ${found.name} — ฿ ${formatBaht(Number(found.price))}`);
      addToCart(found);
    } catch (e) {
      setMsg("ค้นหาไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.product.id === productId ? { ...l, qty: Math.min(Math.max(0, qty), Number(l.product.stock)) } : l))
        .filter((l) => l.qty > 0),
    );
  }

  const total = cartTotal(cart);
  const qrAmount = payMode === "transfer" ? total : payMode === "mixed" ? Number(transfer) || 0 : 0;

  const machineOptions: { value: string; label: string }[] = [];
  for (const m of machines) {
    const r = resByMachine.get(m.id);
    if (r) {
      const zone = m.zone === "sofa" ? "🛋️ โซฟา" : m.zone === "racing" ? "🏎️ รถแข่ง" : "🖥️ PC";
      machineOptions.push({ value: `res:${r.id}`, label: `${zone} เครื่อง ${m.machine_number} — ${r.customer_name}` });
    }
  }
  for (const s of pcSessions) {
    const m = machines.find((x) => x.id === s.machine_id);
    machineOptions.push({
      value: `pc:${s.id}`,
      label: `🖥️ PC ${m?.machine_number ?? "?"} — ${s.customer_name || "ลูกค้า"}`,
    });
  }

  async function submit() {
    if (busy) return;
    if (cart.length === 0) {
      setMsg("ยังไม่มีสินค้าในตะกร้า");
      return;
    }
    if (payMode === "machine" && !target) {
      setMsg("เลือกเครื่องที่จะลงบิลก่อน");
      return;
    }
    setBusy(true);
    try {
      const isRes = target.startsWith("res:");
      const label = machineOptions.find((o) => o.value === target)?.label ?? null;
      await sellProducts({
        lines: cart,
        method: payMode === "machine" ? "on_machine" : payMode,
        paidCash: Number(cash) || 0,
        paidTransfer: Number(transfer) || 0,
        reservationId: payMode === "machine" && isRes ? target.slice(4) : null,
        pcSessionId: payMode === "machine" && !isRes ? target.slice(3) : null,
        machineLabel: payMode === "machine" ? label : null,
      });
      setCart([]);
      setCash("");
      setTransfer("");
      setMsg(payMode === "machine" ? "✅ ลงบิลไว้ที่เครื่องแล้ว (เก็บเงินตอนเช็คบิล)" : "✅ ขายสำเร็จ");
      await reload();
      inputRef.current?.focus();
    } catch (e) {
      setMsg("ขายไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function voidSale(id: string) {
    if (!window.confirm("ยกเลิกบิลสินค้านี้ และคืนสต็อก?")) return;
    try {
      await cancelSale(id);
      await reload();
    } catch (e) {
      setMsg("ยกเลิกไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const paidToday = today.filter((s) => s.status === "paid");
  const totalToday = paidToday.reduce((s, x) => s + Number(x.total), 0);

  if (needsSetup) {
    return (
      <div className="pos-wrap">
        <ProductsSetupNotice />
      </div>
    );
  }

  return (
    <div className="pos-wrap">
      {scan && (
        <BarcodeScanner
          onClose={() => setScan(false)}
          onDetected={(c) => {
            setScan(false);
            handleCode(c);
          }}
        />
      )}

      <div className="pos-grid">
        {/* ---------- ซ้าย 60% : สแกน + เลือกสินค้า + ตะกร้า ---------- */}
        <div className="d-flex flex-column gap-3">
          <div className="pos-card">
            <div className="pos-card-title">สแกนบาร์โค้ด</div>
            <div className="d-flex gap-2 align-items-end">
              <div className="flex-grow-1">
                <label className="pos-label">Barcode / ชื่อสินค้า</label>
                <input
                  ref={inputRef}
                  className="form-control pos-scan-input"
                  placeholder="สแกนบาร์โค้ด แล้วกด Enter"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCode(code);
                  }}
                />
              </div>
              <button className="pos-btn-ghost" onClick={() => setScan(true)}>📷 กล้อง</button>
            </div>
            {msg && <div className="pos-msg">{msg}</div>}

            <div className="pos-quick mt-3">
              {products.slice(0, 12).map((p) => (
                <button key={p.id} className="pos-chip" disabled={Number(p.stock) < 1} onClick={() => addToCart(p)}>
                  {p.name} <b className="ms-1">฿{formatBaht(Number(p.price))}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="pos-card pos-card--flat">
            <div className="pos-head">
              <div className="pos-card-title m-0">ตะกร้าสินค้า ({cart.length})</div>
              <span className="pos-pill">{cart.reduce((s, l) => s + l.qty, 0)} ชิ้น</span>
            </div>
            {cart.length === 0 ? (
              <div className="pos-empty">ตะกร้าว่าง — สแกนเพื่อเริ่มขาย</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm pos-table align-middle">
                  <thead>
                    <tr>
                      <th>รายการสินค้า</th>
                      <th className="text-center" style={{ width: 100 }}>ราคา</th>
                      <th className="text-center" style={{ width: 140 }}>จำนวน</th>
                      <th className="text-end" style={{ width: 110 }}>รวม</th>
                      <th style={{ width: 48 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((l) => (
                      <tr key={l.product.id}>
                        <td className="fw-bold">{l.product.name}</td>
                        <td className="text-center pos-mono">{formatBaht(Number(l.product.price))}</td>
                        <td className="text-center">
                          <div className="d-inline-flex align-items-center gap-2">
                            <button className="pos-step" onClick={() => setQty(l.product.id, l.qty - 1)}>−</button>
                            <b className="pos-mono" style={{ minWidth: 24, display: "inline-block" }}>{l.qty}</b>
                            <button className="pos-step" onClick={() => setQty(l.product.id, l.qty + 1)}>+</button>
                          </div>
                        </td>
                        <td className="text-end pos-mono fw-bold" style={{ color: "var(--pos-mint)" }}>
                          {formatBaht(Number(l.product.price) * l.qty)}
                        </td>
                        <td className="text-end">
                          <button className="pos-mini pos-mini--danger" onClick={() => setQty(l.product.id, 0)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ---------- ขวา 40% : ชำระเงิน (sticky) ---------- */}
        <div className="pos-rail">
          <div className="pos-card pos-card--accent">
            <div className="pos-total">
              <span>ยอดรวมทั้งสิ้น</span>
              <b>฿{formatBaht(total)}</b>
            </div>

            <label className="pos-label">รูปแบบการชำระ</label>
            <div className="pos-pay mb-3">
              {[
                { v: "cash" as PayMode, label: "💵 เงินสด" },
                { v: "transfer" as PayMode, label: "📱 โอน" },
                { v: "mixed" as PayMode, label: "🔀 ผสม" },
                { v: "machine" as PayMode, label: "🎮 ลงบิลที่เครื่อง" },
              ].map((o) => (
                <label key={o.v} className={payMode === o.v ? "is-active" : ""}>
                  <input type="radio" name="posPay" checked={payMode === o.v} onChange={() => setPayMode(o.v)} />
                  {o.label}
                </label>
              ))}
            </div>

            {payMode === "machine" && (
              <div className="mb-3">
                <label className="pos-label">เลือกเครื่อง / ลูกค้า</label>
                <select className="form-select" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">— เลือกเครื่องที่กำลังเล่น —</option>
                  {machineOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {machineOptions.length === 0 && (
                  <div className="small text-warning mt-1">ยังไม่มีเครื่องที่กำลังเล่น</div>
                )}
              </div>
            )}

            {payMode === "mixed" && (
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="pos-label">💵 เงินสด</label>
                  <input type="number" className="form-control pos-mono" value={cash} onChange={(e) => setCash(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="pos-label">📱 เงินโอน</label>
                  <input type="number" className="form-control pos-mono" value={transfer} onChange={(e) => setTransfer(e.target.value)} />
                </div>
              </div>
            )}

            <PromptPayQR amount={qrAmount} />

            <button className="pos-btn-primary mt-2" disabled={busy || cart.length === 0} onClick={submit}>
              {busy ? "กำลังบันทึก..." : payMode === "machine" ? "📌 ลงบิลที่เครื่อง" : "✅ ยืนยันการขาย"}
            </button>
          </div>

          <div className="pos-card">
            <div className="pos-card-title">
              การขายวันนี้ <span className="pos-mono ms-auto" style={{ color: "var(--pos-mint-hi)" }}>฿{formatBaht(totalToday)}</span>
            </div>
            {paidToday.length === 0 ? (
              <div className="pos-empty">ยังไม่มีรายการ</div>
            ) : (
              <div className="pos-scroll">
                {paidToday.map((s) => (
                  <div key={s.id} className="pos-sale-row">
                    <div className="flex-grow-1">
                      <div className="small fw-bold">
                        {(s.product_sale_items ?? []).map((i) => `${i.name} x${i.qty}`).join(", ")}
                      </div>
                      <div className="small pos-mono" style={{ opacity: 0.55, fontSize: "0.68rem" }}>
                        {new Date(s.sold_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                        {s.payment_method === "on_machine"
                          ? `ลงบิล: ${s.machine_label ?? "เครื่อง"}${s.settled ? " (เก็บแล้ว)" : " (ค้างเก็บ)"}`
                          : s.payment_method === "cash"
                          ? "เงินสด"
                          : s.payment_method === "transfer"
                          ? "โอน"
                          : s.payment_method === "points"
                          ? "แลกแต้ม"
                          : "ผสม"}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="fw-bold pos-mono" style={{ color: "var(--pos-mint-hi)" }}>฿{formatBaht(Number(s.total))}</div>
                      {!s.settled && (
                        <button className="pos-mini pos-mini--danger mt-1" onClick={() => voidSale(s.id)}>ยกเลิก</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

