import { createFileRoute } from "@tanstack/react-router";
import { DisplayScreen } from "@/components/shop/DisplayScreen";

export const Route = createFileRoute("/display")({
  ssr: false,
  head: () => ({ meta: [{ title: "หน้าจอลูกค้า — YALA PLAYSTATION" }] }),
  component: DisplayPage,
});

function DisplayPage() {
  return <DisplayScreen />;
}
