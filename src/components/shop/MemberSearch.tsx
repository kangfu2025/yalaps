import { useEffect, useState } from "react";
import { Search, UserPlus, Star, X, IdCard } from "lucide-react";
import {
  findMemberByPhone,
  registerMember,
  normalizePhone,
  formatPhone,
  type Member,
} from "@/lib/members";

interface Props {
  value: Member | null;
  onChange: (m: Member | null) => void;
  /** ชื่อผู้เล่นที่กรอกไว้ ใช้เป็นค่าเริ่มต้นตอนสมัครให้ลูกค้าหน้าร้าน */
  defaultName?: string;
  compact?: boolean;
}

/** ค้นหาสมาชิกด้วยเบอร์โทร — ใช้ร่วมกันทั้งโซน PS5 และ PC */
export function MemberSearch({ value, onChange, defaultName = "", compact = false }: Props) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!value) return;
    setNotFound(false);
    setMsg(null);
  }, [value]);

  const digits = normalizePhone(phone);
  const canSearch = digits.length >= 9 && digits.length <= 10;

  async function doSearch() {
    if (!canSearch || busy) return;
    setBusy(true);
    setMsg(null);
    setNotFound(false);
    try {
      const m = await findMemberByPhone(phone);
      if (m) {
        onChange(m);
        setPhone("");
      } else {
        setNotFound(true);
        setNewName(defaultName.trim());
        setMsg("ไม่พบสมาชิกเบอร์นี้");
      }
    } catch (e) {
      setMsg(setupHint(e) ?? "ค้นหาไม่สำเร็จ: " + errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doRegister() {
    if (busy || newName.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await registerMember(newName, phone);
      if (r.status === "created" || r.status === "exists") {
        const m = await findMemberByPhone(phone);
        if (m) {
          onChange(m);
          setPhone("");
          setNotFound(false);
          setMsg(null);
          return;
        }
      }
      setMsg(r.message || "สมัครไม่สำเร็จ");
    } catch (e) {
      setMsg(setupHint(e) ?? "สมัครไม่สำเร็จ: " + errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className={`member-chip ${compact ? "is-compact" : ""}`}>
        <IdCard size={compact ? 16 : 18} />
        <div className="member-chip-main">
          <b>{value.name}</b>
          <span>{formatPhone(value.phone)}</span>
        </div>
        <span className="member-chip-points">
          <Star size={13} /> {value.points}
        </span>
        <button
          type="button"
          className="member-chip-x"
          onClick={() => onChange(null)}
          title="เอาสมาชิกออกจากบิลนี้"
        >
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="member-search">
      <div className="input-group">
        <input
          className="form-control"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              doSearch();
            }
          }}
          placeholder="เบอร์โทรสมาชิก (ไม่บังคับ)"
          inputMode="numeric"
          maxLength={20}
        />
        <button
          type="button"
          className="btn btn-outline-info"
          onClick={doSearch}
          disabled={!canSearch || busy}
        >
          <Search size={15} /> ค้นหา
        </button>
      </div>

      {msg && <div className="small mt-1 text-warning">{msg}</div>}

      {notFound && (
        <div className="member-newbox mt-2">
          <div className="small text-muted mb-1">
            สมัครให้ลูกค้าเลย — เบอร์ {formatPhone(digits)}
          </div>
          <div className="input-group">
            <input
              className="form-control"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="ชื่อลูกค้า"
              maxLength={60}
            />
            <button
              type="button"
              className="btn btn-success"
              onClick={doRegister}
              disabled={busy || newName.trim().length < 2}
            >
              <UserPlus size={15} /> สมัคร
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** ยังไม่ได้รัน members_migration.sql */
function setupHint(e: unknown): string | null {
  const msg = errText(e);
  const code = (e as { code?: string } | null)?.code ?? "";
  if (
    code === "PGRST205" ||
    code === "PGRST202" ||
    code === "42P01" ||
    /Could not find the (table|function)/i.test(msg)
  ) {
    return "ยังไม่ได้ติดตั้งระบบสมาชิก — รัน supabase/members_migration.sql ก่อน";
  }
  return null;
}
