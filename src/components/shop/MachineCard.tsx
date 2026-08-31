import { useEffect, useState, useMemo } from "react";
import {
  Sofa,
  Gauge,
  Gamepad2,
  Monitor,
  Power,
  User,
  AlertTriangle,
  Receipt,
  Settings2,
  Trash2,
} from "lucide-react";
import type { Machine, Reservation } from "@/lib/supabase";
import { calcPrice, formatHours, formatBaht, type PriceOverride } from "@/lib/priceEngine";

function formatRemaining(ms: number): { text: string; overdue: boolean } {
  const overdue = ms <= 0;
  const clamped = Math.max(0, ms);
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { text: `${pad(h)}:${pad(m)}:${pad(s)}`, overdue };
}

interface Props {
  machine: Machine;
  reservation?: Reservation;
  priceOverride?: PriceOverride | null;
  onStart: (m: Machine) => void;
  onManage: (m: Machine, r: Reservation) => void;
  onCancel: (m: Machine, r: Reservation) => void;
}

type CardStatus = "idle" | "playing" | "overdue" | "credit";

export function MachineCard({ machine, reservation, priceOverride, onStart, onManage, onCancel }: Props) {
  const [, setNow] = useState(Date.now());
  const reservationId = reservation?.id;
  useEffect(() => {
    if (!reservationId) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [reservationId]);

  const isPlaying = machine.status === "playing" && reservation;
  const remaining = reservation?.end_time_ms ? formatRemaining(reservation.end_time_ms - Date.now()) : null;

  const status = useMemo<CardStatus>(() => {
    if (!isPlaying || !reservation) return "idle";
    const totalDue = calcPrice(reservation.zone, Number(reservation.total_hours), priceOverride ?? null) + Number(reservation.food_revenue);
    const paid = Number(reservation.advance_cash) + Number(reservation.advance_transfer);
    if (remaining?.overdue) return "overdue";
    if (paid < totalDue) return "credit";
    return "playing";
  }, [isPlaying, reservation, remaining?.overdue, priceOverride]);

  const statusConfig = {
    idle: { label: "ว่าง", icon: <Monitor size={11} /> },
    playing: { label: "กำลังเล่น", icon: <Gamepad2 size={11} /> },
    overdue: { label: "หมดเวลา", icon: <AlertTriangle size={11} /> },
    credit: { label: "ค้างจ่าย", icon: <Receipt size={11} /> },
  };

  const cfg = statusConfig[status];
  const ZoneIcon = machine.zone === "sofa" ? Sofa : Gauge;
  const zoneLabel = machine.zone === "sofa" ? "Sofa Zone" : machine.zone === "racing" ? "Racing Zone" : "PC Zone";

  const creditAmount = useMemo(() => {
    if (!reservation || status !== "credit") return 0;
    const totalDue = calcPrice(reservation.zone, Number(reservation.total_hours), priceOverride ?? null) + Number(reservation.food_revenue);
    return Math.max(0, totalDue - Number(reservation.advance_cash) - Number(reservation.advance_transfer));
  }, [reservation, status, priceOverride]);

  return (
    <div className="col">
      <div className={`ps5-card ps5-${status} h-100`}>
        {isPlaying && <span className="ps5-ring" aria-hidden="true" />}
        <div className="ps5-inner">
          {/* header */}
          <div className="ps5-head">
            <div>
              <div className="ps5-zone">
                <ZoneIcon size={11} /> {zoneLabel}
              </div>
              <h2 className="ps5-no">เครื่อง {machine.machine_number}</h2>
            </div>
            <span className="ps5-pill">
              <i className="ps5-dot" />
              {cfg.icon}
              {cfg.label}
            </span>
          </div>

          {isPlaying && reservation ? (
            <>
              <div className="ps5-cust">
                <span className="ps5-avatar"><User size={14} /></span>
                <div>
                  <p className="ps5-lab">ลูกค้า</p>
                  <p className="ps5-val">{reservation.customer_name}</p>
                </div>
              </div>

              <div className="ps5-stats">
                <div className="ps5-stat">
                  <p className="ps5-lab">เวลาทั้งหมด</p>
                  <p className="ps5-val">{formatHours(reservation.total_hours)} ชม.</p>
                </div>
                {status === "credit" ? (
                  <div className="ps5-stat is-warn">
                    <p className="ps5-lab">ค้างชำระ</p>
                    <p className="ps5-val">฿{formatBaht(creditAmount)}</p>
                  </div>
                ) : (
                  <div className="ps5-stat">
                    <p className="ps5-lab">สถานะ</p>
                    <p className="ps5-val">{status === "overdue" ? "เกินเวลา" : "ชำระแล้ว"}</p>
                  </div>
                )}
              </div>

              <div className="ps5-timer">
                <span className="ps5-time">{remaining?.text}</span>
                <span className="ps5-time-lab">Remaining Time</span>
              </div>

              <div className="ps5-actions">
                <button className="ps5-btn-main" onClick={() => onManage(machine, reservation)}>
                  <Settings2 size={14} /> จัดการ / เช็คบิล
                </button>
                <button className="ps5-btn-ghost" onClick={() => onCancel(machine, reservation)}>
                  <Trash2 size={12} /> ยกเลิกบิล
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="ps5-empty">
                <span className="ps5-empty-icon"><Monitor size={26} /></span>
                <p>พร้อมให้บริการ</p>
              </div>
              <button className="ps5-btn-start" onClick={() => onStart(machine)}>
                <Power size={15} /> เปิดเครื่อง
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
