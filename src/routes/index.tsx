import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, AlertTriangle, Tag } from "lucide-react";
import { useShopData } from "@/hooks/useShopData";
import { MachineCard } from "@/components/shop/MachineCard";
import { StartModal } from "@/components/shop/StartModal";
import { ManageModal } from "@/components/shop/ManageModal";
import { ReservationsPanel } from "@/components/shop/ReservationsPanel";
import { ReportPanel } from "@/components/shop/ReportPanel";
import { PromotionPanel } from "@/components/shop/PromotionPanel";
import { PromoImagesPanel } from "@/components/shop/PromoImagesPanel";
import { PcZonePanel } from "@/components/shop/PcZonePanel";
import { CouponsPanel } from "@/components/shop/CouponsPanel";
import { UsersPanel } from "@/components/shop/UsersPanel";
import { MembersPanel } from "@/components/shop/MembersPanel";
import { LineSettingsPanel } from "@/components/shop/LineSettingsPanel";
import { ProductsPanel } from "@/components/shop/ProductsPanel";
import { ProductSalePanel } from "@/components/shop/ProductSalePanel";
import { ConfirmDialog } from "@/components/shop/ConfirmDialog";
import { AdminSidebar, type Tab } from "@/components/shop/AdminSidebar";
import type { Machine, Reservation } from "@/lib/supabase";
import { cancelReservation } from "@/lib/reservations";
import { formatBaht } from "@/lib/priceEngine";
import { getZonePrice } from "@/lib/promotions";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "YALA PLAYSTATION 🎮 (Admin)" },
      { name: "description", content: "ระบบบริหารร้านเกม PS5" },
    ],
  }),
  component: IndexGuarded,
});

const STAFF_TABS: Tab[] = ["dash", "pc", "pos", "stock", "report", "screen", "members"];

const TAB_TITLE: Record<Tab, string> = {
  dash: "แดชบอร์ด PS5",
  pc: "โซน PC",
  pos: "ขายสินค้า",
  stock: "คลังสินค้า",
  report: "บัญชีและสรุปยอด",
  members: "สมาชิกและแต้มสะสม",
  line: "แจ้งเตือน LINE",
  coupons: "คูปอง",
  res: "คิวจองล่วงหน้า",
  promo: "โปรโมชั่น",
  screen: "รูปหน้าจอ",
  users: "ผู้ใช้งาน",
};


function IndexGuarded() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [loading, user, navigate]);

  if (loading) return <div className="text-center py-5 text-muted">กำลังตรวจสอบสิทธิ์...</div>;
  if (!user) return null;
  return <Index />;
}

function Index() {
  const { machines, resByMachine, activePromotion, loading, error, refresh } = useShopData();
  const { username, role, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === "admin";
  const [tab, setTab] = useState<Tab>("dash");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [startTarget, setStartTarget] = useState<Machine | null>(null);
  const [manageTarget, setManageTarget] = useState<{ m: Machine; r: Reservation } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ m: Machine; r: Reservation } | null>(null);

  // staff เข้าได้เฉพาะ dash/pc — ถ้าหลุดไป tab อื่นให้ดีดกลับ
  useEffect(() => {
    if (!isAdmin && !STAFF_TABS.includes(tab)) setTab("dash");
  }, [isAdmin, tab]);

  const effTab: Tab = isAdmin || STAFF_TABS.includes(tab) ? tab : "dash";

  const sofa = machines.filter((m) => m.zone === "sofa");
  const racing = machines.filter((m) => m.zone === "racing");
  const pcs = machines.filter((m) => m.zone === "pc");
  const sofaOverride = activePromotion ? getZonePrice("sofa", activePromotion) : null;
  const racingOverride = activePromotion ? getZonePrice("racing", activePromotion) : null;

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth", replace: true });
  }


  async function doCancel() {
    if (!cancelTarget) return;
    const { m, r } = cancelTarget;
    setCancelTarget(null);
    try {
      await cancelReservation(m.id, r.id);
      await refresh();
    } catch (e) {
      alert("ยกเลิกไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <>
      <div className="yl-shell">
        <AdminSidebar
          tab={effTab}
          onTab={setTab}
          isAdmin={isAdmin}
          role={role}
          username={username}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          onRefresh={refresh}
          onSignOut={handleSignOut}
        />

        <div className="yl-main">
          <header className="yl-topbar">
            <button className="yl-burger d-lg-none" onClick={() => setMobileOpen(true)} aria-label="เปิดเมนู">
              <Menu size={18} />
            </button>
            <span className="yl-crumb">{TAB_TITLE[effTab]}</span>
          </header>

          <div className="container-fluid px-3 px-lg-4 my-4">
        {error && <div className="alert alert-danger d-flex align-items-center gap-2"><AlertTriangle size={16} /> {error}</div>}
        {role === null && (
          <div className="alert alert-warning">
            <b>บัญชีนี้ยังไม่ถูกกำหนดสิทธิ์</b> — ระบบจึงแสดงเฉพาะแท็บพื้นฐาน
            <div className="small mt-1">ให้รัน SQL <code>supabase/seed_admin.sql</code> ใน Supabase SQL Editor เพื่อกำหนดสิทธิ์ Admin ให้อีเมลนี้ แล้วรีเฟรชหน้า</div>
          </div>
        )}



        {activePromotion && effTab === "dash" && (
          <div className="alert alert-success d-flex align-items-center gap-2 py-2">
            <Tag size={16} /> 🎉 <b>โปรวันนี้:</b> {activePromotion.name}
            <span className="ms-2 small">— โซฟา 1 ชม. <b>{formatBaht(Number(activePromotion.sofa_hour))}</b> บ. / รถแข่ง 1 ชม. <b>{formatBaht(Number(activePromotion.racing_hour))}</b> บ.</span>
          </div>
        )}

        {loading ? (
          <div className="text-center py-5 text-muted">กำลังโหลด...</div>
        ) : effTab === "dash" ? (
          <>
            <h5 className="zone-sofa-title">🛋️ โซนโซฟา</h5>
            <div className="row row-cols-1 row-cols-md-3 row-cols-lg-5 g-3">
              {sofa.map((m) => (
                <MachineCard
                  key={m.id}
                  machine={m}
                  reservation={resByMachine.get(m.id)}
                  priceOverride={sofaOverride}
                  onStart={setStartTarget}
                  onManage={(machine, r) => setManageTarget({ m: machine, r })}
                  onCancel={(m, r) => setCancelTarget({ m, r })}
                />
              ))}
            </div>

            <h5 className="zone-racing-title">🏎️ โซนรถแข่ง</h5>
            <div className="row row-cols-1 row-cols-md-3 g-3">
              {racing.map((m) => (
                <MachineCard
                  key={m.id}
                  machine={m}
                  reservation={resByMachine.get(m.id)}
                  priceOverride={racingOverride}
                  onStart={setStartTarget}
                  onManage={(machine, r) => setManageTarget({ m: machine, r })}
                  onCancel={(m, r) => setCancelTarget({ m, r })}
                />
              ))}
            </div>
          </>
        ) : effTab === "pc" ? (
          <PcZonePanel machines={pcs} />
        ) : effTab === "pos" ? (
          <ProductSalePanel machines={machines} resByMachine={resByMachine} />
        ) : effTab === "stock" ? (
          <ProductsPanel />
        ) : effTab === "members" ? (
          <MembersPanel />
        ) : effTab === "report" ? (
          <ReportPanel hideTotals={!isAdmin} />
        ) : effTab === "screen" ? (
          <PromoImagesPanel />
        ) : !isAdmin ? (
          <div className="alert alert-warning">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</div>
        ) : effTab === "coupons" ? (
          <CouponsPanel />
        ) : effTab === "res" ? (
          <ReservationsPanel />
        ) : effTab === "promo" ? (
          <PromotionPanel />
        ) : effTab === "line" ? (
          <LineSettingsPanel />
        ) : effTab === "users" ? (
          <UsersPanel />
        ) : (
          <ReportPanel />

        )}
          </div>
        </div>
      </div>




      <StartModal machine={startTarget} onClose={() => setStartTarget(null)} onSuccess={refresh} promotion={activePromotion} />
      {manageTarget && (
        <ManageModal
          machine={manageTarget.m}
          reservation={manageTarget.r}
          onClose={() => setManageTarget(null)}
          onSuccess={refresh}
          promotion={activePromotion}
        />
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        title="ยืนยันยกเลิกบิล"
        icon="✖️"
        variant="danger"
        confirmLabel="ยกเลิกบิลเลย"
        cancelLabel="ไม่ยกเลิก"
        message={
          cancelTarget ? (
            <div>
              ยกเลิกบิลของ <b className="text-primary">{cancelTarget.r.customer_name}</b><br />
              <span className="text-muted small">
                {cancelTarget.m.zone === "sofa" ? "🛋️ โซฟา" : "🏎️ รถแข่ง"} เครื่อง {cancelTarget.m.machine_number}
              </span><br />
              <span className="text-warning small">⚠️ เครื่องจะกลับเป็นว่างพร้อมใช้</span>
            </div>
          ) : ""
        }
        onConfirm={doCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </>
  );
}
