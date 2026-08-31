import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = "https://teyvwnnrchjnffyjtljl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRleXZ3bm5yY2hqbmZmeWp0bGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODMzOTQsImV4cCI6MjA5Njc1OTM5NH0.rykYOT9NS4LLgvbjqpoAMuBqMEeX9_aivlfCa_77xo8";

export default defineTool({
  name: "revenue_report",
  title: "Revenue report",
  description:
    "Get billing/revenue summary for a date range (YYYY-MM-DD). Returns totals for cash, transfer, machine revenue, food revenue, and per-day breakdown.",
  inputSchema: {
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date, YYYY-MM-DD"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("End date, YYYY-MM-DD (inclusive)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ start_date, end_date }) => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase
      .from("billing_logs")
      .select("*")
      .gte("checkout_date", start_date)
      .lte("checkout_date", end_date);
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    const rows = data ?? [];
    const totals = rows.reduce(
      (acc, r) => {
        acc.advance_cash += Number(r.advance_cash) || 0;
        acc.advance_transfer += Number(r.advance_transfer) || 0;
        acc.final_cash += Number(r.final_cash) || 0;
        acc.final_transfer += Number(r.final_transfer) || 0;
        acc.machine_price += Number(r.machine_price) || 0;
        acc.food_price += Number(r.food_price) || 0;
        return acc;
      },
      { advance_cash: 0, advance_transfer: 0, final_cash: 0, final_transfer: 0, machine_price: 0, food_price: 0 },
    );
    const total_cash = totals.advance_cash + totals.final_cash;
    const total_transfer = totals.advance_transfer + totals.final_transfer;
    const net_revenue = total_cash + total_transfer;

    const byDay = new Map<string, number>();
    for (const r of rows) {
      const day = r.checkout_date as string;
      const rev =
        (Number(r.advance_cash) || 0) +
        (Number(r.advance_transfer) || 0) +
        (Number(r.final_cash) || 0) +
        (Number(r.final_transfer) || 0);
      byDay.set(day, (byDay.get(day) ?? 0) + rev);
    }
    const daily = [...byDay.entries()]
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const summary = {
      range: { start_date, end_date },
      transactions: rows.length,
      total_cash,
      total_transfer,
      net_revenue,
      machine_revenue: totals.machine_price,
      food_revenue: totals.food_price,
      daily,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});
