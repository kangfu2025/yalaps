import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { getShopStatus, isShopClosedError, type ShopStatus } from "@/lib/shopShift";

/** แถบแจ้งเตือนมุมจอ (เปิดร้าน/ปิดร้าน/ถอนเงินสำเร็จ) */
export interface ShopToast {
  id: number;
  kind: "success" | "warning" | "info";
  title: string;
  text?: string;
}

interface ShopCtx {
  status: ShopStatus | null;
  /** true = ร้านปิดและตัวกันทำงานอยู่ → ห้ามเริ่ม session */
  blocked: boolean;
  refresh: () => Promise<void>;
  /**
   * เรียกก่อนเปิดหน้าต่างเปิดเครื่อง — ถ้าร้านปิดจะขึ้นหน้าต่าง "ร้านยังปิดอยู่" และคืน false
   * กันไว้ตั้งแต่ก่อนพนักงานกรอกข้อมูลหรือรับเงินลูกค้า
   */
  guardStart: () => boolean;
  /**
   * ใช้ใน catch ของการเปิดเครื่อง: ถ้า error มาจากร้านปิด (เช่นอีกเครื่องเพิ่งกดปิดร้าน
   * แล้วฐานข้อมูลปฏิเสธ) จะขึ้นหน้าต่างเปิดร้านให้และคืน true — ผู้เรียกไม่ต้อง alert ซ้ำ
   */
  handleStartError: (e: unknown) => boolean;
  /** หน้าต่าง "ร้านยังปิดอยู่" กำลังแสดงอยู่ไหม */
  closedPrompt: boolean;
  hideClosedPrompt: () => void;
  toast: ShopToast | null;
  notify: (t: Omit<ShopToast, "id">) => void;
  dismissToast: () => void;
}

const Ctx = createContext<ShopCtx | null>(null);

const TOAST_MS = 4500;

export function ShopProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ShopStatus | null>(null);
  const [closedPrompt, setClosedPrompt] = useState(false);
  const [toast, setToast] = useState<ShopToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getShopStatus());
    } catch (e) {
      console.warn("[shop] อ่านสถานะร้านไม่ได้:", e);
    }
  }, []);

  useEffect(() => {
    refresh();
    // ยอดลิ้นชักขยับตามบิลที่ปิด/สินค้าที่ขาย จึงถามใหม่เป็นระยะ
    // และถามทันทีเมื่อกลับมาที่แท็บนี้ (อีกเครื่องอาจเพิ่งเปิด/ปิดร้าน)
    const t = setInterval(refresh, 20_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    const ch = supabase
      .channel("shop-shift-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_shifts" }, () =>
        refresh(),
      )
      .subscribe();
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(ch);
    };
  }, [refresh]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const blocked = !!status && status.installed && status.gate && !status.open;

  const guardStart = useCallback(() => {
    if (blocked) {
      setClosedPrompt(true);
      return false;
    }
    return true;
  }, [blocked]);

  const handleStartError = useCallback(
    (e: unknown) => {
      if (!isShopClosedError(e)) return false;
      setClosedPrompt(true);
      void refresh();
      return true;
    },
    [refresh],
  );

  const hideClosedPrompt = useCallback(() => setClosedPrompt(false), []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const notify = useCallback((t: Omit<ShopToast, "id">) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ ...t, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  return (
    <Ctx.Provider
      value={{
        status,
        blocked,
        refresh,
        guardStart,
        handleStartError,
        closedPrompt,
        hideClosedPrompt,
        toast,
        notify,
        dismissToast,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useShop(): ShopCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShop ต้องอยู่ใน ShopProvider");
  return ctx;
}
