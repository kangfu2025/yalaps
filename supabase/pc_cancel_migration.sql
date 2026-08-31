-- อนุญาตสถานะ 'cancelled' (ยกเลิกบิล) ให้กับ pc_sessions
-- รันใน Supabase SQL Editor ครั้งเดียว (ปลอดภัยถ้ารันซ้ำ)

alter table public.pc_sessions drop constraint if exists pc_sessions_status_check;
alter table public.pc_sessions
  add constraint pc_sessions_status_check
  check (status in ('playing','ended','force_ended','cancelled'));

notify pgrst, 'reload schema';
