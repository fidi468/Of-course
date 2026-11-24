-- =====================================================================
-- Of Course — 04_lesson_rooms.sql
-- Video dərs otaqları cədvəli. 01_tables.sql və 02_security_functions.sql
-- -dən SONRA işlədilir. Təkrar işlətmək təhlükəsizdir (drop if exists).
--
-- Yalnız dərs iştirakçıları (tələbə və müəllim) otaq məlumatlarını
-- oxuya/yarada bilər. RLS bu məntiqi verilənlər bazası səviyyəsində təmin edir.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) lesson_rooms cədvəli
-- ---------------------------------------------------------------------
drop table if exists public.lesson_rooms cascade;

create table public.lesson_rooms (
  id                bigint generated always as identity primary key,
  lesson_request_id bigint not null references public.lesson_requests(id) on delete cascade,
  room_name         text   not null unique,
  -- Otağı yaradan istifadəçi (adətən dərsi qəbul edən tərəf)
  created_by        uuid   not null references public.profiles(id),
  created_at        timestamptz not null default now()
);

-- İndeks: lesson_request_id ilə sürətli axtarış
create index on public.lesson_rooms (lesson_request_id);
-- İndeks: room_name ilə unikal axtarış
create index on public.lesson_rooms (room_name);

-- ---------------------------------------------------------------------
-- 2) RLS aktivləşdir
-- ---------------------------------------------------------------------
alter table public.lesson_rooms enable row level security;

-- ---------------------------------------------------------------------
-- 3) RLS qaydaları
--    Yalnız həmin lesson_request-in requester_id və ya teacher_id-ə
--    bərabər olan auth.uid() olan istifadəçi select/insert edə bilər.
-- ---------------------------------------------------------------------
drop policy if exists "rooms_select_participants" on public.lesson_rooms;
create policy "rooms_select_participants" on public.lesson_rooms
  for select to authenticated
  using (
    exists (
      select 1 from public.lesson_requests lr
      where lr.id = lesson_rooms.lesson_request_id
        and (lr.requester_id = auth.uid() or lr.teacher_id = auth.uid())
    )
  );

drop policy if exists "rooms_insert_participants" on public.lesson_rooms;
create policy "rooms_insert_participants" on public.lesson_rooms
  for insert to authenticated
  with check (
    exists (
      select 1 from public.lesson_requests lr
      where lr.id = lesson_rooms.lesson_request_id
        and (lr.requester_id = auth.uid() or lr.teacher_id = auth.uid())
    )
    and created_by = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 4) İcazələr
-- ---------------------------------------------------------------------
revoke all on public.lesson_rooms from anon, authenticated;
grant select, insert on public.lesson_rooms to authenticated;
-- update və delete üçün icazə verilmir — otaq yaradılandan sonra
-- dəyişdirilə bilməz, yalnız lesson_request silinəndə cascade-lə silinir

commit;

-- =====================================================================
-- İstifadə təlimatı:
-- 1. Supabase dashboard → SQL Editor
-- 2. Bu faylın tam məzmununu yapışdırın
-- 3. Run klikləyin
-- 4. lesson_requests cədvəli artıq mövcuddursa (01_tables.sql işlədilibsə)
--    bu miqrasiya problemsiz işləyəcək
-- =====================================================================
