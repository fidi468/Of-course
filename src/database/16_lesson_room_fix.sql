-- =====================================================================
-- Of Course — 16_lesson_room_fix.sql
-- Video zəng otağına qoşulma xətasının SERVER TƏRƏFLİ həlli.
--
-- Mövcud simptom:
--   Müəllim: "Dərs otağına yalnız müəllim və tələbə daxil ola bilər..."
--   Tələbə:  "Bu video zəngə girişə icazə yoxdur."
--
-- Kök səbəblər (2 dənə):
--   1) Production bazasında 05-15 migration-ları tətbiq edilməyib —
--      lesson_started_at / lesson_ended_at sütunları yoxdur, mark_joined /
--      get_lesson_timing funksiyaları yoxdur. useLessonRoom hook-u bu
--      sütunları select edəndə PostgREST "column does not exist" xətası
--      qaytarır və frontend bunu "icazə yoxdur" kimi göstərir.
--      → Həll: 05-15 + bu faylı ardıcıllıqla tətbiq edin.
--
--   2) lesson_rooms cədvəlində lesson_request_id üzrə UNIQUE məhdudiyyət
--      yoxdur — iki istifadçi eyni anda otağı açsa, MÜXTƏLİF room_name
--      yaranır və müəllim/tələbə FƏRQLİ Jitsi otaqlarına düşür.
--      → Həll: unique index + atomik ensure_lesson_room RPC.
--
-- Bu miqrasiya təhlükəsizliyi ZƏİFLƏTMİR, əksinə GÜCLƏNDİRİR:
--   - RLS: otağı oxumaq/yaratmaq üçün status = 'accepted' TƏLƏB OLUNUR
--     (sorğu qəbul edilməyibsə otağa giriş bazada da bloklanır)
--   - ensure_lesson_room SECURITY DEFINER RPC: iştirakçı yoxlaması +
--     status yoxlaması server tərəfində, atomik olaraq aparılır
--   - Frontend select/insert-i öz-özünə işləsə də, RLS hər ikisini yoxlayır
--
-- Migration 01-16 ZİNCİRİNDƏ istənilən mərhələdə işlədilə bilər
-- (idempotentdir, təkrar işlətmək təhlükəsizdir).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Dublikat otaqları təmizlə (ehtiyat tədbiri — təkrar işlədilərkən
--    xətasız işləməsi üçün). Hər lesson_request üçün ƏN KÖHNƏ otaq qalır.
-- ---------------------------------------------------------------------
delete from public.lesson_rooms lr
using public.lesson_rooms lr2
where lr.lesson_request_id = lr2.lesson_request_id
  and lr.id > lr2.id;

-- ---------------------------------------------------------------------
-- 2) UNIQUE index — eyni dərs üçün İKİ otaq yaradıla bilməz.
--    Bu, "müəllim və tələbə fərqli otağa düşür" yarış vəziyyətini (race
--    condition) bloklayır.
-- ---------------------------------------------------------------------
drop index if exists lesson_rooms_request_unique;
create unique index lesson_rooms_request_unique
  on public.lesson_rooms (lesson_request_id);

-- ---------------------------------------------------------------------
-- 3) RLS GÜCLƏNDİRMƏ: status = 'accepted' tələbi
--    Sorğu pending/rejected/completed/cancelled ikən otaq məlumatı
--    oxunması da, yaradılması da mümkün deyil.
-- ---------------------------------------------------------------------
drop policy if exists "rooms_select_participants" on public.lesson_rooms;
create policy "rooms_select_participants" on public.lesson_rooms
  for select to authenticated
  using (
    exists (
      select 1 from public.lesson_requests lr
      where lr.id = lesson_rooms.lesson_request_id
        and lr.status = 'accepted'
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
        and lr.status = 'accepted'
        and (lr.requester_id = auth.uid() or lr.teacher_id = auth.uid())
    )
    and created_by = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 4) ensure_lesson_room RPC — atomik "yarad və ya qaytar"
--
--    Frontend otağa qoşularkən BİRBAŞA insert etmir — bu funksiyanı
--    çağırır. Funksiya özü yoxlayır:
--      a) istifadəçi həmin dərsin iştirakçısıdır mı? (server tərəfli)
--      b) sorğu status = 'accepted' olur mu?
--      c) otaq yoxdursa tək, atomik yaradır (race → ON CONFLICT)
--    Qaytarır: room_name (text)
--    Xəta halları:
--      'İcazə yoxdur'                — iştirakçı deyil
--      'Dərs hələ qəbul edilməyib'   — status accepted deyil
-- ---------------------------------------------------------------------
create or replace function public.ensure_lesson_room(p_request_id bigint)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r            public.lesson_requests;
  v_room_name  text;
begin
  -- a) Dərs sorğusunu kilidlə (aynı request üzrə paralel çağırışları
  --    ardıcıllaşdırır — yarış vəziyyəti mümkün deyil)
  select * into r
    from public.lesson_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'İcazə yoxdur';
  end if;

  -- b) Yalnız real iştirakçılar (server tərəfli yoxlama)
  if auth.uid() is null or auth.uid() not in (r.requester_id, r.teacher_id) then
    raise exception 'İcazə yoxdur';
  end if;

  -- c) Sorğu qəbul edilməyibsə otaq yoxdur
  if r.status <> 'accepted' then
    raise exception 'Dərs hələ qəbul edilməyib';
  end if;

  -- d) Mövcud otağı qaytar
  select room_name into v_room_name
    from public.lesson_rooms
   where lesson_request_id = p_request_id;

  if v_room_name is not null then
    return v_room_name;
  end if;

  -- e) Yoxdursa — atomik yarat. Paralel çağırış ON CONFLICT ilə tək
  --    otağı təmin edir (unique index lesson_rooms_request_unique)
  insert into public.lesson_rooms (lesson_request_id, room_name, created_by)
  values (
    p_request_id,
    'of-course-' || p_request_id || '-' || gen_random_uuid()::text,
    auth.uid()
  )
  on conflict (lesson_request_id) do nothing;

  -- f) Yekun oxu — hər iki paralel çağırış EYNİ room_name alır
  select room_name into v_room_name
    from public.lesson_rooms
   where lesson_request_id = p_request_id;

  if v_room_name is null then
    raise exception 'Otaq yaradıla bilmədi';
  end if;

  return v_room_name;
end;
$function$;

-- ---------------------------------------------------------------------
-- 5) İcazələr
-- ---------------------------------------------------------------------
revoke execute on function public.ensure_lesson_room(bigint) from public, anon;
grant execute on function public.ensure_lesson_room(bigint) to authenticated;

commit;

-- =====================================================================
-- TEST SSENARİLƏRİ (static):
-- 1. İştirakçı pending sorğu üçün ensure_lesson_room → xəta
--    'Dərs hələ qəbul edilməyib'
-- 2. İştirakçı accepted sorğu üçün ensure_lesson_room → room_name
-- 3. İkinci iştirakçı eyni sorğu üçün ensure_lesson_room → EYNİ room_name
-- 4. Üçüncü hesab ensure_lesson_room → xəta 'İcazə yoxdur'
-- 5. Üçüncü hesab lesson_rooms SELECT → 0 sətir (RLS)
-- 6. İştirakçı pending sorğu üçün birbaşa INSERT → RLS bloklayır
-- 7. completed dərsin otağı SELECT → 0 sətir (RLS status yoxlaması)
-- =====================================================================
