import { supabase } from "./supabase";

/**
 * สื่อบนจอลูกค้า — รูปโปสเตอร์ / คลิป YouTube / วิดีโอที่อัปโหลดเอง
 *
 * เก็บอยู่ในตาราง promo_images เดิม (ต่อยอด ไม่ได้สร้างตารางใหม่)
 * รูปยังเก็บเป็น base64 ในแถวเหมือนเดิม ส่วนวิดีโอเก็บเป็นไฟล์ใน Storage
 * เพราะคลิปสั้น ๆ ก็หลายสิบเมกะไบต์ ฝังลงแถวไม่ไหว
 */

export const MEDIA_BUCKET = "promo-media";

/** เพดานของแพลนฟรี — ปรับได้ถ้าอัปเกรดแพลนแล้วแก้ file_size_limit ของ bucket */
export const MAX_VIDEO_MB = 50;

/** ค่าเริ่มต้นเวลาแสดงต่อรายการ (วินาที) */
export const DEFAULT_IMAGE_SEC = 8;
export const DEFAULT_YOUTUBE_SEC = 60;

export type MediaKind = "image" | "youtube" | "video";
export type MediaFit = "contain" | "cover";

export interface PromoMedia {
  id: string;
  name: string;
  kind: MediaKind;
  data_url: string | null;
  youtube_id: string | null;
  video_url: string | null;
  video_path: string | null;
  duration_sec: number | null;
  fit: MediaFit;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export const KIND_LABEL: Record<MediaKind, string> = {
  image: "รูปโปสเตอร์",
  youtube: "คลิป YouTube",
  video: "วิดีโออัปโหลด",
};

export const FIT_LABEL: Record<MediaFit, string> = {
  cover: "เต็มจอ (ตัดขอบ)",
  contain: "เห็นทั้งภาพ (มีขอบดำ)",
};

/** ยังไม่ได้รัน promo_media_migration.sql */
export class MediaNotReady extends Error {
  constructor(msg = "ยังไม่ได้ติดตั้งระบบวิดีโอบนจอลูกค้า") {
    super(msg);
    this.name = "MediaNotReady";
  }
}

function isMissing(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? "";
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return (
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42703" ||
    code === "42P01" ||
    /Could not find the (table|column)|column .* does not exist|Bucket not found/i.test(msg)
  );
}

// ================= YouTube =================

/**
 * ดึงรหัสคลิปจากลิงก์ YouTube ทุกแบบที่เจอบ่อย
 *
 * รองรับ: youtu.be/ID · /watch?v=ID · /shorts/ID · /embed/ID · /live/ID
 * หรือจะวางรหัส 11 ตัวมาตรง ๆ ก็ได้
 */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // วางรหัสมาตรง ๆ
  if (/^[\w-]{11}$/.test(s)) return s;

  let u: URL;
  try {
    u = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;

  const v = u.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;

  const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
  return m ? m[1] : null;
}

/** รูปปกของคลิป ใช้โชว์ในหน้าจัดการ */
export function youtubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/**
 * ลิงก์ฝังสำหรับจอลูกค้า
 *
 * mute=1 บังคับ — เบราว์เซอร์ทุกตัวบล็อก autoplay ที่มีเสียง ไม่มีทางเลี่ยง
 * loop=1 ต้องคู่กับ playlist=<รหัสเดิม> ไม่งั้นเล่นจบแล้วหยุด
 * cc_load_policy=0 ไม่เปิดซับไตเติ้ล — จอนี้ไม่ได้ล็อกอิน YouTube
 * จึงไม่มีค่าที่ผู้ใช้เคยตั้งไว้มาบังคับเปิดซับทับ
 */
export function youtubeEmbedUrl(id: string): string {
  const p = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    loop: "1",
    playlist: id,
    controls: "0",
    disablekb: "1",
    fs: "0",
    rel: "0",
    modestbranding: "1",
    iv_load_policy: "3", // ปิดคำอธิบาย/ป้ายที่ลอยบนคลิป
    cc_load_policy: "0", // ไม่เปิดซับไตเติ้ล
    playsinline: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
}

// ================= รูปภาพ =================

/** ย่อ + บีบอัดรูปในเบราว์เซอร์ก่อนบันทึก (ของเดิม ย้ายมารวมไว้ที่นี่) */
export async function compressImage(file: File, maxWidth = 1200, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("เบราว์เซอร์นี้ย่อรูปไม่ได้");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

// ================= อ่าน/เขียนรายการ =================

const COLUMNS =
  "id,name,kind,data_url,youtube_id,video_url,video_path,duration_sec,fit,is_active,sort_order,created_at";

export async function listMedia(): Promise<PromoMedia[]> {
  const { data, error } = await supabase
    .from("promo_images")
    .select(COLUMNS)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissing(error)) throw new MediaNotReady();
    throw error;
  }
  return (data ?? []) as PromoMedia[];
}

async function insertRow(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("promo_images").insert(row);
  if (error) {
    if (isMissing(error)) throw new MediaNotReady();
    throw error;
  }
}

export async function addImage(name: string, file: File, sortOrder: number): Promise<void> {
  const dataUrl = await compressImage(file);
  await insertRow({
    name,
    kind: "image",
    data_url: dataUrl,
    fit: "contain",
    is_active: true,
    sort_order: sortOrder,
  });
}

export async function addYouTube(
  name: string,
  urlOrId: string,
  sortOrder: number,
  opts: { durationSec?: number | null; fit?: MediaFit } = {},
): Promise<void> {
  const id = parseYouTubeId(urlOrId);
  if (!id) throw new Error("ลิงก์ YouTube ไม่ถูกต้อง — วางลิงก์คลิปหรือรหัส 11 ตัว");
  await insertRow({
    name,
    kind: "youtube",
    youtube_id: id,
    duration_sec: opts.durationSec ?? null,
    fit: opts.fit ?? "cover",
    is_active: true,
    sort_order: sortOrder,
  });
}

/**
 * อัปโหลดวิดีโอขึ้น Storage แล้วบันทึกลิงก์
 *
 * ไม่มีแถบเปอร์เซ็นต์ เพราะ supabase-js ไม่ได้บอกความคืบหน้ามา
 * บอกแค่ "กำลังอัปโหลด" ตามจริง ดีกว่าโชว์ตัวเลขปลอม
 */
export async function addVideo(
  name: string,
  file: File,
  sortOrder: number,
  opts: { fit?: MediaFit } = {},
): Promise<void> {
  const mb = file.size / 1024 / 1024;
  if (mb > MAX_VIDEO_MB) {
    throw new Error(
      `ไฟล์ใหญ่ ${mb.toFixed(1)} MB เกินเพดาน ${MAX_VIDEO_MB} MB — ลองตัดคลิปให้สั้นลงหรือลดความละเอียด`,
    );
  }

  const ext = (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const up = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type || "video/mp4", upsert: false });
  if (up.error) {
    if (isMissing(up.error)) throw new MediaNotReady("ยังไม่ได้สร้างที่เก็บวิดีโอ");
    throw up.error;
  }

  const url = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;

  try {
    await insertRow({
      name,
      kind: "video",
      video_url: url,
      video_path: path,
      fit: opts.fit ?? "cover",
      is_active: true,
      sort_order: sortOrder,
    });
  } catch (e) {
    // บันทึกแถวไม่สำเร็จ — เก็บกวาดไฟล์ทิ้ง ไม่ให้เหลือขยะใน Storage
    await supabase.storage
      .from(MEDIA_BUCKET)
      .remove([path])
      .catch(() => {});
    throw e;
  }
}

export async function updateMedia(
  id: string,
  patch: Partial<Pick<PromoMedia, "name" | "duration_sec" | "fit" | "is_active" | "sort_order">>,
): Promise<void> {
  const { error } = await supabase.from("promo_images").update(patch).eq("id", id);
  if (error) {
    if (isMissing(error)) throw new MediaNotReady();
    throw error;
  }
}

/** ลบรายการ — ถ้าเป็นวิดีโอที่อัปโหลดไว้ ลบไฟล์ใน Storage ด้วย */
export async function removeMedia(item: PromoMedia): Promise<void> {
  const { error } = await supabase.from("promo_images").delete().eq("id", item.id);
  if (error) throw error;
  if (item.kind === "video" && item.video_path) {
    await supabase.storage
      .from(MEDIA_BUCKET)
      .remove([item.video_path])
      .catch((e) => console.warn("[promo] ลบไฟล์วิดีโอไม่สำเร็จ:", e));
  }
}

/** สลับลำดับกับรายการที่อยู่ติดกัน */
export async function moveMedia(items: PromoMedia[], index: number, dir: -1 | 1): Promise<void> {
  const to = index + dir;
  if (to < 0 || to >= items.length) return;
  const a = items[index];
  const b = items[to];
  await Promise.all([
    updateMedia(a.id, { sort_order: to }),
    updateMedia(b.id, { sort_order: index }),
  ]);
}

/** เวลาแสดงของรายการนี้ (วินาที) — วิดีโออัปโหลดคืน null = เล่นจนจบคลิป */
export function slideSeconds(m: PromoMedia): number | null {
  if (m.duration_sec && m.duration_sec > 0) return m.duration_sec;
  if (m.kind === "image") return DEFAULT_IMAGE_SEC;
  if (m.kind === "youtube") return DEFAULT_YOUTUBE_SEC;
  return null;
}
