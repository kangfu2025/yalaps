-- ============================================================
-- แพ็กเกจราคา + เก็บชั่วโมงในบัญชีสมาชิก (Hour Bank)
-- รันใน Supabase SQL Editor หลัง members_migration.sql · รันซ้ำได้ ไม่พัง
--
-- กติกาที่ผู้ใช้เลือก (พ.ย. 2569):
--   - ใช้เฉพาะโซนโซฟา
--   - เก็บชั่วโมงที่เหลือได้เฉพาะบิลแพ็กเกจ (และบิลที่เปิดด้วยชั่วโมงสะสม)
--   - เก็บตามนาทีจริง ไม่ปัด
--   - ชั่วโมงที่เก็บหมดอายุ 30 วันนับจากวันที่เก็บ ใช้ก้อนที่ใกล้หมดก่อน
-- อัปเดต 18 พ.ย. 2569 (รันไฟล์นี้ซ้ำได้เลย):
--   - แต่ละโปรเลือกได้ว่าใช้กับเครื่องโซฟาเครื่องไหน (เช่น เฉพาะเครื่องที่มีเกม GTA)
--     โปรที่ยังไม่ได้เลือกเครื่อง = ยังไม่ขึ้นให้เลือกที่เครื่องไหน
--   - ราคารายชั่วโมงปกติ/โปรรายชั่วโมง (เช่น โปร 89) ใช้ได้ทุกเครื่องเหมือนเดิม
--   - ต่อเวลาบิลแพ็กเกจ: พนักงานกรอกราคาเอง (package_extra_price)
--   - ชั่วโมงสะสมจำว่าใช้ได้ที่เครื่องไหน (ตามโปรที่ซื้อ)
--
-- ไฟล์นี้ "เพิ่ม" อย่างเดียว ไม่แก้ตารางหรือฟังก์ชันเดิม
-- เงินค่าแพ็กเกจยังเข้า reservations.advance_cash/transfer เหมือนเดิม
-- ลิ้นชัก บัญชีรายเดือน และรายงานจึงนับเงินได้ถูกโดยไม่ต้องแก้
-- ============================================================

-- ---------- 1) แพ็กเกจราคา ----------
create table if not exists public.price_packages (
  id          uuid primary key default gen_random_uuid(),
  group_name  text not null check (char_length(btrim(group_name)) between 1 and 60),
  label       text not null check (char_length(btrim(label)) between 1 and 60),
  zone        text not null default 'sofa' check (zone in ('sofa')),
  minutes     int  not null check (minutes between 30 and 1440),
  price       numeric(10,2) not null check (price >= 0),
  start_date  date not null,
  end_date    date,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists price_packages_zone_idx on public.price_packages(zone, active, start_date);
-- เลขเครื่องโซฟาที่โปรนี้ใช้ได้ (ว่าง = ยังไม่ได้เลือกเครื่อง → ยังเปิดแพ็กเกจนี้ไม่ได้)
alter table public.price_packages add column if not exists machine_numbers int[] not null default '{}';

-- ราคาที่ตกลงตอนเปิดเครื่อง เก็บติดบิลไว้ (ปิดบิลไม่คำนวณใหม่)
alter table public.reservations add column if not exists package_id uuid references public.price_packages(id) on delete set null;
alter table public.reservations add column if not exists package_name text;
alter table public.reservations add column if not exists package_price numeric(10,2);
alter table public.reservations add column if not exists package_minutes int;
-- เปิดเครื่องด้วยชั่วโมงสะสม: ใช้ไปกี่นาที และก้อนที่ใช้หมดอายุเมื่อไหร่
alter table public.reservations add column if not exists hour_bank_used_min int not null default 0;
alter table public.reservations add column if not exists hour_bank_expires_at timestamptz;
-- เครื่องที่ชั่วโมงของบิลนี้ใช้ได้ (คัดลอกจากโปรตอนเปิดบิล — ใช้ตอนเก็บชั่วโมงที่เหลือ)
alter table public.reservations add column if not exists package_machines int[];
-- ค่าต่อเวลาของบิลแพ็กเกจที่พนักงานกรอกเอง (รวมทุกครั้งที่ต่อ)
-- null = บิลที่เปิดก่อนอัปเดตนี้ → ระบบคิดต่อเวลาแบบรายชั่วโมงเหมือนเดิม
alter table public.reservations add column if not exists package_extra_price numeric(10,2);

alter table public.billing_logs add column if not exists package_name text;
alter table public.billing_logs add column if not exists hour_bank_used_min int not null default 0;

-- ---------- สิทธิ์ ----------
create or replace function public.pkg_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text;
begin
  if auth.uid() is null then
    return null;
  end if;
  if to_regclass('public.user_roles') is null then
    return 'admin';
  end if;
  execute 'select role::text from public.user_roles where user_id = $1
           order by case role::text when ''admin'' then 0 else 1 end limit 1'
    into v using auth.uid();
  return v;  -- 'admin' | 'staff' | null (ยังไม่กำหนดสิทธิ์)
end;
$$;
revoke all on function public.pkg_role() from public, anon;
grant execute on function public.pkg_role() to authenticated;

create or replace function public.pkg_actor_name()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text;
begin
  if auth.uid() is null then return null; end if;
  if to_regclass('public.profiles') is not null then
    execute 'select username from public.profiles where id = $1' into v using auth.uid();
  end if;
  return coalesce(nullif(btrim(coalesce(v, '')), ''), 'ไม่ทราบชื่อ');
end;
$$;
revoke all on function public.pkg_actor_name() from public, anon;

grant select on public.price_packages to authenticated;
grant insert, update, delete on public.price_packages to authenticated;
grant all on public.price_packages to service_role;
revoke all on public.price_packages from anon;
alter table public.price_packages enable row level security;

drop policy if exists "pkg_read" on public.price_packages;
create policy "pkg_read" on public.price_packages
  for select to authenticated using (true);
-- ตั้ง/แก้/ลบแพ็กเกจ: แอดมินเท่านั้น (ตรงกับเมนูโปรโมชั่นที่เห็นเฉพาะแอดมิน)
drop policy if exists "pkg_admin_write" on public.price_packages;
create policy "pkg_admin_write" on public.price_packages
  for all to authenticated
  using (public.pkg_role() = 'admin')
  with check (public.pkg_role() = 'admin');

-- ---------- ราคาแพ็กเกจในบิลมาจากฐานข้อมูลเสมอ ----------
-- หน้าเว็บส่งแค่ package_id มา ราคา/นาที/ชื่อ อ่านจากตารางแพ็กเกจ
-- กันการแก้ราคาจากฝั่งเบราว์เซอร์ และกันใช้แพ็กเกจที่ปิดหรือหมดช่วงแล้ว
create or replace function public.reservations_package_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.price_packages;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if new.package_id is not null then
    select * into p from public.price_packages where id = new.package_id;
    if not found then
      raise exception 'ไม่พบแพ็กเกจนี้';
    end if;
    if not p.active or v_today < p.start_date or (p.end_date is not null and v_today > p.end_date) then
      raise exception 'แพ็กเกจ "% · %" ยังไม่เปิดหรือหมดช่วงโปรแล้ว', p.group_name, p.label;
    end if;
    if new.zone::text <> p.zone then
      raise exception 'แพ็กเกจนี้ใช้ได้เฉพาะโซนโซฟา';
    end if;
    if not (new.machine_number = any(p.machine_numbers)) then
      raise exception 'แพ็กเกจ "%" ใช้ได้เฉพาะเครื่อง % — เครื่อง % ไม่ได้อยู่ในโปรนี้',
        p.group_name,
        coalesce(nullif(array_to_string(p.machine_numbers, ', '), ''), '(ยังไม่ได้เลือกเครื่อง)'),
        new.machine_number;
    end if;
    new.package_name    := p.group_name || ' · ' || p.label;
    new.package_price   := p.price;
    new.package_minutes := p.minutes;
    new.package_machines := p.machine_numbers;
    new.package_extra_price := 0;
    new.hour_bank_used_min := 0;
    new.hour_bank_expires_at := null;
  elsif coalesce(new.hour_bank_used_min, 0) > 0 then
    -- เปิดด้วยชั่วโมงสะสม = ค่าเครื่องส่วนนี้ 0 บาท (จ่ายไปแล้วตอนซื้อแพ็กเกจ)
    if new.zone::text <> 'sofa' then
      raise exception 'ชั่วโมงสะสมใช้ได้เฉพาะโซนโซฟา';
    end if;
    -- package_machines มาจาก hour_bank_redeem (ก้อนที่หักใช้ได้ที่เครื่องไหน) · ว่าง = ทุกเครื่อง
    if cardinality(coalesce(new.package_machines, '{}')) > 0
       and not (new.machine_number = any(new.package_machines)) then
      raise exception 'ชั่วโมงสะสมนี้ใช้ได้เฉพาะเครื่อง %', array_to_string(new.package_machines, ', ');
    end if;
    new.package_name    := 'ใช้ชั่วโมงสะสม';
    new.package_price   := 0;
    new.package_minutes := new.hour_bank_used_min;
    new.package_machines := coalesce(new.package_machines, '{}');
    new.package_extra_price := 0;
  else
    new.package_name := null;
    new.package_price := null;
    new.package_minutes := null;
    new.package_machines := null;
    new.package_extra_price := null;
    new.hour_bank_used_min := 0;
    new.hour_bank_expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reservations_package_guard on public.reservations;
create trigger reservations_package_guard
  before insert on public.reservations
  for each row execute function public.reservations_package_guard();

-- ห้ามเปลี่ยนแพ็กเกจ/ชั่วโมงสะสมของบิลหลังเปิดแล้ว
create or replace function public.reservations_package_lock()
returns trigger
language plpgsql
as $$
begin
  -- package_id เปลี่ยนเป็น null ได้ (ลบแพ็กเกจแล้วบิลเก่ายังเก็บราคาเดิมไว้)
  if (new.package_id is distinct from old.package_id and new.package_id is not null)
     or new.package_price is distinct from old.package_price
     or new.package_minutes is distinct from old.package_minutes
     or new.hour_bank_used_min is distinct from old.hour_bank_used_min
     or new.package_machines is distinct from old.package_machines then
    raise exception 'แก้แพ็กเกจของบิลที่เปิดแล้วไม่ได้';
  end if;
  -- ค่าต่อเวลาที่พนักงานกรอก: มีได้เฉพาะบิลแพ็กเกจที่เปิดหลังอัปเดตนี้ และห้ามติดลบ
  if new.package_extra_price is distinct from old.package_extra_price then
    if old.package_extra_price is null or new.package_extra_price is null then
      raise exception 'บิลนี้ไม่ได้ใช้ค่าต่อเวลาแบบกรอกเอง';
    end if;
    if new.package_extra_price < 0 then
      raise exception 'ค่าต่อเวลาติดลบไม่ได้';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reservations_package_lock on public.reservations;
create trigger reservations_package_lock
  before update on public.reservations
  for each row execute function public.reservations_package_lock();

-- ============================================================
-- 2) ชั่วโมงสะสม (Hour Bank)
-- เก็บเป็น "ก้อน" ตามบิลที่เก็บ แต่ละก้อนมีวันหมดอายุของตัวเอง
-- ยอดคงเหลือคิดสดจากก้อนที่ยังไม่หมดอายุ (ไม่ต้องมีงานตั้งเวลามาลบ)
-- ============================================================
create table if not exists public.hour_bank_lots (
  id                    uuid primary key default gen_random_uuid(),
  member_id             uuid not null references public.members(id) on delete cascade,
  zone                  text not null default 'sofa' check (zone in ('sofa')),
  minutes_total         int not null check (minutes_total > 0),
  minutes_left          int not null check (minutes_left >= 0),
  expires_at            timestamptz not null,
  source_reservation_id uuid unique references public.reservations(id) on delete set null,
  created_by            uuid,
  created_by_name       text,
  created_at            timestamptz not null default now(),
  check (minutes_left <= minutes_total)
);
create index if not exists hour_bank_lots_member_idx on public.hour_bank_lots(member_id, expires_at);
-- เครื่องโซฟาที่ใช้ก้อนนี้ได้ (ว่าง = ทุกเครื่อง — ก้อนที่เก็บก่อนอัปเดตนี้)
alter table public.hour_bank_lots add column if not exists machine_numbers int[] not null default '{}';

create table if not exists public.hour_bank_tx (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members(id) on delete cascade,
  delta_min       int not null,
  balance_after   int not null,
  reason          text not null check (reason in ('save', 'redeem', 'refund')),
  reservation_id  uuid references public.reservations(id) on delete set null,
  allocations     jsonb,           -- redeem: [{lot, min}] ก้อนที่ถูกหัก (ใช้ตอนคืน)
  refunded        boolean not null default false,
  note            text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists hour_bank_tx_member_idx on public.hour_bank_tx(member_id, created_at desc);

revoke all on public.hour_bank_lots from anon;
revoke all on public.hour_bank_tx from anon;
grant select on public.hour_bank_lots to authenticated;
grant select on public.hour_bank_tx to authenticated;
grant all on public.hour_bank_lots to service_role;
grant all on public.hour_bank_tx to service_role;
alter table public.hour_bank_lots enable row level security;
alter table public.hour_bank_tx enable row level security;
drop policy if exists "hb_lots_read" on public.hour_bank_lots;
create policy "hb_lots_read" on public.hour_bank_lots for select to authenticated using (true);
drop policy if exists "hb_tx_read" on public.hour_bank_tx;
create policy "hb_tx_read" on public.hour_bank_tx for select to authenticated using (true);
-- ไม่มี policy insert/update/delete: เขียนได้ผ่านฟังก์ชันด้านล่างเท่านั้น

-- ยอดที่ใช้ได้ตอนนี้ (นาที)
create or replace function public.hour_bank_available(p_member_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(minutes_left), 0)::int
  from public.hour_bank_lots
  where member_id = p_member_id and minutes_left > 0 and expires_at > now()
$$;
revoke all on function public.hour_bank_available(uuid) from public, anon;

-- ยอดคงเหลือ + ก้อนที่ยังใช้ได้ (หน้าเว็บใช้แสดงผล)
create or replace function public.hour_bank_balance(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.pkg_role() is null then
    raise exception 'ไม่มีสิทธิ์ใช้งาน' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'minutes', public.hour_bank_available(p_member_id),
    'next_expiry', (select min(expires_at) from public.hour_bank_lots
                    where member_id = p_member_id and minutes_left > 0 and expires_at > now()),
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', id, 'minutes_left', minutes_left, 'minutes_total', minutes_total,
               'expires_at', expires_at, 'created_at', created_at,
               'machine_numbers', machine_numbers) order by expires_at)
      from public.hour_bank_lots
      where member_id = p_member_id and minutes_left > 0 and expires_at > now()), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.hour_bank_balance(uuid) from public, anon;
grant execute on function public.hour_bank_balance(uuid) to authenticated;

-- ยอดที่ใช้ได้ที่เครื่องโซฟาเครื่องนี้ (นาที)
create or replace function public.hour_bank_available_at(p_member_id uuid, p_machine_number int)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(minutes_left), 0)::int
  from public.hour_bank_lots
  where member_id = p_member_id and minutes_left > 0 and expires_at > now()
    and (cardinality(machine_numbers) = 0 or p_machine_number = any(machine_numbers))
$$;
revoke all on function public.hour_bank_available_at(uuid, int) from public, anon;

-- ยอดที่ใช้ได้ที่เครื่องนี้ + ก้อนที่ใช้ได้ (หน้าต่างเปิดเครื่องใช้)
create or replace function public.hour_bank_balance(p_member_id uuid, p_machine_number int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.pkg_role() is null then
    raise exception 'ไม่มีสิทธิ์ใช้งาน' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'minutes', public.hour_bank_available_at(p_member_id, p_machine_number),
    'total', public.hour_bank_available(p_member_id),
    'next_expiry', (select min(expires_at) from public.hour_bank_lots
                    where member_id = p_member_id and minutes_left > 0 and expires_at > now()
                      and (cardinality(machine_numbers) = 0 or p_machine_number = any(machine_numbers))),
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', id, 'minutes_left', minutes_left, 'minutes_total', minutes_total,
               'expires_at', expires_at, 'created_at', created_at,
               'machine_numbers', machine_numbers) order by expires_at)
      from public.hour_bank_lots
      where member_id = p_member_id and minutes_left > 0 and expires_at > now()
        and (cardinality(machine_numbers) = 0 or p_machine_number = any(machine_numbers))), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.hour_bank_balance(uuid, int) from public, anon;
grant execute on function public.hour_bank_balance(uuid, int) to authenticated;

-- ---------- เก็บเวลาที่เหลือของบิลเข้าบัญชีสมาชิก ----------
-- เวลาที่เหลือคิดที่ฐานข้อมูลเอง = เวลาหมดของบิล − ตอนนี้ (นาทีเต็ม)
-- หน้าเว็บส่งมาแค่รหัสบิล จึงเก็บเกินเวลาที่เหลือจริงไม่ได้
create or replace function public.hour_bank_save(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reservations;
  v_min int;
  v_exp timestamptz;
  v_lot uuid;
  v_bal int;
  v_ref timestamptz;
begin
  if public.pkg_role() is null then
    raise exception 'ไม่มีสิทธิ์เก็บชั่วโมง' using errcode = '42501';
  end if;

  select * into r from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'ไม่พบบิล';
  end if;
  if r.member_id is null then
    raise exception 'บิลนี้ยังไม่ได้ผูกสมาชิก — ผูกสมาชิกก่อนจึงจะเก็บชั่วโมงได้';
  end if;
  if r.zone::text <> 'sofa' then
    raise exception 'เก็บชั่วโมงได้เฉพาะโซนโซฟา';
  end if;
  if r.package_price is null then
    raise exception 'เก็บชั่วโมงได้เฉพาะบิลแพ็กเกจ';
  end if;
  -- กดเก็บได้ระหว่างเล่น หรือภายใน 15 นาทีหลังปิดบิล
  -- เวลาปิดบิลใช้เวลาของฐานข้อมูล (billing_logs.created_at) ไม่ใช่นาฬิกาเครื่องพนักงาน
  if r.status::text = 'playing' then
    v_ref := now();
  elsif r.status::text = 'completed' then
    select max(created_at) into v_ref from public.billing_logs where reservation_id = r.id;
    if v_ref is null or v_ref < now() - interval '15 minutes' then
      raise exception 'บิลนี้ปิดไปนานแล้ว เก็บชั่วโมงไม่ได้';
    end if;
  else
    raise exception 'บิลนี้ถูกยกเลิกแล้ว เก็บชั่วโมงไม่ได้';
  end if;
  if exists (select 1 from public.hour_bank_lots where source_reservation_id = r.id) then
    raise exception 'บิลนี้เก็บชั่วโมงไปแล้ว';
  end if;

  -- นับเวลาที่เหลือ ณ ตอนปิดบิล (ไม่หักช่วงที่พนักงานกดช้า)
  v_min := floor((coalesce(r.end_time_ms, 0) - extract(epoch from v_ref) * 1000) / 60000.0)::int;
  if v_min <= 0 then
    raise exception 'ไม่มีเวลาเหลือให้เก็บ';
  end if;

  -- เวลาที่เหลือจากบิลที่เปิดด้วยชั่วโมงสะสม คืนเข้าก้อนเดิม = หมดอายุวันเดิม
  -- (กันการวนเปิด-เก็บเพื่อยืดอายุ) แต่ให้เวลาอย่างน้อย 1 วันถ้าก้อนเดิมใกล้หมดแล้ว
  v_exp := case
             when coalesce(r.hour_bank_used_min, 0) > 0 and r.hour_bank_expires_at is not null
               then greatest(r.hour_bank_expires_at, now() + interval '1 day')
             else now() + interval '30 days'
           end;

  -- ก้อนใหม่ใช้ได้ที่เครื่องเดียวกับโปรของบิลนี้
  insert into public.hour_bank_lots
    (member_id, zone, minutes_total, minutes_left, expires_at, source_reservation_id,
     machine_numbers, created_by, created_by_name)
  values (r.member_id, 'sofa', v_min, v_min, v_exp, r.id, coalesce(r.package_machines, '{}'),
          auth.uid(), public.pkg_actor_name())
  returning id into v_lot;

  v_bal := public.hour_bank_available(r.member_id);
  insert into public.hour_bank_tx
    (member_id, delta_min, balance_after, reason, reservation_id, note, created_by, created_by_name)
  values (r.member_id, v_min, v_bal, 'save', r.id,
          coalesce(r.package_name, 'แพ็กเกจ'), auth.uid(), public.pkg_actor_name());

  return jsonb_build_object('saved_minutes', v_min, 'balance', v_bal, 'expires_at', v_exp);
end;
$$;
revoke all on function public.hour_bank_save(uuid) from public, anon;
grant execute on function public.hour_bank_save(uuid) to authenticated;

-- ---------- ใช้ชั่วโมงสะสมที่เครื่องนี้ (หักก้อนที่ใกล้หมดอายุก่อน) ----------
-- หักเฉพาะก้อนที่ใช้ได้ที่เครื่องนี้ · คืน machines = เครื่องที่บิลนี้ใช้ได้ (ไว้เก็บเวลาที่เหลือ)
drop function if exists public.hour_bank_redeem(uuid, int);
create or replace function public.hour_bank_redeem(p_member_id uuid, p_minutes int, p_machine_number int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_need int := p_minutes;
  v_have int;
  v_take int;
  v_alloc jsonb := '[]'::jsonb;
  v_first timestamptz;
  v_tx uuid;
  v_bal int;
  v_any boolean := false;
  v_machines int[] := '{}';
  l record;
begin
  if public.pkg_role() is null then
    raise exception 'ไม่มีสิทธิ์ใช้ชั่วโมงสะสม' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'จำนวนนาทีต้องมากกว่า 0';
  end if;
  if p_machine_number is null then
    raise exception 'ต้องระบุเครื่องที่จะใช้ชั่วโมงสะสม';
  end if;

  -- ล็อกก้อนของสมาชิกคนนี้ กันสองเครื่องใช้ชั่วโมงพร้อมกัน
  perform 1 from public.hour_bank_lots where member_id = p_member_id for update;

  v_have := public.hour_bank_available_at(p_member_id, p_machine_number);
  if v_have < p_minutes then
    raise exception 'ชั่วโมงสะสมที่ใช้ได้ที่เครื่อง % ไม่พอ (มี % นาที ต้องการ % นาที)',
      p_machine_number, v_have, p_minutes;
  end if;

  for l in
    select id, minutes_left, expires_at, machine_numbers from public.hour_bank_lots
    where member_id = p_member_id and minutes_left > 0 and expires_at > now()
      and (cardinality(machine_numbers) = 0 or p_machine_number = any(machine_numbers))
    order by expires_at, created_at
  loop
    exit when v_need <= 0;
    v_take := least(l.minutes_left, v_need);
    update public.hour_bank_lots set minutes_left = minutes_left - v_take where id = l.id;
    v_alloc := v_alloc || jsonb_build_object('lot', l.id, 'min', v_take);
    v_first := coalesce(v_first, l.expires_at);
    if cardinality(l.machine_numbers) = 0 then
      v_any := true;
    else
      v_machines := array(select distinct unnest(v_machines || l.machine_numbers) order by 1);
    end if;
    v_need := v_need - v_take;
  end loop;

  v_bal := public.hour_bank_available(p_member_id);
  insert into public.hour_bank_tx
    (member_id, delta_min, balance_after, reason, allocations, note, created_by, created_by_name)
  values (p_member_id, -p_minutes, v_bal, 'redeem', v_alloc, 'เครื่อง ' || p_machine_number,
          auth.uid(), public.pkg_actor_name())
  returning id into v_tx;

  return jsonb_build_object('tx_id', v_tx, 'minutes', p_minutes, 'expires_at', v_first,
                            'balance', v_bal,
                            'machines', to_jsonb(case when v_any then '{}'::int[] else v_machines end));
end;
$$;
revoke all on function public.hour_bank_redeem(uuid, int, int) from public, anon;
grant execute on function public.hour_bank_redeem(uuid, int, int) to authenticated;

-- ผูกรายการใช้ชั่วโมงเข้ากับบิลที่เพิ่งเปิด
create or replace function public.hour_bank_link(p_tx_id uuid, p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.pkg_role() is null then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  update public.hour_bank_tx set reservation_id = p_reservation_id
  where id = p_tx_id and reason = 'redeem' and reservation_id is null and not refunded;
end;
$$;
revoke all on function public.hour_bank_link(uuid, uuid) from public, anon;
grant execute on function public.hour_bank_link(uuid, uuid) to authenticated;

-- คืนชั่วโมงเมื่อเปิดบิลไม่สำเร็จหลังหักไปแล้ว (คืนเข้าก้อนเดิม วันหมดอายุเดิม)
create or replace function public.hour_bank_refund(p_tx_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.hour_bank_tx;
  a jsonb;
  v_bal int;
begin
  if public.pkg_role() is null then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  select * into t from public.hour_bank_tx where id = p_tx_id for update;
  if not found or t.reason <> 'redeem' then
    raise exception 'ไม่พบรายการใช้ชั่วโมง';
  end if;
  if t.refunded then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if t.reservation_id is not null then
    raise exception 'รายการนี้ผูกกับบิลแล้ว คืนไม่ได้';
  end if;

  for a in select * from jsonb_array_elements(coalesce(t.allocations, '[]'::jsonb)) loop
    update public.hour_bank_lots
      set minutes_left = least(minutes_total, minutes_left + (a->>'min')::int)
      where id = (a->>'lot')::uuid;
  end loop;
  update public.hour_bank_tx set refunded = true where id = t.id;

  v_bal := public.hour_bank_available(t.member_id);
  insert into public.hour_bank_tx
    (member_id, delta_min, balance_after, reason, note, created_by, created_by_name)
  values (t.member_id, -t.delta_min, v_bal, 'refund', 'คืนชั่วโมง — เปิดเครื่องไม่สำเร็จ',
          auth.uid(), public.pkg_actor_name());
  return jsonb_build_object('ok', true, 'balance', v_bal);
end;
$$;
revoke all on function public.hour_bank_refund(uuid) from public, anon;
grant execute on function public.hour_bank_refund(uuid) to authenticated;

notify pgrst, 'reload schema';
