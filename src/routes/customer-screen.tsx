import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatBaht } from "@/lib/priceEngine";
import { PROMPTPAY_ID } from "@/lib/promptpay";
import type { DisplayPayload } from "@/lib/customerDisplay";


export const Route = createFileRoute("/customer-screen")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Customer Screen — YALA PLAYSTATION" }],
  }),
  component: CustomerScreenPage,
});

function CustomerScreenPage() {
  const [payload, setPayload] = useState<DisplayPayload>({ kind: "idle" });

  async function load() {
    const { data } = await supabase
      .from("customer_display")
      .select("payload")
      .eq("id", 1)
      .maybeSingle();
    if (data?.payload) setPayload(data.payload as DisplayPayload);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("display-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customer_display" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  if (payload.kind === "idle") {
    return (
      <div
        className="flex items-center justify-center"
        style={{
          width: 480,
          height: 320,
          background: "#0b0f19",
          overflow: "hidden",
        }}
      >
        <div className="text-center">
          <h1
            style={{
              fontSize: 30,
              fontWeight: 900,
              color: "#ffffff",
              lineHeight: 1.2,
              marginBottom: 12,
            }}
          >
            YALA PLAYSTATION
          </h1>
          <p
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "#34d399",
            }}
          >
            พร้อมให้บริการ
          </p>
        </div>
      </div>
    );
  }

  const showQr =
    payload.payment_method === "promptpay" && payload.qr_image_url;

  const playCost =
    typeof payload.amount === "number" && typeof payload.food_amount === "number"
      ? Math.max(0, payload.amount - payload.food_amount)
      : typeof payload.amount === "number"
        ? payload.amount
        : 0;

  return (
    <div
      className="flex"
      style={{
        width: 480,
        height: 320,
        background: "#0b0f19",
        color: "#ffffff",
        overflow: "hidden",
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Thai", sans-serif',
      }}
    >
      {/* Left ~60%: info */}
      <div
        className="flex flex-col justify-center"
        style={{
          flex: "1 1 0%",
          minWidth: 0,
          padding: "10px 14px",
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "#f59e0b",
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          กรุณาชำระเงิน
        </div>

        <div className="flex flex-col" style={{ gap: 4 }}>
          <InfoRow label="ชื่อลูกค้า" value={payload.customer_name || "-"} />
          <InfoRow
            label="หมายเลขเครื่อง"
            value={
              payload.machine_number ? String(payload.machine_number) : "-"
            }
          />
          <InfoRow label="ค่าเล่น" value={`฿ ${formatBaht(playCost)}`} />
          <InfoRow
            label="ค่าอาหาร"
            value={
              typeof payload.food_amount === "number"
                ? `฿ ${formatBaht(payload.food_amount)}`
                : "-"
            }
          />
          <InfoRow
            label="ยอดรวม"
            value={
              typeof payload.amount === "number"
                ? `฿ ${formatBaht(payload.amount)}`
                : "-"
            }
            isTotal
          />
        </div>
      </div>

      {/* Right ~40%: QR */}
      <div
        className="flex flex-col items-center justify-center"
        style={{
          flex: "0 0 200px",
          padding: "8px",
          borderLeft: "1px solid #1e293b",
        }}
      >
        {showQr ? (
          <>
            <img
              src={payload.qr_image_url}
              alt="QR PromptPay"
              style={{
                width: 180,
                height: 180,
                objectFit: "contain",
                display: "block",
              }}
            />
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#f59e0b",
                  marginTop: 6,
                  textAlign: "center",
                }}
              >
                {payload.promptpay_number || PROMPTPAY_ID}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#94a3b8",
                  marginTop: 2,
                  textAlign: "center",
                }}
              >
                กรุณาสแกนเพื่อชำระเงิน
              </div>
          </>
        ) : (
          <div style={{ fontSize: 14, color: "#64748b" }}>ไม่มี QR</div>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  isTotal,
}: {
  label: string;
  value: string;
  isTotal?: boolean;
}) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{ gap: 8, lineHeight: isTotal ? 1.1 : 1.3 }}
    >
      <span
        style={{
          fontSize: isTotal ? 14 : 13,
          fontWeight: isTotal ? 700 : 500,
          color: isTotal ? "#f59e0b" : "#9ca3af",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: isTotal ? 48 : 15,
          fontWeight: isTotal ? 800 : 600,
          color: isTotal ? "#fb923c" : "#ffffff",
          textAlign: "right",
          whiteSpace: "nowrap",
          letterSpacing: isTotal ? "-0.02em" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}
