-- ============================================================
-- ธีมของร้าน (ใช้ร่วมกันทุกจอ) — รันใน Supabase SQL Editor · รันซ้ำได้ ไม่พัง
--
-- เก็บค่าธีมไว้ที่เดียว แอดมินกดสลับครั้งเดียว ทุกเครื่องเปลี่ยนตามทันที
-- รวมถึงจอลูกค้า /display และจออันดับ /ranking ที่ไม่ได้ล็อกอิน (อ่านได้อย่างเดียว)
--   'vice'    = ธีม Vice Night (นีออนซันเซ็ต)
--   'classic' = ธีมม่วง-ฟ้าแบบเดิม
-- ============================================================

create table if not exists public.app_settings (
  id          int primary key default 1 check (id = 1),
  theme       text not null default 'vice' check (theme in ('classic', 'vice')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

grant select on public.app_settings to anon, authenticated;
revoke insert, update, delete on public.app_settings from anon, authenticated;
grant all on public.app_settings to service_role;
alter table public.app_settings enable row level security;

drop policy if exists "app_settings_read" on public.app_settings;
create policy "app_settings_read" on public.app_settings
  for select to anon, authenticated using (true);
-- ไม่มี policy เขียน: เปลี่ยนได้ผ่าน set_app_theme() เท่านั้น

-- เปลี่ยนธีม — แอดมินเท่านั้น
create or replace function public.set_app_theme(p_theme text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := false;
begin
  if auth.uid() is null then
    raise exception 'ต้องล็อกอินก่อน' using errcode = '42501';
  end if;
  if to_regclass('public.user_roles') is null then
    v_admin := true;
  else
    execute 'select exists (select 1 from public.user_roles where user_id = $1 and role::text = ''admin'')'
      into v_admin using auth.uid();
  end if;
  if not v_admin then
    raise exception 'เปลี่ยนธีมได้เฉพาะแอดมิน' using errcode = '42501';
  end if;
  if p_theme not in ('classic', 'vice') then
    raise exception 'ไม่รู้จักธีม %', p_theme;
  end if;

  update public.app_settings
     set theme = p_theme, updated_at = now(), updated_by = auth.uid()
   where id = 1;
  return p_theme;
end;
$$;
revoke all on function public.set_app_theme(text) from public, anon;
grant execute on function public.set_app_theme(text) to authenticated;

-- ให้ทุกจอรู้ทันทีเมื่อสลับธีม (Realtime)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings'
     ) then
    execute 'alter publication supabase_realtime add table public.app_settings';
  end if;
end;
$$;

notify pgrst, 'reload schema';
