/**
 * สถานะเครื่องบนแดชบอร์ด — ใช้ร่วมกันทั้งการ์ด PS5 (โซฟา/รถแข่ง) และการ์ด PC
 * ไว้ให้ตัวกรองและตัวนับด้านบนนับแบบเดียวกับที่การ์ดแสดง
 */

/** เหลือเวลาไม่เกินเท่านี้ = "ใกล้หมดเวลา" */
export const WARN_MS = 10 * 60 * 1000;

export type MachineState = "idle" | "play" | "warn" | "over" | "offline";

export type StatusFilter = "all" | "idle" | "playing" | "warn" | "over" | "credit";
export type ZoneFilter = "all" | "sofa" | "racing" | "pc";

export interface MachineStatusInfo {
  state: MachineState;
  /** ยังจ่ายไม่ครบ */
  credit: boolean;
}

export function stateFromRemaining(remainMs: number): MachineState {
  if (remainMs <= 0) return "over";
  if (remainMs <= WARN_MS) return "warn";
  return "play";
}

export function isPlaying(s: MachineState): boolean {
  return s === "play" || s === "warn" || s === "over";
}

export function matchesFilter(info: MachineStatusInfo, f: StatusFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "idle":
      return info.state === "idle" || info.state === "offline";
    case "playing":
      return isPlaying(info.state);
    case "warn":
      return info.state === "warn";
    case "over":
      return info.state === "over";
    case "credit":
      return info.credit;
  }
}

export interface StatusCounts {
  all: number;
  idle: number;
  playing: number;
  warn: number;
  over: number;
  credit: number;
}

export function countStatuses(list: MachineStatusInfo[]): StatusCounts {
  const c: StatusCounts = { all: 0, idle: 0, playing: 0, warn: 0, over: 0, credit: 0 };
  for (const i of list) {
    c.all++;
    if (matchesFilter(i, "idle")) c.idle++;
    if (matchesFilter(i, "playing")) c.playing++;
    if (i.state === "warn") c.warn++;
    if (i.state === "over") c.over++;
    if (i.credit) c.credit++;
  }
  return c;
}

/** 6:34:56 / −0:04:10 (ชั่วโมงไม่เติม 0 หน้า ให้อ่านเร็ว) */
export function fmtClock(ms: number): string {
  const neg = ms < 0;
  const t = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${neg ? "−" : ""}${h}:${pad(m)}:${pad(s)}`;
}

/** เวลาตามนาฬิกาไทย HH:MM */
export function fmtHHMM(input: number | string | null | undefined): string {
  if (input === null || input === undefined || input === "") return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    numberingSystem: "latn",
  }).format(d);
}

/** เลขเครื่อง 2 หลัก: 1 -> "01" */
export function machineNo(n: number): string {
  return String(n).padStart(2, "0");
}
