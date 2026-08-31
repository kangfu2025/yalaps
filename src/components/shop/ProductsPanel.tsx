import { useEffect, useState } from "react";
import { BarcodeScanner } from "./BarcodeScanner";
import { ProductsSetupNotice } from "./ProductsSetupNotice";
import { formatBaht } from "@/lib/priceEngine";
import {
  LOW_STOCK,
  createProduct,
  isSetupMissing,
  listProducts,
  updateProduct,
  type Product,
} from "@/lib/products";

export function ProductsPanel() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanFor, setScanFor] = useState<"new" | null>(null);
  const [search, setSearch] = useState("");
  const [needsSetup, setNeedsSetup] = useState(false);

  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setItems(await listProducts());
      setNeedsSetup(false);
    } catch (e) {
      if (isSetupMissing(e)) setNeedsSetup(true);
      else alert("โหลดสินค้าไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function submit() {
    if (busy) return;
    if (!barcode.trim() || !name.trim()) {
      alert("กรอกบาร์โค้ดและชื่อสินค้า");
      return;
    }
    setBusy(true);
    try {
      await createProduct({
        barcode: barcode.trim(),
        name: name.trim(),
        price: Number(price) || 0,
        stock: Number(stock) || 0,
      });
      setBarcode("");
      setName("");
      setPrice("");
      setStock("");
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isSetupMissing(e)) setNeedsSetup(true);
      else alert(msg.includes("duplicate") ? "บาร์โค้ดนี้มีสินค้าอยู่แล้ว" : "บันทึกไม่สำเร็จ: " + msg);
    } finally {
      setBusy(false);
    }
  }

  async function quickStock(p: Product, delta: number) {
    try {
      await updateProduct(p.id, { stock: Math.max(0, Number(p.stock) + delta) });
      await reload();
    } catch (e) {
      alert("อัปเดตสต็อกไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function editPrice(p: Product) {
    const v = window.prompt(`ราคาใหม่ของ ${p.name} (บาท)`, String(Number(p.price)));
    if (v === null) return;
    const num = Number(v);
    if (Number.isNaN(num) || num < 0) return;
    await updateProduct(p.id, { price: num });
    await reload();
  }

  async function editName(p: Product) {
    const v = window.prompt("ชื่อสินค้าใหม่", p.name);
    if (!v || !v.trim()) return;
    await updateProduct(p.id, { name: v.trim() });
    await reload();
  }

  const filtered = items.filter(
    (p) =>
      !search.trim() ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode.includes(search.trim()),
  );
  const lowStock = items.filter((p) => p.active && Number(p.stock) <= LOW_STOCK);

  if (needsSetup) {
    return (
      <div className="pos-wrap">
        <ProductsSetupNotice />
      </div>
    );
  }

  return (
    <div className="pos-wrap">

      {scanFor === "new" && (
        <BarcodeScanner
          onClose={() => setScanFor(null)}
          onDetected={(code) => {
            setBarcode(code);
            setScanFor(null);
          }}
        />
      )}

      <div className="pos-card mb-3">
        <div className="pos-card-title">เพิ่มสินค้าเข้าสต็อก</div>
        <div className="row g-2 align-items-end">
          <div className="col-12 col-md-4">
            <label className="pos-label">บาร์โค้ด</label>
            <div className="d-flex gap-2">
              <input
                className="form-control pos-mono"
                value={barcode}
                placeholder="สแกนหรือพิมพ์"
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && document.getElementById("prodName")?.focus()}
              />
              <button className="pos-btn-ghost" onClick={() => setScanFor("new")} title="สแกนด้วยกล้อง">
                📷
              </button>
            </div>
          </div>
          <div className="col-12 col-md-4">
            <label className="pos-label">ชื่อสินค้า</label>
            <input id="prodName" className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="col-6 col-md-2">
            <label className="pos-label">ราคา (บาท)</label>
            <input type="number" min={0} className="form-control pos-mono" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="col-6 col-md-2">
            <label className="pos-label">จำนวน</label>
            <input type="number" min={0} className="form-control pos-mono" value={stock} onChange={(e) => setStock(e.target.value)} />
          </div>
        </div>
        <div className="d-flex justify-content-end mt-3">
          <button className="pos-btn-primary" style={{ width: "auto", padding: "0.6rem 1.5rem", fontSize: "0.95rem" }} disabled={busy} onClick={submit}>
            {busy ? "กำลังบันทึก..." : "💾 บันทึกสินค้า"}
          </button>
        </div>
      </div>

      <div className="pos-card pos-card--flat">
        <div className="pos-head">
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <div className="pos-card-title m-0">คลังสินค้า ({items.length})</div>
            {lowStock.length > 0 && (
              <span className="pos-alert">⚠️ {lowStock.length} รายการสต็อกต่ำ</span>
            )}
          </div>
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 240 }}
            placeholder="ค้นหาชื่อ / บาร์โค้ด"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {lowStock.length > 0 && (
          <div className="px-3 py-2 small" style={{ color: "#fca5a5", borderBottom: "1px solid rgba(239,68,68,.2)" }}>
            ใกล้หมด: {lowStock.slice(0, 12).map((p) => `${p.name} (${p.stock})`).join(", ")}
            {lowStock.length > 12 && ` … +${lowStock.length - 12} รายการ`}
          </div>
        )}

        {loading ? (
          <div className="pos-empty">กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="pos-empty">ยังไม่มีสินค้า</div>
        ) : (
          <div className="table-responsive pos-table-scroll">
            <table className="table table-sm pos-table align-middle">
              <thead>
                <tr>
                  <th>ชื่อสินค้า</th>
                  <th className="text-center">บาร์โค้ด</th>
                  <th className="text-center">ราคาขาย</th>
                  <th className="text-center">คงเหลือ</th>
                  <th className="text-center">จัดการสต็อก</th>
                  <th className="text-center">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const low = Number(p.stock) <= LOW_STOCK;
                  return (
                    <tr key={p.id} className={low ? "pos-low" : ""}>
                      <td className="fw-bold">{p.name}</td>
                      <td className="text-center pos-mono" style={{ opacity: 0.6, fontSize: "0.75rem" }}>{p.barcode}</td>
                      <td className="text-center pos-mono">{formatBaht(Number(p.price))}</td>
                      <td className="text-center pos-mono fw-bold" style={{ color: low ? "#fca5a5" : "var(--pos-mint-hi)" }}>
                        {p.stock}
                      </td>
                      <td className="text-center">
                        <div className="d-inline-flex gap-1 flex-wrap justify-content-center">
                          <button className="pos-mini" onClick={() => quickStock(p, -1)}>-1</button>
                          <button className="pos-mini" onClick={() => quickStock(p, 1)}>+1</button>
                          <button className="pos-mini" onClick={() => quickStock(p, 10)}>+10</button>
                          <button className="pos-mini pos-mini--ghost" onClick={() => editPrice(p)}>ราคา</button>
                          <button className="pos-mini pos-mini--ghost" onClick={() => editName(p)}>ชื่อ</button>
                        </div>
                      </td>
                      <td className="text-center">
                        <button
                          className={`pos-pill ${!p.active ? "pos-pill--off" : low ? "pos-pill--warn" : ""}`}
                          onClick={() => updateProduct(p.id, { active: !p.active }).then(reload)}
                          title={p.active ? "กดเพื่อปิดขาย" : "กดเพื่อเปิดขาย"}
                        >
                          {!p.active ? "ปิดขาย" : low ? "ใกล้หมด" : "วางขาย"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

