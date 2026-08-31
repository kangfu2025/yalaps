-- ============================================================
-- ระบบขายสินค้า (POS ด้วยบาร์โค้ด) — รันครั้งเดียวใน Supabase SQL Editor
-- ปลอดภัย: รันซ้ำได้ ไม่กระทบตารางเดิม
-- ============================================================

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  barcode text not null unique,
  name text not null,
  price numeric(10,2) not null default 0 check (price >= 0),
  stock int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_barcode_idx on public.products(barcode);

create table if not exists public.product_sales (
  id uuid primary key default gen_random_uuid(),
  sale_no bigserial,
  sold_at timestamptz not null default now(),
  sale_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  payment_method text not null default 'cash'
    check (payment_method in ('cash','transfer','mixed','points','on_machine')),
  paid_cash numeric(10,2) not null default 0,
  paid_transfer numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  reservation_id uuid references public.reservations(id) on delete set null,
  pc_session_id uuid references public.pc_sessions(id) on delete set null,
  machine_label text,
  settled boolean not null default false,
  status text not null default 'paid' check (status in ('paid','cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists product_sales_date_idx on public.product_sales(sale_date);
create index if not exists product_sales_res_idx on public.product_sales(reservation_id) where reservation_id is not null;
create index if not exists product_sales_pc_idx on public.product_sales(pc_session_id) where pc_session_id is not null;

create table if not exists public.product_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.product_sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  barcode text,
  unit_price numeric(10,2) not null default 0,
  qty int not null default 1 check (qty > 0),
  subtotal numeric(10,2) not null default 0
);
create index if not exists product_sale_items_sale_idx on public.product_sale_items(sale_id);

-- ============================================================
-- GRANTS + RLS (เปิดเหมือนตารางอื่นในระบบ in-shop)
-- ============================================================
grant select, insert, update, delete on public.products           to anon, authenticated;
grant select, insert, update, delete on public.product_sales      to anon, authenticated;
grant select, insert, update, delete on public.product_sale_items to anon, authenticated;
grant usage, select on sequence public.product_sales_sale_no_seq  to anon, authenticated;
grant all on public.products to service_role;
grant all on public.product_sales to service_role;
grant all on public.product_sale_items to service_role;

alter table public.products           enable row level security;
alter table public.product_sales      enable row level security;
alter table public.product_sale_items enable row level security;

drop policy if exists "open_all_products" on public.products;
drop policy if exists "open_all_product_sales" on public.product_sales;
drop policy if exists "open_all_product_sale_items" on public.product_sale_items;

create policy "open_all_products"           on public.products           for all to anon, authenticated using (true) with check (true);
create policy "open_all_product_sales"      on public.product_sales      for all to anon, authenticated using (true) with check (true);
create policy "open_all_product_sale_items" on public.product_sale_items for all to anon, authenticated using (true) with check (true);

-- ============================================================
-- ขายสินค้าแบบ atomic (กันสต็อกติดลบเมื่อขายพร้อมกัน)
-- p_items = [{"product_id":"uuid","qty":2}, ...]
-- ============================================================
create or replace function public.sell_products(
  p_items jsonb,
  p_payment_method text default 'cash',
  p_paid_cash numeric default 0,
  p_paid_transfer numeric default 0,
  p_reservation_id uuid default null,
  p_pc_session_id uuid default null,
  p_machine_label text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_item jsonb;
  v_qty int;
  v_total numeric(10,2) := 0;
  v_prod public.products;
begin
  insert into public.product_sales(payment_method, paid_cash, paid_transfer, total,
                                  reservation_id, pc_session_id, machine_label, settled, status)
  values (p_payment_method, coalesce(p_paid_cash,0), coalesce(p_paid_transfer,0), 0,
          p_reservation_id, p_pc_session_id, p_machine_label,
          p_payment_method <> 'on_machine', 'paid')
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'qty')::int, 1);
    if v_qty <= 0 then
      raise exception 'จำนวนสินค้าไม่ถูกต้อง';
    end if;

    select * into v_prod from public.products
      where id = (v_item->>'product_id')::uuid for update;
    if not found then
      raise exception 'ไม่พบสินค้าในระบบ';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'สต็อกไม่พอ: % (เหลือ %)', v_prod.name, v_prod.stock;
    end if;

    insert into public.product_sale_items(sale_id, product_id, name, barcode, unit_price, qty, subtotal)
    values (v_sale_id, v_prod.id, v_prod.name, v_prod.barcode, v_prod.price, v_qty, v_prod.price * v_qty);

    update public.products
      set stock = stock - v_qty, updated_at = now()
      where id = v_prod.id;

    v_total := v_total + (v_prod.price * v_qty);
  end loop;

  update public.product_sales set total = v_total where id = v_sale_id;
  return v_sale_id;
end;
$$;

-- ยกเลิกบิลสินค้า 1 ใบ (คืนสต็อก)
create or replace function public.cancel_product_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.product_sales where id = p_sale_id and status = 'paid') then
    return;
  end if;

  update public.products p
    set stock = p.stock + i.qty, updated_at = now()
    from public.product_sale_items i
    where i.sale_id = p_sale_id and i.product_id = p.id;

  update public.product_sales
    set status = 'cancelled', settled = false, paid_cash = 0, paid_transfer = 0
    where id = p_sale_id;
end;
$$;

-- ยกเลิกรายการสินค้าทั้งหมดที่ผูกกับบิลเครื่อง (ใช้ตอนยกเลิกบิล)
create or replace function public.cancel_product_sales_for_bill(
  p_reservation_id uuid default null,
  p_pc_session_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  for v_id in
    select id from public.product_sales
    where status = 'paid'
      and ((p_reservation_id is not null and reservation_id = p_reservation_id)
        or (p_pc_session_id is not null and pc_session_id = p_pc_session_id))
  loop
    perform public.cancel_product_sale(v_id);
  end loop;
end;
$$;

-- ปิดยอดสินค้าที่ลงบิลเครื่องไว้ (ตอนเช็คบิลเครื่อง)
create or replace function public.settle_product_sales_for_bill(
  p_reservation_id uuid default null,
  p_pc_session_id uuid default null,
  p_method text default 'cash',
  p_cash numeric default null,
  p_transfer numeric default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(10,2);
  v_cash numeric(10,2);
  v_transfer numeric(10,2);
begin
  select coalesce(sum(total), 0) into v_total
    from public.product_sales
    where status = 'paid' and settled = false
      and ((p_reservation_id is not null and reservation_id = p_reservation_id)
        or (p_pc_session_id is not null and pc_session_id = p_pc_session_id));
  if v_total = 0 then
    return;
  end if;

  if p_method = 'cash' then
    v_cash := v_total; v_transfer := 0;
  elsif p_method = 'transfer' then
    v_cash := 0; v_transfer := v_total;
  elsif p_method = 'mixed' then
    v_cash := coalesce(p_cash, 0); v_transfer := coalesce(p_transfer, 0);
  else -- points / credit
    v_cash := 0; v_transfer := 0;
  end if;

  -- แบ่งเงินตามสัดส่วนของแต่ละบิลสินค้า
  update public.product_sales s
    set settled = true,
        payment_method = p_method,
        paid_cash = round(v_cash * (s.total / v_total), 2),
        paid_transfer = round(v_transfer * (s.total / v_total), 2)
    where s.status = 'paid' and s.settled = false
      and ((p_reservation_id is not null and s.reservation_id = p_reservation_id)
        or (p_pc_session_id is not null and s.pc_session_id = p_pc_session_id));
end;
$$;

grant execute on function public.sell_products(jsonb, text, numeric, numeric, uuid, uuid, text) to anon, authenticated;
grant execute on function public.cancel_product_sale(uuid) to anon, authenticated;
grant execute on function public.cancel_product_sales_for_bill(uuid, uuid) to anon, authenticated;
grant execute on function public.settle_product_sales_for_bill(uuid, uuid, text, numeric, numeric) to anon, authenticated;

-- Realtime
do $$
begin
  begin alter publication supabase_realtime add table public.products; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.product_sales; exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';
