-- ============================================================
-- ระบบสมาชิก + แต้มสะสม  (รันครั้งเดียวใน Supabase SQL Editor)
-- ปลอดภัย: รันซ้ำได้ ไม่กระทบตารางเดิม
--
-- กติกา (แก้ได้ที่ store_settings ไม่ต้องแก้โค้ด):
--   โซฟา / รถแข่ง : เล่น 1 ชม. = 1 แต้ม  (ปัดลง — 1.5 ชม. ได้ 1 แต้ม)
--   PC            : เล่น 2 ชม. = 1 แต้ม  (ปัดลง)
--   แลก 10 แต้ม   = เล่นฟรี 1 ชม. เฉพาะโซนโซฟาและรถแข่ง
-- ============================================================

-- ---------- members ----------
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,                    -- เก็บเฉพาะตัวเลข เช่น 0812345678
  name text not null,
  points int not null default 0 check (points >= 0),
  lifetime_points int not null default 0,        -- แต้มสะสมตลอดชีพ (ไม่ลดตอนแลก)
  visits int not null default 0,
  joined_at timestamptz not null default now(),
  last_visit_at timestamptz,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists members_phone_idx on public.members(phone);
create index if not exists members_name_idx on public.members(name);

-- ---------- point_transactions (ประวัติแต้มทุกรายการ) ----------
create table if not exists public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  delta int not null,                            -- + ได้แต้ม / - ใช้แต้ม
  balance_after int not null,
  reason text not null check (reason in ('earn_play','redeem_free_hour','manual_adjust')),
  zone text,
  hours numeric(6,1),
  minutes int,
  reservation_id uuid references public.reservations(id) on delete set null,
  pc_session_id uuid references public.pc_sessions(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists point_tx_member_idx on public.point_transactions(member_id, created_at desc);
create index if not exists point_tx_date_idx on public.point_transactions(created_at desc);

-- กันให้แต้มซ้ำจากบิลเดียวกัน (กดปิดบิลรัว ๆ / เน็ตกระตุกแล้วส่งซ้ำ)
create unique index if not exists point_tx_earn_res_uniq
  on public.point_transactions(reservation_id)
  where reason = 'earn_play' and reservation_id is not null;
create unique index if not exists point_tx_earn_pc_uniq
  on public.point_transactions(pc_session_id)
  where reason = 'earn_play' and pc_session_id is not null;
create unique index if not exists point_tx_redeem_res_uniq
  on public.point_transactions(reservation_id)
  where reason = 'redeem_free_hour' and reservation_id is not null;

-- ---------- ผูกสมาชิกเข้ากับบิล ----------
alter table public.reservations  add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.pc_sessions   add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.billing_logs  add column if not exists member_id uuid references public.members(id) on delete set null;

alter table public.billing_logs  add column if not exists points_earned int not null default 0;
alter table public.billing_logs  add column if not exists points_discount numeric(10,2) not null default 0;
alter table public.pc_sessions   add column if not exists points_earned int not null default 0;

create index if not exists reservations_member_idx on public.reservations(member_id) where member_id is not null;
create index if not exists pc_sessions_member_idx  on public.pc_sessions(member_id)  where member_id is not null;
create index if not exists billing_logs_member_idx on public.billing_logs(member_id) where member_id is not null;

-- ---------- ค่ากติกาแต้ม (แหล่งความจริงที่เดียว) ----------
insert into public.store_settings(key, value) values
  ('points_hours_per_point_ps5', '1'),   -- โซฟา/รถแข่ง: กี่ชั่วโมงต่อ 1 แต้ม
  ('points_hours_per_point_pc',  '2'),   -- PC: กี่ชั่วโมงต่อ 1 แต้ม
  ('points_redeem_cost',         '10'),  -- ใช้กี่แต้มแลกฟรี 1 ชม.
  ('points_redeem_zones',        'sofa,racing')
on conflict (key) do nothing;

-- ============================================================
-- GRANTS + RLS
-- ตั้งใจ "ไม่" เปิดให้ anon อ่านตาราง members โดยตรง เพราะหน้าสมัคร
-- /join เป็นหน้าสาธารณะที่ใช้ anon key — ถ้าเปิด select ให้ anon
-- ใครก็ดึงรายชื่อ+เบอร์ลูกค้าทั้งร้านออกไปได้
-- หน้าสมัครจึงเรียกได้เฉพาะฟังก์ชัน register_member() เท่านั้น
-- ============================================================
revoke all on public.members            from anon;
revoke all on public.point_transactions from anon;

grant select, insert, update on public.members            to authenticated;
grant select, insert, update on public.point_transactions to authenticated;
grant all on public.members            to service_role;
grant all on public.point_transactions to service_role;

alter table public.members            enable row level security;
alter table public.point_transactions enable row level security;

drop policy if exists "members_staff_all" on public.members;
create policy "members_staff_all" on public.members
  for all to authenticated using (true) with check (true);

drop policy if exists "point_tx_staff_all" on public.point_transactions;
create policy "point_tx_staff_all" on public.point_transactions
  for all to authenticated using (true) with check (true);

-- ============================================================
-- ฟังก์ชัน
-- ============================================================

-- ค่ากติกาแต้ม (ให้ทั้งหน้าแอดมินและหน้าสมัครอ่านได้ ไม่มีข้อมูลลูกค้า)
create or replace function public.points_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'hours_per_point_ps5', coalesce((select value from public.store_settings where key='points_hours_per_point_ps5'), '1')::numeric,
    'hours_per_point_pc',  coalesce((select value from public.store_settings where key='points_hours_per_point_pc'),  '2')::numeric,
    'redeem_cost',         coalesce((select value from public.store_settings where key='points_redeem_cost'),         '10')::int,
    'redeem_zones',        coalesce((select value from public.store_settings where key='points_redeem_zones'),        'sofa,racing'),
    'shop_name',           coalesce((select value from public.store_settings where key='shop_name'), 'YALA PLAYSTATION')
  )
$$;

-- ---------- ทำเบอร์ให้เป็นรูปแบบเดียวกัน ----------
create or replace function public.normalize_phone(p_phone text)
returns text
language plpgsql
immutable
as $$
declare d text;
begin
  d := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  -- 66812345678 -> 0812345678
  if length(d) = 11 and left(d, 2) = '66' then
    d := '0' || substr(d, 3);
  elsif length(d) = 12 and left(d, 3) = '660' then
    d := substr(d, 4);
  end if;
  return d;
end;
$$;

-- ---------- สมัครสมาชิกจากหน้าสาธารณะ /join ----------
-- SECURITY DEFINER: หน้าสมัครใช้ anon key ที่ไม่มีสิทธิ์แตะตาราง members ตรง ๆ
create or replace function public.register_member(p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_name  text;
  v_row   public.members;
begin
  v_phone := public.normalize_phone(p_phone);
  v_name  := btrim(coalesce(p_name, ''));

  if length(v_phone) < 9 or length(v_phone) > 10 then
    return jsonb_build_object('status', 'invalid_phone', 'message', 'เบอร์โทรไม่ถูกต้อง');
  end if;
  if length(v_name) < 2 then
    return jsonb_build_object('status', 'invalid_name', 'message', 'กรุณากรอกชื่อ');
  end if;
  v_name := left(v_name, 60);

  select * into v_row from public.members where phone = v_phone;
  if found then
    return jsonb_build_object(
      'status', 'exists',
      'name',   v_row.name,
      'phone',  v_row.phone,
      'points', v_row.points,
      'message', 'เบอร์นี้เป็นสมาชิกอยู่แล้ว'
    );
  end if;

  insert into public.members(phone, name)
  values (v_phone, v_name)
  returning * into v_row;

  return jsonb_build_object(
    'status', 'created',
    'name',   v_row.name,
    'phone',  v_row.phone,
    'points', v_row.points,
    'message', 'สมัครสมาชิกเรียบร้อย'
  );
exception
  when unique_violation then
    select * into v_row from public.members where phone = v_phone;
    return jsonb_build_object('status', 'exists', 'name', v_row.name,
      'phone', v_row.phone, 'points', v_row.points, 'message', 'เบอร์นี้เป็นสมาชิกอยู่แล้ว');
end;
$$;

-- ---------- ให้แต้มอัตโนมัติตอนปิดบิล ----------
-- คืนจำนวนแต้มที่ให้จริง (0 = ไม่ถึงเกณฑ์ หรือบิลนี้ให้แต้มไปแล้ว)
create or replace function public.member_award_points(
  p_member_id uuid,
  p_zone text,
  p_hours numeric default 0,
  p_minutes int default 0,
  p_reservation_id uuid default null,
  p_pc_session_id uuid default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_per_ps5 numeric;
  v_per_pc  numeric;
  v_hours   numeric;
  v_points  int;
  v_balance int;
begin
  if p_member_id is null then return 0; end if;

  -- บิลนี้ให้แต้มไปแล้วหรือยัง (กันกดซ้ำ)
  if p_reservation_id is not null and exists (
      select 1 from public.point_transactions
      where reason = 'earn_play' and reservation_id = p_reservation_id) then
    return 0;
  end if;
  if p_pc_session_id is not null and exists (
      select 1 from public.point_transactions
      where reason = 'earn_play' and pc_session_id = p_pc_session_id) then
    return 0;
  end if;

  select coalesce((select value from public.store_settings where key='points_hours_per_point_ps5'), '1')::numeric,
         coalesce((select value from public.store_settings where key='points_hours_per_point_pc'),  '2')::numeric
    into v_per_ps5, v_per_pc;

  -- ชั่วโมงที่ใช้คิด: PS5 ส่งมาเป็นชั่วโมง, PC ส่งมาเป็นนาที
  v_hours := case when p_zone = 'pc'
                  then coalesce(p_minutes, 0) / 60.0
                  else coalesce(p_hours, 0) end;

  v_points := floor(v_hours / greatest(case when p_zone = 'pc' then v_per_pc else v_per_ps5 end, 0.5))::int;

  -- ล็อกแถวสมาชิกก่อนอัปเดตยอด กันสองเครื่องปิดบิลพร้อมกัน
  perform 1 from public.members where id = p_member_id for update;

  update public.members
    set points          = points + greatest(v_points, 0),
        lifetime_points = lifetime_points + greatest(v_points, 0),
        visits          = visits + 1,
        last_visit_at   = now(),
        updated_at      = now()
    where id = p_member_id
    returning points into v_balance;

  if v_balance is null then return 0; end if;
  if v_points <= 0 then return 0; end if;

  insert into public.point_transactions(
    member_id, delta, balance_after, reason, zone, hours, minutes,
    reservation_id, pc_session_id)
  values (p_member_id, v_points, v_balance, 'earn_play', p_zone,
          round(v_hours, 1), p_minutes, p_reservation_id, p_pc_session_id)
  on conflict do nothing;

  return v_points;
end;
$$;

-- ---------- แลกแต้มเป็นเล่นฟรี 1 ชั่วโมง ----------
create or replace function public.member_redeem_free_hour(
  p_member_id uuid,
  p_zone text,
  p_reservation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost    int;
  v_zones   text;
  v_points  int;
begin
  select coalesce((select value from public.store_settings where key='points_redeem_cost'), '10')::int,
         coalesce((select value from public.store_settings where key='points_redeem_zones'), 'sofa,racing')
    into v_cost, v_zones;

  if p_zone is null or not (p_zone = any (string_to_array(v_zones, ','))) then
    return jsonb_build_object('ok', false, 'message', 'โซนนี้ยังแลกแต้มไม่ได้');
  end if;

  if p_reservation_id is not null and exists (
      select 1 from public.point_transactions
      where reason = 'redeem_free_hour' and reservation_id = p_reservation_id) then
    return jsonb_build_object('ok', false, 'message', 'บิลนี้ใช้แต้มไปแล้ว');
  end if;

  select points into v_points from public.members where id = p_member_id for update;
  if v_points is null then
    return jsonb_build_object('ok', false, 'message', 'ไม่พบสมาชิก');
  end if;
  if v_points < v_cost then
    return jsonb_build_object('ok', false, 'message',
      format('แต้มไม่พอ (มี %s ต้องใช้ %s)', v_points, v_cost));
  end if;

  update public.members
    set points = points - v_cost, updated_at = now()
    where id = p_member_id
    returning points into v_points;

  insert into public.point_transactions(
    member_id, delta, balance_after, reason, zone, reservation_id, note)
  values (p_member_id, -v_cost, v_points, 'redeem_free_hour', p_zone, p_reservation_id,
          'แลกเล่นฟรี 1 ชั่วโมง');

  return jsonb_build_object('ok', true, 'cost', v_cost, 'points_left', v_points);
end;
$$;

-- ---------- ปรับแต้มด้วยมือ (แอดมิน) ----------
create or replace function public.member_adjust_points(
  p_member_id uuid,
  p_delta int,
  p_note text default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_points int;
begin
  select points into v_points from public.members where id = p_member_id for update;
  if v_points is null then raise exception 'ไม่พบสมาชิก'; end if;
  if v_points + p_delta < 0 then raise exception 'แต้มคงเหลือติดลบไม่ได้'; end if;

  update public.members
    set points = points + p_delta, updated_at = now(),
        lifetime_points = lifetime_points + greatest(p_delta, 0)
    where id = p_member_id
    returning points into v_points;

  insert into public.point_transactions(member_id, delta, balance_after, reason, note)
  values (p_member_id, p_delta, v_points, 'manual_adjust', p_note);

  return v_points;
end;
$$;

-- ============================================================
-- สิทธิ์เรียกฟังก์ชัน
--   anon เรียกได้แค่ 2 ตัวที่หน้าสมัครสาธารณะต้องใช้
-- ============================================================
revoke all on function public.member_award_points(uuid, text, numeric, int, uuid, uuid) from public, anon;
revoke all on function public.member_redeem_free_hour(uuid, text, uuid)                 from public, anon;
revoke all on function public.member_adjust_points(uuid, int, text)                     from public, anon;

grant execute on function public.register_member(text, text)   to anon, authenticated;
grant execute on function public.points_config()               to anon, authenticated;
grant execute on function public.normalize_phone(text)         to anon, authenticated;

grant execute on function public.member_award_points(uuid, text, numeric, int, uuid, uuid) to authenticated;
grant execute on function public.member_redeem_free_hour(uuid, text, uuid)                 to authenticated;
grant execute on function public.member_adjust_points(uuid, int, text)                     to authenticated;

-- ---------- ปิดหน้า QR สมัครสมาชิกบนจอลูกค้า ----------
-- ลูกค้ากดสมัครเสร็จจากมือถือ -> จอลูกค้าเปลี่ยนเป็นหน้า "ยินดีต้อนรับ"
-- แล้วหน้าจอจะกลับสู่โหมดปกติเองใน 5 วินาที
-- เช็คสถานะก่อนเสมอ: ถ้าจอกำลังโชว์ยอดชำระของลูกค้าอีกคนอยู่ จะไม่ไปทับ
create or replace function public.close_join_screen(p_name text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_kind text;
begin
  select payload->>'kind' into v_kind from public.customer_display where id = 1;
  if v_kind is distinct from 'join' then
    return false;
  end if;

  update public.customer_display
    set payload = jsonb_build_object(
          'kind', 'join_done',
          'customer_name', left(btrim(coalesce(p_name, '')), 40)
        ),
        updated_at = now()
    where id = 1;

  return true;
end;
$$;

grant execute on function public.close_join_screen(text) to anon, authenticated;

-- Realtime (ให้หน้าแอดมินเห็นแต้มอัปเดตทันที)
do $$
begin
  begin alter publication supabase_realtime add table public.members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.point_transactions; exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';
