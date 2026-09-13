-- ============================================================
-- ตรวจเงินเข้าอัตโนมัติ (PlernPay) — รันครั้งเดียวใน Supabase SQL Editor
-- ปลอดภัย: รันซ้ำได้ ไม่กระทบตารางเดิม
--
-- แนวคิด: แทนที่จะให้ลูกค้าโชว์สลิปแล้วพนักงานสแกน ระบบขอ QR ที่มี
-- "ยอดไม่ซ้ำใคร" (เติมเศษสตางค์) จากผู้ให้บริการ พอเงินเข้าบัญชีจริง
-- ผู้ให้บริการจะบอกกลับมาว่ายอดนี้เข้าแล้ว ระบบจึงจับคู่กับบิลได้แน่นอน
--
-- ref = เลขอ้างอิงของผู้ให้บริการ ตั้ง unique กันบันทึกซ้ำ
-- unique_amount = ยอดจริงที่ลูกค้าต้องโอน (เช่น 100.47) คือกุญแจจับคู่
-- ============================================================

create table if not exists public.payment_watches (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,

  amount        numeric(10,2) not null,  -- ยอดบิลจริง (100.00)
  unique_amount numeric(10,2) not null,  -- ยอดที่ให้ลูกค้าโอน (100.47)

  status text not null default 'pending'
    check (status in ('pending','confirmed','expired','cancelled')),

  memo text,
  bank text,                              -- ธนาคารต้นทาง (ได้ตอนเงินเข้า)

  zone text,
  machine_number int,
  reservation_id  uuid references public.reservations(id)  on delete set null,
  pc_session_id   uuid references public.pc_sessions(id)   on delete set null,
  product_sale_id uuid references public.product_sales(id) on delete set null,

  expires_at   timestamptz,
  confirmed_at timestamptz,
  -- ใช้แล้วกับบิลไหน — กันไม่ให้เงินก้อนเดียวถูกนับสองบิล
  consumed_at  timestamptz,

  created_by uuid references auth.users(id) on delete set null,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_watches_status_idx  on public.payment_watches(status, created_at desc);
create index if not exists payment_watches_created_idx on public.payment_watches(created_at desc);
create index if not exists payment_watches_res_idx     on public.payment_watches(reservation_id) where reservation_id is not null;

-- ============================================================
-- GRANTS + RLS
-- ตารางนี้เป็นรายการเงินเข้าของร้าน เปิดให้เฉพาะพนักงานที่ล็อกอินแล้ว
-- ไม่เปิดให้ anon เด็ดขาด (จอลูกค้าไม่ต้องอ่านตารางนี้ เพราะ QR
-- ถูกส่งไปทาง customer_display อยู่แล้ว)
-- ============================================================
revoke all on public.payment_watches from anon;
grant select, insert, update on public.payment_watches to authenticated;
grant all on public.payment_watches to service_role;

alter table public.payment_watches enable row level security;

drop policy if exists "paywatch_staff_read" on public.payment_watches;
create policy "paywatch_staff_read" on public.payment_watches
  for select to authenticated using (true);

drop policy if exists "paywatch_staff_insert" on public.payment_watches;
create policy "paywatch_staff_insert" on public.payment_watches
  for insert to authenticated with check (true);

drop policy if exists "paywatch_staff_update" on public.payment_watches;
create policy "paywatch_staff_update" on public.payment_watches
  for update to authenticated using (true) with check (true);

-- ============================================================
-- สวิตช์เปิด/ปิดระบบ เก็บใน store_settings ที่มีอยู่แล้ว
-- ปิดไว้ก่อนเป็นค่าเริ่มต้น จะได้ไม่กระทบร้านจนกว่าจะตั้งค่าคีย์เสร็จ
-- ============================================================
insert into public.store_settings(key, value)
values ('paywatch_enabled', 'false')
on conflict (key) do nothing;

-- ============================================================
-- ยอดเงินเข้าที่รอเกินเวลาแล้ว ให้ถือว่าหมดอายุ
-- เรียกจากฝั่งแอปเป็นครั้งคราว ไม่ต้องตั้ง cron
-- ============================================================
create or replace function public.paywatch_expire_stale()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  update public.payment_watches
     set status = 'expired', updated_at = now()
   where status = 'pending'
     and expires_at is not null
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.paywatch_expire_stale() from public, anon;
grant execute on function public.paywatch_expire_stale() to authenticated;
