-- ============================================================
-- บัญชีรายรับ-รายจ่าย และกำไรสุทธิรายเดือน
-- รันครั้งเดียวใน Supabase SQL Editor — รันซ้ำได้ ไม่กระทบตารางเดิม
--
-- หลักการที่ยึดไว้ทั้งไฟล์:
--   1. ไม่แตะตารางรายได้เดิมเลย (billing_logs / pc_sessions / product_sales
--      / reservations) — อ่านอย่างเดียว การคำนวณรายได้เดิมจึงไม่เปลี่ยน
--   2. เดือนตัดตามเวลาไทย (Asia/Bangkok) ทุกที่ คำนวณในฐานข้อมูลที่เดียว
--      ฝั่งเบราว์เซอร์ไม่ต้องรู้เรื่อง timezone เลย
--   3. ค่าแรงพนักงานไม่มีตารางแยก — เป็นรายจ่ายหมวด 'wage' ในตารางเดียวกัน
--      จึงไม่มีทางถูกนับเป็นรายจ่ายสองครั้งโดยโครงสร้าง
--   4. ลบจริงไม่ได้ ใช้ status='void' แทน และทุกการเปลี่ยนแปลงถูกบันทึกใน
--      finance_audit เพื่อตรวจย้อนหลังได้
-- ============================================================

-- ============================================================
-- 1) ตารางรายจ่าย
-- ============================================================
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),

  -- เวลาที่จ่ายจริง — บันทึกอัตโนมัติ แต่แอดมินแก้ย้อนหลังได้
  occurred_at timestamptz not null default now(),
  -- สองคอลัมน์นี้ trigger เติมให้เสมอจาก occurred_at ตามเวลาไทย
  -- ห้ามเขียนเอง เพราะจะทำให้ยอดรายเดือนเพี้ยน
  occurred_date date,
  period_month  text,          -- 'YYYY-MM'

  category text not null check (category in (
    'rent_shop',    -- ค่าเช่าร้าน
    'electricity',  -- ค่าไฟ
    'internet',     -- Internet
    'ps_plus',      -- PS Plus (มีได้หลายรายการต่อเดือน)
    'wage',         -- ค่าแรงพนักงาน
    'buy_game',     -- ซื้อเกม
    'buy_stock',    -- ซื้อสินค้า
    'repair',       -- ซ่อม/อุปกรณ์
    'marketing',    -- การตลาด
    'other'         -- อื่น ๆ
  )),

  amount numeric(12, 2) not null check (amount > 0),
  pay_method text not null default 'cash' check (pay_method in ('cash', 'transfer')),

  -- ใช้เฉพาะหมวดค่าแรง — จ่ายให้ใคร
  staff_name text,

  note text,

  status text not null default 'active' check (status in ('active', 'void')),

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ค่าแรงต้องระบุชื่อพนักงานเสมอ ไม่งั้นย้อนดูไม่ได้ว่าจ่ายให้ใคร
  constraint expenses_wage_needs_name check (
    category <> 'wage' or nullif(btrim(coalesce(staff_name, '')), '') is not null
  )
);

create index if not exists expenses_month_idx    on public.expenses (period_month, status);
create index if not exists expenses_cat_idx      on public.expenses (period_month, category) where status = 'active';
create index if not exists expenses_occurred_idx on public.expenses (occurred_at desc);
create index if not exists expenses_staff_idx    on public.expenses (staff_name, period_month) where category = 'wage';

-- ============================================================
-- 2) ตารางรายรับอื่นที่ไม่ได้มาจากหน้าร้าน (ค่าเช่าห้อง)
--
-- ค่าเช่าห้องคิดเป็น "เดือนที่รับ" ที่ผู้ใช้เลือกเอง ไม่ใช่เวลาที่กดบันทึก
-- period_month จึงเป็นคอลัมน์ธรรมดา ไม่ได้มาจาก timestamp
--
-- ค่าเช่า + ค่าไฟผู้เช่า ให้กรอกรวมเป็นยอดเดียวตามที่ตกลงไว้
-- (เช่น 3,500 + 850 = 4,350)
-- ============================================================
create table if not exists public.other_incomes (
  id uuid primary key default gen_random_uuid(),

  kind text not null default 'room_rent' check (kind in ('room_rent', 'other')),
  amount numeric(12, 2) not null check (amount > 0),

  period_month text not null check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  pay_method text not null default 'cash' check (pay_method in ('cash', 'transfer')),
  note text,

  status text not null default 'active' check (status in ('active', 'void')),

  received_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists other_incomes_month_idx on public.other_incomes (period_month, status);

-- ============================================================
-- 3) ประวัติการแก้ไข — ตรวจย้อนหลังได้ว่าใครแก้อะไรเมื่อไหร่
-- ============================================================
create table if not exists public.finance_audit (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert', 'update', 'void', 'restore')),
  actor uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create index if not exists finance_audit_row_idx on public.finance_audit (table_name, row_id, at desc);
create index if not exists finance_audit_at_idx  on public.finance_audit (at desc);

-- ============================================================
-- 4) Trigger — เติมเดือนตามเวลาไทย และกันคนเขียนคอลัมน์สรุปเอง
-- ============================================================
create or replace function public.finance_fill_period()
returns trigger
language plpgsql
as $$
begin
  new.occurred_date := (new.occurred_at at time zone 'Asia/Bangkok')::date;
  new.period_month  := to_char(new.occurred_at at time zone 'Asia/Bangkok', 'YYYY-MM');
  new.updated_at    := now();
  return new;
end;
$$;

drop trigger if exists expenses_fill_period on public.expenses;
create trigger expenses_fill_period
  before insert or update on public.expenses
  for each row execute function public.finance_fill_period();

create or replace function public.finance_touch_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists other_incomes_touch on public.other_incomes;
create trigger other_incomes_touch
  before update on public.other_incomes
  for each row execute function public.finance_touch_updated();

-- ============================================================
-- 5) Trigger — บันทึกประวัติทุกการเปลี่ยนแปลง
-- ============================================================
create or replace function public.finance_write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'insert';
  elsif new.status = 'void' and old.status <> 'void' then
    v_action := 'void';
  elsif new.status = 'active' and old.status = 'void' then
    v_action := 'restore';
  else
    v_action := 'update';
  end if;

  insert into public.finance_audit (table_name, row_id, action, actor, before, after)
  values (
    tg_table_name,
    new.id,
    v_action,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new)
  );
  return null;
end;
$$;

drop trigger if exists expenses_audit on public.expenses;
create trigger expenses_audit
  after insert or update on public.expenses
  for each row execute function public.finance_write_audit();

drop trigger if exists other_incomes_audit on public.other_incomes;
create trigger other_incomes_audit
  after insert or update on public.other_incomes
  for each row execute function public.finance_write_audit();

-- ============================================================
-- 6) สิทธิ์
--
-- ข้อมูลการเงินของร้าน เปิดให้เฉพาะแอดมิน — พนักงานอ่านไม่ได้
-- (ถ้ายังไม่ได้ตั้งตาราง user_roles ให้ถือว่าผ่าน เพื่อไม่ให้ระบบล็อกตัวเอง)
--
-- ไม่ให้สิทธิ์ delete กับใครเลย — ลบได้ทางเดียวคือตั้ง status='void'
-- ซึ่งถูกบันทึกไว้ใน finance_audit เสมอ
-- ============================================================
create or replace function public.fin_is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_ok boolean;
begin
  if auth.uid() is null then
    return false;
  end if;
  if to_regclass('public.user_roles') is null then
    return true;
  end if;
  execute 'select exists(select 1 from public.user_roles where user_id = $1 and role = ''admin'')'
    into v_ok
    using auth.uid();
  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.fin_is_admin() from public, anon;
grant execute on function public.fin_is_admin() to authenticated;

revoke all on public.expenses       from anon;
revoke all on public.other_incomes  from anon;
revoke all on public.finance_audit  from anon;

grant select, insert, update on public.expenses      to authenticated;
grant select, insert, update on public.other_incomes to authenticated;
grant select                 on public.finance_audit to authenticated;

grant all on public.expenses      to service_role;
grant all on public.other_incomes to service_role;
grant all on public.finance_audit to service_role;

alter table public.expenses      enable row level security;
alter table public.other_incomes enable row level security;
alter table public.finance_audit enable row level security;

drop policy if exists "fin_exp_read"   on public.expenses;
drop policy if exists "fin_exp_insert" on public.expenses;
drop policy if exists "fin_exp_update" on public.expenses;
create policy "fin_exp_read"   on public.expenses for select to authenticated using (public.fin_is_admin());
create policy "fin_exp_insert" on public.expenses for insert to authenticated with check (public.fin_is_admin());
create policy "fin_exp_update" on public.expenses for update to authenticated using (public.fin_is_admin()) with check (public.fin_is_admin());

drop policy if exists "fin_inc_read"   on public.other_incomes;
drop policy if exists "fin_inc_insert" on public.other_incomes;
drop policy if exists "fin_inc_update" on public.other_incomes;
create policy "fin_inc_read"   on public.other_incomes for select to authenticated using (public.fin_is_admin());
create policy "fin_inc_insert" on public.other_incomes for insert to authenticated with check (public.fin_is_admin());
create policy "fin_inc_update" on public.other_incomes for update to authenticated using (public.fin_is_admin()) with check (public.fin_is_admin());

drop policy if exists "fin_audit_read" on public.finance_audit;
create policy "fin_audit_read" on public.finance_audit for select to authenticated using (public.fin_is_admin());

-- ============================================================
-- 7) สรุปยอดรายเดือน — ที่เดียวที่คำนวณ "กำไรสุทธิ"
--
-- กติกาที่ใช้ตัดเดือน (สำคัญที่สุดของทั้งระบบ):
--
--   PS5 โซฟา/เรสซิ่ง : นับทั้งบิลในเดือนที่ "ปิดบิล" (checkout_date)
--                      บิลที่เปิดข้ามเดือนจึงไปตกเดือนที่ปิด ไม่ถูกนับสองเดือน
--   PC              : นับตามวันที่เริ่ม session ตามเวลาไทย ไม่นับบิลที่ยกเลิก
--   POS / สินค้า     : นับตาม sale_date ของบิลที่ status='paid'
--   ค่าเช่าห้อง      : นับตามเดือนที่ผู้ใช้เลือกเอง
--
-- ทำไมถึงไม่นับมัดจำของบิลที่ยังเล่นค้างอยู่เข้ารายรับ:
--   เงินก้อนนั้นจะถูกเขียนลง billing_logs ทั้งก้อน (advance + final)
--   ตอนปิดบิล ถ้านับตอนนี้ด้วยจะกลายเป็นนับซ้ำทันทีที่บิลปิดข้ามเดือน
--   จึงส่งกลับไปแยกเป็น info.open_bills_advance ให้หน้าจอแสดงเป็นหมายเหตุ
--   โดยไม่รวมในยอด
--
-- ยอดสินค้าที่ลงบิลเครื่อง ถูกหักออกจาก final_cash/final_transfer ตอนปิดบิล
-- อยู่แล้ว (ดู ManageModal.doCheckout) การบวก billing_logs กับ product_sales
-- จึงไม่ซ้ำกัน
-- ============================================================
create or replace function public.finance_month_summary(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day_start date;
  v_day_end   date;   -- ไม่รวมวันนี้ (exclusive)
  v_ts_start  timestamptz;
  v_ts_end    timestamptz;

  v_sofa_cash numeric := 0; v_sofa_tf numeric := 0;
  v_race_cash numeric := 0; v_race_tf numeric := 0;
  v_etc_cash  numeric := 0; v_etc_tf  numeric := 0;
  v_pc_cash   numeric := 0; v_pc_tf   numeric := 0;
  v_pos_cash  numeric := 0; v_pos_tf  numeric := 0;
  v_oth_cash  numeric := 0; v_oth_tf  numeric := 0;

  v_open_adv  numeric := 0;
  v_open_cnt  int     := 0;

  v_exp_cash  numeric := 0;
  v_exp_tf    numeric := 0;
  v_exp_rows  jsonb   := '[]'::jsonb;
  v_oth_rows  jsonb   := '[]'::jsonb;

  v_income numeric := 0;
  v_expense numeric := 0;
begin
  if not public.fin_is_admin() then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลการเงิน';
  end if;
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'รูปแบบเดือนไม่ถูกต้อง ต้องเป็น YYYY-MM';
  end if;

  v_day_start := (p_month || '-01')::date;
  v_day_end   := (v_day_start + interval '1 month')::date;
  v_ts_start  := v_day_start::timestamp at time zone 'Asia/Bangkok';
  v_ts_end    := v_day_end::timestamp at time zone 'Asia/Bangkok';

  -- ---- PS5: บิลที่ปิดในเดือนนี้ ----
  select
    coalesce(sum(case when zone = 'sofa'   then advance_cash     + final_cash     end), 0),
    coalesce(sum(case when zone = 'sofa'   then advance_transfer + final_transfer end), 0),
    coalesce(sum(case when zone = 'racing' then advance_cash     + final_cash     end), 0),
    coalesce(sum(case when zone = 'racing' then advance_transfer + final_transfer end), 0),
    coalesce(sum(case when zone not in ('sofa', 'racing') then advance_cash     + final_cash     end), 0),
    coalesce(sum(case when zone not in ('sofa', 'racing') then advance_transfer + final_transfer end), 0)
    into v_sofa_cash, v_sofa_tf, v_race_cash, v_race_tf, v_etc_cash, v_etc_tf
  from public.billing_logs
  where checkout_date >= v_day_start
    and checkout_date <  v_day_end;

  -- ---- PC: session ที่เริ่มในเดือนนี้ (ไม่นับที่ยกเลิก) ----
  select
    coalesce(sum(coalesce(paid_cash, 0)), 0),
    coalesce(sum(coalesce(paid_transfer, 0)), 0)
    into v_pc_cash, v_pc_tf
  from public.pc_sessions
  where started_at >= v_ts_start
    and started_at <  v_ts_end
    and status <> 'cancelled';

  -- ---- POS: บิลขายสินค้าที่ยังไม่ถูกยกเลิก ----
  select
    coalesce(sum(coalesce(paid_cash, 0)), 0),
    coalesce(sum(coalesce(paid_transfer, 0)), 0)
    into v_pos_cash, v_pos_tf
  from public.product_sales
  where sale_date >= v_day_start
    and sale_date <  v_day_end
    and status = 'paid';

  -- ---- รายรับอื่น (ค่าเช่าห้อง) ----
  select
    coalesce(sum(case when pay_method = 'cash'     then amount end), 0),
    coalesce(sum(case when pay_method = 'transfer' then amount end), 0)
    into v_oth_cash, v_oth_tf
  from public.other_incomes
  where period_month = p_month
    and status = 'active';

  select coalesce(
    jsonb_agg(jsonb_build_object('kind', kind, 'amount', amt, 'count', cnt) order by amt desc),
    '[]'::jsonb
  )
    into v_oth_rows
  from (
    select kind, sum(amount) as amt, count(*) as cnt
    from public.other_incomes
    where period_month = p_month and status = 'active'
    group by kind
  ) t;

  -- ---- หมายเหตุ: บิลที่ยังเล่นค้างอยู่ (ไม่รวมในยอด) ----
  select coalesce(sum(advance_cash + advance_transfer), 0), count(*)
    into v_open_adv, v_open_cnt
  from public.reservations
  where status = 'playing'
    and start_time >= v_ts_start
    and start_time <  v_ts_end;

  -- ---- รายจ่าย ----
  select
    coalesce(sum(case when pay_method = 'cash'     then amount end), 0),
    coalesce(sum(case when pay_method = 'transfer' then amount end), 0)
    into v_exp_cash, v_exp_tf
  from public.expenses
  where period_month = p_month
    and status = 'active';

  select coalesce(
    jsonb_agg(jsonb_build_object('category', category, 'amount', amt, 'count', cnt) order by amt desc),
    '[]'::jsonb
  )
    into v_exp_rows
  from (
    select category, sum(amount) as amt, count(*) as cnt
    from public.expenses
    where period_month = p_month and status = 'active'
    group by category
  ) t;

  v_income  := v_sofa_cash + v_sofa_tf + v_race_cash + v_race_tf + v_etc_cash + v_etc_tf
             + v_pc_cash + v_pc_tf + v_pos_cash + v_pos_tf + v_oth_cash + v_oth_tf;
  v_expense := v_exp_cash + v_exp_tf;

  return jsonb_build_object(
    'month', p_month,
    'income', jsonb_build_object(
      'sofa',   v_sofa_cash + v_sofa_tf,
      'racing', v_race_cash + v_race_tf,
      'pc',     v_pc_cash   + v_pc_tf,
      'pos',    v_pos_cash  + v_pos_tf,
      'zone_other', v_etc_cash + v_etc_tf,
      'other_total', v_oth_cash + v_oth_tf,
      'other_rows',  v_oth_rows,
      'cash',     v_sofa_cash + v_race_cash + v_etc_cash + v_pc_cash + v_pos_cash + v_oth_cash,
      'transfer', v_sofa_tf   + v_race_tf   + v_etc_tf   + v_pc_tf   + v_pos_tf   + v_oth_tf,
      'total', v_income
    ),
    'expense', jsonb_build_object(
      'by_category', v_exp_rows,
      'cash',     v_exp_cash,
      'transfer', v_exp_tf,
      'total',    v_expense
    ),
    'net_profit', v_income - v_expense,
    'info', jsonb_build_object(
      'open_bills_advance', v_open_adv,
      'open_bills_count',   v_open_cnt
    )
  );
end;
$$;

revoke all on function public.finance_month_summary(text) from public, anon;
grant execute on function public.finance_month_summary(text) to authenticated;

-- ============================================================
-- 8) สรุปรายปี — เรียกฟังก์ชันรายเดือนซ้ำ 12 ครั้ง
--    จึงใช้กติกาตัดเดือนชุดเดียวกันเป๊ะ ไม่มีทางคำนวณคนละแบบ
-- ============================================================
create or replace function public.finance_year_summary(p_year int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_one jsonb;
  m int;
  v_key text;
begin
  if not public.fin_is_admin() then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลการเงิน';
  end if;
  if p_year < 2000 or p_year > 2999 then
    raise exception 'ปีไม่ถูกต้อง';
  end if;

  for m in 1..12 loop
    v_key := p_year::text || '-' || lpad(m::text, 2, '0');
    v_one := public.finance_month_summary(v_key);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'month',      v_key,
      'income',     v_one -> 'income'  -> 'total',
      'expense',    v_one -> 'expense' -> 'total',
      'net_profit', v_one -> 'net_profit'
    ));
  end loop;

  return v_out;
end;
$$;

revoke all on function public.finance_year_summary(int) from public, anon;
grant execute on function public.finance_year_summary(int) to authenticated;
