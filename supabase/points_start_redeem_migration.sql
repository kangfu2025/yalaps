-- ============================================================
-- แลกแต้มตั้งแต่ตอนเปิดเครื่อง (ไม่ใช่แค่ตอนปิดบิล)
-- รันหลัง members_migration.sql — รันซ้ำได้ ไม่พัง
-- ============================================================

-- เก็บผลการแลกแต้มไว้ที่บิลเลย เพื่อให้ตอนปิดบิลรู้ว่า
-- บิลนี้หักแต้มไปแล้ว ต้องให้ส่วนลดต่อ และห้ามหักแต้มซ้ำ
alter table public.reservations
  add column if not exists points_discount numeric(10,2) not null default 0,
  add column if not exists points_spent    int           not null default 0;

comment on column public.reservations.points_discount is
  'ส่วนลดจากการแลกแต้ม (บาท) ที่หักไปแล้วตอนเปิดเครื่อง';
comment on column public.reservations.points_spent is
  'จำนวนแต้มที่หักไปกับบิลนี้ 0 = ยังไม่ได้แลก';

-- ---------- คืนแต้ม เมื่อสร้างบิลไม่สำเร็จหลังหักแต้มไปแล้ว ----------
-- ใช้เป็นการชดเชย ไม่ใช่การปรับแต้มด้วยมือ จึงแยกฟังก์ชันออกมา
-- เพื่อให้ประวัติแต้มอ่านออกว่าเกิดอะไรขึ้น
create or replace function public.member_refund_points(
  p_member_id uuid,
  p_points    int,
  p_note      text default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_points int;
begin
  if p_points is null or p_points <= 0 then
    raise exception 'จำนวนแต้มที่คืนต้องมากกว่า 0';
  end if;

  update public.members
    set points = points + p_points, updated_at = now()
    where id = p_member_id
    returning points into v_points;
  if v_points is null then raise exception 'ไม่พบสมาชิก'; end if;

  insert into public.point_transactions(
    member_id, delta, balance_after, reason, note)
  values (p_member_id, p_points, v_points, 'manual_adjust',
          coalesce(p_note, 'คืนแต้ม (เปิดบิลไม่สำเร็จ)'));

  return v_points;
end;
$$;

revoke all on function public.member_refund_points(uuid, int, text) from public, anon;
grant execute on function public.member_refund_points(uuid, int, text) to authenticated;
