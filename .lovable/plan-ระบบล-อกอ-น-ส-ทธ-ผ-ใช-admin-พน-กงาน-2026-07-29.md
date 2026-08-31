# ระบบล็อกอิน + สิทธิ์ผู้ใช้ (Admin / พนักงาน)

เพิ่มการล็อกอินก่อนใช้งานระบบทั้งหมด แบ่งสิทธิ์เป็น 2 ระดับ:

- **Admin** — เห็นทุกแท็บ (แดชบอร์ด PS5, PC, คูปอง, คิวจอง, โปรโมชั่น, รูปหน้าจอ, บัญชี/สรุปยอด) และเข้าหน้า `/display`, `/customer-screen` ได้
- **พนักงาน (staff)** — เห็นเฉพาะ **แดชบอร์ด PS5** และ **โซน PC** เท่านั้น แท็บอื่นถูกซ่อน

หน้า `/display` และ `/customer-screen` (จอลูกค้า/ESP32) เปิดสาธารณะเหมือนเดิม (ไม่ต้องล็อกอิน) เพราะเป็นจอแสดงผลหน้าร้าน

## วิธีล็อกอิน

- ใช้ **Username + รหัสผ่าน** (ไม่ใช้อีเมล)
- ภายในระบบจะ map username → อีเมลปลอม `username@yala.local` เพื่อใช้กับ Supabase Auth (ผู้ใช้ไม่เห็น ไม่ต้องยืนยันอีเมล)
- ปิด public signup — เฉพาะ Admin สร้างบัญชีพนักงานได้จากในระบบ

## บัญชี Admin แรก

- Username: `kangfu`
- Email ที่ผูกไว้จริงใน Supabase: **kangfu2025@gmail.com** (ตามที่ระบุ)
- Admin ตั้งรหัสผ่านเองครั้งแรกผ่าน Supabase Dashboard หรือหน้า "ลืมรหัสผ่าน" (ทีมแจ้งได้ภายหลัง)
- Role `admin` ถูก seed ผ่าน SQL migration

## โครงสร้างฐานข้อมูล

- `public.app_role` enum: `admin | staff`
- `public.user_roles(user_id, role)` + unique `(user_id, role)` — เก็บ role แยกจาก profile กันการยกระดับสิทธิ์
- `public.profiles(id, username, display_name)` — เก็บ username เพื่อโชว์ในหัวจอ
- Trigger `on auth.users insert` → สร้าง profile อัตโนมัติจาก `raw_user_meta_data.username`
- Security definer function `public.has_role(_uid, _role)` สำหรับใช้ใน RLS
- RLS: user อ่าน/อัปเดต profile ตัวเองได้, อ่าน role ตัวเองได้; Admin เห็น/แก้ทั้งหมด
- Seed: หา user ที่มี email = `kangfu2025@gmail.com` แล้ว insert `('<uid>', 'admin')` ให้ (idempotent)

หมายเหตุ: ตารางธุรกิจเดิม (machines, reservations, pc_sessions, billing_logs, coupons, promotions ฯลฯ) ยังใช้ anon key เหมือนเดิม ไม่แตะ RLS ของตารางเหล่านี้ในรอบนี้เพื่อไม่ให้กระทบการทำงาน — การจำกัดสิทธิ์ทำที่ **UI-level** (ซ่อนแท็บ + route guard)

## เส้นทางในแอป

- `/auth` — หน้าล็อกอินสาธารณะ (username + password)
- `/` และหน้าอื่นๆ ในระบบแอดมิน → ต้องล็อกอิน; ถ้ายังไม่ล็อกอิน redirect ไป `/auth`
- `/display`, `/customer-screen` — **ยกเว้น** ไม่บังคับล็อกอิน (จอหน้าร้าน)
- แท็บใน `src/routes/index.tsx`:
  - Admin: เห็นทุกแท็บเหมือนเดิม
  - Staff: เห็นเฉพาะ `dash` และ `pc`; ถ้าพยายามเข้า tab อื่นด้วย state จะถูก clamp กลับเป็น `dash`

## หน้าจัดการบัญชีพนักงาน (Admin เท่านั้น)

เพิ่มแท็บ **"ผู้ใช้งาน"** ใน navbar/แท็บ (แสดงเฉพาะ Admin):

- ลิสต์บัญชีทั้งหมด: username, role, สร้างเมื่อ
- ปุ่ม **เพิ่มพนักงาน**: กรอก username + รหัสผ่าน → เรียก server function สร้าง auth user (ใช้ service role) + set role = `staff`
- ปุ่ม **รีเซ็ตรหัสผ่าน** ต่อบัญชี
- ปุ่ม **ลบบัญชี** (ยืนยันก่อนลบ) — Admin ลบตัวเองไม่ได้
- Admin เปลี่ยน role พนักงาน ↔ admin ได้

## UI/UX

- Navbar เพิ่มมุมขวา: แสดง username + role badge + ปุ่ม **ออกจากระบบ**
- หน้า `/auth` ใช้ธีมเดียวกับระบบ (Prompt font, dark card, ปุ่มสีน้ำเงินเดียวกับ navbar-yala)

## รายละเอียดทางเทคนิค

- **Auth client**: ใช้ `@/lib/supabase.ts` (Supabase JS) แต่ **เปิด** `persistSession: true, autoRefreshToken: true` (ปัจจุบันเป็น false) เพื่อจำ session ข้ามรีเฟรช
- **AuthProvider** (`src/lib/auth.tsx`): context ที่ให้ `{ user, role, loading, signIn, signOut }` — ใช้ `onAuthStateChange` + `getUser()` โหลด role จาก `user_roles` — mount ใน `src/routes/__root.tsx`
- **Route guard**: helper component `<RequireAuth>` และ `<RequireRole role="admin">` wrap เนื้อหาใน `src/routes/index.tsx` (หน้า admin) — ไม่แตะ `/display`, `/customer-screen`
- **Admin server functions** (`src/lib/admin.functions.ts`): 
  - `createStaff({ username, password })` — verify caller เป็น admin ผ่าน `requireSupabaseAuth` context, แล้ว `await import('@/integrations/supabase/client.server')` ใช้ `supabaseAdmin.auth.admin.createUser` + insert `user_roles`
  - `resetPassword({ userId, password })`, `deleteUser({ userId })`, `setRole({ userId, role })` — pattern เดียวกัน
  - ทั้งหมดตรวจ `has_role(auth.uid(),'admin')` ผ่าน context.supabase ก่อนใช้ admin client
- **Middleware**: append `attachSupabaseAuth` ใน `src/start.ts` (ถ้ายังไม่มี) เพื่อแนบ bearer token ให้ protected server fn
- **SQL migration** ใหม่: enum + tables + RLS + trigger + seed admin role — ต้องมี `GRANT SELECT ON public.user_roles TO authenticated;` และ `GRANT ALL ON ... TO service_role;`
- **ตารางธุรกิจอื่น**: ไม่เปลี่ยน RLS ในรอบนี้ (จำกัดสิทธิ์ระดับ UI) — เพิ่ม note ไว้ว่ารอบต่อไปควรย้ายไป bearer-based RLS

## สิ่งที่ต้องทำก่อนใช้งาน

1. รัน SQL migration ที่ระบบสร้างให้ (จะรันอัตโนมัติเมื่อ approve plan)
2. เข้า Supabase Dashboard → Authentication → เพิ่มผู้ใช้ `kangfu2025@gmail.com` ตั้งรหัสผ่านครั้งแรก (หรือใช้ "ลืมรหัสผ่าน")
   - trigger จะสร้าง profile ให้เอง; migration จะ seed role admin ให้อัตโนมัติเมื่อพบ user นี้
3. ล็อกอินด้วย username `kangfu` (หรือ email ก็ได้ ระบบจะรับทั้งคู่) แล้วเพิ่มบัญชีพนักงานจากแท็บ "ผู้ใช้งาน"
