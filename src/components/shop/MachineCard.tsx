import { Gamepad2, Gauge, Plus, Power, Receipt, X } from "lucide-react";
import type { Machine, Reservation } from "@/lib/supabase";
import { formatBaht, formatHours, type PriceOverride } from "@/lib/priceEngine";
import { machinePriceOf } from "@/lib/billing";
import { fmtMinutes } from "@/lib/packages";
import {
  fmtClock,
  fmtHHMM,
  machineNo,
  stateFromRemaining,
  type MachineState,
  type MachineStatusInfo,
} from "@/lib/dashStatus";

/** สถานะของเครื่อง PS5 — แดชบอร์ดใช้นับ/กรอง การ์ดใช้แสดง (คิดที่เดียว) */
export function ps5StatusOf(
  machine: Machine,
  reservation: Reservation | undefined,
  priceOverride: PriceOverride | null | undefined,
  now = Date.now(),
): MachineStatusInfo {
  if (machine.status !== "playing" || !reservation) return { state: "idle", credit: false };
  const remain = (reservation.end_time_ms ?? now) - now;
  const due = machinePriceOf(reservation, priceOverride ?? null) + Number(reservation.food_revenue);
  const paid = Number(reservation.advance_cash) + Number(reservation.advance_transfer);
  return { state: stateFromRemaining(remain), credit: due - paid > 0.5 };
}

const STATE_LABEL: Record<MachineState, string> = {
  idle: "ว่าง",
  play: "กำลังเล่น",
  warn: "ใกล้หมด",
  over: "เกินเวลา",
  offline: "ออฟไลน์",
};

interface Props {
  machine: Machine;
  reservation?: Reservation;
  priceOverride?: PriceOverride | null;
  /** เวลาปัจจุบันจากแดชบอร์ด (เดินทุกวินาที) — การ์ดทุกใบใช้นาฬิกาเดียวกัน */
  now: number;
  onStart: (m: Machine) => void;
  onManage: (m: Machine, r: Reservation) => void;
  onExtend: (m: Machine, r: Reservation) => void;
  onCancel: (m: Machine, r: Reservation) => void;
}

/** การ์ดเครื่อง PS5 (โซฟา/รถแข่ง) บนแดชบอร์ด — ปุ่มทุกปุ่มเปิดหน้าต่างเดิมที่มีอยู่แล้ว */
export function MachineCard({
  machine,
  reservation,
  priceOverride,
  now,
  onStart,
  onManage,
  onExtend,
  onCancel,
}: Props) {
  const info = ps5StatusOf(machine, reservation, priceOverride, now);
  const st = info.state;
  const ZoneIcon = machine.zone === "sofa" ? Gamepad2 : Gauge;
  const zoneLabel = machine.zone === "sofa" ? "SOFA" : "RACING";

  if (st === "idle" || !reservation) {
    return (
      <article className="dm-card is-idle">
        <header className="dm-head">
          <div className="dm-id">
            <span className="dm-no">{machineNo(machine.machine_number)}</span>
            <span className="dm-zone">{zoneLabel}</span>
          </div>
          <span className="dm-state is-idle">
            <i aria-hidden />
            ว่าง
          </span>
        </header>
        <div className="dm-empty">
          <ZoneIcon size={30} aria-hidden />
          <span>พร้อมให้บริการ</span>
        </div>
        <div className="dm-actions">
          <button type="button" className="dm-primary is-sea" onClick={() => onStart(machine)}>
            <Power size={16} /> เปิดเครื่อง
          </button>
        </div>
      </article>
    );
  }

  const r = reservation;
  const endMs = r.end_time_ms ?? now;
  const startMs = r.start_time ? new Date(r.start_time).getTime() : endMs;
  const remainMs = endMs - now;
  const used = Math.min(100, Math.max(0, ((now - startMs) / Math.max(1, endMs - startMs)) * 100));
  const bankMin = Number(r.hour_bank_used_min) || 0;
  const due =
    machinePriceOf(r, priceOverride ?? null) +
    Number(r.food_revenue) -
    Number(r.advance_cash) -
    Number(r.advance_transfer);

  return (
    <article className={`dm-card is-${st}`}>
      <header className="dm-head">
        <div className="dm-id">
          <span className="dm-no">{machineNo(machine.machine_number)}</span>
          <span className="dm-zone">{zoneLabel}</span>
        </div>
        <span className={`dm-state is-${st}`}>
          <i aria-hidden />
          {STATE_LABEL[st]}
        </span>
      </header>

      <div className="dm-who">
        <b title={r.customer_name}>{r.customer_name}</b>
        {r.package_name && (
          <span className={`dm-pkg ${bankMin > 0 ? "is-bank" : ""}`} title={r.package_name}>
            {bankMin > 0 ? `ใช้ชั่วโมงสะสม ${fmtMinutes(bankMin)}` : r.package_name}
          </span>
        )}
      </div>

      <div className="dm-clock">
        <span className="dm-time">{fmtClock(remainMs)}</span>
        <span className="dm-until">
          {remainMs < 0 ? "เกินมา" : "เหลือ"} · ครบ {fmtHHMM(endMs)}
        </span>
        <div className="dm-prog" aria-hidden>
          <i style={{ width: `${used}%` }} />
        </div>
      </div>

      <div className="dm-meta">
        <div>
          เวลารวม<b>{formatHours(r.total_hours)} ชม.</b>
        </div>
        <div className={info.credit ? "is-due" : ""}>
          {info.credit ? "ค้างจ่าย" : "ยอด"}
          <b>{info.credit ? `${formatBaht(due)} บ.` : "ชำระแล้ว"}</b>
        </div>
      </div>

      <div className="dm-actions">
        <button type="button" className="dm-primary" onClick={() => onManage(machine, r)}>
          <Receipt size={16} /> {st === "over" ? "เช็คบิลเลย" : "จัดการ / เช็คบิล"}
        </button>
        <div className="dm-row2">
          <button type="button" className="dm-sec" onClick={() => onExtend(machine, r)}>
            <Plus size={15} /> ต่อเวลา
          </button>
          <button type="button" className="dm-sec is-danger" onClick={() => onCancel(machine, r)}>
            <X size={15} /> ยกเลิกบิล
          </button>
        </div>
      </div>
    </article>
  );
}
