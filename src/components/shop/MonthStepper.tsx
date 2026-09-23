import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { monthLabel, shiftMonth, currentMonthKey } from "@/lib/finance";

/**
 * ตัวเลื่อนเดือน  [ < ]  กันยายน 2026  [ > ]
 *
 * ใช้ร่วมกันทั้งหน้ารายจ่ายและหน้าสรุปยอด เพื่อให้เปลี่ยนเดือนได้เหมือนกันทุกที่
 * ปุ่มเดินหน้าถูกปิดเมื่อถึงเดือนปัจจุบัน — เดือนอนาคตยังไม่มีข้อมูลให้ดู
 */
export function MonthStepper({
  value,
  onChange,
  allowFuture = false,
}: {
  value: string;
  onChange: (m: string) => void;
  allowFuture?: boolean;
}) {
  const now = currentMonthKey();
  const atNow = value >= now;

  return (
    <div className="yl-month-nav">
      <button
        type="button"
        className="yl-month-btn"
        onClick={() => onChange(shiftMonth(value, -1))}
        aria-label="เดือนก่อนหน้า"
      >
        <ChevronLeft size={18} />
      </button>

      <div className="yl-month-label">
        <CalendarRange size={16} className="yl-month-ico" />
        <span>{monthLabel(value)}</span>
      </div>

      <button
        type="button"
        className="yl-month-btn"
        onClick={() => onChange(shiftMonth(value, 1))}
        disabled={!allowFuture && atNow}
        aria-label="เดือนถัดไป"
      >
        <ChevronRight size={18} />
      </button>

      {value !== now && (
        <button type="button" className="yl-month-today" onClick={() => onChange(now)}>
          เดือนนี้
        </button>
      )}
    </div>
  );
}
