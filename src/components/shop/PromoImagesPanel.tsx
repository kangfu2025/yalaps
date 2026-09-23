import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Youtube,
  Film,
  Upload,
  Trash2,
  Power,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Maximize2,
  Minimize2,
  Clock,
} from "lucide-react";
import {
  KIND_LABEL,
  FIT_LABEL,
  MAX_VIDEO_MB,
  DEFAULT_IMAGE_SEC,
  DEFAULT_YOUTUBE_SEC,
  MediaNotReady,
  listMedia,
  addImage,
  addYouTube,
  addVideo,
  updateMedia,
  removeMedia,
  moveMedia,
  parseYouTubeId,
  youtubeThumb,
  slideSeconds,
  type PromoMedia,
  type MediaKind,
} from "@/lib/promoMedia";
import { ConfirmDialog } from "./ConfirmDialog";

export function PromoImagesPanel() {
  const [items, setItems] = useState<PromoMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [delTarget, setDelTarget] = useState<PromoMedia | null>(null);

  // ---- ฟอร์มเพิ่มรายการ ----
  const [kind, setKind] = useState<MediaKind>("image");
  const [name, setName] = useState("");
  const [ytUrl, setYtUrl] = useState("");
  const [seconds, setSeconds] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listMedia());
      setNotReady(false);
      setError(null);
    } catch (e) {
      if (e instanceof MediaNotReady) setNotReady(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function resetForm() {
    setName("");
    setYtUrl("");
    setSeconds("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      alert("กรุณาตั้งชื่อรายการ");
      return;
    }
    const sec = seconds.trim() ? Number(seconds) : null;
    if (sec !== null && (!Number.isFinite(sec) || sec < 3 || sec > 600)) {
      alert("เวลาแสดงต้องอยู่ระหว่าง 3 ถึง 600 วินาที");
      return;
    }

    setBusy(true);
    try {
      const order = items.length;
      if (kind === "image") {
        const file = fileRef.current?.files?.[0];
        if (!file) throw new Error("กรุณาเลือกไฟล์รูป");
        await addImage(name.trim(), file, order);
      } else if (kind === "youtube") {
        await addYouTube(name.trim(), ytUrl, order, { durationSec: sec, fit: "cover" });
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) throw new Error("กรุณาเลือกไฟล์วิดีโอ");
        await addVideo(name.trim(), file, order, { fit: "cover" });
      }
      resetForm();
      await refresh();
    } catch (err) {
      alert("เพิ่มไม่สำเร็จ: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function patch(item: PromoMedia, p: Parameters<typeof updateMedia>[1]) {
    try {
      await updateMedia(item.id, p);
      await refresh();
    } catch (e) {
      alert("บันทึกไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function move(index: number, dir: -1 | 1) {
    try {
      await moveMedia(items, index, dir);
      await refresh();
    } catch (e) {
      alert("ย้ายลำดับไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function doDelete() {
    if (!delTarget) return;
    const t = delTarget;
    setDelTarget(null);
    try {
      await removeMedia(t);
      await refresh();
    } catch (e) {
      alert("ลบไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  if (notReady) {
    return (
      <div className="alert alert-warning">
        <b>ยังไม่ได้ติดตั้งระบบวิดีโอบนจอลูกค้า</b>
        <div className="small mt-1">
          เปิด Supabase SQL Editor แล้วรัน <code>supabase/promo_media_migration.sql</code>{" "}
          จากนั้นรีเฟรชหน้านี้ · รูปโปสเตอร์เดิมจะยังอยู่ครบไม่หายไปไหน
        </div>
      </div>
    );
  }

  const activeCount = items.filter((x) => x.is_active).length;
  const ytPreview = kind === "youtube" ? parseYouTubeId(ytUrl) : null;

  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <ImageIcon size={20} />
        <h5 className="m-0 fw-bold">สื่อบนหน้าจอลูกค้า</h5>
        <span className="badge bg-success ms-auto">{activeCount} รายการกำลังแสดง</span>
      </div>

      {error && (
        <div className="alert alert-warning d-flex align-items-center gap-2 small">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* ---------- ฟอร์มเพิ่ม ---------- */}
      <form onSubmit={handleAdd} className="card p-3 mb-4">
        <div className="btn-group btn-group-sm mb-3" role="group">
          {(["image", "youtube", "video"] as MediaKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`btn ${kind === k ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => {
                setKind(k);
                resetForm();
              }}
            >
              {k === "image" ? (
                <ImageIcon size={14} />
              ) : k === "youtube" ? (
                <Youtube size={14} />
              ) : (
                <Film size={14} />
              )}{" "}
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="row g-2 align-items-end">
          <div className="col-md-4">
            <label className="form-label small fw-bold">ชื่อรายการ</label>
            <input
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น โปรต้นเดือน"
            />
          </div>

          {kind === "image" && (
            <div className="col-md-6">
              <label className="form-label small fw-bold">ไฟล์รูป (JPG/PNG)</label>
              <input ref={fileRef} type="file" accept="image/*" className="form-control" />
            </div>
          )}

          {kind === "youtube" && (
            <>
              <div className="col-md-5">
                <label className="form-label small fw-bold">ลิงก์ YouTube</label>
                <input
                  className="form-control"
                  value={ytUrl}
                  onChange={(e) => setYtUrl(e.target.value)}
                  placeholder="https://youtu.be/..."
                />
              </div>
              <div className="col-md-3">
                <label className="form-label small fw-bold">แสดงกี่วินาที</label>
                <input
                  type="number"
                  min={3}
                  max={600}
                  className="form-control"
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.value)}
                  placeholder={String(DEFAULT_YOUTUBE_SEC)}
                />
              </div>
            </>
          )}

          {kind === "video" && (
            <div className="col-md-6">
              <label className="form-label small fw-bold">
                ไฟล์วิดีโอ (MP4/WebM · ไม่เกิน {MAX_VIDEO_MB} MB)
              </label>
              <input ref={fileRef} type="file" accept="video/*" className="form-control" />
            </div>
          )}

          <div className="col-md-2">
            <button
              type="submit"
              className="btn btn-primary w-100 d-inline-flex align-items-center justify-content-center gap-1"
              disabled={busy}
            >
              <Upload size={14} /> {busy ? "กำลังบันทึก..." : "เพิ่ม"}
            </button>
          </div>
        </div>

        {kind === "image" && (
          <div className="small text-muted mt-2">
            💡 รูปถูกย่อไม่เกิน 1200px และบีบอัดอัตโนมัติ · แสดงรายการละ {DEFAULT_IMAGE_SEC} วินาที
          </div>
        )}
        {kind === "youtube" && (
          <div className="small text-muted mt-2" style={{ lineHeight: 1.9 }}>
            ⚠️ คลิป YouTube จะ <b>เล่นแบบไม่มีเสียงเสมอ</b> —
            เบราว์เซอร์บล็อกการเล่นอัตโนมัติที่มีเสียง และ <b>อาจมีโฆษณาคั่น</b> ซึ่งเราควบคุมไม่ได้
            {ytPreview && (
              <div className="d-flex align-items-center gap-2 mt-2">
                <img src={youtubeThumb(ytPreview)} alt="" style={{ width: 96, borderRadius: 6 }} />
                <span className="text-success">✓ อ่านรหัสคลิปได้: {ytPreview}</span>
              </div>
            )}
            {ytUrl.trim() && !ytPreview && (
              <div className="text-danger mt-1">
                ✗ อ่านลิงก์ไม่ออก — วางลิงก์คลิปหรือรหัส 11 ตัว
              </div>
            )}
          </div>
        )}
        {kind === "video" && (
          <div className="small text-muted mt-2" style={{ lineHeight: 1.9 }}>
            💡 ไม่มีโฆษณา ควบคุมได้เต็มที่ · <b>เล่นแบบไม่มีเสียง</b> เหมือนกัน
            (ข้อจำกัดของเบราว์เซอร์)
            <br />
            คลิปจะเล่นจนจบแล้วค่อยสลับไปรายการถัดไป · ถ้าถ่ายมาเป็นแนวตั้งจะพอดีจอเลย
          </div>
        )}
      </form>

      {/* ---------- รายการ ---------- */}
      {loading ? (
        <div className="text-center py-4 text-muted">กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-5 text-muted">ยังไม่มีสื่อ — เพิ่มรายการแรกด้านบน</div>
      ) : (
        <div className="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">
          {items.map((item, i) => (
            <div key={item.id} className="col">
              <div className={`card h-100 ${item.is_active ? "border-success border-2" : ""}`}>
                <div style={{ aspectRatio: "3/4", overflow: "hidden", background: "#000" }}>
                  {item.kind === "image" && item.data_url && (
                    <img
                      src={item.data_url}
                      alt={item.name}
                      style={{ width: "100%", height: "100%", objectFit: item.fit }}
                    />
                  )}
                  {item.kind === "youtube" && item.youtube_id && (
                    <img
                      src={youtubeThumb(item.youtube_id)}
                      alt={item.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  )}
                  {item.kind === "video" && item.video_url && (
                    <video
                      src={item.video_url}
                      muted
                      playsInline
                      preload="metadata"
                      style={{ width: "100%", height: "100%", objectFit: item.fit }}
                    />
                  )}
                </div>

                <div className="card-body p-2">
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <span className="fw-bold text-truncate flex-grow-1" title={item.name}>
                      {item.name}
                    </span>
                    {item.is_active ? (
                      <span className="badge bg-success">แสดงอยู่</span>
                    ) : (
                      <span className="badge bg-secondary">ปิด</span>
                    )}
                  </div>

                  <div className="small text-muted mb-2 d-flex align-items-center gap-2 flex-wrap">
                    <span>
                      {item.kind === "image" ? "🖼️" : item.kind === "youtube" ? "▶️" : "🎬"}{" "}
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span>·</span>
                    <span>
                      <Clock size={11} />{" "}
                      {slideSeconds(item) === null ? "จนจบคลิป" : `${slideSeconds(item)} วิ`}
                    </span>
                    <span>·</span>
                    <span>{FIT_LABEL[item.fit]}</span>
                  </div>

                  <div className="d-flex gap-1 flex-wrap">
                    <button
                      className={`btn btn-sm flex-grow-1 d-inline-flex align-items-center justify-content-center gap-1 ${
                        item.is_active ? "btn-outline-secondary" : "btn-outline-success"
                      }`}
                      onClick={() => patch(item, { is_active: !item.is_active })}
                    >
                      <Power size={12} /> {item.is_active ? "ปิด" : "เปิด"}
                    </button>
                    <button
                      className="btn btn-sm btn-outline-primary"
                      title={`สลับเป็น ${FIT_LABEL[item.fit === "cover" ? "contain" : "cover"]}`}
                      onClick={() =>
                        patch(item, { fit: item.fit === "cover" ? "contain" : "cover" })
                      }
                    >
                      {item.fit === "cover" ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={i === 0}
                      title="เลื่อนขึ้น"
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={i === items.length - 1}
                      title="เลื่อนลง"
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button
                      className="btn btn-sm btn-outline-danger"
                      title="ลบ"
                      onClick={() => setDelTarget(item)}
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

      <ConfirmDialog
        open={!!delTarget}
        title="ยืนยันลบรายการ"
        icon="🗑️"
        variant="danger"
        confirmLabel="ลบเลย"
        cancelLabel="ไม่ลบ"
        message={
          delTarget ? (
            <div>
              ลบ <b className="text-primary">{delTarget.name}</b>
              <br />
              <span className="text-muted small">{KIND_LABEL[delTarget.kind]}</span>
              {delTarget.kind === "video" && (
                <>
                  <br />
                  <span className="text-warning small">⚠️ ไฟล์วิดีโอจะถูกลบออกจากที่เก็บด้วย</span>
                </>
              )}
            </div>
          ) : (
            ""
          )
        }
        onConfirm={doDelete}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  );
}
