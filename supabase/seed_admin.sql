-- ============================================================
-- กำหนดสิทธิ์ Admin ให้ kangfu2025@gmail.com
-- รันหลังจากสร้าง user ใน Supabase Auth แล้ว
-- ============================================================

-- 1) backfill profile (เผื่อ user ถูกสร้างก่อนมี trigger)
insert into public.profiles (id, username, display_name)
select u.id,
       coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
       coalesce(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- 2) ให้สิทธิ์ admin
insert into public.user_roles (user_id, role)
select id, 'admin'::public.app_role
from auth.users
where lower(email) = 'kangfu2025@gmail.com'
on conflict (user_id, role) do nothing;

-- 3) ตรวจสอบผล — ต้องได้ 1 แถว role = admin
select u.email, r.role
from auth.users u
join public.user_roles r on r.user_id = u.id
where lower(u.email) = 'kangfu2025@gmail.com';

notify pgrst, 'reload schema';
