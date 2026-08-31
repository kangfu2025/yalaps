import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { UserPlus, Phone, User as UserIcon, CheckCircle2, Gift } from "lucide-react";
import { registerMember, closeJoinScreen, normalizePhone, formatPhone } from "@/lib/members";

export const Route = createFileRoute("/join")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "สมัครสมาชิก — YALA PLAYSTATION" },
      { name: "description", content: "สมัครสมาชิกสะสมแต้ม ร้าน YALA PLAYSTATION" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
    ],
  }),
  component: JoinPage,
});

type Result =
  | { kind: "created"; name: string; phone: string }
  | { kind: "exists"; name: string; phone: string; points: number };

function JoinPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const digits = normalizePhone(phone);
  const phoneOk = digits.length >= 9 && digits.length <= 10;
  const nameOk = name.trim().length >= 2;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !phoneOk || !nameOk) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await registerMember(name, phone);
      if (r.status === "created") {
        const who = r.name ?? name.trim();
        setResult({ kind: "created", name: who, phone: r.phone ?? digits });
        // ปิดหน้า QR บนจอลูกค้า แล้วให้จอโชว์ "ยินดีต้อนรับ" ก่อนกลับโหมดปกติ
        closeJoinScreen(who).catch(() => {});
      } else if (r.status === "exists") {
        setResult({
          kind: "exists",
          name: r.name ?? "",
          phone: r.phone ?? digits,
          points: Number(r.points) || 0,
        });
      } else {
        setErr(r.message || "ข้อมูลไม่ถูกต้อง");
      }
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : String(e2);
      setErr(
        /Could not find the function/i.test(msg)
          ? "ระบบสมาชิกยังไม่ได้ติดตั้ง — กรุณาแจ้งพนักงาน"
          : "สมัครไม่สำเร็จ กรุณาลองใหม่หรือแจ้งพนักงาน",
      );
      console.error(e2);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="join-wrap">
      <style>{JOIN_CSS}</style>

      <div className="join-card">
        <div className="join-head">
          <div className="join-logo">🎮</div>
          <h1 className="join-brand">YALA PLAYSTATION</h1>
          <div className="join-sub">สมาชิกสะสมแต้ม</div>
        </div>

        {result ? (
          <div className="join-body">
            <div className={`join-result ${result.kind}`}>
              <CheckCircle2 size={54} strokeWidth={1.6} />
              <h2>{result.kind === "created" ? "สมัครสำเร็จ" : "คุณเป็นสมาชิกอยู่แล้ว"}</h2>
              <p className="join-result-name">{result.name}</p>
              <p className="join-result-phone">{formatPhone(result.phone)}</p>
              {result.kind === "exists" && (
                <div className="join-points">
                  แต้มสะสมตอนนี้ <b>{result.points}</b> แต้ม
                </div>
              )}
            </div>
            <div className="join-next">
              แจ้ง <b>เบอร์โทรนี้</b> กับพนักงานทุกครั้งที่มาเล่น ระบบจะสะสมแต้มให้อัตโนมัติ
            </div>
          </div>
        ) : (
          <form className="join-body" onSubmit={onSubmit}>
            <div className="join-perk">
              <Gift size={20} />
              <div>
                <b>เล่น 1 ชั่วโมง ได้ 1 แต้ม</b>
                <span>ครบ 10 แต้ม เล่นฟรี 1 ชั่วโมง</span>
              </div>
            </div>

            <label className="join-label">
              <UserIcon size={14} /> ชื่อ
            </label>
            <input
              className="join-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ชื่อหรือชื่อเล่น"
              autoComplete="name"
              maxLength={60}
              required
            />

            <label className="join-label">
              <Phone size={14} /> เบอร์โทรศัพท์
            </label>
            <input
              className="join-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="08X-XXX-XXXX"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={20}
              required
            />
            <div className="join-hint">
              {phone && !phoneOk
                ? "เบอร์โทรต้องมี 9-10 หลัก"
                : "ใช้เบอร์นี้แจ้งพนักงานเพื่อสะสมแต้ม"}
            </div>

            {err && <div className="join-err">{err}</div>}

            <button className="join-btn" type="submit" disabled={busy || !phoneOk || !nameOk}>
              <UserPlus size={18} />
              {busy ? "กำลังสมัคร..." : "สมัครสมาชิก"}
            </button>
          </form>
        )}
      </div>

      <div className="join-foot">ข้อมูลใช้สำหรับสะสมแต้มภายในร้านเท่านั้น</div>
    </div>
  );
}

const JOIN_CSS = `
.join-wrap{
  min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:18px;padding:24px 16px;
  background:radial-gradient(120% 90% at 50% 0%, #16233d 0%, #0b0f17 62%);
  font-family:'Prompt',system-ui,sans-serif;color:#e2e8f0;
}
.join-card{
  width:100%;max-width:420px;background:#111826;border:1px solid #24314a;border-radius:20px;
  overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.5);
}
.join-head{padding:28px 24px 22px;text-align:center;border-bottom:1px solid #1c2740;
  background:linear-gradient(180deg,#16203a 0%,#111826 100%);}
.join-logo{font-size:44px;line-height:1}
.join-brand{margin:8px 0 2px;font-size:1.35rem;font-weight:700;letter-spacing:.06em;color:#22d3ee}
.join-sub{font-size:.9rem;color:#94a3b8}
.join-body{padding:22px 22px 26px;display:flex;flex-direction:column;gap:10px}
.join-perk{
  display:flex;gap:12px;align-items:center;background:#1a2438;
  border:1px solid #2a3552;border-radius:12px;padding:12px 14px;margin-bottom:6px;color:#fbbf24;
}
.join-perk div{display:flex;flex-direction:column;line-height:1.45}
.join-perk b{color:#f8fafc;font-size:.95rem}
.join-perk span{color:#94a3b8;font-size:.82rem}
.join-label{display:flex;align-items:center;gap:6px;font-size:.85rem;color:#94a3b8;margin-top:6px}
.join-input{
  width:100%;padding:14px 16px;font-size:1.05rem;border-radius:12px;
  background:#0d1421;border:1px solid #2a3552;color:#f1f5f9;outline:none;
}
.join-input:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.15)}
.join-hint{font-size:.78rem;color:#64748b;margin-top:-2px}
.join-err{background:#3b1d1d;border:1px solid #7f2626;color:#fca5a5;
  padding:10px 14px;border-radius:10px;font-size:.88rem}
.join-btn{
  margin-top:14px;display:flex;align-items:center;justify-content:center;gap:8px;
  width:100%;padding:15px;border:0;border-radius:12px;cursor:pointer;
  background:linear-gradient(135deg,#06b6d4,#3b82f6);color:#04121c;
  font-size:1.05rem;font-weight:700;font-family:inherit;
}
.join-btn:disabled{opacity:.45;cursor:not-allowed}
.join-result{display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px;padding:14px 0 6px}
.join-result svg{color:#34d399}
.join-result.exists svg{color:#38bdf8}
.join-result h2{margin:10px 0 2px;font-size:1.25rem;font-weight:700;color:#f8fafc}
.join-result-name{margin:0;font-size:1.5rem;font-weight:700;color:#22d3ee}
.join-result-phone{margin:0;font-size:1rem;color:#94a3b8;font-family:'JetBrains Mono',monospace}
.join-points{margin-top:12px;padding:10px 18px;border-radius:999px;
  background:#1a2438;border:1px solid #2a3552;color:#fbbf24;font-size:.95rem}
.join-points b{font-size:1.2rem;color:#fde047}
.join-next{margin-top:16px;padding:14px;border-radius:12px;background:#0d1421;
  border:1px solid #24314a;font-size:.9rem;color:#cbd5e1;text-align:center;line-height:1.6}
.join-next b{color:#22d3ee}
.join-foot{font-size:.78rem;color:#475569;text-align:center}
`;
