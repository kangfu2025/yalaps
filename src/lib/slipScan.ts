import { supabase } from "./supabase";
import { verifySlip, type SlipVerifyResult } from "./slipVerify";
import { clearDisplay, showSlipResultScreen, showSlipScanScreen } from "./customerDisplay";

export type SlipScanStatus = "waiting" | "scanned" | "done" | "failed" | "cancelled";

export interface SlipScanRequest {
  id: string;
  status: SlipScanStatus;
  expected_amount: number;
  reservation_id: string | null;
  pc_session_id: string | null;
  payload: string | null;
  result_ok: boolean | null;
  result_message: string | null;
  created_at: string;
  updated_at: string;
}

/** พนักงานเริ่มขั้นตอน: สร้างคิว + สั่งจอลูกค้าเปิดกล้อง */
export async function startSlipScan(opts: {
  expectedAmount: number;
  reservationId?: string | null;
  pcSessionId?: string | null;
}): Promise<SlipScanRequest> {
  // ยกเลิกคิวเก่าที่ค้างอยู่ก่อน กันจอลูกค้าสับสนว่ากำลังรออันไหน
  await supabase
    .from("slip_scan_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("status", "waiting");

  const { data, error } = await supabase
    .from("slip_scan_requests")
    .insert({
      expected_amount: opts.expectedAmount,
      reservation_id: opts.reservationId ?? null,
      pc_session_id: opts.pcSessionId ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  const req = data as SlipScanRequest;
  await showSlipScanScreen(req.id, opts.expectedAmount);
  return req;
}

export async function cancelSlipScan(requestId: string) {
  await supabase
    .from("slip_scan_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "waiting");
  await clearDisplay();
}

/** จอลูกค้าอ่าน QR ได้แล้ว ส่งกลับมา (ใช้ anon key เขียนผ่าน RPC เท่านั้น) */
export async function submitScannedPayload(requestId: string, payload: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("submit_slip_scan", {
    p_request_id: requestId,
    p_payload: payload,
  });
  if (error) throw error;
  return Boolean(data);
}

/**
 * ฝั่งแอดมิน: เฝ้าคิวนี้ พอจอลูกค้าส่ง QR กลับมาก็ส่งไปตรวจกับ EasySlip
 * แล้วอัปเดตผลทั้งในคิวและบนจอลูกค้า
 */
export function watchSlipScan(
  requestId: string,
  onResult: (result: SlipVerifyResult) => void,
  onError?: (message: string) => void,
): () => void {
  let done = false;

  async function handle(row: SlipScanRequest) {
    if (done || row.status !== "scanned" || !row.payload) return;
    done = true;
    try {
      const result = await verifySlip({
        payload: row.payload,
        expectedAmount: Number(row.expected_amount) || 0,
        reservationId: row.reservation_id,
        pcSessionId: row.pc_session_id,
      });

      await supabase
        .from("slip_scan_requests")
        .update({
          status: result.ok ? "done" : "failed",
          result_ok: result.ok,
          result_message: result.error ?? "สลิปถูกต้อง",
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      await showSlipResultScreen(
        result.ok,
        result.ok ? "ยืนยันการชำระเงินเรียบร้อย" : (result.error ?? "ตรวจสลิปไม่ผ่าน"),
        Number(row.expected_amount) || 0,
      );

      onResult(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("slip_scan_requests")
        .update({ status: "failed", result_ok: false, result_message: msg })
        .eq("id", requestId);
      await showSlipResultScreen(false, "ตรวจสลิปไม่สำเร็จ กรุณาลองใหม่");
      onError?.(msg);
    }
  }

  const ch = supabase
    .channel(`slip-scan-${requestId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "slip_scan_requests",
        filter: `id=eq.${requestId}`,
      },
      (p) => handle(p.new as SlipScanRequest),
    )
    .subscribe();

  // สำรองเผื่อ realtime หลุด — ถามเองทุก 2 วินาที
  const poll = setInterval(async () => {
    if (done) return;
    const { data } = await supabase
      .from("slip_scan_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();
    if (data) handle(data as SlipScanRequest);
  }, 2000);

  return () => {
    done = true;
    clearInterval(poll);
    supabase.removeChannel(ch);
  };
}

/** ตารางพร้อมใช้งานหรือยัง */
export async function slipScanReady(): Promise<boolean> {
  try {
    const { error } = await supabase.from("slip_scan_requests").select("id").limit(1);
    if (error) throw error;
    return true;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code ?? "";
    const msg = e instanceof Error ? e.message : String(e ?? "");
    if (code === "PGRST205" || code === "42P01" || /Could not find the table/i.test(msg))
      return false;
    return true;
  }
}
