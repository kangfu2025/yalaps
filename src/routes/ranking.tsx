import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trophy, Star } from "lucide-react";
import {
  getPublicRanking,
  rankMonthLabel,
  RankingNotReady,
  type PublicRankResult,
  type RankPeriod,
} from "@/lib/ranking";
import { RankList, RankPodium, type BoardEntry } from "@/components/shop/RankingBoard";

/**
 * จออันดับลูกค้า — เปิดบนจอแนวตั้งในร้านแบบเต็มจอ ไม่ต้องล็อกอิน
 *
 * อ่านผ่าน ranking_public() เท่านั้น ซึ่งคืนแค่ ชื่อ (ชื่อเล่นหรือชื่อสมาชิก) รูป แต้ม อันดับ
 * ไม่มีเบอร์โทรหรือรหัสสมาชิก · ลูกค้าที่ขอซ่อนจะไม่ขึ้นจอ
 *
 * ?period=month   อันดับประจำเดือนอย่างเดียว
 * ?period=all     อันดับตลอดกาลอย่างเดียว
 * (ไม่ใส่)         สลับสองแบบทุก 20 วินาที
 */
export const Route = createFileRoute("/ranking")({
  ssr: false,
  head: () => ({
    meta: [{ title: "อันดับลูกค้า — YALA PLAYSTATION" }],
  }),
  component: RankingScreen,
});

const REFRESH_MS = 30_000;
const SWITCH_MS = 20_000;

function readMode(): RankPeriod | "auto" {
  if (typeof window === "undefined") return "auto";
  const p = new URLSearchParams(window.location.search).get("period");
  return p === "month" || p === "all" ? p : "auto";
}

function RankingScreen() {
  const [mode] = useState(readMode);
  const [period, setPeriod] = useState<RankPeriod>(mode === "all" ? "all" : "month");
  const [data, setData] = useState<Record<RankPeriod, PublicRankResult | null>>({
    month: null,
    all: null,
  });
  const [movedUp, setMovedUp] = useState<Record<RankPeriod, Set<string>>>({
    month: new Set(),
    all: new Set(),
  });
  const [error, setError] = useState<string | null>(null);
  const prevRanks = useRef<Record<RankPeriod, Map<string, number> | null>>({
    month: null,
    all: null,
  });

  const load = useCallback(async () => {
    const periods: RankPeriod[] = mode === "auto" ? ["month", "all"] : [mode];
    try {
      const results = await Promise.all(periods.map((p) => getPublicRanking(p)));
      const nextData: Partial<Record<RankPeriod, PublicRankResult>> = {};
      const nextUp: Partial<Record<RankPeriod, Set<string>>> = {};
      results.forEach((r, i) => {
        const p = periods[i];
        nextData[p] = r;
        // เทียบกับรอบก่อน: ใครอันดับดีขึ้นได้ลูกศรขึ้น (รอบแรกยังไม่มีอะไรให้เทียบ)
        const before = prevRanks.current[p];
        const up = new Set<string>();
        const now = new Map<string, number>();
        for (const row of r.rows) {
          now.set(row.name, row.rank);
          const old = before?.get(row.name);
          if (before && (old === undefined || row.rank < old)) up.add(row.name);
        }
        prevRanks.current[p] = now;
        nextUp[p] = up;
      });
      setData((d) => ({ ...d, ...nextData }));
      setMovedUp((m) => ({ ...m, ...nextUp }));
      setError(null);
    } catch (e) {
      setError(
        e instanceof RankingNotReady
          ? "ยังไม่ได้ติดตั้งระบบอันดับลูกค้า"
          : "เชื่อมต่อไม่ได้ชั่วคราว — กำลังลองใหม่",
      );
    }
  }, [mode]);

  // โหลด + ถามใหม่เป็นระยะ + ทันทีที่จอกลับมาทำงาน
  useEffect(() => {
    void load();
    const t = setInterval(load, REFRESH_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  // สลับประจำเดือน / ตลอดกาล
  useEffect(() => {
    if (mode !== "auto") return;
    const t = setInterval(() => setPeriod((p) => (p === "month" ? "all" : "month")), SWITCH_MS);
    return () => clearInterval(t);
  }, [mode]);

  // แตะจอ = เต็มจอ (จอในร้านไม่มีคีย์บอร์ด)
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };

  const current = data[period];
  const ups = movedUp[period];
  const entries: BoardEntry[] = (current?.rows ?? []).map((r, i) => ({
    key: `${period}-${i}-${r.name}`,
    rank: r.rank,
    name: r.name,
    avatarUrl: r.avatar_url,
    points: r.points,
    movedUp: ups.has(r.name),
  }));
  const topPoints = entries[0]?.points ?? 0;
  const title =
    period === "month" ? `ประจำเดือน${rankMonthLabel(current?.month)}` : "แต้มสะสมตลอดกาล";

  return (
    <div className="yl-rk-screen" onClick={toggleFullscreen}>
      <div className="yl-rk-bg" aria-hidden>
        <span className="yl-rk-grid" />
        <span className="yl-rk-orb a" />
        <span className="yl-rk-orb b" />
      </div>

      <header className="yl-rk-head">
        <div className="yl-rk-brand">YALA PLAYSTATION</div>
        <h1 className="yl-rk-title">
          <Trophy className="yl-rk-title-ico" aria-hidden />
          อันดับลูกค้าประจำ
        </h1>
        <div className="yl-rk-period" key={period}>
          {title}
        </div>
        {mode === "auto" && (
          <div className="yl-rk-dots" aria-hidden>
            <i className={period === "month" ? "on" : ""} />
            <i className={period === "all" ? "on" : ""} />
          </div>
        )}
      </header>

      <main className="yl-rk-stage is-screen" key={period}>
        {entries.length === 0 ? (
          <div className="yl-rk-empty is-screen">
            <Trophy size={64} />
            <b>{current ? "ยังไม่มีอันดับในช่วงนี้" : (error ?? "กำลังโหลดอันดับ...")}</b>
            <span>สมัครสมาชิก แล้วเล่นสะสมแต้ม เพื่อขึ้นจออันดับ</span>
          </div>
        ) : (
          <>
            <RankPodium entries={entries} />
            <RankList entries={entries.slice(3)} topPoints={topPoints} />
          </>
        )}
      </main>

      <footer className="yl-rk-foot">
        <span>
          <Star size={16} /> เล่นสะสมแต้ม · ไต่อันดับ · ชิงแชมป์ประจำเดือน
        </span>
        {error && entries.length > 0 && <span className="yl-rk-offline">{error}</span>}
      </footer>
    </div>
  );
}
