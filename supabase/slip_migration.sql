-- ============================================================
-- ตรวจสลิปโอนเงิน (EasySlip)  — รันครั้งเดียวใน Supabase SQL Editor
-- ปลอดภัย: รันซ้ำได้ ไม่กระทบตารางเดิม
--
-- ตารางนี้เก็บ "ผลการตรวจ" ไม่ได้เก็บรูปสลิป
-- trans_ref = เลขอ้างอิงรายการโอนจากธนาคาร ตั้งเป็น unique เพื่อกัน
-- ลูกค้าเอาสลิปใบเดิมมาใช้ซ้ำกับอีกบิลหนึ่ง
-- ============================================================

create table if not exists public.slip_verifications (
  id uuid primary key default gen_random_uuid(),
  trans_ref text not null unique,
  status text not null default 'verified'
    check (status in ('verified','amount_mismatch','duplicate','failed')),
  amount numeric(10,2) not null default 0,          -- ยอดที่อยู่บนสลิป
  expected_amount numeric(10,2) not null default 0, -- ยอดที่ระบบเรียกเก็บ
  amount_matched boolean not null default false,

  slip_date timestamptz,
  sender_name text,
  sender_bank text,
  receiver_name text,
  receiver_bank text,

  reservation_id  uuid references public.reservations(id) on delete set null,
  pc_session_id   uuid references public.pc_sessions(id)  on delete set null,
  product_sale_id uuid references public.product_sales(id) on delete set null,
  note text,

  provider text not null default 'easyslip',
  raw jsonb,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists slip_verifications_created_idx on public.slip_verifications(created_at desc);
create index if not exists slip_verifications_res_idx on public.slip_verifications(reservation_id) where reservation_id is not null;
create index if not exists slip_verifications_pc_idx  on public.slip_verifications(pc_session_id)  where pc_session_id is not null;

-- ============================================================
-- GRANTS + RLS
-- ตารางนี้มีชื่อบัญชีธนาคารของลูกค้า จึงเปิดให้เฉพาะพนักงานที่ล็อกอินแล้ว
-- ไม่เปิดให้ anon เด็ดขาด
-- ============================================================
revoke all on public.slip_verifications from anon;
grant select, insert on public.slip_verifications to authenticated;
grant all on public.slip_verifications to service_role;

alter table public.slip_verifications enable row level security;

drop policy if exists "slip_staff_read" on public.slip_verifications;
create policy "slip_staff_read" on public.slip_verifications
  for select to authenticated using (true);

drop policy if exists "slip_staff_insert" on public.slip_verifications;
create policy "slip_staff_insert" on public.slip_verifications
  for insert to authenticated with check (true);

-- ============================================================
-- คิวสแกนสลิปด้วยกล้องหน้าร้าน
--
-- ลำดับงาน:
--   1. พนักงานกด "ให้ลูกค้าโชว์สลิปที่กล้อง" -> insert แถวนี้ status='waiting'
--      แล้วสั่งจอลูกค้าเปิดกล้อง
--   2. จอลูกค้า (ใช้ anon key ไม่ได้ล็อกอิน) อ่าน QR จากสลิปได้ ->
--      เรียก submit_slip_scan() ใส่ payload สถานะเป็น 'scanned'
--   3. หน้าแอดมิน (ล็อกอินแล้ว) เห็นผ่าน realtime -> ส่ง payload ไปตรวจกับ
--      EasySlip ผ่าน /api/verify-slip -> อัปเดตผลกลับมาที่แถวนี้
--
-- ทำแบบนี้เพราะจอลูกค้าไม่มีสิทธิ์เรียก API ที่ถือ key และไม่ควรอ่านตาราง
-- slip_verifications ที่มีชื่อบัญชีลูกค้าอยู่
-- ============================================================

create table if not exists public.slip_scan_requests (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'waiting'
    check (status in ('waiting','scanned','done','failed','cancelled')),
  expected_amount numeric(10,2) not null default 0,
  reservation_id uuid references public.reservations(id) on delete set null,
  pc_session_id  uuid references public.pc_sessions(id)  on delete set null,
  payload text,
  result_ok boolean,
  result_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists slip_scan_status_idx on public.slip_scan_requests(status, created_at desc);

revoke all on public.slip_scan_requests from anon;
grant select, insert, update on public.slip_scan_requests to authenticated;
grant all on public.slip_scan_requests to service_role;

alter table public.slip_scan_requests enable row level security;

drop policy if exists "slip_scan_staff_all" on public.slip_scan_requests;
create policy "slip_scan_staff_all" on public.slip_scan_requests
  for all to authenticated using (true) with check (true);

-- จอลูกค้าส่ง QR ที่อ่านได้กลับมา (เขียนได้อย่างเดียว อ่านตารางไม่ได้)
create or replace function public.submit_slip_scan(p_request_id uuid, p_payload text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_payload is null or btrim(p_payload) = '' then
    return false;
  end if;

  update public.slip_scan_requests
    set payload = left(btrim(p_payload), 2000),
        status = 'scanned',
        updated_at = now()
    where id = p_request_id
      and status = 'waiting'
      and created_at > now() - interval '10 minutes';

  return found;
end;
$$;

revoke all on function public.submit_slip_scan(uuid, text) from public;
grant execute on function public.submit_slip_scan(uuid, text) to anon, authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.slip_scan_requests; exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';
