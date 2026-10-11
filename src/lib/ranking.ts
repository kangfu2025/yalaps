import { supabase } from "./supabase";
import type { Member } from "./members";

/**
 * อันดับลูกค้าประจำ — อ่านอย่างเดียวจากระบบสมาชิก/แต้มเดิม
 *
 * การคิดอันดับทั้งหมดอยู่ในฐานข้อมูล (supabase/ranking_migration.sql)
 *   ตลอดกาล  = members.lifetime_points
 *   รายเดือน = แต้มจากการเล่นจริง (earn_play) ในเดือนนั้น ตามเวลาไทย
 * ไฟล์นี้แค่เรียกฟังก์ชันพวกนั้น ไม่คิดแต้มซ้ำเองอีกสูตร
 */

export type RankPeriod = "month" | "all";

/** แถวสำหรับหน้าแอดมิน/พนักงาน (มีชื่อจริง ไม่มีเบอร์โทร) */
export interface RankRow {
  rank: number;
  member_id: string;
  name: string;
  display_name: string | null;
  /** ลูกค้าขอไม่แสดงบนจออันดับในร้าน */
  hide_from_ranking: boolean;
  avatar_url: string | null;
  points: number;
  last_earned_at: string | null;
}

export interface RankResult {
  period: RankPeriod;
  month: string | null;
  /** จำนวนสมาชิกที่มีแต้มในช่วงนี้ทั้งหมด (ไม่ใช่แค่ที่แสดง) */
  total: number;
  generated_at: string;
  rows: RankRow[];
}

/** แถวสำหรับจอสาธารณะ — มีแค่ อันดับ ชื่อ (ชื่อเล่นหรือชื่อสมาชิก) รูป แต้ม */
export interface PublicRankRow {
  rank: number;
  name: string;
  avatar_url: string | null;
  points: number;
}

export interface PublicRankResult {
  period: RankPeriod;
  month: string | null;
  generated_at: string;
  rows: PublicRankRow[];
}

/** ยังไม่ได้รัน ranking_migration.sql */
export class RankingNotReady extends Error {
  constructor() {
    super("ยังไม่ได้ติดตั้งระบบอันดับลูกค้า — รัน supabase/ranking_migration.sql ใน Supabase");
    this.name = "RankingNotReady";
  }
}

function isMissing(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? "";
  const msg = (e as { message?: string } | null)?.message ?? String(e ?? "");
  return (
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "42883" ||
    code === "42703" ||
    /Could not find the (function|.*column)/i.test(msg)
  );
}

function toError(e: unknown): Error {
  if (isMissing(e)) return new RankingNotReady();
  const msg = (e as { message?: string } | null)?.message;
  return new Error(msg || String(e));
}

export async function getRanking(
  period: RankPeriod,
  month?: string | null,
  limit = 20,
): Promise<RankResult> {
  const { data, error } = await supabase.rpc("ranking_list", {
    p_period: period,
    p_month: period === "month" ? (month ?? null) : null,
    p_limit: limit,
  });
  if (error) throw toError(error);
  return data as RankResult;
}

export async function getPublicRanking(
  period: RankPeriod,
  month?: string | null,
): Promise<PublicRankResult> {
  const { data, error } = await supabase.rpc("ranking_public", {
    p_period: period,
    p_month: period === "month" ? (month ?? null) : null,
  });
  if (error) throw toError(error);
  return data as PublicRankResult;
}

// ============================================================
// โปรไฟล์บนจออันดับ (ชื่อเล่น / ซ่อนจากจอ / รูป)
// ============================================================

export type RankingProfile = Pick<
  Member,
  "id" | "display_name" | "hide_from_ranking" | "avatar_url" | "avatar_path"
>;

export async function getRankingProfile(memberId: string): Promise<RankingProfile> {
  const { data, error } = await supabase
    .from("members")
    .select("id, display_name, hide_from_ranking, avatar_url, avatar_path")
    .eq("id", memberId)
    .single();
  if (error) throw toError(error);
  return data as RankingProfile;
}

export const DISPLAY_NAME_MAX = 24;

/**
 * ตั้งชื่อเล่น (ว่าง = ใช้ชื่อสมาชิก) และซ่อน/ไม่ซ่อนจากจออันดับ
 * พนักงานทำได้ — ค่าเริ่มต้นทุกคนขึ้นจอ ซ่อนเฉพาะคนที่ลูกค้าขอ
 */
export async function saveRankingProfile(
  memberId: string,
  displayName: string,
  hide: boolean,
): Promise<void> {
  const name = displayName.trim().slice(0, DISPLAY_NAME_MAX);
  const { error } = await supabase
    .from("members")
    .update({ display_name: name || null, hide_from_ranking: hide })
    .eq("id", memberId);
  if (error) throw toError(error);
}

const AVATAR_BUCKET = "member-avatars";
const AVATAR_SIZE = 512;

/**
 * ย่อ + ครอปกลางให้เป็นสี่เหลี่ยมจัตุรัส 512px ก่อนอัปโหลด
 * รูปจากมือถือ 3–5 MB จะเหลือราว 50–150 KB จอลูกค้าโหลดเร็วและไม่กินพื้นที่ Storage
 */
async function squareImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("ไฟล์นี้ไม่ใช่รูปภาพ");
  if (file.size > 20 * 1024 * 1024) throw new Error("รูปใหญ่เกิน 20 MB");

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("เปิดรูปนี้ไม่ได้ ลองใช้ไฟล์ JPG หรือ PNG");
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  // รูปคนส่วนใหญ่หน้าอยู่ค่อนบน — ครอปแนวตั้งเยื้องขึ้นเล็กน้อย
  const sy = Math.max(0, (bitmap.height - side) * 0.3);
  const out = Math.min(AVATAR_SIZE, side);

  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("เบราว์เซอร์นี้ย่อรูปไม่ได้");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
  bitmap.close();

  const toBlob = (type: string, q: number) =>
    new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  // Safari บางรุ่นสร้าง webp ไม่ได้ (คืน png มาแทน) — ถอยไปใช้ jpeg
  let blob = await toBlob("image/webp", 0.85);
  if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg", 0.88);
  if (!blob) throw new Error("ย่อรูปไม่สำเร็จ");
  return blob;
}

/** เพิ่ม/เปลี่ยนรูปสมาชิก (พนักงาน/แอดมิน — Storage และ trigger ในฐานข้อมูลตรวจสิทธิ์ซ้ำ) */
export async function uploadMemberAvatar(
  profile: RankingProfile,
  file: File,
): Promise<RankingProfile> {
  const blob = await squareImage(file);
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${profile.id}/${crypto.randomUUID()}.${ext}`;

  const up = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
  if (up.error) {
    if (/bucket not found/i.test(up.error.message)) throw new RankingNotReady();
    throw new Error(up.error.message);
  }
  const url = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;

  const { error } = await supabase
    .from("members")
    .update({ avatar_url: url, avatar_path: path })
    .eq("id", profile.id);
  if (error) {
    // บันทึกลงสมาชิกไม่ได้ -> ลบไฟล์ที่เพิ่งอัปทิ้ง ไม่ให้มีไฟล์กำพร้า
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    throw toError(error);
  }

  // ลบรูปเก่าหลังผูกรูปใหม่สำเร็จแล้ว (ลบไม่ได้ก็ไม่เป็นไร ไม่กระทบการแสดงผล)
  if (profile.avatar_path && profile.avatar_path !== path) {
    await supabase.storage.from(AVATAR_BUCKET).remove([profile.avatar_path]);
  }
  return { ...profile, avatar_url: url, avatar_path: path };
}

/** ลบรูป -> กลับไปใช้ Avatar เริ่มต้น */
export async function removeMemberAvatar(profile: RankingProfile): Promise<RankingProfile> {
  const { error } = await supabase
    .from("members")
    .update({ avatar_url: null, avatar_path: null })
    .eq("id", profile.id);
  if (error) throw toError(error);
  if (profile.avatar_path) {
    await supabase.storage.from(AVATAR_BUCKET).remove([profile.avatar_path]);
  }
  return { ...profile, avatar_url: null, avatar_path: null };
}

// ============================================================
// ตัวช่วยแสดงผล
// ============================================================

/** เดือนปัจจุบันตามเวลาไทย YYYY-MM */
export function currentRankMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

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

/** "2026-10" -> "ตุลาคม 2569" (จอลูกค้าใช้ พ.ศ. ให้อ่านง่าย) */
export function rankMonthLabel(key: string | null | undefined): string {
  if (!key) return "";
  const [y, m] = key.split("-").map(Number);
  return `${THAI_MONTHS[m - 1] ?? m} ${y + 543}`;
}
