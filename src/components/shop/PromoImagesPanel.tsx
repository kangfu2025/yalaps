import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Upload, Trash2, Power, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

export interface PromoImage {
  id: string;
  name: string;
  data_url: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

// ย่อ+บีบอัดรูปในเบราว์เซอร์ก่อนบันทึก
async function compressImage(file: File, maxWidth = 1200, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export function PromoImagesPanel() {
  const [items, setItems] = useState<PromoImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    const { data, error } = await supabase
      .from("promo_images")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setItems((data ?? []) as PromoImage[]);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      alert("กรุณาเลือกรูปภาพ");
      return;
    }
    if (!name.trim()) {
      alert("กรุณาตั้งชื่อรูป");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await compressImage(file);
      const { error } = await supabase.from("promo_images").insert({
        name: name.trim(),
        data_url: dataUrl,
        is_active: true,
        sort_order: items.length,
      });
      if (error) throw error;
      setName("");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (err) {
      alert("อัปโหลดไม่สำเร็จ: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(item: PromoImage) {
    const { error } = await supabase
      .from("promo_images")
      .update({ is_active: !item.is_active })
      .eq("id", item.id);
    if (error) alert(error.message);
    else refresh();
  }

  async function remove(item: PromoImage) {
    if (!confirm(`ลบรูป "${item.name}"?`)) return;
    const { error } = await supabase.from("promo_images").delete().eq("id", item.id);
    if (error) alert(error.message);
    else refresh();
  }

  const activeCount = items.filter((x) => x.is_active).length;

  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-3">
        <ImageIcon size={20} />
        <h5 className="m-0 fw-bold">รูปโปรโมชั่น (หน้าจอลูกค้า)</h5>
        <span className="badge bg-success ms-auto">{activeCount} รูปกำลังแสดง</span>
      </div>

      {error && (
        <div className="alert alert-warning d-flex align-items-center gap-2 small">
          <AlertTriangle size={14} /> {error}
          <span className="ms-auto">— โปรดสร้างตาราง <code>promo_images</code> ตาม SQL ที่ให้ไว้</span>
        </div>
      )}

      <form onSubmit={handleUpload} className="card p-3 mb-4 bg-light">
        <div className="row g-2 align-items-end">
          <div className="col-md-5">
            <label className="form-label small fw-bold">ชื่อรูป</label>
            <input
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น โปรต้นเดือน"
            />
          </div>
          <div className="col-md-5">
            <label className="form-label small fw-bold">เลือกไฟล์รูป (JPG/PNG)</label>
            <input ref={fileRef} type="file" accept="image/*" className="form-control" />
          </div>
          <div className="col-md-2">
            <button type="submit" className="btn btn-primary w-100 d-inline-flex align-items-center justify-content-center gap-1" disabled={busy}>
              <Upload size={14} /> {busy ? "..." : "อัปโหลด"}
            </button>
          </div>
        </div>
        <div className="small text-muted mt-2">
          💡 รูปจะถูกย่อขนาดไม่เกิน 1200px และบีบอัดอัตโนมัติ
        </div>
      </form>

      {loading ? (
        <div className="text-center py-4 text-muted">กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-5 text-muted">
          ยังไม่มีรูปโปรโมชั่น — อัปโหลดรูปแรกด้านบน
        </div>
      ) : (
        <div className="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">
          {items.map((item) => (
            <div key={item.id} className="col">
              <div className={`card h-100 ${item.is_active ? "border-success border-2" : ""}`}>
                <div style={{ aspectRatio: "3/4", overflow: "hidden", background: "#000" }}>
                  <img
                    src={item.data_url}
                    alt={item.name}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                </div>
                <div className="card-body p-2">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <span className="fw-bold text-truncate flex-grow-1" title={item.name}>{item.name}</span>
                    {item.is_active ? (
                      <span className="badge bg-success">แสดงอยู่</span>
                    ) : (
                      <span className="badge bg-secondary">ปิด</span>
                    )}
                  </div>
                  <div className="d-flex gap-2">
                    <button
                      className={`btn btn-sm flex-grow-1 d-inline-flex align-items-center justify-content-center gap-1 ${item.is_active ? "btn-outline-secondary" : "btn-outline-success"}`}
                      onClick={() => toggleActive(item)}
                    >
                      <Power size={12} /> {item.is_active ? "ปิด" : "เปิด"}
                    </button>
                    <button
                      className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                      onClick={() => remove(item)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
