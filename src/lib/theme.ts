import { supabase } from "./supabase";

/**
 * ธีมของร้าน — ค่าเดียวใช้ทุกจอ (supabase/theme_migration.sql)
 *  - อ่านได้ทุกหน้า รวมจอลูกค้าที่ไม่ได้ล็อกอิน
 *  - เปลี่ยนได้เฉพาะแอดมินผ่าน set_app_theme() (ฐานข้อมูลตรวจสิทธิ์เอง)
 *  - จำค่าล่าสุดไว้ในเครื่อง เพื่อให้เปิดหน้ามาก็เป็นธีมที่ถูกทันที ไม่กะพริบ
 */

export type AppTheme = "classic" | "vice";

export const THEMES: { id: AppTheme; label: string }[] = [
  { id: "vice", label: "Vice Night" },
  { id: "classic", label: "ธีมเดิม" },
];

export const THEME_STORAGE_KEY = "yala-theme";
/** ยังไม่ได้รัน SQL = ใช้ธีมเดิม (หน้าตาเหมือนก่อนอัปเดต) */
export const FALLBACK_THEME: AppTheme = "classic";
export const THEME_SQL_FILE = "supabase/theme_migration.sql";

export function isAppTheme(v: unknown): v is AppTheme {
  return v === "classic" || v === "vice";
}

export function readCachedTheme(): AppTheme | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isAppTheme(v) ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // โหมดส่วนตัว/บล็อก storage — ใช้ได้ แค่จำค่าไม่ได้
  }
}

/**
 * สคริปต์เล็ก ๆ ใส่ใน <head> ให้ตั้งธีมก่อนหน้าเว็บวาด (กันหน้ากะพริบเป็นธีมผิด)
 * อ่านจากค่าที่จำไว้ในเครื่อง — ค่าจริงจากฐานข้อมูลจะตามมาแก้ให้ทันทีถ้าไม่ตรง
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});document.documentElement.setAttribute("data-theme",t==="vice"||t==="classic"?t:${JSON.stringify(
  FALLBACK_THEME,
)})}catch(e){document.documentElement.setAttribute("data-theme",${JSON.stringify(FALLBACK_THEME)})}})();`;

function isMissing(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? "";
  const msg = (e as { message?: string } | null)?.message ?? "";
  return (
    code === "PGRST202" ||
    code === "PGRST205" ||
    code === "42P01" ||
    code === "42883" ||
    /app_settings|set_app_theme|Could not find the (table|function)/i.test(msg)
  );
}

/** null = ยังไม่ได้รัน theme_migration.sql */
export async function fetchTheme(): Promise<AppTheme | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("theme")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(error.message);
  }
  const t = (data as { theme?: string } | null)?.theme;
  return isAppTheme(t) ? t : FALLBACK_THEME;
}

export async function saveTheme(theme: AppTheme): Promise<void> {
  const { error } = await supabase.rpc("set_app_theme", { p_theme: theme });
  if (error) {
    if (isMissing(error)) {
      throw new Error(`ยังไม่ได้เปิดใช้การสลับธีม — รันไฟล์ ${THEME_SQL_FILE} ใน Supabase ก่อน`);
    }
    throw new Error(error.message);
  }
}

/** ฟังการเปลี่ยนธีมจากเครื่องอื่น — คืนฟังก์ชันเลิกฟัง */
export function subscribeTheme(onChange: (t: AppTheme) => void): () => void {
  const ch = supabase
    .channel("app-theme")
    .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, (p) => {
      const t = (p.new as { theme?: string } | null)?.theme;
      if (isAppTheme(t)) onChange(t);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}
