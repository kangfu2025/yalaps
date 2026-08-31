import { supabase, type Machine, type Zone } from "./supabase";

const EXPECTED: Array<{ zone: Zone; machine_number: number }> = [
  { zone: "sofa", machine_number: 1 },
  { zone: "sofa", machine_number: 2 },
  { zone: "sofa", machine_number: 3 },
  { zone: "sofa", machine_number: 4 },
  { zone: "sofa", machine_number: 5 },
  { zone: "racing", machine_number: 1 },
  { zone: "racing", machine_number: 2 },
  { zone: "racing", machine_number: 3 },
  { zone: "pc", machine_number: 1 },
  { zone: "pc", machine_number: 2 },
];

/** auto-heal: ถ้าเครื่องไม่ครบ → upsert ที่หาย (ห้าม DELETE) */
export async function ensureAllMachines(): Promise<Machine[]> {
  const { data, error } = await supabase.from("machines").select("*");
  if (error) throw error;
  const existing = new Set((data ?? []).map((m) => `${m.zone}-${m.machine_number}`));
  const missing = EXPECTED.filter((e) => !existing.has(`${e.zone}-${e.machine_number}`));
  if (missing.length) {
    const { error: insErr } = await supabase.from("machines").insert(missing);
    if (insErr) throw insErr;
  }
  return await fetchAllMachines();
}

export async function fetchAllMachines(): Promise<Machine[]> {
  const { data, error } = await supabase
    .from("machines")
    .select("*")
    .order("zone")
    .order("machine_number");
  if (error) throw error;
  return data ?? [];
}

export async function markMachinePlaying(machineId: string, reservationId: string) {
  const { error } = await supabase
    .from("machines")
    .update({
      status: "playing",
      current_reservation_id: reservationId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", machineId);
  if (error) throw error;
}

/** Reset เครื่องกลับเป็น "ว่างพร้อมใช้" — ใช้ทั้งกรณีปิดบิลและยกเลิกบิล */
export async function resetMachineToIdle(machineId: string) {
  const { error } = await supabase
    .from("machines")
    .update({
      status: "idle",
      current_reservation_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", machineId);
  if (error) throw error;
}
