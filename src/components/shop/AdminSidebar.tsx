import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Gamepad2, Monitor, ShoppingCart, Package, BarChart3, Ticket, CalendarDays,
  Tag, Image as ImageIcon, Users, LogOut, Shield, RefreshCw, PanelLeftClose, PanelLeftOpen, X, IdCard, MessageCircle,
} from "lucide-react";

export type Tab = "dash" | "pc" | "pos" | "stock" | "coupons" | "res" | "report" | "promo" | "screen" | "users" | "members" | "line";

type Item = { key: Tab; label: string; icon: LucideIcon; adminOnly?: boolean };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "ปฏิบัติการ",
    items: [
      { key: "dash", label: "แดชบอร์ด PS5", icon: Gamepad2 },
      { key: "pc", label: "โซน PC", icon: Monitor },
      { key: "pos", label: "ขายสินค้า", icon: ShoppingCart },
      { key: "stock", label: "คลังสินค้า", icon: Package },
      { key: "members", label: "สมาชิก", icon: IdCard },
      { key: "report", label: "บัญชีและสรุปยอด", icon: BarChart3 },
    ],
  },
  {
    title: "ผู้ดูแลระบบ",
    items: [
      { key: "coupons", label: "คูปอง", icon: Ticket, adminOnly: true },
      { key: "res", label: "คิวจองล่วงหน้า", icon: CalendarDays, adminOnly: true },
      { key: "promo", label: "โปรโมชั่น", icon: Tag, adminOnly: true },
      { key: "screen", label: "รูปหน้าจอ", icon: ImageIcon },
      { key: "line", label: "แจ้งเตือน LINE", icon: MessageCircle, adminOnly: true },
      { key: "users", label: "ผู้ใช้งาน", icon: Users, adminOnly: true },
    ],
  },
];

type Props = {
  tab: Tab;
  onTab: (t: Tab) => void;
  isAdmin: boolean;
  role: string | null;
  username?: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
};

export function AdminSidebar({
  tab, onTab, isAdmin, role, username, collapsed, onToggleCollapsed,
  mobileOpen, onCloseMobile, onRefresh, onSignOut,
}: Props) {
  return (
    <>
      {mobileOpen && <div className="yl-sb-overlay" onClick={onCloseMobile} />}
      <aside
        className={`yl-sb ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-open" : ""}`}
        aria-label="เมนูหลัก"
      >
        <div className="yl-sb-head">
          <div className="yl-sb-logo" aria-hidden>🎮</div>
          <div className="yl-sb-brand">
            <span className="yl-sb-title">YALA PLAYSTATION</span>
            <span className="yl-sb-sub">
              {isAdmin ? "Admin Console" : role === "staff" ? "Staff Console" : "รอกำหนดสิทธิ์"}
            </span>
          </div>
          <button className="yl-sb-x d-lg-none" onClick={onCloseMobile} aria-label="ปิดเมนู">
            <X size={16} />
          </button>
        </div>

        <div className="yl-sb-user">
          <span className="yl-sb-avatar">{(username ?? "?").slice(0, 1).toUpperCase()}</span>
          <div className="yl-sb-brand">
            <span className="yl-sb-uname">{username ?? "-"}</span>
            <span className="yl-sb-role">
              {isAdmin ? (
                <><Shield size={10} /> admin</>
              ) : role === "staff" ? "พนักงาน" : "ยังไม่กำหนดสิทธิ์"}
            </span>
          </div>
        </div>

        <nav className="yl-sb-nav">
          {GROUPS.map((g) => {
            const items = g.items.filter((i) => !i.adminOnly || isAdmin);
            if (!items.length) return null;
            return (
              <div key={g.title} className="yl-sb-group">
                <div className="yl-sb-grouplabel">{g.title}</div>
                {items.map((i) => (
                  <button
                    key={i.key}
                    className={`yl-sb-item ${tab === i.key ? "active" : ""}`}
                    onClick={() => { onTab(i.key); onCloseMobile(); }}
                    title={i.label}
                  >
                    <i.icon size={17} className="yl-sb-ico" />
                    <span className="yl-sb-label">{i.label}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="yl-sb-foot">
          <Link to="/display" target="_blank" className="yl-sb-item" title="จอลูกค้า">
            <Monitor size={17} className="yl-sb-ico" />
            <span className="yl-sb-label">จอลูกค้า</span>
          </Link>
          <button className="yl-sb-item" onClick={onRefresh} title="รีเฟรช">
            <RefreshCw size={17} className="yl-sb-ico" />
            <span className="yl-sb-label">รีเฟรช</span>
          </button>
          <button className="yl-sb-item danger" onClick={onSignOut} title="ออกจากระบบ">
            <LogOut size={17} className="yl-sb-ico" />
            <span className="yl-sb-label">ออกจากระบบ</span>
          </button>
          <button className="yl-sb-collapse d-none d-lg-flex" onClick={onToggleCollapsed} title="ย่อ/ขยายเมนู">
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span className="yl-sb-label">ย่อเมนู</span>
          </button>
        </div>
      </aside>
    </>
  );
}
