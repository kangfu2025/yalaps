import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { getShopStatus, SHOP_CLOSED_MESSAGE, type ShopStatus } from "@/lib/shopShift";

interface ShopCtx {
  status: ShopStatus | null;
  /** true = ร้านปิดและตัวกันทำงานอยู่ → ห้ามเริ่ม session */
  blocked: boolean;
  refresh: () => Promise<void>;
  /**
   * เรียกก่อนเปิดหน้าต่างเปิดเครื่อง — ถ้าร้านปิดจะแจ้งเตือนและคืน false
   * กันไว้ตั้งแต่ก่อนพนักงานกรอกข้อมูลหรือรับเงินลูกค้า
   */
  guardStart: () => boolean;
}

const Ctx = createContext<ShopCtx | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ShopStatus | null>(null);

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

  const blocked = !!status && status.installed && status.gate && !status.open;

  const guardStart = useCallback(() => {
    if (blocked) {
      alert(SHOP_CLOSED_MESSAGE);
      return false;
    }
    return true;
  }, [blocked]);

  return <Ctx.Provider value={{ status, blocked, refresh, guardStart }}>{children}</Ctx.Provider>;
}

export function useShop(): ShopCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShop ต้องอยู่ใน ShopProvider");
  return ctx;
}
