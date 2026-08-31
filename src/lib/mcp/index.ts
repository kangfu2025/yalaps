import { defineMcp } from "@lovable.dev/mcp-js";
import listMachines from "./tools/list-machines";
import listActiveReservations from "./tools/list-active-reservations";
import revenueReport from "./tools/revenue-report";

export default defineMcp({
  name: "yala-playstation-mcp",
  title: "YALA PlayStation MCP",
  version: "0.1.0",
  instructions:
    "Tools for the YALA PlayStation PS5 shop admin. Use `list_machines` to see machine status, `list_active_reservations` to see who is currently playing, and `revenue_report` for billing summaries over a date range.",
  tools: [listMachines, listActiveReservations, revenueReport],
});
