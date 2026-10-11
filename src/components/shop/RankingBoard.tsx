import { useState } from "react";
import { Crown, ChevronUp } from "lucide-react";

/**
 * ชิ้นส่วนแสดงอันดับ ใช้ร่วมกันทั้งหน้าแอดมิน (แท็บอันดับลูกค้า) และจอลูกค้า /ranking
 * รับข้อมูลที่แปลงแล้ว (BoardEntry) จึงไม่รู้ว่ามาจากฟังก์ชันไหน
 */

export interface BoardEntry {
  key: string;
  rank: number;
  name: string;
  /** บรรทัดรอง (เฉพาะหน้าแอดมิน เช่น ชื่อจริง) */
  sub?: string;
  avatarUrl: string | null;
  points: number;
  /** หน้าแอดมิน: ลูกค้าขอซ่อน จึงไม่ขึ้นบนจอลูกค้า */
  hidden?: boolean;
  /** อันดับขยับขึ้นจากรอบก่อน (จอลูกค้า) */
  movedUp?: boolean;
}

const TIER = ["gold", "silver", "bronze"] as const;

/** ตัวเลขสุ่มคงที่จากชื่อ — คนเดิมได้การ์ตูนหน้าตาเดิมทุกครั้ง */
function seedOf(name: string): number {
  let h = 2166136261;
  for (const ch of name) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SKINS = [
  ["#ffe0bd", "#f2c39b"],
  ["#f5c89a", "#e0a877"],
  ["#e8b088", "#cf9064"],
  ["#c98d62", "#ad7148"],
];
const HAIRS = ["#2b1b14", "#4a2c1a", "#111827", "#7c3f1d", "#3b2f63"];
const ACCENTS = ["#22d3ee", "#a855f7", "#f472b6", "#4ade80", "#fbbf24", "#60a5fa"];
const HAIR_PATHS = [
  // ตั้งชี้
  "M27 41 C 25 24 38 15 50 15 C 64 15 76 24 73 41 L 68 31 L 62 37 L 57 26 L 50 34 L 44 25 L 38 35 L 32 29 Z",
  // ทรงกะลา
  "M27 43 C 24 24 37 14 50 14 C 64 14 77 24 73 43 C 70 32 62 27 50 27 C 39 27 30 32 27 43 Z",
  // ปัดข้าง
  "M27 42 C 25 22 40 13 55 15 C 69 17 77 28 73 41 C 66 30 52 33 41 25 C 36 31 31 36 27 42 Z",
  // ยาวประบ่า
  "M25 60 C 18 34 30 14 50 14 C 70 14 82 34 75 60 C 73 48 72 36 66 31 C 58 34 44 33 35 29 C 29 36 28 48 25 60 Z",
];

/**
 * รูปการ์ตูนเกมเมอร์ใส่หูฟัง — ใช้เมื่อสมาชิกยังไม่มีรูป
 * วาดเป็น SVG ในตัว (ไม่ต้องโหลดไฟล์) สี ทรงผม สีผิว เปลี่ยนตามชื่อ
 */
function CartoonAvatar({ seed }: { seed: string }) {
  const n = seedOf(seed || "?");
  const pick = <T,>(arr: T[], shift: number) => arr[(n >>> shift) % arr.length];
  const hue = n % 360;
  const [skin, skinShade] = pick(SKINS, 3);
  const hair = pick(HAIRS, 7);
  const accent = pick(ACCENTS, 11);
  const hairPath = pick(HAIR_PATHS, 15);
  const gid = `rkbg${n.toString(36)}`;

  return (
    <svg viewBox="0 0 100 100" className="yl-rk-cartoon" aria-hidden>
      <defs>
        <radialGradient id={gid} cx="50%" cy="35%" r="75%">
          <stop offset="0%" stopColor={`hsl(${hue} 80% 66%)`} />
          <stop offset="100%" stopColor={`hsl(${(hue + 40) % 360} 70% 32%)`} />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gid})`} />
      <circle cx="18" cy="20" r="22" fill="#fff" opacity="0.12" />
      {/* ตัว + เสื้อ */}
      <path
        d="M12 102 C 14 79 33 70 50 70 C 67 70 86 79 88 102 Z"
        fill={`hsl(${(hue + 180) % 360} 70% 52%)`}
      />
      <path d="M40 71 L 50 82 L 60 71 Z" fill={skinShade} />
      <rect x="43" y="58" width="14" height="14" rx="5" fill={skinShade} />
      {/* หัว */}
      <circle cx="27.5" cy="47" r="5" fill={skinShade} />
      <circle cx="72.5" cy="47" r="5" fill={skinShade} />
      <circle cx="50" cy="44" r="22" fill={skin} />
      <path d={hairPath} fill={hair} />
      {/* หน้า */}
      <ellipse cx="41" cy="46" rx="3.2" ry="4.2" fill="#2b1d3a" />
      <ellipse cx="59" cy="46" rx="3.2" ry="4.2" fill="#2b1d3a" />
      <circle cx="42.2" cy="44.6" r="1.2" fill="#fff" />
      <circle cx="60.2" cy="44.6" r="1.2" fill="#fff" />
      <ellipse cx="35" cy="53.5" rx="4" ry="2.4" fill="#ff7d98" opacity="0.5" />
      <ellipse cx="65" cy="53.5" rx="4" ry="2.4" fill="#ff7d98" opacity="0.5" />
      <path
        d="M43 54 Q 50 61.5 57 54"
        stroke="#7a2e3a"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      {/* หูฟังเกมมิ่ง */}
      <path
        d="M24.5 45 C 24 17 76 17 75.5 45"
        stroke="#1f1b33"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M24.5 45 C 24 17 76 17 75.5 45"
        stroke={accent}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="19" y="38" width="10" height="17" rx="4.5" fill="#1f1b33" />
      <rect x="71" y="38" width="10" height="17" rx="4.5" fill="#1f1b33" />
      <rect x="21" y="41" width="3" height="11" rx="1.5" fill={accent} />
      <rect x="76" y="41" width="3" height="11" rx="1.5" fill={accent} />
      <path
        d="M24 54 C 25 63 32 66 39 65"
        stroke="#1f1b33"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="40" cy="65" r="2.8" fill={accent} />
    </svg>
  );
}

export function RankAvatar({
  url,
  name,
  className = "",
}: {
  url: string | null;
  /** ใช้เลือกหน้าตารูปการ์ตูนเมื่อยังไม่มีรูป */
  name: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImg = !!url && !broken;

  return (
    <span className={`yl-rk-avatar ${showImg ? "" : "is-default"} ${className}`}>
      {showImg ? (
        <img src={url!} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <CartoonAvatar seed={name} />
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
            {e.hidden && <span className="yl-rk-hidden-tag">ซ่อนจากจอ</span>}
            <div className="yl-rk-pts">
              {fmtPts(e.points)}
              <small>แต้ม</small>
            </div>
            <div className="yl-rk-block">
              <span>อันดับ {e.rank}</span>
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
                {e.hidden && <span className="yl-rk-hidden-tag">ซ่อนจากจอ</span>}
              </b>
              {e.sub && <em>{e.sub}</em>}
              <span className="yl-rk-bar">
                <i style={{ width: `${pct}%` }} />
              </span>
            </span>
            <span className="yl-rk-score">
              {fmtPts(e.points)}
              <small>แต้ม</small>
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
