import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /ranking เดิม — ตอนนี้จอลูกค้ากับจออันดับรวมเป็นหน้าเดียวที่ /display (สลับกันแสดง)
 * จอที่ยังเปิดลิงก์เก่าไว้จะถูกพาไป /display อัตโนมัติ
 */
export const Route = createFileRoute("/ranking")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/display", replace: true });
  },
});
