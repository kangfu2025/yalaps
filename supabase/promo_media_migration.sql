-- ============================================================
-- จอลูกค้า: รองรับวิดีโอ YouTube และวิดีโอที่อัปโหลดเอง
-- รันครั้งเดียวใน Supabase SQL Editor — รันซ้ำได้ ไม่กระทบรูปเดิม
--
-- หลักการ:
--   1. ต่อยอดตาราง promo_images เดิม ไม่สร้างตารางใหม่
--      รูปที่มีอยู่จะกลายเป็น kind='image' อัตโนมัติ จอแสดงเหมือนเดิมเป๊ะ
--   2. วิดีโอที่อัปโหลดเก็บใน Supabase Storage ไม่ใช่ในแถวฐานข้อมูล
--      เพราะคลิปสั้น ๆ ก็ 10-20 MB ถ้าฝัง base64 ลงแถว จอจะดึงทั้งก้อน
--      ทุกครั้งที่โหลดใหม่
--   3. bucket เปิดอ่านสาธารณะ เพราะหน้า /display ไม่ได้ล็อกอิน
--      แต่การอัปโหลด/ลบ ต้องล็อกอินเท่านั้น
-- ============================================================

-- ------------------------------------------------------------
-- 1) ตารางสื่อบนจอลูกค้า (เผื่อโปรเจกต์ไหนยังไม่มี)
-- ------------------------------------------------------------
create table if not exists public.promo_images (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data_url text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) คอลัมน์ใหม่ — ทุกตัวมีค่าเริ่มต้น แถวเดิมจึงไม่กระทบ
-- ------------------------------------------------------------
alter table public.promo_images
  add column if not exists kind text not null default 'image',
  add column if not exists youtube_id  text,
  add column if not exists video_url   text,
  add column if not exists video_path  text,   -- path ใน Storage ไว้ลบไฟล์ตอนลบรายการ
  add column if not exists duration_sec int,   -- null = ใช้ค่าเริ่มต้นของชนิดนั้น
  add column if not exists fit text not null default 'contain';

-- data_url เดิมเป็น not null ในบางโปรเจกต์ — วิดีโอไม่มีค่านี้ จึงต้องปลดออก
alter table public.promo_images alter column data_url drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promo_images_kind_check') then
    alter table public.promo_images
      add constraint promo_images_kind_check check (kind in ('image', 'youtube', 'video'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'promo_images_fit_check') then
    alter table public.promo_images
      add constraint promo_images_fit_check check (fit in ('contain', 'cover'));
  end if;

  -- แต่ละชนิดต้องมีแหล่งสื่อของตัวเองครบ ไม่งั้นจอจะขึ้นช่องว่างเปล่า
  if not exists (select 1 from pg_constraint where conname = 'promo_images_source_check') then
    alter table public.promo_images
      add constraint promo_images_source_check check (
        (kind = 'image'   and data_url   is not null) or
        (kind = 'youtube' and youtube_id is not null) or
        (kind = 'video'   and video_url  is not null)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'promo_images_duration_check') then
    alter table public.promo_images
      add constraint promo_images_duration_check check (
        duration_sec is null or (duration_sec between 3 and 600)
      );
  end if;
end $$;

-- แถวเก่าทั้งหมดคือรูปภาพ และคงการแสดงผลแบบเดิม (เห็นทั้งภาพ ไม่ตัดขอบ)
update public.promo_images set kind = 'image' where kind is null or kind = '';
update public.promo_images set fit  = 'contain' where fit is null or fit = '';

create index if not exists promo_images_active_idx
  on public.promo_images (is_active, sort_order);

-- ------------------------------------------------------------
-- 3) ที่เก็บไฟล์วิดีโอ
--    ข้ามไปเงียบ ๆ ถ้าฐานข้อมูลไม่มี Storage (เช่น Postgres ธรรมดาตอนทดสอบ)
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'ไม่พบ Storage ในฐานข้อมูลนี้ — ข้ามขั้นตอนสร้าง bucket';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'promo-media', 'promo-media', true,
    52428800,  -- 50 MB = เพดานของแพลนฟรี ปรับขึ้นได้ถ้าอัปเกรดแพลน
    array['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
  )
  on conflict (id) do update
    set public = true,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- จอลูกค้าเปิดโดยไม่ล็อกอิน จึงต้องอ่านไฟล์ได้
  execute $p$
    drop policy if exists "promo_media_public_read" on storage.objects;
    create policy "promo_media_public_read" on storage.objects
      for select to public using (bucket_id = 'promo-media');
  $p$;

  -- อัปโหลด/แก้/ลบ เฉพาะคนที่ล็อกอินแล้ว (ตรงกับสิทธิ์หน้าจัดการรูปเดิม)
  execute $p$
    drop policy if exists "promo_media_staff_insert" on storage.objects;
    create policy "promo_media_staff_insert" on storage.objects
      for insert to authenticated with check (bucket_id = 'promo-media');
  $p$;

  execute $p$
    drop policy if exists "promo_media_staff_update" on storage.objects;
    create policy "promo_media_staff_update" on storage.objects
      for update to authenticated using (bucket_id = 'promo-media');
  $p$;

  execute $p$
    drop policy if exists "promo_media_staff_delete" on storage.objects;
    create policy "promo_media_staff_delete" on storage.objects
      for delete to authenticated using (bucket_id = 'promo-media');
  $p$;
end $$;

notify pgrst, 'reload schema';
