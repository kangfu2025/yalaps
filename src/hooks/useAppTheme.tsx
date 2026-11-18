import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  applyTheme,
  fetchTheme,
  readCachedTheme,
  saveTheme,
  subscribeTheme,
  FALLBACK_THEME,
  type AppTheme,
} from "@/lib/theme";

interface ThemeCtx {
  theme: AppTheme;
  /** false = ยังไม่ได้รัน theme_migration.sql (สลับไม่ได้) */
  installed: boolean;
  saving: boolean;
  /** แอดมินเท่านั้น — ฐานข้อมูลปฏิเสธถ้าไม่ใช่ */
  setTheme: (t: AppTheme) => Promise<void>;
}

const Ctx = createContext<ThemeCtx | null>(null);

/**
 * ใส่ไว้ที่ root ครั้งเดียว ทุกหน้า (รวมจอลูกค้า) ได้ธีมตามค่าในฐานข้อมูล
 * และเปลี่ยนตามทันทีเมื่อแอดมินกดสลับจากเครื่องไหนก็ได้
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setLocal] = useState<AppTheme>(FALLBACK_THEME);
  const [installed, setInstalled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const cached = readCachedTheme();
    if (cached) setLocal(cached);

    let alive = true;
    fetchTheme()
      .then((t) => {
        if (!alive) return;
        if (t === null) {
          setInstalled(false);
          setLocal(FALLBACK_THEME);
          applyTheme(FALLBACK_THEME);
          return;
        }
        setLocal(t);
        applyTheme(t);
      })
      .catch((e) => console.warn("[theme] load failed:", e));

    const off = subscribeTheme((t) => {
      setLocal(t);
      applyTheme(t);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const setTheme = useCallback(
    async (t: AppTheme) => {
      if (saving) return;
      const prev = theme;
      setSaving(true);
      setLocal(t);
      applyTheme(t);
      try {
        await saveTheme(t);
      } catch (e) {
        setLocal(prev);
        applyTheme(prev);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [saving, theme],
  );

  return <Ctx.Provider value={{ theme, installed, saving, setTheme }}>{children}</Ctx.Provider>;
}

export function useAppTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppTheme must be used inside AppThemeProvider");
  return v;
}
