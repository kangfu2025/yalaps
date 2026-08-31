import { useEffect, useState } from "react";
import { supabase, type Machine, type Reservation } from "@/lib/supabase";
import { ensureAllMachines } from "@/lib/machines";
import { getActivePromotion, listPromotions, type Promotion } from "@/lib/promotions";

export function useShopData() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [activeReservations, setActiveReservations] = useState<Reservation[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const ms = await ensureAllMachines();
      setMachines(ms);
      const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .eq("status", "playing");
      if (error) throw error;
      setActiveReservations(data ?? []);

      // โหลดโปรโมชั่น (ถ้าตารางยังไม่ถูกสร้าง — เงียบไว้ ไม่ทำให้ระบบพัง)
      try {
        const ps = await listPromotions();
        setPromotions(ps);
      } catch (e) {
        console.warn("[shop] load promotions failed (table may not exist):", e);
        setPromotions([]);
      }

      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      console.error("[shop] refresh failed:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("shop-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "machines" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "promotions" }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const resByMachine = new Map<string, Reservation>();
  for (const m of machines) {
    if (m.current_reservation_id) {
      const r = activeReservations.find((x) => x.id === m.current_reservation_id);
      if (r) resByMachine.set(m.id, r);
    }
  }

  const activePromotion = getActivePromotion(promotions);

  return { machines, activeReservations, promotions, activePromotion, resByMachine, loading, error, refresh };
}
