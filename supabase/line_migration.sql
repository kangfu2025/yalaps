-- ============================================================
-- แจ้งเตือนผ่าน LINE (Messaging API)  — รันครั้งเดียวใน Supabase SQL Editor
-- ปลอดภัย: รันซ้ำได้ ไม่กระทบตารางเดิม
--
-- หมายเหตุ: LINE Notify ปิดบริการไปแล้วตั้งแต่ 31 มี.ค. 2568
-- ต้องใช้ LINE Official Account + Messaging API แทน
--
-- Channel access token เก็บเป็น environment variable ฝั่งเซิร์ฟเวอร์
-- (LINE_CHANNEL_ACCESS_TOKEN) ไม่เก็บในตารางนี้ เพราะตารางนี้พนักงานทุกคนอ่านได้
-- ============================================================

create table if not exists public.line_config (
  id int primary key default 1,
  enabled boolean not null default false,
  target_id text,                       -- userId (Uxxxx) หรือ groupId (Cxxxx) ปลายทาง
  target_label text,                    -- ชื่อที่พนักงานตั้งไว้ให้จำง่าย
  events jsonb not null default '{
    "start": true,
    "extend": false,
    "checkout": true,
    "cancel": true,
    "member": false
  }'::jsonb,
  updated_at timestamptz not null default now(),
  constraint line_config_single check (id = 1)
);

insert into public.line_config(id) values (1) on conflict (id) do nothing;

-- บันทึกการส่งไว้ดูย้อนหลังและนับโควตา (แพ็กฟรีของ LINE ให้ 300 ข้อความ/เดือน)
create table if not exists public.line_logs (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  message text not null,
  ok boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists line_logs_created_idx on public.line_logs(created_at desc);

revoke all on public.line_config from anon;
revoke all on public.line_logs   from anon;

grant select, insert, update on public.line_config to authenticated;
grant select, insert on public.line_logs to authenticated;
grant all on public.line_config to service_role;
grant all on public.line_logs   to service_role;

alter table public.line_config enable row level security;
alter table public.line_logs   enable row level security;

drop policy if exists "line_config_staff" on public.line_config;
create policy "line_config_staff" on public.line_config
  for all to authenticated using (true) with check (true);

drop policy if exists "line_logs_staff" on public.line_logs;
create policy "line_logs_staff" on public.line_logs
  for all to authenticated using (true) with check (true);

-- จำนวนข้อความที่ส่งสำเร็จในเดือนนี้ (ไว้เตือนก่อนโควตาฟรีหมด)
create or replace function public.line_usage_this_month()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.line_logs
  where ok = true
    and created_at >= date_trunc('month', now() at time zone 'Asia/Bangkok')
$$;

grant execute on function public.line_usage_this_month() to authenticated;

notify pgrst, 'reload schema';
