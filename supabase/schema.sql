-- ============================================================
-- YALA PLAYSTATION - Schema (รัน 1 ครั้งใน Supabase SQL Editor)
-- ============================================================

-- Clean previous (ถ้ามี) - ปลอดภัยเฉพาะตอนติดตั้งครั้งแรก
drop table if exists public.billing_logs cascade;
drop table if exists public.reservations cascade;
drop table if exists public.customer_display cascade;
drop table if exists public.store_settings cascade;
drop table if exists public.machines cascade;
drop type if exists public.machine_zone;
drop type if exists public.machine_status;
drop type if exists public.reservation_status;

create type public.machine_zone as enum ('sofa', 'racing');
create type public.machine_status as enum ('idle', 'playing');
create type public.reservation_status as enum ('scheduled', 'playing', 'completed', 'cancelled');

-- ============================================================
-- MACHINES (ห้ามลบ! ใช้ UPDATE เท่านั้น)
-- ============================================================
create table public.machines (
  id uuid primary key default gen_random_uuid(),
  zone public.machine_zone not null,
  machine_number int not null check (machine_number > 0),
  status public.machine_status not null default 'idle',
  current_reservation_id uuid,
  updated_at timestamptz not null default now(),
  unique (zone, machine_number)
);

-- ============================================================
-- RESERVATIONS (เซสชันการเล่น + การจองล่วงหน้า)
-- ============================================================
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  zone public.machine_zone not null,
  machine_number int not null,
  customer_name text not null,
  customer_phone text,
  status public.reservation_status not null default 'scheduled',

  -- สำหรับ scheduled
  scheduled_at timestamptz,

  -- สำหรับเซสชันเล่นจริง
  base_hours numeric(4,1) not null default 0,
  extended_hours numeric(4,1) not null default 0,
  total_hours numeric(4,1) generated always as (base_hours + extended_hours) stored,

  advance_cash numeric(10,2) not null default 0,
  advance_transfer numeric(10,2) not null default 0,
  food_revenue numeric(10,2) not null default 0,

  start_time timestamptz,
  end_time_ms bigint,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reservations_status_idx on public.reservations(status);
create index reservations_machine_idx on public.reservations(zone, machine_number);

alter table public.machines
  add constraint machines_current_res_fk
  foreign key (current_reservation_id) references public.reservations(id) on delete set null;

-- ============================================================
-- BILLING LOGS (ปิดบิลแล้วจะมี record ที่นี่ทุกครั้ง)
-- ============================================================
create table public.billing_logs (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations(id) on delete set null,
  checkout_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  checkout_time time not null default (now() at time zone 'Asia/Bangkok')::time,
  zone public.machine_zone not null,
  machine_number int not null,
  customer_name text not null,
  duration_hours numeric(4,1) not null,
  machine_price numeric(10,2) not null,
  food_price numeric(10,2) not null default 0,
  advance_cash numeric(10,2) not null default 0,
  advance_transfer numeric(10,2) not null default 0,
  final_cash numeric(10,2) not null default 0,
  final_transfer numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create index billing_logs_date_idx on public.billing_logs(checkout_date);

-- ============================================================
-- CUSTOMER DISPLAY (1 row อัปเดต realtime ให้หน้า /display)
-- ============================================================
create table public.customer_display (
  id int primary key default 1,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint customer_display_single check (id = 1)
);

insert into public.customer_display(id, payload) values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- ============================================================
-- STORE SETTINGS (PromptPay ID ฯลฯ)
-- ============================================================
create table public.store_settings (
  key text primary key,
  value text not null
);

insert into public.store_settings(key, value) values
  ('promptpay_id', '0819698842'),
  ('shop_name', 'YALA PLAYSTATION')
on conflict (key) do update set value = excluded.value;

-- ============================================================
-- GRANTS  (Data API access — anon-only, ไม่มี auth)
-- ============================================================
grant select, insert, update on public.machines        to anon, authenticated;
grant select, insert, update, delete on public.reservations    to anon, authenticated;
grant select, insert, update, delete on public.billing_logs    to anon, authenticated;
grant select, insert, update on public.customer_display to anon, authenticated;
grant select, insert, update on public.store_settings  to anon, authenticated;
grant all on all tables in schema public to service_role;

-- RLS: เปิด แต่อนุญาตเต็มสำหรับ anon (ระบบ in-shop ไม่มี login)
alter table public.machines enable row level security;
alter table public.reservations enable row level security;
alter table public.billing_logs enable row level security;
alter table public.customer_display enable row level security;
alter table public.store_settings enable row level security;

create policy "open_all_machines"        on public.machines        for all to anon, authenticated using (true) with check (true);
-- ห้าม DELETE บน machines (revoke ระดับ table แล้วด้านบน ไม่มี grant delete)
create policy "open_all_reservations"    on public.reservations    for all to anon, authenticated using (true) with check (true);
create policy "open_all_billing"         on public.billing_logs    for all to anon, authenticated using (true) with check (true);
create policy "open_all_display"         on public.customer_display for all to anon, authenticated using (true) with check (true);
create policy "open_all_settings"        on public.store_settings  for all to anon, authenticated using (true) with check (true);

-- ============================================================
-- SEED MACHINES (8 เครื่อง)
-- ============================================================
insert into public.machines(zone, machine_number) values
  ('sofa', 1), ('sofa', 2), ('sofa', 3), ('sofa', 4), ('sofa', 5),
  ('racing', 1), ('racing', 2), ('racing', 3)
on conflict (zone, machine_number) do nothing;

-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table public.machines;
alter publication supabase_realtime add table public.reservations;
alter publication supabase_realtime add table public.customer_display;

-- ============================================================
-- PROMOTIONS (กำหนดราคาเครื่องช่วงโปรโมชั่น)
-- รัน block นี้แยกได้ ไม่กระทบของเดิม
-- ============================================================
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sofa_half numeric(10,2) not null default 0,
  sofa_hour numeric(10,2) not null default 0,
  racing_half numeric(10,2) not null default 0,
  racing_hour numeric(10,2) not null default 0,
  start_date date not null,
  end_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists promotions_date_idx on public.promotions(start_date, end_date);
create index if not exists promotions_active_idx on public.promotions(active);

grant select, insert, update, delete on public.promotions to anon, authenticated;

alter table public.promotions enable row level security;

drop policy if exists "open_all_promotions" on public.promotions;
create policy "open_all_promotions" on public.promotions
  for all to anon, authenticated using (true) with check (true);

alter publication supabase_realtime add table public.promotions;

-- ============================================================
-- PC ZONE + COUPONS  (Phase 1 — รันแยกได้ ไม่กระทบของเดิม)
-- ============================================================

-- เพิ่มค่า 'pc' ให้ machine_zone แบบปลอดภัยใน transaction เดียว
-- หลีกเลี่ยง error: unsafe use of new value "pc" of enum type machine_zone
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'machine_zone'
      and e.enumlabel = 'pc'
  ) then
    create type public.machine_zone_new as enum ('sofa', 'racing', 'pc');

    alter table public.machines
      alter column zone type public.machine_zone_new
      using zone::text::public.machine_zone_new;

    alter table public.reservations
      alter column zone type public.machine_zone_new
      using zone::text::public.machine_zone_new;

    alter table public.billing_logs
      alter column zone type public.machine_zone_new
      using zone::text::public.machine_zone_new;

    drop type public.machine_zone;
    alter type public.machine_zone_new rename to machine_zone;
  end if;
end $$;

-- เพิ่ม 2 เครื่อง PC (ถ้ายังไม่มี)
insert into public.machines(zone, machine_number) values
  ('pc', 1), ('pc', 2)
on conflict (zone, machine_number) do nothing;

-- ---------- coupons ----------
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_name text,
  customer_phone text,
  total_minutes int not null check (total_minutes > 0),
  remaining_minutes int not null,
  price_paid numeric(10,2) not null default 0,
  paid_cash numeric(10,2) not null default 0,
  paid_transfer numeric(10,2) not null default 0,
  paid_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','in_use','expired','depleted','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists coupons_code_idx on public.coupons(code);
create index if not exists coupons_status_idx on public.coupons(status);

-- ---------- pc_sessions ----------
create table if not exists public.pc_sessions (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id),
  coupon_id uuid references public.coupons(id),        -- optional (legacy); Phase 2.5+ ไม่ใช้แล้ว
  customer_name text,
  minutes_purchased int not null default 0,
  price numeric(10,2) not null default 0,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz,
  minutes_used int not null default 0,
  status text not null default 'playing' check (status in ('playing','ended','force_ended','cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists pc_sessions_machine_idx on public.pc_sessions(machine_id, status);

-- Migration for existing installs (safe to re-run)
alter table public.pc_sessions alter column coupon_id drop not null;
alter table public.pc_sessions add column if not exists customer_name text;
alter table public.pc_sessions add column if not exists minutes_purchased int not null default 0;
alter table public.pc_sessions add column if not exists price numeric(10,2) not null default 0;

-- ---------- pc_commands ----------
create table if not exists public.pc_commands (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id),
  type text not null check (type in ('lock','unlock','warn','shutdown','show_countdown','end_session')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  ack_at timestamptz
);
create index if not exists pc_commands_pending_idx on public.pc_commands(machine_id, ack_at) where ack_at is null;

-- ---------- pc_agents ----------
create table if not exists public.pc_agents (
  machine_id uuid primary key references public.machines(id),
  agent_version text,
  last_heartbeat timestamptz not null default now(),
  is_locked boolean not null default true,
  current_session_id uuid references public.pc_sessions(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- GRANTS
grant select, insert, update, delete on public.coupons      to anon, authenticated;
grant select, insert, update, delete on public.pc_sessions  to anon, authenticated;
grant select, insert, update, delete on public.pc_commands  to anon, authenticated;
grant select, insert, update, delete on public.pc_agents    to anon, authenticated;

-- RLS: เปิดเหมือนตารางอื่น
alter table public.coupons     enable row level security;
alter table public.pc_sessions enable row level security;
alter table public.pc_commands enable row level security;
alter table public.pc_agents   enable row level security;

drop policy if exists "open_all_coupons"     on public.coupons;
drop policy if exists "open_all_pc_sessions" on public.pc_sessions;
drop policy if exists "open_all_pc_commands" on public.pc_commands;
drop policy if exists "open_all_pc_agents"   on public.pc_agents;

create policy "open_all_coupons"     on public.coupons     for all to anon, authenticated using (true) with check (true);
create policy "open_all_pc_sessions" on public.pc_sessions for all to anon, authenticated using (true) with check (true);
create policy "open_all_pc_commands" on public.pc_commands for all to anon, authenticated using (true) with check (true);
create policy "open_all_pc_agents"   on public.pc_agents   for all to anon, authenticated using (true) with check (true);

-- Realtime
alter publication supabase_realtime add table public.coupons;
alter publication supabase_realtime add table public.pc_sessions;
alter publication supabase_realtime add table public.pc_commands;
alter publication supabase_realtime add table public.pc_agents;

-- ราคา PC เริ่มต้น (บาท/ชม.) — แก้ได้ผ่าน store_settings
insert into public.store_settings(key, value) values
  ('pc_hour_price', '40'),
  ('coupon_expire_days', '30')
on conflict (key) do nothing;

-- ---------- ตัวเลือกการชำระ "แลกแต้ม" ----------
alter table public.billing_logs
  add column if not exists redeemed_points boolean not null default false;

-- ---------- ช่องทางชำระเงินสำหรับ pc_sessions (เหมือนโซน PS5) ----------
alter table public.pc_sessions
  add column if not exists paid_cash numeric(10,2) not null default 0,
  add column if not exists paid_transfer numeric(10,2) not null default 0,
  add column if not exists redeemed_points boolean not null default false;

-- ---------- ค่าอาหาร/เครื่องดื่ม สำหรับ pc_sessions (เช็คบิลปิดเครื่อง) ----------
alter table public.pc_sessions
  add column if not exists food_amount numeric(10,2) not null default 0;
notify pgrst, 'reload schema';
