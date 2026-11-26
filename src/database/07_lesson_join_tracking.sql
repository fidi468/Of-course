-- =====================================================================
-- Of Course — 07_lesson_join_tracking.sql
-- AUDIT FIX: start_lesson artıq hər iki iştirakçının qoşulmasını tələb edir.
--
-- Problem (audit-də tapıldı):
--   start_lesson yalnız bir iştirakçının çağırışını kifayət sayırdı.
--   Tələb: "Hər iki iştirakçı video otağına qoşulduqda dərsin
--   başlama vaxtını server tərəfindən qeydə al."
--
-- Həll:
--   1. lesson_rooms-ə teacher_joined_at, student_joined_at sütunları
--   2. Yeni RPC: mark_joined(p_request_id) — hər iştirakçı otağa daxil
--      olanda çağırır. İkisi də qoşulanda lesson_started_at avtomatik
--      set olunur.
--   3. start_lesson artıq deprecated (mark_joined əvəz edir), amma
--      backwards compatibility üçün saxlanılır.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) lesson_rooms-ə qoşulma vaxt sütunları
-- ---------------------------------------------------------------------
alter table public.lesson_rooms
  add column if not exists teacher_joined_at timestamptz,
  add column if not exists student_joined_at timestamptz;

-- ---------------------------------------------------------------------
-- 2) mark_joined RPC
--    Hər iştirakçı otağa daxil olanda çağırır.
--    İkisi də qoşulanda lesson_started_at avtomatik set olunur.
-- ---------------------------------------------------------------------
create or replace function public.mark_joined(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r     public.lesson_requests;
  room  public.lesson_rooms;
  is_teacher boolean;
begin
  -- 1) lesson_request-i yoxla
  select * into r from public.lesson_requests where id = p_request_id for update;
  if not found then raise exception 'Sorğu tapılmadı'; end if;

  -- Təhlükəsizlik: yalnız iştirakçılar
  if auth.uid() not in (r.requester_id, r.teacher_id) then
    raise exception 'İcazə yoxdur';
  end if;

  -- Status yoxlaması
  if r.status <> 'accepted' then
    raise exception 'Dərs əvvəlcə qəbul edilməlidir';
  end if;

  -- 2) Otağı tap
  select * into room from public.lesson_rooms
   where lesson_request_id = p_request_id for update;

  if not found then
    raise exception 'Otaq tapılmadı';
  end if;

  -- 3) İştirakçının qoşulma vaxtını qeyd et
  is_teacher := (auth.uid() = r.teacher_id);

  if is_teacher and room.teacher_joined_at is null then
    update public.lesson_rooms
       set teacher_joined_at = now()
     where id = room.id;
    room.teacher_joined_at := now();  -- köhnə dəyişən deyil, təzə dəyər istifadə olunmalıdır
  elsif not is_teacher and room.student_joined_at is null then
    update public.lesson_rooms
       set student_joined_at = now()
     where id = room.id;
    room.student_joined_at := now();  -- köhnə dəyişən deyil, təzə dəyər istifadə olunmalıdır
  end if;

  -- 4) Əgər hər ikisi qoşulubsa və lesson_started_at hələ set deyilsə
  --    lesson_started_at = now() qoy
  if room.teacher_joined_at is not null
     and room.student_joined_at is not null
     and r.lesson_started_at is null then

    -- İlk qoşulma vaxtını deyil, İKİNCİ qoşulma vaxtını götürürük
    -- (dərs yalnız hər ikisi olanda başlayır)
    update public.lesson_requests
       set lesson_started_at = greatest(room.teacher_joined_at, room.student_joined_at)
     where id = p_request_id;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3) start_lesson-i mark_joined-ə yönləndir (backwards compat)
--    Artıq birbaşa lesson_started_at set etmir — mark_joined vasitəsilə
-- ---------------------------------------------------------------------
create or replace function public.start_lesson(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- mark_joined-i çağır — o özü hər iki iştirakçı yoxlayır
  perform public.mark_joined(p_request_id);
end;
$function$;

-- ---------------------------------------------------------------------
-- 4) İcazələr
-- ---------------------------------------------------------------------
revoke execute on function public.mark_joined(bigint) from public, anon;
revoke execute on function public.start_lesson(bigint) from public, anon;

grant execute on function public.mark_joined(bigint) to authenticated;
grant execute on function public.start_lesson(bigint) to authenticated;

commit;

-- =====================================================================
-- Test ssenariləri:
-- 1. Tələbə mark_joined çağırır → student_joined_at set, lesson_started_at NULL qalır
-- 2. Müəllim mark_joined çağırır → teacher_joined_at set, lesson_started_at NULL qalır
-- 3. İkisi də çağırdıqdan sonra → lesson_started_at = greatest(both joined) set
-- 4. Təkrar çağırış → idempotent (xəta yox)
-- =====================================================================
