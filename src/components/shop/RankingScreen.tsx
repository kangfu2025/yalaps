import { useCallback, useEffect, useRef, useState } from "react";
import { Trophy, Star } from "lucide-react";
import {
  getPublicRanking,
  rankMonthLabel,
  RankingNotReady,
  type PublicRankResult,
  type RankPeriod,
} from "@/lib/ranking";
import { RankList, RankPodium, type BoardEntry } from "./RankingBoard";

/**
 * กระดานอันดับลูกค้าเต็มจอ — ใช้ในจอลูกค้า /display (สลับกับรูปโปรโมชั่น)
 *
 * อ่านผ่าน ranking_public() เท่านั้น ซึ่งคืนแค่ ชื่อ (ชื่อเล่นหรือชื่อสมาชิก) รูป แต้ม อันดับ
 * ไม่มีเบอร์โทรหรือรหัสสมาชิก · ลูกค้าที่ขอซ่อนจะไม่ขึ้นจอ
 */

const REFRESH_MS = 30_000;
const PERIODS: RankPeriod[] = ["month", "all"];

export interface PublicRanking {
  data: Record<RankPeriod, PublicRankResult | null>;
  movedUp: Record<RankPeriod, Set<string>>;
  error: string | null;
  /** โหลดเสร็จอย่างน้อยหนึ่งครั้ง (สำเร็จหรือพลาดก็ได้) */
  loaded: boolean;
}

/** โหลดอันดับทั้งประจำเดือนและตลอดกาลไว้ล่วงหน้า + ถามใหม่ทุก 30 วินาที */
export function usePublicRanking(): PublicRanking {
  const [data, setData] = useState<Record<RankPeriod, PublicRankResult | null>>({
    month: null,
    all: null,
  });
  const [movedUp, setMovedUp] = useState<Record<RankPeriod, Set<string>>>({
    month: new Set(),
    all: new Set(),
  });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const prevRanks = useRef<Record<RankPeriod, Map<string, number> | null>>({
    month: null,
    all: null,
  });

  const load = useCallback(async () => {
    try {
      const results = await Promise.all(PERIODS.map((p) => getPublicRanking(p)));
      const nextData: Partial<Record<RankPeriod, PublicRankResult>> = {};
      const nextUp: Partial<Record<RankPeriod, Set<string>>> = {};
      results.forEach((r, i) => {
        const p = PERIODS[i];
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
    } finally {
      setLoaded(true);
    }
  }, []);

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

  return { data, movedUp, error, loaded };
}

/** ช่วงอันดับที่มีคนอยู่จริง (ไว้ตัดสินว่าจะสลับมาแสดงอันดับไหม) */
export function rankingPeriodsWithRows(r: PublicRanking): RankPeriod[] {
  return PERIODS.filter((p) => (r.data[p]?.rows.length ?? 0) > 0);
}

export function RankingScreen({
  ranking,
  period,
  periods,
}: {
  ranking: PublicRanking;
  period: RankPeriod;
  /** ช่วงที่วนแสดงอยู่ (ใช้วาดจุดบอกตำแหน่ง) */
  periods: RankPeriod[];
}) {
  // แตะจอ = เต็มจอ (จอในร้านไม่มีคีย์บอร์ด)
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };

  const current = ranking.data[period];
  const ups = ranking.movedUp[period];
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
        {periods.length > 1 && (
          <div className="yl-rk-dots" aria-hidden>
            {periods.map((p) => (
              <i key={p} className={period === p ? "on" : ""} />
            ))}
          </div>
        )}
      </header>

      <main className="yl-rk-stage is-screen" key={period}>
        {entries.length === 0 ? (
          <div className="yl-rk-empty is-screen">
            <Trophy size={64} />
            <b>{current ? "ยังไม่มีอันดับในช่วงนี้" : (ranking.error ?? "กำลังโหลดอันดับ...")}</b>
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
        {ranking.error && entries.length > 0 && (
          <span className="yl-rk-offline">{ranking.error}</span>
        )}
      </footer>
    </div>
  );
}
