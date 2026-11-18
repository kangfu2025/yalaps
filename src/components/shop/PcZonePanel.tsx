import { useShop } from "@/hooks/useShop";
import { useEffect, useState } from "react";
import {
  Monitor,
  Lock,
  Unlock,
  ShieldAlert,
  Power,
  AlertTriangle,
  User,
  Timer,
  Play,
  XCircle,
  Wifi,
  WifiOff,
  Plus,
  Receipt,
} from "lucide-react";

const CMD_LABEL: Record<string, string> = {
  lock: "ล็อกหน้าจอ",
  unlock: "ปลดล็อก",
  shutdown: "ปิดเครื่อง",
  warn: "เตือนเวลา",
  show_countdown: "แสดงนับถอยหลัง",
  end_session: "จบ session",
};
import {
  type Machine,
  type PcAgent,
  type PcCommand,
  type PcCommandType,
  type PcSession,
} from "@/lib/supabase";
import {
  sendPcCommand,
  isAgentOnline,
  startPcSession,
  extendPcSession,
  endPcSession,
  cancelPcSession,
  calcPcPrice,
  setPcSessionMember,
} from "@/lib/pcControl";
import { useAuth } from "@/lib/auth";
import type { PcZoneData } from "@/hooks/usePcZone";
import {
  fmtClock,
  fmtHHMM,
  machineNo,
  matchesFilter,
  stateFromRemaining,
  type MachineState,
  type MachineStatusInfo,
  type StatusFilter,
} from "@/lib/dashStatus";
import { fmtMinutes } from "@/lib/packages";
import { formatBaht } from "@/lib/priceEngine";
import { MemberSearch } from "./MemberSearch";
import {
  getMember,
  getPointsConfig,
  pointsForPlay,
  DEFAULT_POINTS_CONFIG,
  type Member,
  type PointsConfig,
} from "@/lib/members";
import {
  listOpenSalesForBill,
  settleSalesForBill,
  cancelSalesForBill,
  type ProductSale,
  type ProductSaleItem,
} from "@/lib/products";
import { PromptPayQR } from "./PromptPayQR";
import { ConfirmDialog } from "./ConfirmDialog";

type PayMode = "cash" | "transfer" | "mixed" | "points" | "credit";

/** บิล PC แถมฟรีที่เปิดก่อนเวลานี้ใช้รูปแบบข้อมูลเก่า (price = ราคาเต็ม) — ดู EndPcModal */
const LEGACY_FREE_BEFORE = Date.parse("2026-10-20T00:00:00+07:00");

function PayModeRadio({
  value,
  onChange,
  name,
}: {
  value: PayMode;
  onChange: (v: PayMode) => void;
  name: string;
}) {
  const opts: { v: PayMode; label: string }[] = [
    { v: "cash", label: "💵 เงินสด" },
    { v: "transfer", label: "📱 โอน" },
    { v: "mixed", label: "🔀 ผสม" },
    { v: "points", label: "🎁 แถมฟรี" },
    { v: "credit", label: "🧾 ค้างจ่าย" },
  ];
  return (
    <div className="radio-box">
      {opts.map((o) => (
        <label key={o.v} className="radio-item">
          <input type="radio" name={name} checked={value === o.v} onChange={() => onChange(o.v)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function fmtRemaining(ms: number): string {
  const clamped = Math.max(0, ms);
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** ข้อความบอกอายุ heartbeat ล่าสุด เช่น "12 วินาทีที่แล้ว" */
function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "ยังไม่เคยเชื่อมต่อ";
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 90) return `${sec} วินาทีที่แล้ว`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min} นาทีที่แล้ว`;
  return `${Math.round(min / 60)} ชั่วโมงที่แล้ว`;
}

interface Props {
  machines: Machine[];
  data: PcZoneData;
  /** ตัวกรองจากแถบด้านบนแดชบอร์ด */
  filter?: StatusFilter;
}

/** บิล PC แถมฟรีแบบข้อมูลเก่า: ราคาเต็มแต่ไม่ได้เก็บเงิน — ดู EndPcModal */
function isLegacyFree(s: PcSession): boolean {
  const paid = Number(s.paid_cash ?? 0) + Number(s.paid_transfer ?? 0);
  return (
    !!s.redeemed_points &&
    paid === 0 &&
    Date.parse(s.started_at ?? s.created_at ?? "") < LEGACY_FREE_BEFORE
  );
}

/** สถานะเครื่อง PC สำหรับการ์ดและตัวกรอง — คิดแบบเดียวกับที่หน้าเช็คบิลคิด */
export function pcStatusOf(
  session: PcSession | undefined,
  agent: PcAgent | undefined,
  now = Date.now(),
): MachineStatusInfo {
  if (!session) return { state: isAgentOnline(agent) ? "idle" : "offline", credit: false };
  const remain = new Date(session.ends_at).getTime() - now;
  const paid = Number(session.paid_cash ?? 0) + Number(session.paid_transfer ?? 0);
  const due = isLegacyFree(session)
    ? 0
    : Number(session.price ?? 0) + Number(session.food_amount ?? 0);
  return { state: stateFromRemaining(remain), credit: due - paid > 0.5 };
}

const STATE_LABEL: Record<MachineState, string> = {
  idle: "ว่าง",
  play: "กำลังเล่น",
  warn: "ใกล้หมด",
  over: "เกินเวลา",
  offline: "ออฟไลน์",
};

/**
 * โซน PC บนแดชบอร์ด — การ์ดแบบเดียวกับโซฟา/รถแข่ง + เครื่องมือควบคุม PC (แอดมิน)
 * ข้อมูลมาจาก usePcZone() ที่แดชบอร์ดโหลดไว้ (ใช้นับสถานะรวมด้วย)
 */
export function PcZonePanel({ machines, data, filter = "all" }: Props) {
  const { role } = useAuth();
  const { guardStart, notify } = useShop();
  const isAdmin = role === "admin";
  const { agents, sessions, commands, reload } = data;
  const [startTarget, setStartTarget] = useState<Machine | null>(null);
  const [extendTarget, setExtendTarget] = useState<{ m: Machine; s: PcSession } | null>(null);
  const [endTarget, setEndTarget] = useState<{ m: Machine; s: PcSession } | null>(null);
  const [lockTarget, setLockTarget] = useState<Machine | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ m: Machine; s: PcSession } | null>(null);
  const [cmdTarget, setCmdTarget] = useState<{ m: Machine | null; type: PcCommandType } | null>(
    null,
  );
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function runCommand(target: Machine | null, type: PcCommandType) {
    try {
      const list = target ? [target] : machines;
      await Promise.all(list.map((mm) => sendPcCommand(mm.id, type)));
      await reload();
    } catch (e) {
      alert("ส่งคำสั่งไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function warn5(m: Machine) {
    try {
      await sendPcCommand(m.id, "warn", { minutes: 5 });
      notify({
        kind: "info",
        title: `ส่งเตือน 5 นาทีไปที่ PC ${machineNo(m.machine_number)} แล้ว`,
        text: "ลูกค้าจะเห็นข้อความเตือนบนจอ",
      });
    } catch (e) {
      notify({
        kind: "warning",
        title: "ส่งเตือนไม่สำเร็จ",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (machines.length === 0) {
    return (
      <div className="alert alert-info">
        ยังไม่มีเครื่อง PC ในระบบ — รัน SQL migration แล้วรีเฟรช
      </div>
    );
  }

  const now = Date.now();
  const cards = machines
    .map((m) => {
      const agent = agents.find((a) => a.machine_id === m.id);
      const session = sessions.find((x) => x.machine_id === m.id);
      return { m, agent, session, info: pcStatusOf(session, agent, now) };
    })
    .filter((c) => matchesFilter(c.info, filter));

  return (
    <>
      {cards.length === 0 ? (
        <div className="dm-none">ไม่มีเครื่อง PC ตามตัวกรองนี้</div>
      ) : (
        <div className="dm-grid">
          {cards.map(({ m, agent, session, info }) => {
            const online = isAgentOnline(agent);
            const st = info.state;
            const remainMs = session ? new Date(session.ends_at).getTime() - now : 0;
            const startMs = session
              ? new Date(session.started_at ?? session.created_at).getTime()
              : 0;
            const endMs = session ? new Date(session.ends_at).getTime() : 0;
            const used = session
              ? Math.min(100, Math.max(0, ((now - startMs) / Math.max(1, endMs - startMs)) * 100))
              : 0;
            const free = session
              ? isLegacyFree(session) ||
                (!!session.redeemed_points && Number(session.price ?? 0) === 0)
              : false;
            const agentChip = (
              <span
                className={`dm-agent ${online ? "" : "is-off"}`}
                title={
                  agent
                    ? `Agent v${agent.agent_version ?? "?"} · heartbeat ${fmtAgo(agent.last_heartbeat)}`
                    : "ยังไม่เคยเชื่อมต่อ — ตรวจว่า Agent ติดตั้ง/รันอยู่หรือไม่"
                }
              >
                <i aria-hidden />
                {online ? "Agent ออนไลน์" : `Agent ออฟไลน์ · ${fmtAgo(agent?.last_heartbeat)}`}
              </span>
            );
            return (
              <article key={m.id} className={`dm-card is-${st}`}>
                <header className="dm-head">
                  <div className="dm-id">
                    <span className="dm-no">{machineNo(m.machine_number)}</span>
                    <span className="dm-zone">PC</span>
                  </div>
                  <span className={`dm-state is-${st}`}>
                    <i aria-hidden />
                    {STATE_LABEL[st]}
                  </span>
                </header>

                {session ? (
                  <>
                    <div className="dm-who">
                      <b title={session.customer_name ?? undefined}>
                        {session.customer_name || `ลูกค้า PC ${m.machine_number}`}
                      </b>
                      {agentChip}
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
                        เวลาที่ซื้อ<b>{fmtMinutes(session.minutes_purchased || 0)}</b>
                      </div>
                      <div className={info.credit ? "is-due" : ""}>
                        {info.credit ? "ค้างจ่าย" : "ยอด"}
                        <b>
                          {free
                            ? "แถมฟรี"
                            : info.credit
                              ? `${formatBaht(
                                  Number(session.price ?? 0) +
                                    Number(session.food_amount ?? 0) -
                                    Number(session.paid_cash ?? 0) -
                                    Number(session.paid_transfer ?? 0),
                                )} บ.`
                              : "ชำระแล้ว"}
                        </b>
                      </div>
                    </div>
                    <div className="dm-actions">
                      <button
                        type="button"
                        className="dm-primary"
                        onClick={() => setEndTarget({ m, s: session })}
                      >
                        <Receipt size={16} />
                        {st === "over" ? "ปิดเครื่อง / เช็คบิลเลย" : "ปิดเครื่อง / เช็คบิล"}
                      </button>
                      <div className="dm-row2">
                        <button
                          type="button"
                          className="dm-sec"
                          onClick={() => setExtendTarget({ m, s: session })}
                        >
                          <Plus size={15} /> เพิ่มเวลา
                        </button>
                        <button
                          type="button"
                          className="dm-sec is-amber"
                          disabled={!online}
                          title={online ? "ส่งข้อความเตือนไปที่จอ PC" : "Agent ออฟไลน์"}
                          onClick={() => warn5(m)}
                        >
                          <AlertTriangle size={15} /> เตือน 5 นาที
                        </button>
                      </div>
                      <button
                        type="button"
                        className="dm-sec is-danger"
                        onClick={() => setCancelTarget({ m, s: session })}
                      >
                        <XCircle size={15} /> ยกเลิกบิล
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="dm-empty">
                      <Monitor size={30} aria-hidden />
                      {agentChip}
                      {online && <span>ล็อกหน้าจออยู่</span>}
                    </div>
                    <div className="dm-actions">
                      <button
                        type="button"
                        className="dm-primary is-sea"
                        onClick={() => {
                          if (guardStart()) setStartTarget(m);
                        }}
                      >
                        <Play size={16} /> เริ่มเปิดเครื่อง
                      </button>
                      {isAdmin && (
                        <div className="dm-row2">
                          <button
                            type="button"
                            className="dm-sec is-amber"
                            onClick={() => setLockTarget(m)}
                            disabled={!online}
                            title={online ? "สั่งล็อกหน้าจอเครื่อง PC นี้" : "Agent ออฟไลน์"}
                          >
                            <Lock size={15} /> ล็อก
                          </button>
                          <button
                            type="button"
                            className="dm-sec"
                            disabled={!online}
                            onClick={() => setCmdTarget({ m, type: "shutdown" })}
                          >
                            <Power size={15} /> ปิดเครื่อง
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      {isAdmin && (
        <details className="dm-tools">
          <summary>
            <ShieldAlert size={17} className="dm-tools-ic" aria-hidden />
            <b>เครื่องมือควบคุม PC</b>
            <span className="dm-tools-hint">
              ล็อก / ปลดล็อก / ปิดเครื่องจากระยะไกล และประวัติคำสั่ง Agent
            </span>
            <span className="dm-tools-badge">แอดมิน</span>
          </summary>
          <div className="dm-tools-body">
            <div>
              <div className="dm-tools-rows">
                {machines.map((m) => {
                  const agent = agents.find((a) => a.machine_id === m.id);
                  const online = isAgentOnline(agent);
                  return (
                    <div className="dm-tools-row" key={m.id}>
                      <b className="dm-tools-pc">PC-{machineNo(m.machine_number)}</b>
                      <span className={`dm-agent ${online ? "" : "is-off"}`}>
                        <i aria-hidden />
                        {online ? "ออนไลน์" : "ออฟไลน์"}
                      </span>
                      <span className="dm-tools-sub">
                        {agent
                          ? `v${agent.agent_version ?? "?"} · ${fmtAgo(agent.last_heartbeat)}`
                          : "ยังไม่เคยเชื่อมต่อ"}
                      </span>
                      <span className="dm-tools-btns">
                        <button
                          type="button"
                          className="dm-mini is-amber"
                          disabled={!online}
                          onClick={() => setCmdTarget({ m, type: "lock" })}
                        >
                          <Lock size={13} /> ล็อก
                        </button>
                        <button
                          type="button"
                          className="dm-mini is-green"
                          disabled={!online}
                          onClick={() => setCmdTarget({ m, type: "unlock" })}
                        >
                          <Unlock size={13} /> ปลดล็อก
                        </button>
                        <button
                          type="button"
                          className="dm-mini is-red"
                          disabled={!online}
                          onClick={() => setCmdTarget({ m, type: "shutdown" })}
                        >
                          <Power size={13} /> ปิด
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="dm-tools-all">
                <button
                  type="button"
                  className="dm-mini is-amber"
                  onClick={() => setCmdTarget({ m: null, type: "lock" })}
                >
                  <Lock size={14} /> ล็อกทุกเครื่อง
                </button>
                <button
                  type="button"
                  className="dm-mini is-red"
                  onClick={() => setCmdTarget({ m: null, type: "shutdown" })}
                >
                  <Power size={14} /> ปิดทุกเครื่อง
                </button>
              </div>
            </div>
            <div className="dm-tools-log">
              <h4>ประวัติคำสั่งล่าสุด</h4>
              {commands.length === 0 ? (
                <div className="text-muted small">ยังไม่มีคำสั่ง</div>
              ) : (
                <ul>
                  {commands.map((c) => {
                    const mm = machines.find((x) => x.id === c.machine_id);
                    const ageSec = (Date.now() - new Date(c.created_at).getTime()) / 1000;
                    const stale = !c.ack_at && ageSec > 30;
                    return (
                      <li key={c.id}>
                        <span>
                          PC-{mm ? machineNo(mm.machine_number) : "??"} ·{" "}
                          {CMD_LABEL[c.type] ?? c.type}
                        </span>
                        <span>
                          {c.ack_at ? (
                            <span className="is-ok">ตอบรับแล้ว</span>
                          ) : stale ? (
                            <span className="is-bad">ไม่ตอบรับ</span>
                          ) : (
                            <span className="is-wait">รอตอบรับ</span>
                          )}{" "}
                          · <time>{fmtHHMM(c.created_at)}</time>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </details>
      )}

      <ConfirmDialog
        open={!!cmdTarget}
        title={cmdTarget ? `ยืนยัน: ${CMD_LABEL[cmdTarget.type] ?? cmdTarget.type}` : ""}
        icon={cmdTarget?.type === "shutdown" ? "⏻" : cmdTarget?.type === "unlock" ? "🔓" : "🔒"}
        variant={cmdTarget?.type === "shutdown" ? "danger" : "warning"}
        confirmLabel="ยืนยันส่งคำสั่ง"
        cancelLabel="ยกเลิก"
        message={
          cmdTarget ? (
            <div>
              {CMD_LABEL[cmdTarget.type] ?? cmdTarget.type}{" "}
              <b className="text-primary">
                {cmdTarget.m ? `PC ${cmdTarget.m.machine_number}` : "ทุกเครื่อง PC"}
              </b>
              ?
              <br />
              <span className="text-muted small">คำสั่งจะถูกส่งไปยัง Agent ทันที</span>
            </div>
          ) : (
            ""
          )
        }
        onConfirm={async () => {
          if (!cmdTarget) return;
          const t = cmdTarget;
          setCmdTarget(null);
          await runCommand(t.m, t.type);
        }}
        onCancel={() => setCmdTarget(null)}
      />

      {startTarget && (
        <StartPcModal
          machine={startTarget}
          onClose={() => setStartTarget(null)}
          onSuccess={() => {
            setStartTarget(null);
            reload();
          }}
        />
      )}

      {extendTarget && (
        <ExtendPcModal
          machine={extendTarget.m}
          session={extendTarget.s}
          onClose={() => setExtendTarget(null)}
          onSuccess={() => {
            setExtendTarget(null);
            reload();
          }}
        />
      )}

      {endTarget && (
        <EndPcModal
          machine={endTarget.m}
          session={endTarget.s}
          onClose={() => setEndTarget(null)}
          onSuccess={() => {
            setEndTarget(null);
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={!!lockTarget}
        title="ล็อกหน้าจอเครื่อง PC"
        icon="🔒"
        variant="warning"
        confirmLabel="ล็อกเลย"
        cancelLabel="ยกเลิก"
        message={
          lockTarget ? (
            <div>
              สั่งล็อกหน้าจอ PC {lockTarget.machine_number}?<br />
              <span className="text-muted small">
                Agent จะแสดงหน้าจอ YALA PLAYSTATION ทันที (ไม่กระทบ session ที่ทำงานอยู่)
              </span>
            </div>
          ) : (
            ""
          )
        }
        onConfirm={async () => {
          if (!lockTarget) return;
          try {
            await sendPcCommand(lockTarget.id, "lock");
            setLockTarget(null);
          } catch (e) {
            alert("สั่งล็อกไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
          }
        }}
        onCancel={() => setLockTarget(null)}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        title="ยืนยันยกเลิกบิล PC"
        icon="✖️"
        variant="danger"
        confirmLabel="ยกเลิกบิลเลย"
        cancelLabel="ไม่ยกเลิก"
        message={
          cancelTarget ? (
            <div>
              ยกเลิกบิลของ{" "}
              <b className="text-primary">
                {cancelTarget.s.customer_name || `ลูกค้า PC ${cancelTarget.m.machine_number}`}
              </b>
              <br />
              <span className="text-muted small">
                🖥️ PC เครื่อง {cancelTarget.m.machine_number}
              </span>
              <br />
              <span className="text-warning small">
                ⚠️ ยอดทั้งหมดจะไม่ถูกนับเป็นรายได้ และเครื่องจะกลับไปล็อกหน้าจอ
              </span>
            </div>
          ) : (
            ""
          )
        }
        onConfirm={async () => {
          if (!cancelTarget) return;
          const t = cancelTarget;
          setCancelTarget(null);
          try {
            await cancelPcSession(t.s.id);
            await reload();
          } catch (e) {
            alert("ยกเลิกบิลไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
          }
        }}
        onCancel={() => setCancelTarget(null)}
      />
    </>
  );
}

const DURATION_PRESETS = [
  { label: "30 นาที", minutes: 30 },
  { label: "1 ชั่วโมง", minutes: 60 },
  { label: "2 ชั่วโมง", minutes: 120 },
];

function StartPcModal({
  machine,
  onClose,
  onSuccess,
}: {
  machine: Machine;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { handleStartError } = useShop();
  const [minutes, setMinutes] = useState<number>(60);
  const [custom, setCustom] = useState<string>("");
  const [name, setName] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [cash, setCash] = useState<string>("");
  const [transfer, setTransfer] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [cfg, setCfg] = useState<PointsConfig>(DEFAULT_POINTS_CONFIG);
  const [nameFromMember, setNameFromMember] = useState(false);
  useEffect(() => {
    getPointsConfig()
      .then(setCfg)
      .catch(() => {});
  }, []);

  /** ค้นเจอสมาชิก -> เติมชื่อให้อัตโนมัติ, ถอดสมาชิกออก -> ล้างชื่อที่เติมให้ */
  function handleMemberChange(m: Member | null) {
    setMember(m);
    if (m) {
      setName(m.name);
      setNameFromMember(true);
    } else if (nameFromMember) {
      setName("");
      setNameFromMember(false);
    }
  }

  const finalMinutes = minutes === 0 ? parseInt(custom, 10) || 0 : minutes;
  const price = calcPcPrice(finalMinutes);
  const qrAmount = payMode === "transfer" ? price : payMode === "mixed" ? Number(transfer) || 0 : 0;

  const [autoRun, setAutoRun] = useState(false);
  function handleSlipVerified() {
    if (autoRun || busy) return;
    setAutoRun(true);
    setTimeout(() => {
      Promise.resolve(submit()).catch(() => setAutoRun(false));
    }, 900);
  }

  async function submit() {
    if (finalMinutes <= 0 || busy) return;
    setBusy(true);
    try {
      let paidCash = 0;
      let paidTransfer = 0;
      const redeemedPoints = payMode === "points";
      if (payMode === "cash") paidCash = price;
      else if (payMode === "transfer") paidTransfer = price;
      else if (payMode === "mixed") {
        paidCash = Number(cash) || 0;
        paidTransfer = Number(transfer) || 0;
      }
      await startPcSession({
        machineId: machine.id,
        minutes: finalMinutes,
        customerName: name.trim() || undefined,
        price,
        paidCash,
        paidTransfer,
        redeemedPoints,
        memberId: member?.id ?? null,
      });
      onSuccess();
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === "object"
            ? (e as { message?: string; details?: string; hint?: string; code?: string }).message ||
              (e as { details?: string }).details ||
              JSON.stringify(e)
            : String(e);
      console.error("startPcSession failed:", e);
      // ร้านปิด -> ขึ้นหน้าต่างเปิดร้านแทน alert
      if (handleStartError(e)) {
        onClose();
        return;
      }
      alert("เริ่ม session ไม่สำเร็จ: " + msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header bg-success text-white">
          <h5 className="modal-title fw-bold m-0">
            🟢 เริ่มเปิดเครื่อง PC {machine.machine_number}
          </h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <div className="p-4">
          <div className="mb-3">
            <label className="form-label fw-bold">🎫 เบอร์โทรสมาชิก</label>
            <MemberSearch value={member} onChange={handleMemberChange} defaultName={name} />
            {member ? (
              <div className="small text-success mt-1">
                บิลนี้จะได้ <b>{pointsForPlay("pc", { minutes: finalMinutes }, cfg)}</b> แต้ม
                <span className="text-muted">
                  {" "}
                  (โซน PC เล่น {cfg.hours_per_point_pc} ชม. = 1 แต้ม)
                </span>
              </div>
            ) : (
              <div className="small text-muted mt-1">
                ลูกค้าแจ้งเบอร์โทร ระบบจะดึงชื่อมาใส่ให้อัตโนมัติ — ไม่ใช่สมาชิกก็ข้ามได้
              </div>
            )}
          </div>
          <div className="mb-3">
            <label className="form-label fw-bold d-flex align-items-center gap-2">
              👤 ชื่อลูกค้า (ไม่บังคับ)
              {nameFromMember && (
                <span className="badge bg-info-subtle text-info border border-info-subtle fw-normal">
                  จากข้อมูลสมาชิก
                </span>
              )}
            </label>
            <input
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น เอ, บี..."
            />
          </div>
          <div className="mb-3">
            <label className="form-label fw-bold">⏱️ เลือกเวลา</label>
            <div className="d-grid gap-2">
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.minutes}
                  type="button"
                  className={`btn ${minutes === p.minutes ? "btn-success" : "btn-outline-success"} d-flex justify-content-between`}
                  onClick={() => setMinutes(p.minutes)}
                >
                  <span>{p.label}</span>
                  <b>{formatBaht(calcPcPrice(p.minutes))} บาท</b>
                </button>
              ))}
              <button
                type="button"
                className={`btn ${minutes === 0 ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => setMinutes(0)}
              >
                กำหนดเอง
              </button>
              {minutes === 0 && (
                <div className="input-group">
                  <input
                    type="number"
                    min={1}
                    className="form-control"
                    placeholder="จำนวนนาที"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    autoFocus
                  />
                  <span className="input-group-text">นาที</span>
                </div>
              )}
            </div>
          </div>
          <div className="alert alert-info py-2 text-center mb-3">
            รวม: <b>{finalMinutes}</b> นาที · ราคา{" "}
            <b className="text-danger">{formatBaht(price)}</b> บาท
            <div className="small text-muted">
              อัตรา: 30 บาท/30 นาที · 50 บาท/ชม. · 2 ชม. 100 บาท
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">💳 ช่องทางชำระ</label>
            <PayModeRadio name="pcStartPay" value={payMode} onChange={setPayMode} />
          </div>

          {payMode === "mixed" && (
            <div className="row g-2 mb-3">
              <div className="col-6">
                <label className="small text-success fw-bold">💵 เงินสด (บาท)</label>
                <input
                  type="number"
                  className="form-control"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                />
              </div>
              <div className="col-6">
                <label className="small text-primary fw-bold">📱 เงินโอน (บาท)</label>
                <input
                  type="number"
                  className="form-control"
                  value={transfer}
                  onChange={(e) => setTransfer(e.target.value)}
                />
              </div>
            </div>
          )}

          {payMode === "points" && (
            <div className="alert alert-warning py-2 small">
              🎁 ร้านแถมให้ — ไม่คิดเงิน ไม่หักแต้มสมาชิก (ไม่นับเข้ารายได้) · โซน PC
              ยังแลกแต้มไม่ได้
            </div>
          )}

          {payMode === "credit" && (
            <div className="alert alert-warning py-2 small">
              🧾 ค้างจ่าย — เปิดเครื่องก่อน ยังไม่รับเงิน (เก็บตอนเช็คบิล)
            </div>
          )}

          <PromptPayQR
            amount={qrAmount}
            onVerified={payMode === "transfer" ? handleSlipVerified : undefined}
          />
          {autoRun && (
            <div className="alert alert-success py-2 text-center mt-2 mb-0 fw-bold">
              ✅ ตรวจสลิปผ่านแล้ว — กำลังเปิดเครื่อง...
            </div>
          )}

          <div className="d-flex justify-content-end gap-2 mt-3">
            <button className="btn btn-secondary" onClick={onClose}>
              ยกเลิก
            </button>
            <button
              className="btn btn-success fw-bold"
              disabled={finalMinutes <= 0 || busy}
              onClick={submit}
            >
              {busy ? "กำลังเริ่ม..." : "🟢 เริ่มเปิดเครื่อง"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExtendPcModal({
  machine,
  session,
  onClose,
  onSuccess,
}: {
  machine: Machine;
  session: PcSession;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [minutes, setMinutes] = useState<number>(30);
  const [custom, setCustom] = useState<string>("");
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [cash, setCash] = useState<string>("");
  const [transfer, setTransfer] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const finalMinutes = minutes === 0 ? parseInt(custom, 10) || 0 : minutes;
  const price = calcPcPrice(finalMinutes);
  const qrAmount = payMode === "transfer" ? price : payMode === "mixed" ? Number(transfer) || 0 : 0;

  const [autoRun, setAutoRun] = useState(false);
  function handleSlipVerified() {
    if (autoRun || busy) return;
    setAutoRun(true);
    setTimeout(() => {
      Promise.resolve(submit()).catch(() => setAutoRun(false));
    }, 900);
  }

  async function submit() {
    if (finalMinutes <= 0 || busy) return;
    setBusy(true);
    try {
      let paidCash = 0;
      let paidTransfer = 0;
      const redeemedPoints = payMode === "points";
      if (payMode === "cash") paidCash = price;
      else if (payMode === "transfer") paidTransfer = price;
      else if (payMode === "mixed") {
        paidCash = Number(cash) || 0;
        paidTransfer = Number(transfer) || 0;
      }
      await extendPcSession(session.id, finalMinutes, { paidCash, paidTransfer, redeemedPoints });
      onSuccess();
    } catch (e) {
      alert("เพิ่มเวลาไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header bg-primary text-white">
          <h5 className="modal-title fw-bold m-0">➕ เพิ่มเวลา PC {machine.machine_number}</h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <div className="p-4">
          <div className="mb-3">
            <label className="form-label fw-bold">⏱️ เพิ่มอีก</label>
            <div className="d-grid gap-2">
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.minutes}
                  type="button"
                  className={`btn ${minutes === p.minutes ? "btn-primary" : "btn-outline-primary"} d-flex justify-content-between`}
                  onClick={() => setMinutes(p.minutes)}
                >
                  <span>{p.label}</span>
                  <b>{formatBaht(calcPcPrice(p.minutes))} บาท</b>
                </button>
              ))}
              <button
                type="button"
                className={`btn ${minutes === 0 ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => setMinutes(0)}
              >
                กำหนดเอง
              </button>
              {minutes === 0 && (
                <div className="input-group">
                  <input
                    type="number"
                    min={1}
                    className="form-control"
                    placeholder="จำนวนนาที"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    autoFocus
                  />
                  <span className="input-group-text">นาที</span>
                </div>
              )}
            </div>
          </div>
          <div className="alert alert-info py-2 text-center mb-3">
            เพิ่ม <b>{finalMinutes}</b> นาที · <b className="text-danger">{formatBaht(price)}</b>{" "}
            บาท
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">💳 ช่องทางชำระ</label>
            <PayModeRadio name="pcExtendPay" value={payMode} onChange={setPayMode} />
          </div>

          {payMode === "mixed" && (
            <div className="row g-2 mb-3">
              <div className="col-6">
                <label className="small text-success fw-bold">💵 เงินสด (บาท)</label>
                <input
                  type="number"
                  className="form-control"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                />
              </div>
              <div className="col-6">
                <label className="small text-primary fw-bold">📱 เงินโอน (บาท)</label>
                <input
                  type="number"
                  className="form-control"
                  value={transfer}
                  onChange={(e) => setTransfer(e.target.value)}
                />
              </div>
            </div>
          )}

          {payMode === "points" && (
            <div className="alert alert-warning py-2 small">
              🎁 ร้านแถมให้ — ไม่คิดเงิน ไม่หักแต้มสมาชิก (ไม่นับเข้ารายได้) · โซน PC
              ยังแลกแต้มไม่ได้
            </div>
          )}

          {payMode === "credit" && (
            <div className="alert alert-warning py-2 small">
              🧾 ค้างจ่าย — ต่อเวลาโดยยังไม่รับเงิน (เก็บตอนเช็คบิล)
            </div>
          )}

          <PromptPayQR
            amount={qrAmount}
            onVerified={payMode === "transfer" ? handleSlipVerified : undefined}
          />
          {autoRun && (
            <div className="alert alert-success py-2 text-center mt-2 mb-0 fw-bold">
              ✅ ตรวจสลิปผ่านแล้ว — กำลังต่อเวลา...
            </div>
          )}

          <div className="d-flex justify-content-end gap-2 mt-3">
            <button className="btn btn-secondary" onClick={onClose}>
              ยกเลิก
            </button>
            <button
              className="btn btn-primary fw-bold"
              disabled={finalMinutes <= 0 || busy}
              onClick={submit}
            >
              {busy ? "กำลังเพิ่ม..." : "➕ เพิ่มเวลา"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EndPcModal({
  machine,
  session,
  onClose,
  onSuccess,
}: {
  machine: Machine;
  session: PcSession;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [food, setFood] = useState<string>("");
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [cash, setCash] = useState<string>("");
  const [transfer, setTransfer] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [member, setMember] = useState<Member | null>(null);
  const [cfg, setCfg] = useState<PointsConfig>(DEFAULT_POINTS_CONFIG);
  useEffect(() => {
    getPointsConfig()
      .then(setCfg)
      .catch(() => {});
  }, []);
  useEffect(() => {
    let alive = true;
    if (!session.member_id) {
      setMember(null);
      return;
    }
    getMember(session.member_id)
      .then((m) => {
        if (alive) setMember(m);
      })
      .catch((e) => console.warn("[pc bill] load member failed:", e));
    return () => {
      alive = false;
    };
  }, [session.member_id]);

  async function handleMemberChange(m: Member | null) {
    setMember(m);
    try {
      await setPcSessionMember(session.id, m?.id ?? null);
    } catch (e) {
      console.warn("[pc bill] set member failed:", e);
    }
  }

  const pcEarn = pointsForPlay("pc", { minutes: Number(session.minutes_purchased) || 0 }, cfg);

  const [prodSales, setProdSales] = useState<
    (ProductSale & { product_sale_items: ProductSaleItem[] })[]
  >([]);
  useEffect(() => {
    listOpenSalesForBill({ pcSessionId: session.id })
      .then(setProdSales)
      .catch((e) => console.warn("[pc bill] load product sales failed:", e));
  }, [session.id]);
  const productItems = prodSales.flatMap((x) => x.product_sale_items ?? []);
  const productTotal = prodSales.reduce((sum, x) => sum + Number(x.total), 0);

  const now = Date.now();
  const usedMin = Math.max(0, Math.round((now - new Date(session.started_at).getTime()) / 60_000));
  const alreadyPaid = Number(session.paid_cash ?? 0) + Number(session.paid_transfer ?? 0);
  // บิลแถมฟรีที่เปิดก่อนแก้บั๊ก ยังเก็บราคาเต็มไว้ใน price (ทั้งที่ไม่ได้รับเงิน)
  // ถือว่าค่าเครื่องเป็น 0 ไม่งั้นจะขึ้นค้างชำระ และถ้ากดยืนยันจะบันทึกเงินสดที่ไม่ได้รับ
  // บิลที่เปิดหลังแก้แล้วเก็บ price = 0 ตั้งแต่ต้น จึงไม่เข้าเงื่อนไขนี้
  const legacyFree =
    !!session.redeemed_points &&
    alreadyPaid === 0 &&
    new Date(session.created_at).getTime() < LEGACY_FREE_BEFORE;
  const machinePrice = legacyFree ? 0 : Number(session.price ?? 0);
  const foodAmount = Number(food) || 0;
  const grandTotal = machinePrice + foodAmount + productTotal;
  const remaining = Math.max(0, grandTotal - alreadyPaid);
  const alreadyRedeemed = !!session.redeemed_points;

  const qrAmount =
    alreadyRedeemed && foodAmount === 0
      ? 0
      : payMode === "transfer"
        ? remaining
        : payMode === "mixed"
          ? Number(transfer) || 0
          : 0;

  const [autoRun, setAutoRun] = useState(false);
  function handleSlipVerified() {
    if (autoRun || busy) return;
    setAutoRun(true);
    setTimeout(() => {
      Promise.resolve(submit()).catch(() => setAutoRun(false));
    }, 900);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      let addCash = 0;
      let addTransfer = 0;
      if (remaining > 0) {
        if (payMode === "cash") addCash = remaining;
        else if (payMode === "transfer") addTransfer = remaining;
        else if (payMode === "mixed") {
          addCash = Number(cash) || 0;
          addTransfer = Number(transfer) || 0;
        }
      }
      if (productTotal > 0) {
        let prodCash = 0;
        let prodTransfer = 0;
        if (payMode === "cash") prodCash = Math.min(addCash, productTotal);
        else if (payMode === "transfer") prodTransfer = Math.min(addTransfer, productTotal);
        else if (payMode === "mixed") {
          prodCash = Math.min(addCash, productTotal);
          prodTransfer = Math.min(addTransfer, productTotal - prodCash);
        }
        addCash = Math.max(0, addCash - prodCash);
        addTransfer = Math.max(0, addTransfer - prodTransfer);
        await settleSalesForBill({
          pcSessionId: session.id,
          method:
            payMode === "credit" ? "points" : (payMode as "cash" | "transfer" | "mixed" | "points"),
          cash: prodCash,
          transfer: prodTransfer,
        });
      }
      await endPcSession(session.id, {
        forced: true,
        addCash,
        addTransfer,
        foodAmount,
        memberId: member?.id ?? null,
      });
      onSuccess();
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === "object"
            ? (e as { message?: string; details?: string }).message ||
              (e as { details?: string }).details ||
              JSON.stringify(e)
            : String(e);
      alert("ปิดเครื่องไม่สำเร็จ: " + msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-custom" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header bg-danger text-white">
          <h5 className="modal-title fw-bold m-0">🔴 ปิดเครื่อง PC {machine.machine_number}</h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <div className="p-4">
          <div className="alert alert-secondary py-2 small mb-3">
            <div>
              👤 ลูกค้า: <b>{session.customer_name || "-"}</b>
            </div>
            <div>
              ⏱️ เล่นจริง: <b>{usedMin}</b> นาที (ซื้อ {session.minutes_purchased} นาที)
            </div>
            <div>
              💰 ค่าเครื่อง: <b>{formatBaht(machinePrice)}</b> บาท{" "}
              {alreadyRedeemed && (
                <span className="badge ms-1" style={{ background: "#a855f7" }}>
                  🎁 แถมฟรี
                </span>
              )}
            </div>
            {productTotal > 0 && (
              <div>
                🛒 สินค้า: <b>{productItems.map((i) => `${i.name} x${i.qty}`).join(", ")}</b> ={" "}
                <b>{formatBaht(productTotal)}</b> บาท
              </div>
            )}
            <div>
              ✅ ชำระมาแล้ว: <b className="text-success">{formatBaht(alreadyPaid)}</b> บาท
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">🎫 สมาชิกสะสมแต้ม</label>
            <MemberSearch
              value={member}
              onChange={handleMemberChange}
              defaultName={session.customer_name ?? ""}
              compact
            />
            {member && (
              <div className="small text-success mt-1">
                ปิดบิลนี้จะได้อีก <b>{pcEarn}</b> แต้ม (รวมเป็น {member.points + pcEarn})
              </div>
            )}
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold">🍔 ค่าอาหาร/เครื่องดื่ม (บาท)</label>
            <input
              type="number"
              min={0}
              className="form-control"
              value={food}
              placeholder="0"
              onChange={(e) => setFood(e.target.value)}
            />
          </div>

          <div className="alert alert-warning py-2 text-center mb-3">
            ยอดคงเหลือต้องชำระ:{" "}
            <b className="text-danger" style={{ fontSize: "1.3rem" }}>
              {formatBaht(remaining)}
            </b>{" "}
            บาท
          </div>

          {remaining > 0 && (
            <>
              <div className="mb-3">
                <label className="form-label fw-bold">💳 ช่องทางชำระ</label>
                <div className="radio-box">
                  {[
                    { v: "cash" as PayMode, label: "💵 เงินสด" },
                    { v: "transfer" as PayMode, label: "📱 โอน" },
                    { v: "mixed" as PayMode, label: "🔀 ผสม" },
                  ].map((o) => (
                    <label key={o.v} className="radio-item">
                      <input
                        type="radio"
                        name="pcEndPay"
                        checked={payMode === o.v}
                        onChange={() => setPayMode(o.v)}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>

              {payMode === "mixed" && (
                <div className="row g-2 mb-3">
                  <div className="col-6">
                    <label className="small text-success fw-bold">💵 เงินสด (บาท)</label>
                    <input
                      type="number"
                      className="form-control"
                      value={cash}
                      onChange={(e) => setCash(e.target.value)}
                    />
                  </div>
                  <div className="col-6">
                    <label className="small text-primary fw-bold">📱 เงินโอน (บาท)</label>
                    <input
                      type="number"
                      className="form-control"
                      value={transfer}
                      onChange={(e) => setTransfer(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <PromptPayQR
                amount={qrAmount}
                onVerified={payMode === "transfer" ? handleSlipVerified : undefined}
              />
              {autoRun && (
                <div className="alert alert-success py-2 text-center mt-2 mb-0 fw-bold">
                  ✅ ตรวจสลิปผ่านแล้ว — กำลังปิดบิล...
                </div>
              )}
            </>
          )}

          <div className="d-flex justify-content-end gap-2 mt-3">
            <button className="btn btn-secondary" onClick={onClose}>
              ยกเลิก
            </button>
            <button className="btn btn-danger fw-bold" disabled={busy} onClick={submit}>
              {busy ? "กำลังบันทึก..." : "✅ ยืนยันปิดเครื่อง"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
