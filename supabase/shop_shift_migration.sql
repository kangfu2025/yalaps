-- ============================================================
-- เปิดร้าน / ปิดร้าน / เงินในลิ้นชัก
-- รันครั้งเดียวใน Supabase SQL Editor — รันซ้ำได้ ไม่กระทบตารางเดิม
--
-- *** ลำดับสำคัญ: อัปเดตหน้าเว็บ (deploy) ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ ***
-- เพราะทันทีที่รัน ร้านจะอยู่สถานะ "ปิด" และฐานข้อมูลจะไม่ยอมให้เปิดเครื่อง
-- จนกว่าจะมีคนกด "เปิดร้าน" ซึ่งปุ่มนั้นอยู่ในหน้าเว็บเวอร์ชันใหม่
--
-- ถ้าติดขัดฉุกเฉิน ปิดตัวกันชั่วคราวได้ด้วย:
--   update public.shop_config set gate_enabled = false where id = 1;
--
-- หลักการ:
--   1. สถานะร้าน = "มีรอบ (shift) ที่ยังเปิดอยู่ไหม" เก็บในฐานข้อมูล
--      ไม่มี state แยกให้หลุดไม่ตรงกัน และมีได้ทีละรอบเดียว (unique index)
--   2. ตัวกันเปิดเครื่องเป็น trigger ในฐานข้อมูล — ปิดปุ่มในหน้าเว็บอย่างเดียว
--      ยังยิง API ตรงได้ จึงต้องกันที่ต้นทางของข้อมูล
--   3. ลิ้นชักไม่ใช่บัญชี: ไฟล์นี้ไม่แตะ finance_month_summary และไม่เขียน
--      อะไรลง expenses / other_incomes เลย การถอนเงินเก็บในตารางของมันเอง
--      กำไรสุทธิจึงไม่เปลี่ยนแม้แต่สตางค์เดียว
--   4. ยอด "ควรมีในลิ้นชัก" อ่านจากตารางเงินเดิมโดยตรง (เฉพาะคอลัมน์เงินสด)
--      ไม่มีการคัดลอกยอดมาเก็บซ้ำระหว่างวัน จึงไม่มีทางนับซ้ำ
-- ============================================================

-- ------------------------------------------------------------
-- 0) สิทธิ์และชื่อผู้ทำรายการ (ใช้ user_roles / profiles เดิม)
-- ------------------------------------------------------------
create or replace function public.shop_role()
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
           order by (role::text = ''admin'') desc limit 1'
    into v using auth.uid();
  return v;
end;
$$;

create or replace function public.shop_actor_name()
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
  if to_regclass('public.profiles') is not null then
    execute 'select username from public.profiles where id = $1' into v using auth.uid();
  end if;
  return coalesce(nullif(btrim(coalesce(v, '')), ''), 'ไม่ทราบชื่อ');
end;
$$;

-- ------------------------------------------------------------
-- 1) ตาราง
-- ------------------------------------------------------------
create table if not exists public.shop_config (
  id int primary key default 1 check (id = 1),
  -- false = ปิดตัวกันเปิดเครื่องชั่วคราว (ใช้ตอนฉุกเฉินเท่านั้น)
  gate_enabled boolean not null default true
);
insert into public.shop_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.shop_shifts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'open' check (status in ('open', 'closed')),

  opened_at timestamptz not null default now(),
  opened_by uuid references auth.users(id) on delete set null,
  opened_by_name text,
  opening_counts jsonb not null,           -- {"1000":1,"500":1,...}
  opening_cash numeric(12, 2) not null,

  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  closed_by_name text,
  closing_counts jsonb,
  counted_cash numeric(12, 2),             -- เงินจริงที่นับได้ตอนปิด

  -- ภาพนิ่ง ณ ตอนปิดร้าน — ประวัติจะไม่เปลี่ยนแม้มีคนแก้รายการย้อนหลัง
  cash_in numeric(12, 2),                  -- รายรับเงินสดระหว่างรอบ
  cash_out numeric(12, 2),                 -- รายจ่ายเงินสดจากลิ้นชัก
  withdrawn numeric(12, 2),                -- แอดมินถอนออก
  expected_cash numeric(12, 2),            -- ที่ควรเหลือ
  diff numeric(12, 2),                     -- นับจริง - ควรเหลือ (ลบ = ขาด)
  breakdown jsonb,                         -- แยกแหล่งรายรับเงินสด
  note text
);

-- เปิดได้ทีละรอบเดียว — กันกดเปิดร้านซ้อนจากสองเครื่องพร้อมกัน
create unique index if not exists shop_shifts_one_open
  on public.shop_shifts ((1)) where status = 'open';
create index if not exists shop_shifts_opened_idx on public.shop_shifts (opened_at desc);

create table if not exists public.cash_withdrawals (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shop_shifts(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  balance_before numeric(12, 2) not null,
  balance_after numeric(12, 2) not null,
  note text,
  withdrawn_by uuid references auth.users(id) on delete set null,
  withdrawn_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists cash_withdrawals_shift_idx on public.cash_withdrawals (shift_id);
create index if not exists cash_withdrawals_at_idx on public.cash_withdrawals (created_at desc);

-- ------------------------------------------------------------
-- 2) ธงบอกว่าเงินสดก้อนนี้ผ่านลิ้นชักหรือเปล่า
--
-- รายจ่ายเงินสดไม่ได้ออกจากลิ้นชักทุกรายการ (เช่น เจ้าของจ่ายค่าเช่าร้านเอง)
-- และค่าเช่าห้องที่รับเป็นเงินสดก็ไม่ได้เข้าลิ้นชักเสมอไป จึงให้ติ๊กทีละรายการ
-- ค่าเริ่มต้น false = รายการเก่าทั้งหมดไม่ยุ่งกับลิ้นชัก และไม่มีผลต่อบัญชี
-- ------------------------------------------------------------
alter table if exists public.expenses
  add column if not exists from_drawer boolean not null default false;
alter table if exists public.other_incomes
  add column if not exists to_drawer boolean not null default false;

-- ------------------------------------------------------------
-- 3) นับธนบัตร/เหรียญ — ยอดรวมคำนวณที่ฐานข้อมูล ไม่เชื่อยอดที่หน้าเว็บส่งมา
-- ------------------------------------------------------------
create or replace function public.shop_count_clean(p_counts jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  d text;
  raw text;
  n numeric;
  out_counts jsonb := '{}'::jsonb;
  total numeric := 0;
begin
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'ข้อมูลการนับเงินไม่ถูกต้อง';
  end if;

  for d in select jsonb_object_keys(p_counts) loop
    if d not in ('1000', '500', '100', '50', '20', '10', '5', '1') then
      raise exception 'ไม่รู้จักชนิดธนบัตร/เหรียญ: %', d;
    end if;
  end loop;

  foreach d in array array['1000', '500', '100', '50', '20', '10', '5', '1'] loop
    raw := coalesce(p_counts ->> d, '0');
    if raw !~ '^[0-9]{1,6}$' then
      raise exception 'จำนวนของ % บาท ต้องเป็นจำนวนเต็มที่ไม่ติดลบ', d;
    end if;
    n := raw::numeric;
    out_counts := out_counts || jsonb_build_object(d, n);
    total := total + n * d::numeric;
  end loop;

  return jsonb_build_object('counts', out_counts, 'total', total);
end;
$$;

-- ------------------------------------------------------------
-- 4) เงินสดที่ผ่านลิ้นชักในรอบหนึ่ง — สูตรเดียวของทั้งระบบ
--
--   ควรมี = เงินตอนเปิด + รายรับเงินสด - รายจ่ายเงินสดจากลิ้นชัก - ถอนออก
--
-- นับเฉพาะคอลัมน์เงินสด (…_cash / pay_method = 'cash') เงินโอนไม่เกี่ยวเลย
-- ใช้เวลา created_at ของเซิร์ฟเวอร์ทุกตาราง ไม่ขึ้นกับนาฬิกาเครื่องไหน
--
--   PS5 บิลที่ปิดในรอบ : final_cash + advance_cash
--                        (มัดจำของบิลที่เปิดก่อนรอบนี้ไม่นับ — เงินก้อนนั้น
--                         อยู่ในยอดนับตอนเปิดร้านแล้ว)
--   PS5 บิลที่ยังเล่นอยู่ : advance_cash ที่รับมาแล้วในรอบนี้
--   PC                 : paid_cash ของ session ที่เปิดในรอบ (ไม่นับที่ยกเลิก)
--   POS                : paid_cash ของบิลขายในรอบที่ยังไม่ถูกยกเลิก
--   รายรับอื่น           : เฉพาะเงินสดที่ติ๊ก "เก็บเข้าลิ้นชัก"
--   รายจ่าย             : เฉพาะเงินสดที่ติ๊ก "จ่ายจากลิ้นชัก"
-- ------------------------------------------------------------
create or replace function public.shop_shift_cash(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.shop_shifts;
  v_to timestamptz;
  v_ps5 numeric := 0;
  v_ps5_open numeric := 0;
  v_pc numeric := 0;
  v_pos numeric := 0;
  v_other numeric := 0;
  v_out numeric := 0;
  v_wd numeric := 0;
  v_in numeric;
begin
  select * into s from public.shop_shifts where id = p_shift_id;
  if not found then
    raise exception 'ไม่พบรอบเปิดร้าน';
  end if;
  v_to := coalesce(s.closed_at, now());

  select coalesce(sum(
           b.final_cash
           + case when r.id is null or r.created_at >= s.opened_at then b.advance_cash else 0 end
         ), 0)
    into v_ps5
  from public.billing_logs b
  left join public.reservations r on r.id = b.reservation_id
  where b.created_at >= s.opened_at and b.created_at <= v_to;

  select coalesce(sum(advance_cash), 0) into v_ps5_open
  from public.reservations
  where status = 'playing'
    and created_at >= s.opened_at and created_at <= v_to;

  select coalesce(sum(coalesce(paid_cash, 0)), 0) into v_pc
  from public.pc_sessions
  where status <> 'cancelled'
    and created_at >= s.opened_at and created_at <= v_to;

  if to_regclass('public.product_sales') is not null then
    execute 'select coalesce(sum(coalesce(paid_cash, 0)), 0) from public.product_sales
             where status = ''paid'' and created_at >= $1 and created_at <= $2'
      into v_pos using s.opened_at, v_to;
  end if;

  if to_regclass('public.other_incomes') is not null then
    execute 'select coalesce(sum(amount), 0) from public.other_incomes
             where status = ''active'' and pay_method = ''cash'' and to_drawer
               and created_at >= $1 and created_at <= $2'
      into v_other using s.opened_at, v_to;
  end if;

  if to_regclass('public.expenses') is not null then
    execute 'select coalesce(sum(amount), 0) from public.expenses
             where status = ''active'' and pay_method = ''cash'' and from_drawer
               and created_at >= $1 and created_at <= $2'
      into v_out using s.opened_at, v_to;
  end if;

  select coalesce(sum(amount), 0) into v_wd
  from public.cash_withdrawals where shift_id = s.id;

  v_in := v_ps5 + v_ps5_open + v_pc + v_pos + v_other;

  return jsonb_build_object(
    'opening',   s.opening_cash,
    'ps5',       v_ps5 + v_ps5_open,
    'pc',        v_pc,
    'pos',       v_pos,
    'other_in',  v_other,
    'cash_in',   v_in,
    'cash_out',  v_out,
    'withdrawn', v_wd,
    'expected',  s.opening_cash + v_in - v_out - v_wd
  );
end;
$$;

-- ฟังก์ชันภายใน — เรียกผ่าน shop_status / shop_close / drawer_withdraw เท่านั้น
revoke all on function public.shop_shift_cash(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5) สถานะร้านตอนนี้
-- ------------------------------------------------------------
create or replace function public.shop_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.shop_role();
  s public.shop_shifts;
  v_open boolean;
  v_active int;
  v_last jsonb;
begin
  if v_role is null then
    raise exception 'ไม่มีสิทธิ์ใช้งาน';
  end if;

  select * into s from public.shop_shifts where status = 'open' limit 1;
  v_open := found;

  select (select count(*) from public.reservations where status = 'playing')
       + (select count(*) from public.pc_sessions where status = 'playing')
    into v_active;

  select jsonb_build_object('closed_at', closed_at, 'counted_cash', counted_cash, 'diff', diff)
    into v_last
  from public.shop_shifts where status = 'closed'
  order by closed_at desc limit 1;

  return jsonb_build_object(
    'gate', (select gate_enabled from public.shop_config where id = 1),
    'open', v_open,
    'role', v_role,
    'active_sessions', v_active,
    'last_closed', v_last,
    'shift', case when v_open then jsonb_build_object(
      'id', s.id,
      'opened_at', s.opened_at,
      'opened_by_name', s.opened_by_name,
      'opening_cash', s.opening_cash,
      'opening_counts', s.opening_counts
    ) end,
    'cash', case when v_open then public.shop_shift_cash(s.id) end
  );
end;
$$;

-- ------------------------------------------------------------
-- 6) เปิดร้าน
-- ------------------------------------------------------------
create or replace function public.shop_open(p_counts jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c jsonb;
  v_id uuid;
begin
  if public.shop_role() is null then
    raise exception 'ไม่มีสิทธิ์เปิดร้าน';
  end if;
  if exists (select 1 from public.shop_shifts where status = 'open') then
    raise exception 'ร้านเปิดอยู่แล้ว';
  end if;

  c := public.shop_count_clean(p_counts);

  begin
    insert into public.shop_shifts
      (status, opened_by, opened_by_name, opening_counts, opening_cash, note)
    values
      ('open', auth.uid(), public.shop_actor_name(), c -> 'counts', (c ->> 'total')::numeric,
       nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ร้านเปิดอยู่แล้ว';
  end;

  return jsonb_build_object('id', v_id, 'opening_cash', (c ->> 'total')::numeric);
end;
$$;

-- ------------------------------------------------------------
-- 7) ปิดร้าน — นับเงินจริง เทียบกับที่ควรมี แล้วเก็บภาพนิ่งไว้
--
-- ต้องปิดบิลทุกเครื่องก่อน: บิลที่ค้างอยู่แปลว่ายังมีเงินจะเข้ามาอีก
-- ถ้ายอมให้ปิดร้านทั้งที่มีบิลค้าง เงินก้อนนั้นจะไม่อยู่ในรอบไหนเลย
-- ------------------------------------------------------------
create or replace function public.shop_close(p_counts jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.shop_shifts;
  c jsonb;
  cash jsonb;
  v_ps5 int;
  v_pc int;
  v_counted numeric;
  v_expected numeric;
begin
  if public.shop_role() is null then
    raise exception 'ไม่มีสิทธิ์ปิดร้าน';
  end if;

  select * into s from public.shop_shifts where status = 'open' for update;
  if not found then
    raise exception 'ร้านปิดอยู่แล้ว';
  end if;

  select count(*) into v_ps5 from public.reservations where status = 'playing';
  select count(*) into v_pc  from public.pc_sessions  where status = 'playing';
  if v_ps5 + v_pc > 0 then
    raise exception 'ยังมีบิลที่ยังไม่ปิด (PS5 % บิล, PC % เครื่อง) — ปิดบิลให้ครบก่อนปิดร้าน', v_ps5, v_pc;
  end if;

  c := public.shop_count_clean(p_counts);
  v_counted := (c ->> 'total')::numeric;

  cash := public.shop_shift_cash(s.id);
  v_expected := (cash ->> 'expected')::numeric;

  update public.shop_shifts set
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    closed_by_name = public.shop_actor_name(),
    closing_counts = c -> 'counts',
    counted_cash = v_counted,
    cash_in = (cash ->> 'cash_in')::numeric,
    cash_out = (cash ->> 'cash_out')::numeric,
    withdrawn = (cash ->> 'withdrawn')::numeric,
    expected_cash = v_expected,
    diff = v_counted - v_expected,
    breakdown = cash,
    note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
  where id = s.id;

  return cash || jsonb_build_object(
    'id', s.id,
    'counted', v_counted,
    'diff', v_counted - v_expected
  );
end;
$$;

-- ------------------------------------------------------------
-- 8) ถอนเงินจากลิ้นชัก (เฉพาะแอดมิน)
--
-- ไม่ใช่รายจ่ายของร้าน — ไม่เขียนลง expenses และไม่อยู่ในสูตรกำไรสุทธิ
-- เป็นแค่การย้ายเงินสดออกจากลิ้นชัก
-- ------------------------------------------------------------
create or replace function public.drawer_withdraw(p_amount numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.shop_shifts;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_before numeric;
begin
  if coalesce(public.shop_role(), '') <> 'admin' then
    raise exception 'เฉพาะแอดมินเท่านั้นที่ถอนเงินจากลิ้นชักได้';
  end if;
  if v_amount <= 0 then
    raise exception 'จำนวนเงินที่ถอนต้องมากกว่า 0';
  end if;

  -- ล็อกรอบไว้ กันถอนสองรายการพร้อมกันจนเกินยอด
  select * into s from public.shop_shifts where status = 'open' for update;
  if not found then
    raise exception 'ร้านปิดอยู่ — เปิดร้านก่อนจึงจะถอนเงินจากลิ้นชักได้';
  end if;

  v_before := (public.shop_shift_cash(s.id) ->> 'expected')::numeric;
  if v_amount > v_before then
    raise exception 'ถอนเกินยอดในลิ้นชักไม่ได้ (มีอยู่ % บาท)', to_char(v_before, 'FM999,999,990.00');
  end if;

  insert into public.cash_withdrawals
    (shift_id, amount, balance_before, balance_after, note, withdrawn_by, withdrawn_by_name)
  values
    (s.id, v_amount, v_before, v_before - v_amount, nullif(btrim(coalesce(p_note, '')), ''),
     auth.uid(), public.shop_actor_name());

  return jsonb_build_object('before', v_before, 'amount', v_amount, 'after', v_before - v_amount);
end;
$$;

-- ------------------------------------------------------------
-- 9) ตัวกันเปิดเครื่องตอนร้านปิด
--
-- กันเฉพาะ "เริ่ม session ใหม่" เท่านั้น ต่อเวลา/ปิดบิล/ยกเลิก ไม่ถูกแตะ
-- ระบบจับเวลาและ PC Agent ทำงานเหมือนเดิมทุกอย่าง
-- ------------------------------------------------------------
create or replace function public.shop_guard_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select gate_enabled from public.shop_config where id = 1), true) then
    return new;
  end if;
  if not exists (select 1 from public.shop_shifts where status = 'open') then
    raise exception 'กรุณาเปิดร้านก่อนเริ่มใช้งานเครื่อง' using errcode = 'P0001', hint = 'SHOP_CLOSED';
  end if;
  return new;
end;
$$;

drop trigger if exists shop_guard_pc_insert on public.pc_sessions;
create trigger shop_guard_pc_insert
  before insert on public.pc_sessions
  for each row execute function public.shop_guard_session();

drop trigger if exists shop_guard_res_insert on public.reservations;
create trigger shop_guard_res_insert
  before insert on public.reservations
  for each row when (new.status = 'playing')
  execute function public.shop_guard_session();

drop trigger if exists shop_guard_res_start on public.reservations;
create trigger shop_guard_res_start
  before update of status on public.reservations
  for each row when (new.status = 'playing' and old.status is distinct from new.status)
  execute function public.shop_guard_session();

-- ------------------------------------------------------------
-- 10) สิทธิ์
--   เขียนตารางตรง ๆ ไม่ได้เลย ทุกอย่างต้องผ่านฟังก์ชันข้างบน
--   ประวัติรอบและประวัติถอนเงิน อ่านได้เฉพาะแอดมิน
-- ------------------------------------------------------------
revoke all on public.shop_config      from anon, authenticated;
revoke all on public.shop_shifts      from anon, authenticated;
revoke all on public.cash_withdrawals from anon, authenticated;
grant select on public.shop_shifts      to authenticated;
grant select on public.cash_withdrawals to authenticated;
grant all on public.shop_config, public.shop_shifts, public.cash_withdrawals to service_role;

alter table public.shop_config      enable row level security;
alter table public.shop_shifts      enable row level security;
alter table public.cash_withdrawals enable row level security;

drop policy if exists "shop_shifts_admin_read" on public.shop_shifts;
create policy "shop_shifts_admin_read" on public.shop_shifts
  for select to authenticated using (public.shop_role() = 'admin');

drop policy if exists "cash_withdrawals_admin_read" on public.cash_withdrawals;
create policy "cash_withdrawals_admin_read" on public.cash_withdrawals
  for select to authenticated using (public.shop_role() = 'admin');

revoke all on function public.shop_role()                    from public, anon;
revoke all on function public.shop_actor_name()              from public, anon;
revoke all on function public.shop_status()                  from public, anon;
revoke all on function public.shop_open(jsonb, text)         from public, anon;
revoke all on function public.shop_close(jsonb, text)        from public, anon;
revoke all on function public.drawer_withdraw(numeric, text) from public, anon;
grant execute on function public.shop_role()                    to authenticated;
grant execute on function public.shop_actor_name()              to authenticated;
grant execute on function public.shop_status()                  to authenticated;
grant execute on function public.shop_open(jsonb, text)         to authenticated;
grant execute on function public.shop_close(jsonb, text)        to authenticated;
grant execute on function public.drawer_withdraw(numeric, text) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.shop_shifts;
  exception when others then null;
  end;
end $$;

notify pgrst, 'reload schema';
