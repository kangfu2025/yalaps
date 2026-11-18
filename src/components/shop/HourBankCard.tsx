import { useEffect, useState } from "react";
import { PiggyBank } from "lucide-react";
import {
  getHourBank,
  listHourBankTx,
  fmtMinutes,
  fmtThaiDate,
  type HourBankBalance,
  type HourBankTx,
} from "@/lib/packages";

const REASON: Record<HourBankTx["reason"], string> = {
  save: "เก็บจากบิล",
  redeem: "ใช้เปิดเครื่อง",
  refund: "คืนชั่วโมง",
};

/** ชั่วโมงสะสมของสมาชิก (หน้ารายละเอียดสมาชิก) — อ่านอย่างเดียว เปลี่ยนได้ผ่านการเปิด/ปิดบิลเท่านั้น */
export function HourBankCard({ memberId }: { memberId: string }) {
  const [bank, setBank] = useState<HourBankBalance | null | undefined>(undefined);
  const [tx, setTx] = useState<HourBankTx[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([getHourBank(memberId), listHourBankTx(memberId, 20)])
      .then(([b, t]) => {
        if (!alive) return;
        setBank(b);
        setTx(t);
      })
      .catch((e) => {
        console.warn("[hour-bank]", e);
        if (alive) setBank(null);
      });
    return () => {
      alive = false;
    };
  }, [memberId]);

  // ยังไม่ได้รัน SQL หรือโหลดไม่ได้ = ไม่แสดงอะไร (ไม่ให้หน้าสมาชิกพัง)
  if (!bank) return null;
  if (bank.minutes === 0 && tx.length === 0) {
    return (
      <div className="yl-bank-card is-empty mb-3">
        <PiggyBank size={16} /> ยังไม่มีชั่วโมงสะสม
      </div>
    );
  }

  return (
    <div className="yl-bank-card mb-3">
      <div className="yl-bank-top">
        <PiggyBank size={20} />
        <div>
          <div className="yl-bank-lab">ชั่วโมงสะสม (โซฟา)</div>
          <div className="yl-bank-val">{fmtMinutes(bank.minutes)}</div>
        </div>
      </div>
      {bank.lots.length > 0 && (
        <ul className="yl-bank-lots">
          {bank.lots.map((l) => (
            <li key={l.id}>
              <span>{fmtMinutes(l.minutes_left)}</span>
              <span>หมดอายุ {fmtThaiDate(l.expires_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {tx.length > 0 && (
        <details className="yl-bank-hist">
          <summary>ประวัติชั่วโมงสะสม ({tx.length})</summary>
          <table className="table table-sm mb-0">
            <tbody>
              {tx.map((t) => (
                <tr key={t.id} className={t.refunded ? "text-muted" : ""}>
                  <td className="small text-nowrap">{fmtThaiDate(t.created_at)}</td>
                  <td className="small">
                    {REASON[t.reason]}
                    {t.refunded && " (คืนแล้ว)"}
                    {t.note && <span className="text-muted"> · {t.note}</span>}
                  </td>
                  <td
                    className={`small text-end text-nowrap fw-bold ${t.delta_min >= 0 ? "text-success" : "text-danger"}`}
                  >
                    {t.delta_min >= 0 ? "+" : "−"}
                    {fmtMinutes(Math.abs(t.delta_min))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
