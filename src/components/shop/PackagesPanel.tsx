import { useEffect, useMemo, useState } from "react";
import { Package, Plus, Trash2, Power, Pencil, X, Check, AlertTriangle } from "lucide-react";
import { formatBaht } from "@/lib/priceEngine";
import {
  listPackages,
  savePackage,
  setPackageActive,
  deletePackage,
  packageState,
  bangkokToday,
  fmtMinutes,
  fmtThaiDate,
  PACKAGES_SQL_FILE,
  type PricePackage,
  type PackageState,
} from "@/lib/packages";

/**
 * แพ็กเกจราคา (เฉพาะโซฟา) — แอดมินตั้งราคาเองและกำหนดชั่วโมงที่ได้
 * เช่น โปรเกมใหม่: 1 ชม. 120 / 3 ชม. 300 / เหมา 9 ชม. 800
 * บิลที่เปิดไปแล้วเก็บราคาไว้ในบิลเอง แก้หรือลบแพ็กเกจทีหลังไม่กระทบบิลเก่า
 */

const STATE_LABEL: Record<PackageState, { label: string; cls: string }> = {
  live: { label: "เปิดขายอยู่", cls: "bg-success" },
  upcoming: { label: "ยังไม่ถึงวัน", cls: "bg-info" },
  ended: { label: "หมดช่วงโปร", cls: "bg-secondary" },
  off: { label: "ปิดไว้", cls: "bg-dark" },
};

interface TierDraft {
  label: string;
  hours: string;
  price: string;
}

const EMPTY_TIER: TierDraft = { label: "", hours: "", price: "" };

function tierLabel(t: TierDraft): string {
  const h = Number(t.hours);
  return t.label.trim() || (Number.isFinite(h) && h > 0 ? `${h} ชม.` : "");
}

export function PackagesPanel() {
  const [items, setItems] = useState<PricePackage[] | null>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = bangkokToday();

  const [group, setGroup] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([{ ...EMPTY_TIER }]);

  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<TierDraft & { start: string; end: string }>({
    ...EMPTY_TIER,
    start: today,
    end: "",
  });

  async function refresh() {
    try {
      setItems(await listPackages());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  /** รวมเป็นกลุ่มโปร (ชื่อ + ช่วงวันที่เดียวกัน) ให้อ่านเป็นก้อนเหมือนโปสเตอร์ */
  const groups = useMemo(() => {
    const map = new Map<string, PricePackage[]>();
    for (const p of items ?? []) {
      const k = `${p.group_name}|${p.start_date}|${p.end_date ?? ""}`;
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return [...map.entries()].map(([k, list]) => ({
      key: k,
      name: list[0].group_name,
      start: list[0].start_date,
      end: list[0].end_date,
      list: list.sort((a, b) => a.sort_order - b.sort_order || a.minutes - b.minutes),
    }));
  }, [items]);

  function setTier(i: number, patch: Partial<TierDraft>) {
    setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  function validTier(t: TierDraft): string | null {
    const h = Number(t.hours);
    const p = Number(t.price);
    if (!Number.isFinite(h) || h < 0.5 || h > 24) return "ชั่วโมงต้องอยู่ระหว่าง 0.5 – 24";
    if (Math.round(h * 60) % 1 !== 0) return "ชั่วโมงไม่ถูกต้อง";
    if (t.price.trim() === "" || !Number.isFinite(p) || p < 0) return "ราคาต้องเป็นตัวเลข ≥ 0";
    if (tierLabel(t).length > 60) return "ชื่อแพ็กเกจยาวเกินไป";
    return null;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!group.trim()) return alert("ระบุชื่อโปร เช่น GTA VI มาใหม่");
    if (endDate && endDate < startDate) return alert("วันสิ้นสุดต้องไม่ก่อนวันเริ่ม");
    const filled = tiers.filter((t) => t.hours.trim() || t.price.trim());
    if (filled.length === 0) return alert("ใส่อย่างน้อย 1 แพ็กเกจ");
    for (const [i, t] of filled.entries()) {
      const err = validTier(t);
      if (err) return alert(`แพ็กเกจแถวที่ ${i + 1}: ${err}`);
    }
    setBusy(true);
    try {
      for (const [i, t] of filled.entries()) {
        await savePackage({
          group_name: group,
          label: tierLabel(t),
          minutes: Math.round(Number(t.hours) * 60),
          price: Number(t.price),
          start_date: startDate,
          end_date: endDate || null,
          active: true,
          sort_order: i + 1,
        });
      }
      setGroup("");
      setTiers([{ ...EMPTY_TIER }]);
      await refresh();
    } catch (err) {
      alert("บันทึกแพ็กเกจไม่สำเร็จ: " + (err instanceof Error ? err.message : String(err)));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function startEdit(p: PricePackage) {
    setEditId(p.id);
    setEdit({
      label: p.label,
      hours: String(p.minutes / 60),
      price: String(p.price),
      start: p.start_date,
      end: p.end_date ?? "",
    });
  }

  async function saveEdit(p: PricePackage) {
    const err = validTier(edit);
    if (err) return alert(err);
    if (edit.end && edit.end < edit.start) return alert("วันสิ้นสุดต้องไม่ก่อนวันเริ่ม");
    setBusy(true);
    try {
      await savePackage(
        {
          group_name: p.group_name,
          label: tierLabel(edit),
          minutes: Math.round(Number(edit.hours) * 60),
          price: Number(edit.price),
          start_date: edit.start,
          end_date: edit.end || null,
          active: p.active,
          sort_order: p.sort_order,
        },
        p.id,
      );
      setEditId(null);
      await refresh();
    } catch (e) {
      alert("แก้ไขไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p: PricePackage) {
    try {
      await setPackageActive(p.id, !p.active);
      await refresh();
    } catch (e) {
      alert("ไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function remove(p: PricePackage) {
    if (
      !confirm(
        `ลบแพ็กเกจ "${p.group_name} · ${p.label}" ?\nบิลที่เปิดไปแล้วยังเก็บราคาเดิมไว้ ไม่กระทบรายงาน`,
      )
    )
      return;
    try {
      await deletePackage(p.id);
      await refresh();
    } catch (e) {
      alert("ลบไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  if (items === null) {
    return (
      <div className="alert alert-warning d-flex align-items-start gap-2 mb-4">
        <AlertTriangle size={18} className="flex-shrink-0 mt-1" />
        <div>
          <b>แพ็กเกจราคา + ชั่วโมงสะสม ยังไม่ได้เปิดใช้</b>
          <div className="small">
            เปิด Supabase → SQL Editor แล้วรันไฟล์ <code>{PACKAGES_SQL_FILE}</code> หนึ่งครั้ง
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5">
      <h5 className="d-flex align-items-center gap-2 mb-1">
        <Package size={18} /> แพ็กเกจราคา (โซนโซฟา)
      </h5>
      <p className="small text-muted mb-3">
        ตั้งราคาเองและกำหนดชั่วโมงที่ได้ · พนักงานเลือกได้ตอนเปิดเครื่อง · เล่นไม่หมด
        เก็บเวลาที่เหลือเข้าบัญชีสมาชิกได้ 30 วัน
      </p>

      {error && (
        <div className="alert alert-danger d-flex align-items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="card mb-3">
        <div className="card-header bg-light fw-bold d-flex align-items-center gap-2">
          <Plus size={16} /> สร้างโปรแพ็กเกจ
        </div>
        <form onSubmit={handleCreate} className="card-body">
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label fw-bold small" htmlFor="pkgGroup">
                ชื่อโปร
              </label>
              <input
                id="pkgGroup"
                className="form-control"
                value={group}
                maxLength={60}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="เช่น GTA VI มาใหม่"
              />
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label fw-bold small" htmlFor="pkgStart">
                เริ่มขาย
              </label>
              <input
                id="pkgStart"
                type="date"
                className="form-control"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label fw-bold small" htmlFor="pkgEnd">
                ถึงวันที่ <span className="fw-normal text-muted">(เว้นว่าง = ไม่กำหนด)</span>
              </label>
              <input
                id="pkgEnd"
                type="date"
                className="form-control"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="yl-tier-head mt-3">
            <span>ชื่อแพ็กเกจ</span>
            <span>ชั่วโมงที่ได้</span>
            <span>ราคา (บาท)</span>
            <span />
          </div>
          {tiers.map((t, i) => (
            <div key={i} className="yl-tier-row">
              <input
                id={`tierLabel${i}`}
                className="form-control"
                value={t.label}
                maxLength={60}
                aria-label={`ชื่อแพ็กเกจแถว ${i + 1}`}
                placeholder={tierLabel({ ...t, label: "" }) || "เช่น เหมา 9 ชม."}
                onChange={(e) => setTier(i, { label: e.target.value })}
              />
              <input
                id={`tierHours${i}`}
                type="number"
                step="0.5"
                min="0.5"
                max="24"
                className="form-control"
                value={t.hours}
                aria-label={`ชั่วโมงแถว ${i + 1}`}
                placeholder="เช่น 9"
                onChange={(e) => setTier(i, { hours: e.target.value })}
              />
              <input
                id={`tierPrice${i}`}
                type="number"
                min="0"
                className="form-control"
                value={t.price}
                aria-label={`ราคาแถว ${i + 1}`}
                placeholder="เช่น 800"
                onChange={(e) => setTier(i, { price: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                title="ลบแถวนี้"
                disabled={tiers.length === 1}
                onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="d-flex flex-wrap gap-2 justify-content-between mt-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
              disabled={tiers.length >= 8}
              onClick={() => setTiers((ts) => [...ts, { ...EMPTY_TIER }])}
            >
              <Plus size={14} /> เพิ่มแถว
            </button>
            <button
              className="btn btn-primary fw-bold d-inline-flex align-items-center gap-1"
              disabled={busy}
            >
              <Check size={16} /> {busy ? "กำลังบันทึก..." : "บันทึกแพ็กเกจ"}
            </button>
          </div>
        </form>
      </div>

      {loading ? (
        <div className="text-muted small">กำลังโหลด...</div>
      ) : groups.length === 0 ? (
        <div className="text-muted small">— ยังไม่มีแพ็กเกจ —</div>
      ) : (
        <div className="yl-pkg-groups">
          {groups.map((g) => (
            <div key={g.key} className="card">
              <div className="card-header bg-light d-flex flex-wrap align-items-center gap-2">
                <b>{g.name}</b>
                <span className="small text-muted">
                  {fmtThaiDate(g.start)} → {g.end ? fmtThaiDate(g.end) : "ไม่กำหนด"}
                </span>
              </div>
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <tbody>
                    {g.list.map((p) => {
                      const st = STATE_LABEL[packageState(p, today)];
                      if (editId === p.id) {
                        return (
                          <tr key={p.id}>
                            <td colSpan={4}>
                              <div className="yl-tier-row is-edit">
                                <input
                                  id="editLabel"
                                  className="form-control form-control-sm"
                                  value={edit.label}
                                  aria-label="ชื่อแพ็กเกจ"
                                  onChange={(e) => setEdit({ ...edit, label: e.target.value })}
                                />
                                <input
                                  id="editHours"
                                  type="number"
                                  step="0.5"
                                  className="form-control form-control-sm"
                                  value={edit.hours}
                                  aria-label="ชั่วโมง"
                                  onChange={(e) => setEdit({ ...edit, hours: e.target.value })}
                                />
                                <input
                                  id="editPrice"
                                  type="number"
                                  className="form-control form-control-sm"
                                  value={edit.price}
                                  aria-label="ราคา"
                                  onChange={(e) => setEdit({ ...edit, price: e.target.value })}
                                />
                                <input
                                  id="editStart"
                                  type="date"
                                  className="form-control form-control-sm"
                                  value={edit.start}
                                  aria-label="เริ่มขาย"
                                  onChange={(e) => setEdit({ ...edit, start: e.target.value })}
                                />
                                <input
                                  id="editEnd"
                                  type="date"
                                  className="form-control form-control-sm"
                                  value={edit.end}
                                  aria-label="ถึงวันที่"
                                  onChange={(e) => setEdit({ ...edit, end: e.target.value })}
                                />
                                <div className="d-flex gap-1">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-success"
                                    disabled={busy}
                                    onClick={() => saveEdit(p)}
                                    title="บันทึก"
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-secondary"
                                    onClick={() => setEditId(null)}
                                    title="ยกเลิก"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={p.id} className={p.active ? "" : "text-muted"}>
                          <td className="fw-bold">{p.label}</td>
                          <td className="small">{fmtMinutes(p.minutes)}</td>
                          <td className="text-end fw-bold">{formatBaht(p.price)} บ.</td>
                          <td className="text-end text-nowrap">
                            <span className={`badge ${st.cls} me-2`}>{st.label}</span>
                            <button
                              className="btn btn-sm btn-outline-primary me-1"
                              onClick={() => startEdit(p)}
                              title="แก้ไข"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="btn btn-sm btn-outline-secondary me-1"
                              onClick={() => toggle(p)}
                              title={p.active ? "ปิดขาย" : "เปิดขาย"}
                            >
                              <Power size={14} />
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => remove(p)}
                              title="ลบ"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
