import { useEffect, useMemo, useState } from "react";
import { Gauge, Monitor, Sofa } from "lucide-react";
import type { Machine, Reservation } from "@/lib/supabase";
import type { PriceOverride } from "@/lib/priceEngine";
import { MachineCard, ps5StatusOf } from "./MachineCard";
import { PcZonePanel, pcStatusOf } from "./PcZonePanel";
import { ShopBar } from "./ShopDrawer";
import { usePcZone } from "@/hooks/usePcZone";
import { isAgentOnline } from "@/lib/pcControl";
import { listOpenPackages, fmtThaiDate, fmtMachines, type PricePackage } from "@/lib/packages";
import {
  countStatuses,
  isPlaying,
  matchesFilter,
  type MachineStatusInfo,
  type StatusFilter,
  type ZoneFilter,
} from "@/lib/dashStatus";

interface Props {
  machines: Machine[];
  resByMachine: Map<string, Reservation>;
  sofaOverride: PriceOverride | null;
  racingOverride: PriceOverride | null;
  isAdmin: boolean;
  onStart: (m: Machine) => void;
  onManage: (m: Machine, r: Reservation) => void;
  onExtend: (m: Machine, r: Reservation) => void;
  onCancel: (m: Machine, r: Reservation) => void;
}

const STATUS_CHIPS: { key: StatusFilter; label: string; dot?: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "idle", label: "ว่าง", dot: "idle" },
  { key: "playing", label: "กำลังเล่น", dot: "play" },
  { key: "warn", label: "ใกล้หมดเวลา", dot: "warn" },
  { key: "over", label: "เกินเวลา", dot: "over" },
  { key: "credit", label: "ค้างจ่าย", dot: "credit" },
];

const ZONES: { key: ZoneFilter; label: string }[] = [
  { key: "all", label: "ทุกโซน" },
  { key: "sofa", label: "โซฟา" },
  { key: "racing", label: "รถแข่ง" },
  { key: "pc", label: "PC" },
];

function fmtToday(now: number): string {
  const d = new Date(now);
  const date = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    numberingSystem: "latn",
  }).format(d);
  return `${date} · ${time} น.`;
}

/**
 * แดชบอร์ดหลัก — ทุกโซนอยู่หน้าเดียว (โซฟา · รถแข่ง · PC)
 * การเปิด/ปิดบิลทั้งหมดยังใช้หน้าต่างและฟังก์ชันเดิม หน้านี้จัดวางและกรองอย่างเดียว
 */
export function Dashboard({
  machines,
  resByMachine,
  sofaOverride,
  racingOverride,
  isAdmin,
  onStart,
  onManage,
  onExtend,
  onCancel,
}: Props) {
  const pc = usePcZone();
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<StatusFilter>("all");
  const [zone, setZone] = useState<ZoneFilter>("all");
  const [packages, setPackages] = useState<PricePackage[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // แพ็กเกจที่ขายวันนี้ — โหลดใหม่ทุก 10 นาที (ข้ามวันแล้วโปรเปลี่ยนเอง)
  useEffect(() => {
    let alive = true;
    const load = () =>
      listOpenPackages().then((list) => {
        if (alive) setPackages(list);
      });
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const sofa = machines.filter((m) => m.zone === "sofa");
  const racing = machines.filter((m) => m.zone === "racing");
  const pcs = machines.filter((m) => m.zone === "pc");

  const ps5Info = (m: Machine) =>
    ps5StatusOf(m, resByMachine.get(m.id), m.zone === "sofa" ? sofaOverride : racingOverride, now);
  const pcInfo = (m: Machine) =>
    pcStatusOf(
      pc.sessions.find((s) => s.machine_id === m.id),
      pc.agents.find((a) => a.machine_id === m.id),
      now,
    );

  const all: { zone: ZoneFilter; info: MachineStatusInfo }[] = [
    ...sofa.map((m) => ({ zone: "sofa" as const, info: ps5Info(m) })),
    ...racing.map((m) => ({ zone: "racing" as const, info: ps5Info(m) })),
    ...pcs.map((m) => ({ zone: "pc" as const, info: pcInfo(m) })),
  ];
  const counts = countStatuses(
    all.filter((x) => zone === "all" || x.zone === zone).map((x) => x.info),
  );
  const playingIn = (z: ZoneFilter) =>
    all.filter((x) => x.zone === z && isPlaying(x.info.state)).length;
  const onlineAgents = pcs.filter((m) =>
    isAgentOnline(pc.agents.find((a) => a.machine_id === m.id)),
  ).length;

  // จัดกลุ่มแพ็กเกจตามชื่อโปร เพื่อแสดงเป็นแถบ "โปรวันนี้"
  const promoGroups = useMemo(() => {
    const map = new Map<string, PricePackage[]>();
    for (const p of packages) map.set(p.group_name, [...(map.get(p.group_name) ?? []), p]);
    return [...map.entries()];
  }, [packages]);

  // เครื่องโซฟาไหนอยู่ในโปรอะไร (เช่น เครื่องที่มีเกม GTA) — ติดป้ายบนการ์ดให้พนักงานรู้
  const gameTagOf = useMemo(() => {
    const map = new Map<number, string>();
    for (const [name, list] of promoGroups) {
      for (const n of list[0].machine_numbers ?? []) {
        map.set(n, map.has(n) ? `${map.get(n)}, ${name}` : name);
      }
    }
    return map;
  }, [promoGroups]);

  function zoneSection(
    key: "sofa" | "racing",
    title: string,
    Icon: typeof Sofa,
    list: Machine[],
    override: PriceOverride | null,
  ) {
    if (zone !== "all" && zone !== key) return null;
    const shown = list.filter((m) => matchesFilter(ps5Info(m), status));
    return (
      <section className="dm-zone-sec" aria-label={title}>
        <div className="dm-zhead">
          <span className={`dm-sign is-${key}`}>
            <span>
              <Icon size={19} aria-hidden /> {title}
            </span>
          </span>
          <span className="dm-zmeta">
            เล่นอยู่ <b>{playingIn(key)}</b>/{list.length}
          </span>
          <span className="dm-zrule" aria-hidden />
        </div>
        {shown.length === 0 ? (
          <div className="dm-none">ไม่มีเครื่องตามตัวกรองนี้</div>
        ) : (
          <div className="dm-grid">
            {shown.map((m) => (
              <MachineCard
                key={m.id}
                machine={m}
                reservation={resByMachine.get(m.id)}
                priceOverride={override}
                gameTag={key === "sofa" ? gameTagOf.get(m.machine_number) : undefined}
                now={now}
                onStart={onStart}
                onManage={onManage}
                onExtend={onExtend}
                onCancel={onCancel}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="dm-page">
      <header className="dm-top">
        <div>
          <h1 className="dm-title">ภาพรวมเครื่องเล่น</h1>
          <div className="dm-date">{fmtToday(now)}</div>
        </div>
      </header>

      <ShopBar isAdmin={isAdmin} />

      {promoGroups.map(([name, list]) => (
        <section key={name} className="dm-promo" aria-label={`แพ็กเกจ ${name}`}>
          <span className="dm-promo-tag">โปรวันนี้</span>
          <span className="dm-promo-name">{name}</span>
          <span className="dm-promo-tiers">
            {list.map((p) => (
              <span key={p.id} className="dm-tier">
                {p.label} <b>{p.price.toLocaleString("th-TH")}</b>
              </span>
            ))}
          </span>
          <span className="dm-promo-when">
            {!Array.isArray(list[0].machine_numbers) ? (
              "เฉพาะโซนโซฟา"
            ) : list[0].machine_numbers.length === 0 ? (
              // ยังไม่ได้เลือกเครื่อง = แพ็กเกจนี้ยังไม่ขึ้นที่เครื่องไหน บอกให้ไปตั้งก่อน
              <span className="dm-promo-warn">
                ยังไม่ได้เลือกเครื่อง — ตั้งที่เมนูโปรโมชั่น › แก้เครื่อง
              </span>
            ) : (
              `เฉพาะโซฟาเครื่อง ${fmtMachines(list[0].machine_numbers)}`
            )}
            {list[0].end_date ? ` · ถึง ${fmtThaiDate(list[0].end_date)}` : ""}
          </span>
        </section>
      ))}

      <div className="dm-bar">
        <div className="dm-chips" role="group" aria-label="กรองตามสถานะ">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`dm-chip ${status === c.key ? "is-on" : ""}`}
              aria-pressed={status === c.key}
              onClick={() => setStatus(status === c.key ? "all" : c.key)}
            >
              {c.dot && <i className={`dm-dot is-${c.dot}`} aria-hidden />}
              <b>{counts[c.key]}</b>
              {c.label}
            </button>
          ))}
        </div>
        <div className="dm-seg" role="group" aria-label="เลือกโซน">
          {ZONES.map((z) => (
            <button
              key={z.key}
              type="button"
              className={zone === z.key ? "is-on" : ""}
              aria-pressed={zone === z.key}
              onClick={() => setZone(z.key)}
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>

      {zoneSection("sofa", "โซนโซฟา", Sofa, sofa, sofaOverride)}
      {zoneSection("racing", "โซนรถแข่ง", Gauge, racing, racingOverride)}

      {(zone === "all" || zone === "pc") && (
        <section className="dm-zone-sec" aria-label="โซน PC">
          <div className="dm-zhead">
            <span className="dm-sign is-pc">
              <span>
                <Monitor size={19} aria-hidden /> โซน PC
              </span>
            </span>
            <span className="dm-zmeta">
              เล่นอยู่ <b>{playingIn("pc")}</b>/{pcs.length} · Agent ออนไลน์ <b>{onlineAgents}</b>/
              {pcs.length}
            </span>
            <span className="dm-zrule" aria-hidden />
          </div>
          <PcZonePanel machines={pcs} data={pc} filter={status} />
        </section>
      )}
    </div>
  );
}
