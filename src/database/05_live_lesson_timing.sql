-- =====================================================================
-- Of Course — 05_live_lesson_timing.sql
-- Live Lessons vaxt izləməsi və təhlükəsiz kredit köçürmə.
-- 01-04 miqrasiyalarından SONRA işlədilir. Təkrar işlətmək təhlükəsizdir.
--
-- Dəyişikliklər:
-- 1. lesson_requests-ə lesson_started_at, lesson_ended_at sütunları
-- 2. Yeni RPC: start_lesson — dərsin başlama vaxtını qeyd edir
-- 3. Modifikasiya olunmuş complete_lesson — vaxt yoxlaması ilə
-- 4. Yeni RPC: get_lesson_timing — frontend countdown üçün
--
-- Təhlükəsizlik:
-- - Kredit köçürülməsi yalnız server tərəfindən (RPC içində)
-- - complete_lesson yalnız dərs müddəti tamamlandıqdan sonra işləyir
-- - İdempotent: eyni dərs iki dəfə tamamlana bilməz
-- - Atomik: balans yenilənməsi və status dəyişməsi bir əməliyyatda
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) lesson_requests-ə vaxt sütunları əlavə et
-- ---------------------------------------------------------------------
alter table public.lesson_requests
  add column if not exists lesson_started_at timestamptz,
  add column if not exists lesson_ended_at   timestamptz;

-- ---------------------------------------------------------------------
-- 2) start_lesson RPC
--    Dərsin başlama vaxtını qeyd edir. İştirakçılardan hər biri çağıra bilər.
--    Yalnız 'accepted' statuslu dərslər üçün işləyir.
--    İdempotent: əgər artıq başlamışsa, xəta vermir.
-- ---------------------------------------------------------------------
create or replace function public.start_lesson(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare r public.lesson_requests;
begin
  select * into r from public.lesson_requests where id = p_request_id for update;
  if not found then raise exception 'Sorğu tapılmadı'; end if;

  -- Təhlükəsizlik: yalnız iştirakçılar başlada bilər
  if auth.uid() not in (r.requester_id, r.teacher_id) then
    raise exception 'İcazə yoxdur';
  end if;

  -- Yalnız accepted statuslu dərslər
  if r.status <> 'accepted' then
    raise exception 'Dərs əvvəlcə qəbul edilməlidir';
  end if;

  -- İdempotent: əgər artıq başlamışsa, heç nə etmə
  if r.lesson_started_at is not null then
    return;
  end if;

  update public.lesson_requests
     set lesson_started_at = now()
   where id = p_request_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3) Modifikasiya olunmuş complete_lesson
--    Vaxt yoxlaması əlavə olunub: dərs müddəti tamamlanmalıdır
--    Brauzerin timer-i kredit köçürməsinə qərar vermir — server yoxlayır
-- ---------------------------------------------------------------------
create or replace function public.complete_lesson(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r   public.lesson_requests;
  bal integer;
  elapsed_minutes integer;
  required_minutes integer;
begin
  select * into r from public.lesson_requests where id = p_request_id for update;
  if not found then raise exception 'Sorğu tapılmadı'; end if;

  -- Təhlükəsizlik: yalnız müəllim tamamlaya bilər
  if r.teacher_id <> auth.uid() then
    raise exception 'Yalnız müəllim seansı bitirə bilər';
  end if;

  -- Status yoxlaması
  if r.status = 'completed' then
    raise exception 'Dərs artıq tamamlanıb';
  end if;

  if r.status <> 'accepted' then
    raise exception 'Seans əvvəlcə təsdiqlənməlidir';
  end if;

  -- VAXT YOXLAMASI: dərs başlamalıdır
  if r.lesson_started_at is null then
    raise exception 'Dərs hələ başlamayıb — əvvəlcə otağa qoşulun';
  end if;

  -- Vaxt hesablaması: dərsin real müddəti keçibmi?
  elapsed_minutes := extract(epoch from (now() - r.lesson_started_at)) / 60;
  required_minutes := r.duration_hours * 60;

  -- 1 dəqiqə tolerans (şəbəkə gecikməsi üçün)
  if elapsed_minutes < required_minutes - 1 then
    raise exception 'Dərs müddəti hələ tamamlanmayıb (% dəq qalıb)',
      required_minutes - elapsed_minutes;
  end if;

  -- Kredit yoxlaması
  select credit_balance into bal from public.profiles where id = r.requester_id for update;
  if bal < r.duration_hours then
    raise exception 'Öyrənənin krediti çatmır';
  end if;

  -- ATOMİK kredit köçürməsi
  update public.profiles
     set credit_balance = credit_balance - r.duration_hours
   where id = r.requester_id;

  update public.profiles
     set credit_balance = credit_balance + r.duration_hours
   where id = r.teacher_id;

  insert into public.credit_transactions (user_id, lesson_request_id, amount, type, note) values
    (r.requester_id, r.id, -r.duration_hours, 'lesson_spent',  'Dərs üçün ödəniş'),
    (r.teacher_id,   r.id,  r.duration_hours, 'lesson_earned', 'Dərs verdin');

  -- Dərsi tamamlandı kimi qeyd et
  update public.lesson_requests
     set status = 'completed',
         completed_at = now(),
         lesson_ended_at = now()
   where id = r.id;
end;
$function$;

-- ---------------------------------------------------------------------
-- 4) get_lesson_timing RPC
--    Frontend countdown timer üçün vaxt məlumatlarını qaytarır
-- ---------------------------------------------------------------------
create or replace function public.get_lesson_timing(p_request_id bigint)
returns table(
  status text,
  lesson_started_at timestamptz,
  lesson_ended_at timestamptz,
  duration_hours integer,
  elapsed_seconds integer,
  remaining_seconds integer
)
language plpgsql
security definer
set search_path to ''
as $function$
declare r public.lesson_requests;
begin
  select * into r from public.lesson_requests where id = p_request_id;
  if not found then return; end if;

  -- Təhlükəsizlik: yalnız iştirakçılar
  if auth.uid() not in (r.requester_id, r.teacher_id) then
    return;
  end if;

  if r.lesson_started_at is not null then
    return query select
      r.status,
      r.lesson_started_at,
      r.lesson_ended_at,
      r.duration_hours,
      extract(epoch from (now() - r.lesson_started_at))::integer,
      greatest(0, (r.duration_hours * 3600 - extract(epoch from (now() - r.lesson_started_at)))::integer);
  else
    return query select r.status, null::timestamptz, null::timestamptz,
      r.duration_hours, 0, r.duration_hours * 3600;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------
-- 5) İcazələr
-- ---------------------------------------------------------------------
revoke execute on function public.start_lesson(bigint) from public, anon;
revoke execute on function public.complete_lesson(bigint) from public, anon;
revoke execute on function public.get_lesson_timing(bigint) from public, anon;

grant execute on function public.start_lesson(bigint) to authenticated;
grant execute on function public.complete_lesson(bigint) to authenticated;
grant execute on function public.get_lesson_timing(bigint) to authenticated;

commit;

-- =====================================================================
-- İstifadə təlimatı:
-- 1. Supabase dashboard → SQL Editor
-- 2. Bu faylın tam məzmununu yapışdırın
-- 3. Run klikləyin
-- 4. Mövcud complete_lesson funksiyası overwrite olunur (yenilənir)
-- =====================================================================
