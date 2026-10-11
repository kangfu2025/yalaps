import { useState } from "react";
import { Crown, Gamepad2, ChevronUp } from "lucide-react";

/**
 * ชิ้นส่วนแสดงอันดับ ใช้ร่วมกันทั้งหน้าแอดมิน (แท็บอันดับลูกค้า) และจอลูกค้า /ranking
 * รับข้อมูลที่แปลงแล้ว (BoardEntry) จึงไม่รู้ว่ามาจากฟังก์ชันไหน — หน้าสาธารณะไม่มีทางได้ชื่อจริง
 */

export interface BoardEntry {
  key: string;
  rank: number;
  name: string;
  /** บรรทัดรอง (เฉพาะหน้าแอดมิน เช่น ชื่อจริง) */
  sub?: string;
  avatarUrl: string | null;
  points: number;
  /** หน้าแอดมิน: คนนี้ไม่ได้ยินยอม จึงไม่ขึ้นบนจอลูกค้า */
  hidden?: boolean;
  /** อันดับขยับขึ้นจากรอบก่อน (จอลูกค้า) */
  movedUp?: boolean;
}

const TIER = ["gold", "silver", "bronze"] as const;

/** ตัวอักษรแรกที่อ่านเป็นตัว — ข้ามสระหน้าภาษาไทย (เ แ โ ใ ไ) */
function initialOf(name: string): string {
  const chars = Array.from(name.trim());
  const c = chars.find((ch) => !/[เ-ไ\s]/.test(ch));
  return (c ?? "").toUpperCase();
}

/** สีพื้นของ Avatar เริ่มต้น — คนเดิมได้สีเดิมทุกครั้ง */
function hueOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

export function RankAvatar({
  url,
  name,
  className = "",
}: {
  url: string | null;
  name: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImg = !!url && !broken;
  const hue = hueOf(name);
  const initial = initialOf(name);

  return (
    <span
      className={`yl-rk-avatar ${showImg ? "" : "is-default"} ${className}`}
      style={
        showImg
          ? undefined
          : {
              background: `linear-gradient(140deg, hsl(${hue} 85% 58%), hsl(${(hue + 60) % 360} 80% 38%))`,
            }
      }
    >
      {showImg ? (
        <img src={url!} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : initial ? (
        <span className="yl-rk-initial">{initial}</span>
      ) : (
        <Gamepad2 className="yl-rk-pad" />
      )}
    </span>
  );
}

function fmtPts(n: number): string {
  return n.toLocaleString("en-US");
}

/** แท่นรางวัล 3 อันดับแรก — วางเป็น 2 · 1 · 3 */
export function RankPodium({
  entries,
  onPick,
}: {
  entries: BoardEntry[];
  onPick?: (e: BoardEntry) => void;
}) {
  const top = entries.slice(0, 3);
  if (top.length === 0) return null;
  const order = [top[1], top[0], top[2]];

  return (
    <div className="yl-rk-podium">
      {order.map((e, i) => {
        const place = i === 1 ? 0 : i === 0 ? 1 : 2; // 0 = ที่ 1
        if (!e) return <div key={`empty-${place}`} className="yl-rk-step is-empty" />;
        const tier = TIER[place];
        const Tag = onPick ? "button" : "div";
        return (
          <Tag
            key={e.key}
            type={onPick ? "button" : undefined}
            className={`yl-rk-step is-${tier} ${e.hidden ? "is-hidden" : ""}`}
            style={{ animationDelay: `${[0.15, 0, 0.3][place]}s` }}
            onClick={onPick ? () => onPick(e) : undefined}
          >
            <div className="yl-rk-hero">
              {place === 0 && <Crown className="yl-rk-crown" aria-hidden />}
              <span className="yl-rk-ring">
                <RankAvatar url={e.avatarUrl} name={e.name} />
              </span>
              <span className="yl-rk-medal" aria-label={`อันดับ ${e.rank}`}>
                {e.rank}
              </span>
            </div>
            <div className="yl-rk-name" title={e.name}>
              <span className="yl-rk-txt">{e.name}</span>
              {e.movedUp && <ChevronUp className="yl-rk-up" aria-label="อันดับขึ้น" />}
            </div>
            {e.sub && <div className="yl-rk-sub">{e.sub}</div>}
            {e.hidden && <span className="yl-rk-hidden-tag">ไม่แสดงบนจอ</span>}
            <div className="yl-rk-pts">
              {fmtPts(e.points)}
              <small>PTS</small>
            </div>
            <div className="yl-rk-block">
              <span>{["1ST", "2ND", "3RD"][place]}</span>
            </div>
          </Tag>
        );
      })}
    </div>
  );
}

/** อันดับ 4 ลงไป */
export function RankList({
  entries,
  topPoints,
  onPick,
}: {
  entries: BoardEntry[];
  topPoints: number;
  onPick?: (e: BoardEntry) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <ol className="yl-rk-list">
      {entries.map((e, i) => {
        const pct = topPoints > 0 ? Math.max(4, Math.round((e.points / topPoints) * 100)) : 0;
        const inner = (
          <>
            <span className="yl-rk-no">{e.rank}</span>
            <RankAvatar url={e.avatarUrl} name={e.name} className="is-sm" />
            <span className="yl-rk-who">
              <b>
                <span className="yl-rk-txt">{e.name}</span>
                {e.movedUp && <ChevronUp className="yl-rk-up" aria-label="อันดับขึ้น" />}
                {e.hidden && <span className="yl-rk-hidden-tag">ไม่แสดงบนจอ</span>}
              </b>
              {e.sub && <em>{e.sub}</em>}
              <span className="yl-rk-bar">
                <i style={{ width: `${pct}%` }} />
              </span>
            </span>
            <span className="yl-rk-score">
              {fmtPts(e.points)}
              <small>PTS</small>
            </span>
          </>
        );
        return (
          <li
            key={e.key}
            className={e.hidden ? "is-hidden" : undefined}
            style={{ animationDelay: `${0.35 + i * 0.05}s` }}
          >
            {onPick ? (
              <button type="button" onClick={() => onPick(e)}>
                {inner}
              </button>
            ) : (
              <div>{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
