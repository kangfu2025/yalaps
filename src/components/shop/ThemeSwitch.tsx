import { Palette } from "lucide-react";
import { useAppTheme } from "@/hooks/useAppTheme";
import { useShop } from "@/hooks/useShop";
import { THEMES, THEME_SQL_FILE } from "@/lib/theme";

/**
 * ปุ่มสลับธีมในเมนูซ้าย — แอดมินกดได้ ทุกเครื่องและจอลูกค้าเปลี่ยนตามทันที
 * พนักงานเห็นว่าใช้ธีมอะไรอยู่ แต่กดเปลี่ยนไม่ได้ (ฐานข้อมูลกันอีกชั้น)
 */
export function ThemeSwitch({ isAdmin }: { isAdmin: boolean }) {
  const { theme, installed, saving, setTheme } = useAppTheme();
  const { notify } = useShop();
  const isVice = theme === "vice";
  const label = THEMES.find((t) => t.id === theme)?.label ?? theme;
  const canSwitch = isAdmin && installed && !saving;

  const hint = !installed
    ? `ยังไม่ได้เปิดใช้การสลับธีม — รัน ${THEME_SQL_FILE} ใน Supabase ก่อน`
    : !isAdmin
      ? "เปลี่ยนธีมได้เฉพาะแอดมิน"
      : isVice
        ? "กดเพื่อกลับไปใช้ธีมเดิม (ทุกจอเปลี่ยนตาม)"
        : "กดเพื่อใช้ธีม Vice Night (ทุกจอเปลี่ยนตาม)";

  async function toggle() {
    if (!canSwitch) return;
    const next = isVice ? "classic" : "vice";
    try {
      await setTheme(next);
      notify({
        kind: "success",
        title: `เปลี่ยนเป็น${next === "vice" ? "ธีม Vice Night" : "ธีมเดิม"} แล้ว`,
        text: "ทุกเครื่องและจอลูกค้าเปลี่ยนตามอัตโนมัติ",
      });
    } catch (e) {
      notify({
        kind: "warning",
        title: "เปลี่ยนธีมไม่สำเร็จ",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isVice}
      aria-label={`ธีม: ${label}`}
      className={`yl-sb-item yl-theme-switch ${canSwitch ? "" : "is-locked"}`}
      onClick={toggle}
      disabled={!canSwitch}
      title={hint}
    >
      <Palette size={17} className="yl-sb-ico" />
      <span className="yl-sb-label">ธีม: {label}</span>
      <span className={`yl-switch ${isVice ? "is-on" : ""}`} aria-hidden />
    </button>
  );
}
