import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";
import { buildPromptpayDataUrl, PROMPTPAY_ID } from "@/lib/promptpay";
import { formatBaht, formatHours } from "@/lib/priceEngine";
import { clearDisplay, type DisplayPayload } from "@/lib/customerDisplay";
import { SlipQrCamera, type CameraDevice } from "@/components/shop/SlipQrCamera";
import { submitScannedPayload } from "@/lib/slipScan";
import { formatBaht as fmtBaht } from "@/lib/priceEngine";

const CAMERA_KEY = "yala-slip-camera";

export const Route = createFileRoute("/display")({
  ssr: false,
  head: () => ({ meta: [{ title: "หน้าจอลูกค้า — YALA PLAYSTATION" }] }),
  component: DisplayPage,
});

interface PromoRow {
  id: string;
  data_url: string;
  sort_order: number;
}

function DisplayPage() {
  const [payload, setPayload] = useState<DisplayPayload>({ kind: "idle" });
  const [qrUrl, setQrUrl] = useState("");
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const [promoIdx, setPromoIdx] = useState(0);
  const [joinQr, setJoinQr] = useState("");
  const payloadRef = useRef<DisplayPayload>({ kind: "idle" });
  const [scanSent, setScanSent] = useState(false);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  // จำกล้องที่เลือกไว้ในเครื่องที่ต่อจอลูกค้า (เครื่องละค่า ไม่ยุ่งกับเครื่องอื่น)
  const [cameraId, setCameraId] = useState<string>(() => {
    try {
      return localStorage.getItem(CAMERA_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const pickCamera = useCallback((id: string) => {
    setCameraId(id);
    try {
      if (id) localStorage.setItem(CAMERA_KEY, id);
      else localStorage.removeItem(CAMERA_KEY);
    } catch {
      /* โหมดส่วนตัวเขียนไม่ได้ ก็ใช้ได้แค่รอบนี้ */
    }
  }, []);

  const handleDevices = useCallback((list: CameraDevice[]) => setCameras(list), []);

  const handleSlipDetected = useCallback(
    (code: string) => {
      const reqId = payloadRef.current.slip_request_id;
      if (!reqId) return;
      setScanSent(true);
      submitScannedPayload(reqId, code).catch((e) => {
        console.error("submit slip scan failed", e);
        setScanSent(false);
      });
    },
    [],
  );

  // QR สมัครสมาชิก — ชี้ไปหน้า /join ของโดเมนเดียวกับที่จอนี้เปิดอยู่
  useEffect(() => {
    if (typeof window === "undefined") return;
    QRCode.toDataURL(`${window.location.origin}/join`, { width: 720, margin: 1 })
      .then(setJoinQr)
      .catch((e) => console.error("build join QR failed", e));
  }, []);

  // สมัครเสร็จ: โชว์หน้าต้อนรับ 5 วินาที แล้วปิดกลับโหมดปกติเอง
  useEffect(() => {
    if (payload.kind !== "join_done") return;
    const t = setTimeout(() => {
      clearDisplay().catch((e) => console.error("clear display failed", e));
    }, 5000);
    return () => clearTimeout(t);
  }, [payload.kind, payload.customer_name]);

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  // เริ่มรอบสแกนใหม่ = พร้อมอ่านอีกครั้ง
  useEffect(() => {
    if (payload.kind === "slip_scan") setScanSent(false);
  }, [payload.kind, payload.slip_request_id]);

  // ผลตรวจสลิป: โชว์ 6 วินาทีแล้วกลับโหมดปกติ
  useEffect(() => {
    if (payload.kind !== "slip_result") return;
    const t = setTimeout(() => {
      clearDisplay().catch((e) => console.error("clear display failed", e));
    }, 6000);
    return () => clearTimeout(t);
  }, [payload.kind, payload.slip_message]);

  async function load() {
    const { data } = await supabase
      .from("customer_display")
      .select("payload")
      .eq("id", 1)
      .maybeSingle();
    if (data?.payload) setPayload(data.payload as DisplayPayload);
  }

  async function loadPromos() {
    const { data } = await supabase
      .from("promo_images")
      .select("id, data_url, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    setPromos((data ?? []) as PromoRow[]);
    setPromoIdx(0);
  }

  useEffect(() => {
    load();
    loadPromos();
    const ch1 = supabase
      .channel("display-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_display" }, () => load())
      .subscribe();
    const ch2 = supabase
      .channel("promo-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "promo_images" }, () => loadPromos())
      .subscribe();
    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, []);

  // สลับรูปทุก 8 วิ ถ้ามีมากกว่า 1
  useEffect(() => {
    if (promos.length <= 1) return;
    const t = setInterval(() => setPromoIdx((i) => (i + 1) % promos.length), 8000);
    return () => clearInterval(t);
  }, [promos.length]);

  // ยอด QR
  const qrAmount = (() => {
    const explicit = payload.qr ? parseFloat(payload.qr) : 0;
    if (explicit > 0) return explicit;
    const method = payload.payment_method;
    if (method === "promptpay" || method === "transfer" || method === "mixed") {
      return Number(payload.amount) || 0;
    }
    return 0;
  })();

  const showQr = qrAmount > 0;

  useEffect(() => {
    if (payload.qr_code) {
      setQrUrl(payload.qr_code);
      return;
    }
    if (showQr) {
      buildPromptpayDataUrl(qrAmount).then(setQrUrl).catch(console.error);
    } else {
      setQrUrl("");
    }
  }, [payload.qr_code, qrAmount, showQr]);

  // ---------- ตรวจสลิป: เปิดกล้องให้ลูกค้าโชว์ QR บนสลิป ----------
  if (payload.kind === "slip_scan" && payload.slip_request_id) {
    return (
      <div className="display-portrait display-slip">
        <div className="slip-scr-head">
          <div className="slip-scr-title">สแกนสลิปโอนเงิน</div>
          <div className="slip-scr-amount">
            ยอด <b>{fmtBaht(Number(payload.slip_amount) || 0)}</b> บาท
          </div>
        </div>

        <SlipQrCamera
          paused={scanSent}
          deviceId={cameraId || null}
          onDevices={handleDevices}
          onDetected={handleSlipDetected}
        />

        {cameras.length > 1 && (
          <div className="slip-scr-campick">
            <label htmlFor="slipCam">กล้องที่ใช้</label>
            <select
              id="slipCam"
              value={cameraId}
              onChange={(e) => pickCamera(e.target.value)}
            >
              <option value="">กล้องเริ่มต้นของเครื่อง</option>
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="slip-scr-steps">
          <div className="slip-scr-step">
            <span className="n">1</span> เปิดสลิปโอนเงินในมือถือ
          </div>
          <div className="slip-scr-step">
            <span className="n">2</span> หัน <b>QR บนสลิป</b> เข้าหากล้อง
          </div>
          <div className="slip-scr-step">
            <span className="n">3</span> ถือนิ่ง ๆ ให้ QR อยู่ในกรอบ
          </div>
        </div>

        <div className="slip-scr-foot">
          {scanSent ? "อ่านสลิปได้แล้ว กำลังตรวจกับธนาคาร..." : "ระบบจะอ่านให้อัตโนมัติ ไม่ต้องกดอะไร"}
        </div>
      </div>
    );
  }

  // ---------- ผลตรวจสลิป ----------
  if (payload.kind === "slip_result") {
    const ok = payload.slip_ok === true;
    return (
      <div className={`display-portrait display-slip-result ${ok ? "is-ok" : "is-bad"}`}>
        <div className="slip-res-mark">{ok ? "✓" : "!"}</div>
        <div className="slip-res-title">{ok ? "ชำระเงินเรียบร้อย" : "ตรวจสลิปไม่ผ่าน"}</div>
        {typeof payload.slip_amount === "number" && payload.slip_amount > 0 && (
          <div className="slip-res-amount">{fmtBaht(payload.slip_amount)} บาท</div>
        )}
        <div className="slip-res-msg">{payload.slip_message}</div>
        {!ok && <div className="slip-res-note">กรุณาติดต่อพนักงานที่เคาน์เตอร์</div>}
      </div>
    );
  }

  // ---------- QR สมัครสมาชิก: เต็มจอเมื่อพนักงานสั่ง ----------
  if (payload.kind === "join") {
    return (
      <div className="display-portrait display-join">
        <div className="join-scr-head">
          <div className="join-scr-brand">YALA PLAYSTATION</div>
          <div className="join-scr-title">สมัครสมาชิกสะสมแต้ม</div>
        </div>

        <div className="join-scr-qr">
          {joinQr ? (
            <img src={joinQr} alt="QR สมัครสมาชิก" />
          ) : (
            <div className="join-scr-qr-loading">กำลังสร้าง QR...</div>
          )}
        </div>

        <div className="join-scr-scan">📱 สแกนด้วยกล้องมือถือ</div>

        <div className="join-scr-perks">
          <div className="join-scr-perk">
            <span className="p-num">1</span>
            <span className="p-txt">ชั่วโมง</span>
            <span className="p-eq">=</span>
            <span className="p-num p-gold">1</span>
            <span className="p-txt">แต้ม</span>
          </div>
          <div className="join-scr-perk">
            <span className="p-num p-gold">10</span>
            <span className="p-txt">แต้ม</span>
            <span className="p-eq">=</span>
            <span className="p-txt p-free">เล่นฟรี 1 ชั่วโมง</span>
          </div>
        </div>

        <div className="join-scr-foot">กรอกแค่ชื่อกับเบอร์โทร ใช้เวลาไม่ถึงนาที</div>
      </div>
    );
  }

  // ---------- สมัครสำเร็จ: โชว์ต้อนรับแล้วปิดกลับโหมดปกติเอง ----------
  if (payload.kind === "join_done") {
    return (
      <div className="display-portrait display-join-done">
        <div className="join-done-check">✓</div>
        <div className="join-done-title">สมัครสมาชิกสำเร็จ</div>
        {payload.customer_name && (
          <div className="join-done-name">คุณ{payload.customer_name}</div>
        )}
        <div className="join-done-sub">ยินดีต้อนรับสู่ YALA PLAYSTATION</div>
        <div className="join-done-note">
          แจ้งเบอร์โทรกับพนักงานทุกครั้งที่มาเล่น<br />ระบบจะสะสมแต้มให้อัตโนมัติ
        </div>
      </div>
    );
  }

  // Idle
  if (!showQr) {
    const current = promos[promoIdx];
    return (
      <div className="display-portrait display-idle">
        {current ? (
          <img
            key={current.id}
            src={current.data_url}
            alt="Promotion"
            className="display-promo-img"
          />
        ) : (
          <div className="display-promo-empty">
            <div className="brand-big">🎮 YALA PLAYSTATION</div>
            <div className="sub">ยินดีต้อนรับ</div>
            <div className="hint">แอดมินยังไม่ได้อัปโหลดรูปโปรโมชั่น</div>
          </div>
        )}
      </div>
    );
  }


  // มีการชำระ → แสดง QR เต็มจอ
  const chargeLabel =
    payload.charge_type === "start"
      ? "ค่าเปิดเครื่อง"
      : payload.charge_type === "extend"
        ? "ค่าต่อเวลา"
        : payload.charge_type === "food"
          ? "ค่าอาหาร/เครื่องดื่ม"
          : payload.charge_type === "checkout"
            ? "ยอดชำระปิดบิล"
            : "ยอดที่ต้องชำระ";

  const extMin = (payload.extend_hours ?? 0) * 60;

  return (
    <div className="display-portrait display-pay">
      <div className="display-pay-header">
        <div className="brand">🎮 YALA PLAYSTATION</div>
        {payload.zone && (
          <div className="zone-badge">
            {payload.zone === "sofa" ? "🛋️ โซฟา" : payload.zone === "racing" ? "🏎️ รถแข่ง" : "🖥️ PC"}
            {typeof payload.machine_number === "number" ? ` · เครื่อง ${payload.machine_number}` : ""}
          </div>
        )}
      </div>

      {payload.customer_name && (
        <div className="display-customer">👤 {payload.customer_name}</div>
      )}

      <div className="display-amount-block">
        <div className="amount-label">{chargeLabel}</div>
        <div className="amount-value">
          {formatBaht(qrAmount)} <span className="amount-unit">บาท</span>
        </div>
      </div>

      <div className="display-breakdown">
        {typeof payload.play_hours === "number" && payload.play_hours > 0 && (
          <div className="bd-row">
            <span className="bd-label">⏱️ เวลาเล่นรวม</span>
            <span className="bd-value">{formatHours(payload.play_hours)} ชม.</span>
          </div>
        )}
        {payload.charge_type === "extend" && extMin > 0 && (
          <div className="bd-row bd-highlight">
            <span className="bd-label">➕ ต่อเวลา</span>
            <span className="bd-value">
              {extMin >= 60
                ? `${formatHours(payload.extend_hours ?? 0)} ชม. (${extMin} นาที)`
                : `${extMin} นาที`}
            </span>
          </div>
        )}
        {payload.charge_type === "food" && (payload.food_charge ?? 0) > 0 && (
          <div className="bd-row bd-highlight">
            <span className="bd-label">🍽️ ค่าอาหาร/เครื่องดื่ม</span>
            <span className="bd-value">{formatBaht(payload.food_charge ?? 0)} บาท</span>
          </div>
        )}
        {typeof payload.food_amount === "number" && payload.food_amount > 0 &&
          payload.charge_type !== "food" && (
            <div className="bd-row">
              <span className="bd-label">🍽️ ค่าอาหารสะสม</span>
              <span className="bd-value">{formatBaht(payload.food_amount)} บาท</span>
            </div>
          )}
        {(payload.start_time || payload.end_time) && (
          <div className="bd-row">
            <span className="bd-label">🕒 ช่วงเวลา</span>
            <span className="bd-value">
              {payload.start_time ?? "—"} - {payload.end_time ?? "—"}
            </span>
          </div>
        )}
      </div>

      <div className="display-qr-frame">
        {qrUrl ? (
          <img src={qrUrl} alt="PromptPay QR" className="display-qr-img" />
        ) : (
          <div className="qr-loading">กำลังสร้าง QR...</div>
        )}
        <div className="qr-caption">
          <div className="qr-title">📱 สแกนจ่ายผ่าน PromptPay</div>
          <div className="qr-pp">{payload.promptpay_number || PROMPTPAY_ID}</div>
        </div>
      </div>

      <div className="display-footer">
        {payload.message ? payload.message : "รอแอดมินยืนยันการชำระเงิน"}
      </div>
    </div>
  );
}
