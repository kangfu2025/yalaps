-- ============================================================
-- อันดับลูกค้าประจำ (Customer Ranking)  — รันใน Supabase SQL Editor
-- รันหลัง members_migration.sql · รันซ้ำได้ ไม่พัง
--
-- ใช้ระบบสมาชิก/แต้มเดิมทั้งหมด ไฟล์นี้ "เพิ่ม" อย่างเดียว:
--   1) คอลัมน์ใหม่ในตาราง members: ชื่อที่แสดงบนอันดับ, ยินยอมให้แสดง, รูปโปรไฟล์
--   2) ที่เก็บรูป member-avatars (อัปโหลด/เปลี่ยน/ลบ ได้เฉพาะแอดมิน)
--   3) ฟังก์ชันอ่านอันดับ (อ่านอย่างเดียว ไม่แตะแต้ม)
--      - ranking_list   : หน้าแอดมิน/พนักงาน เห็นชื่อจริงและคนที่ไม่ได้ยินยอม
--      - ranking_public : จอลูกค้า (ไม่ต้องล็อกอิน) เห็นเฉพาะชื่อที่แสดง รูป แต้ม อันดับ
--
-- กติกาที่ผู้ใช้เลือก (ต.ค. 2569):
--   ตลอดกาล  = members.lifetime_points (แต้มที่เคยได้ทั้งหมด แลกแต้มแล้วอันดับไม่ตก)
--   รายเดือน = ผลรวมแต้ม reason = 'earn_play' ที่ได้ในเดือนนั้น (เวลา Asia/Bangkok)
--              ไม่นับแต้มที่แอดมินปรับมือ/คืนแต้ม
--   จอสาธารณะแสดงเฉพาะสมาชิกที่ยินยอมและตั้งชื่อที่แสดงแล้วเท่านั้น
-- ============================================================

-- ---------- 1) คอลัมน์ใหม่ ----------
alter table public.members add column if not exists display_name      text;
alter table public.members add column if not exists show_on_ranking   boolean not null default false;
alter table public.members add column if not exists ranking_consent_at timestamptz;
alter table public.members add column if not exists avatar_url        text;
alter table public.members add column if not exists avatar_path       text;

comment on column public.members.display_name is
  'ชื่อเล่น/ชื่อที่สมาชิกยินยอมให้แสดงบนจออันดับ (ไม่ใช่ชื่อจริง)';
comment on column public.members.show_on_ranking is
  'สมาชิกยินยอมให้แสดงบนจออันดับสาธารณะ — ค่าเริ่มต้น false';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'members_display_name_len') then
    alter table public.members
      add constraint members_display_name_len
      check (display_name is null or char_length(display_name) between 1 and 24);
  end if;
  -- ยินยอมแสดงอันดับ ต้องมีชื่อที่แสดงเสมอ — กันจอสาธารณะดึงชื่อจริงไปโชว์
  if not exists (select 1 from pg_constraint where conname = 'members_ranking_needs_name') then
    alter table public.members
      add constraint members_ranking_needs_name
      check (not show_on_ranking or (display_name is not null and btrim(display_name) <> ''));
  end if;
end $$;

-- ช่วยคิดอันดับรายเดือน (แต้มจากการเล่นเรียงตามเวลา)
create index if not exists point_tx_earn_date_idx
  on public.point_transactions(created_at, member_id)
  where reason = 'earn_play';

-- ---------- สิทธิ์แอดมิน ----------
create or replace function public.ranking_is_admin()
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
    return true;  -- ระบบที่ยังไม่มีการแบ่งสิทธิ์ ถือว่าทุกคนที่ล็อกอินเป็นแอดมิน (เหมือน fin_is_admin)
  end if;
  execute 'select exists(select 1 from public.user_roles where user_id = $1 and role = ''admin'')'
    into v_ok using auth.uid();
  return coalesce(v_ok, false);
end;
$$;
revoke all on function public.ranking_is_admin() from public, anon;
grant execute on function public.ranking_is_admin() to authenticated;

-- ---------- รูปโปรไฟล์: แก้ได้เฉพาะแอดมิน ----------
-- ตาราง members เปิดให้พนักงานแก้ได้อยู่แล้ว (ชื่อ เบอร์ หมายเหตุ) จึงกันเฉพาะคอลัมน์รูป
-- และจด/ล้างเวลายินยอมให้อัตโนมัติ
create or replace function public.members_ranking_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.avatar_url is distinct from old.avatar_url
      or new.avatar_path is distinct from old.avatar_path)
     and auth.uid() is not null           -- คำสั่งจาก SQL Editor / service role ผ่านได้
     and not public.ranking_is_admin() then
    raise exception 'เฉพาะแอดมินเท่านั้นที่เพิ่ม/เปลี่ยน/ลบรูปสมาชิกได้'
      using errcode = '42501';
  end if;

  if new.display_name is not null then
    new.display_name := nullif(btrim(new.display_name), '');
  end if;

  if new.show_on_ranking and not old.show_on_ranking then
    new.ranking_consent_at := now();
  elsif not new.show_on_ranking then
    new.ranking_consent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists members_ranking_guard on public.members;
create trigger members_ranking_guard
  before update on public.members
  for each row execute function public.members_ranking_guard();

-- สมัครใหม่พร้อมยินยอม (ถ้ามีในอนาคต) ให้จดเวลาด้วย
create or replace function public.members_ranking_guard_ins()
returns trigger
language plpgsql
as $$
begin
  if new.display_name is not null then
    new.display_name := nullif(btrim(new.display_name), '');
  end if;
  new.ranking_consent_at := case when new.show_on_ranking then now() else null end;
  return new;
end;
$$;

drop trigger if exists members_ranking_guard_ins on public.members;
create trigger members_ranking_guard_ins
  before insert on public.members
  for each row execute function public.members_ranking_guard_ins();

-- ---------- แกนกลางคิดอันดับ (ใช้ร่วมกันทั้งสองฟังก์ชัน ไม่ให้คิดคนละสูตร) ----------
-- คืนสมาชิกที่มีแต้ม > 0 ในช่วงที่เลือก เรียงจากมากไปน้อย
-- เสมอกัน: ใครทำแต้มถึงก่อนอยู่บน (last_earned_at เก่ากว่า) แต่ได้เลขอันดับเท่ากัน
create or replace function public.ranking_rows(
  p_period text,
  p_month  text,
  p_public boolean
)
returns table (
  rank            int,
  member_id       uuid,
  name            text,
  display_name    text,
  show_on_ranking boolean,
  avatar_url      text,
  points          int,
  last_earned_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  if p_period = 'month' then
    if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
      raise exception 'รูปแบบเดือนไม่ถูกต้อง (ต้องเป็น YYYY-MM)';
    end if;
    v_from := (p_month || '-01')::date::timestamp at time zone 'Asia/Bangkok';
    v_to   := ((p_month || '-01')::date + interval '1 month')::timestamp at time zone 'Asia/Bangkok';

    return query
      with earned as (
        select t.member_id as mid,
               sum(t.delta)::int as pts,
               max(t.created_at) as last_at
        from public.point_transactions t
        where t.reason = 'earn_play'
          and t.created_at >= v_from
          and t.created_at <  v_to
        group by t.member_id
      ),
      pool as (
        select m.id, m.name, m.display_name, m.show_on_ranking, m.avatar_url,
               e.pts, e.last_at
        from earned e
        join public.members m on m.id = e.mid
        where m.active
          and e.pts > 0
          and (not p_public or (m.show_on_ranking and m.display_name is not null))
      )
      select (rank() over (order by p.pts desc))::int,
             p.id, p.name, p.display_name, p.show_on_ranking, p.avatar_url, p.pts, p.last_at
      from pool p
      order by p.pts desc, p.last_at asc, p.id;
  elsif p_period = 'all' then
    return query
      with last_earn as (
        select t.member_id as mid, max(t.created_at) as last_at
        from public.point_transactions t
        where t.reason in ('earn_play', 'manual_adjust') and t.delta > 0
        group by t.member_id
      ),
      pool as (
        select m.id, m.name, m.display_name, m.show_on_ranking, m.avatar_url,
               m.lifetime_points as pts,
               coalesce(l.last_at, m.created_at) as last_at
        from public.members m
        left join last_earn l on l.mid = m.id
        where m.active
          and m.lifetime_points > 0
          and (not p_public or (m.show_on_ranking and m.display_name is not null))
      )
      select (rank() over (order by p.pts desc))::int,
             p.id, p.name, p.display_name, p.show_on_ranking, p.avatar_url, p.pts, p.last_at
      from pool p
      order by p.pts desc, p.last_at asc, p.id;
  else
    raise exception 'ช่วงเวลาไม่ถูกต้อง (ใช้ month หรือ all)';
  end if;
end;
$$;
-- ห้ามเรียกตรงจากภายนอก: ตัวนี้คืนชื่อจริงได้
revoke all on function public.ranking_rows(text, text, boolean) from public, anon, authenticated;

-- เดือนปัจจุบันตามเวลาไทย
create or replace function public.ranking_current_month()
returns text
language sql
stable
as $$
  select to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
$$;

-- ---------- 2) สำหรับหน้าแอดมิน/พนักงาน ----------
-- เห็นทุกคน (รวมคนที่ไม่ได้ยินยอม) พร้อมชื่อจริง — แต่ไม่ส่งเบอร์โทร
create or replace function public.ranking_list(
  p_period text default 'month',
  p_month  text default null,
  p_limit  int  default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month text := coalesce(nullif(p_month, ''), public.ranking_current_month());
  v_limit int  := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_rows  jsonb;
  v_total int;
begin
  if auth.uid() is null then
    raise exception 'ต้องล็อกอินก่อน' using errcode = '42501';
  end if;

  select count(*)::int,
         coalesce(jsonb_agg(to_jsonb(r) order by r.ord) filter (where r.ord <= v_limit), '[]'::jsonb)
    into v_total, v_rows
  from (
    select x.*, row_number() over (order by x.points desc, x.last_earned_at asc, x.member_id) as ord
    from public.ranking_rows(p_period, v_month, false) x
  ) r;

  return jsonb_build_object(
    'period', p_period,
    'month', case when p_period = 'month' then v_month end,
    'total', v_total,
    'generated_at', now(),
    'rows', v_rows
  );
end;
$$;
revoke all on function public.ranking_list(text, text, int) from public, anon;
grant execute on function public.ranking_list(text, text, int) to authenticated;

-- ---------- 3) สำหรับจอลูกค้า (ไม่ต้องล็อกอิน) ----------
-- คืนเฉพาะ: อันดับ, ชื่อที่แสดง, รูป, แต้ม — ไม่มี id, ชื่อจริง, เบอร์โทร
-- อันดับนับเฉพาะคนที่ยินยอม จอจึงเรียง 1,2,3,... ต่อเนื่อง
create or replace function public.ranking_public(
  p_period text default 'month',
  p_month  text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month text := coalesce(nullif(p_month, ''), public.ranking_current_month());
  v_rows  jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', r.rank,
           'name', r.display_name,
           'avatar_url', r.avatar_url,
           'points', r.points
         ) order by r.ord), '[]'::jsonb)
    into v_rows
  from (
    select x.*, row_number() over (order by x.points desc, x.last_earned_at asc, x.member_id) as ord
    from public.ranking_rows(p_period, v_month, true) x
  ) r
  where r.ord <= 20;

  return jsonb_build_object(
    'period', p_period,
    'month', case when p_period = 'month' then v_month end,
    'generated_at', now(),
    'rows', v_rows
  );
end;
$$;
revoke all on function public.ranking_public(text, text) from public;
grant execute on function public.ranking_public(text, text) to anon, authenticated;

-- ---------- ที่เก็บรูปสมาชิก ----------
-- bucket แบบ public: จอลูกค้าโหลดรูปได้โดยไม่ล็อกอิน (ชื่อไฟล์สุ่ม เดาไม่ได้)
-- ไม่มี policy ให้ anon "list" ไฟล์ จึงไล่ดูรูปทั้งหมดไม่ได้
-- อัปโหลด/เปลี่ยน/ลบ ได้เฉพาะแอดมิน
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'ไม่พบ Storage ในฐานข้อมูลนี้ — ข้ามขั้นตอนสร้าง bucket';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'member-avatars', 'member-avatars', true,
    2097152,  -- 2 MB (หน้าเว็บย่อรูปเหลือราว 100–200 KB ก่อนอัปโหลดอยู่แล้ว)
    array['image/webp', 'image/jpeg', 'image/png']
  )
  on conflict (id) do update
    set public = true,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute $p$
    drop policy if exists "member_avatars_staff_read" on storage.objects;
    create policy "member_avatars_staff_read" on storage.objects
      for select to authenticated using (bucket_id = 'member-avatars');
  $p$;

  execute $p$
    drop policy if exists "member_avatars_admin_insert" on storage.objects;
    create policy "member_avatars_admin_insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'member-avatars' and public.ranking_is_admin());
  $p$;

  execute $p$
    drop policy if exists "member_avatars_admin_update" on storage.objects;
    create policy "member_avatars_admin_update" on storage.objects
      for update to authenticated
      using (bucket_id = 'member-avatars' and public.ranking_is_admin());
  $p$;

  execute $p$
    drop policy if exists "member_avatars_admin_delete" on storage.objects;
    create policy "member_avatars_admin_delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'member-avatars' and public.ranking_is_admin());
  $p$;
end $$;

notify pgrst, 'reload schema';
