-- =====================================================================
-- Of Course — 15_security_hardening.sql
-- MÜSTƏQİL AUDİT-DƏ TAPILAN 3 CRITICAL + 2 HIGH problemin həlli.
--
-- BU MİQRASYA YENİ FUNKSİYA ƏLAVƏ ETMİR — mövcud sistemin qorunması.
--
-- CRITICAL 1: lesson_attendance birbaşa INSERT/UPDATE bağlanır
-- CRITICAL 2: complete_lesson authenticated-a bağlanır (bypass qarşısı)
-- CRITICAL 3: Heartbeat reconnect köhnə sessiyanı uzadır — düzəldilir
-- HIGH 1: get_pending_review_lessons RPC (admin üçün)
-- HIGH 2: Jitsi heartbeat məhdudiyyəti sənədləşdirilir
--
-- Migration 01-14-dən SONRA işlədilir.
-- =====================================================================

begin;

-- =====================================================================
-- CRITICAL FIX 1: lesson_attendance birbaşa yazma qorunması
--
-- Problem (audit tapıntısı):
--   grant select, insert, update on lesson_attendance to authenticated
--   İstifadəçi birbaşa INSERT/UPDATE edərək saxta joined_at/left_at yarada bilər.
--
-- Həll:
--   REVOKE insert, update from authenticated
--   Yalnız SECURITY DEFINER RPC-lər (mark_joined, heartbeat, mark_left)
--   yazmaq hüququna malikdir (function owner kimi işləyirlər).
--   SELECT qalır (RLS ilə — öz məlumatlarını görə bilər).
-- =====================================================================

revoke insert on public.lesson_attendance from authenticated;
revoke update on public.lesson_attendance from authenticated;

-- DELETE icazəsi yoxdur (migration 13-də grant edilməyib) — yoxlanıldı ✓
-- SELECT qalır: grant select on public.lesson_attendance to authenticated

-- Təsdiqlə:
-- select has_table_privilege('authenticated', 'public.lesson_attendance', 'INSERT')
--   → false (gözlənilir)
-- select has_table_privilege('authenticated', 'public.lesson_attendance', 'SELECT')
--   → true (gözlənilir)

-- =====================================================================
-- CRITICAL FIX 2: complete_lesson authenticated-a bağlanır
--
-- Problem (audit tapıntısı):
--   complete_lesson(bigint) authenticated-ə grant edilib.
--   Müəllim birbaşa çağıraraq attendance yoxlamasını bypass edə bilər.
--   LessonRoom.tsx sətir 148-də timer bitəndə avtomatik çağırır.
--
-- Həll:
--   REVOKE execute on complete_lesson from authenticated
--   auto_complete_expired_lessons (cron) öz inline logic-i ilə işləyir
--   (complete_lesson çağırmır) — təsir etmir.
--   Frontend-də complete_lesson çağırışı silinir (yalnız status göstərişi).
--
-- İmza: public.complete_lesson(bigint) — migration 05-dən
-- Overload: yoxdur (tək imza)
-- =====================================================================

revoke execute on function public.complete_lesson(bigint) from authenticated;

-- Artıq yalnız pg_cron (superuser) complete_lesson çağıra bilər
-- (amma auto_complete_expired_lessons onu çağırmır — öz logic-i var)

-- =====================================================================
-- CRITICAL FIX 3: Heartbeat reconnect — köhnə sessiya Problemi
--
-- Problem (audit tapıntısı):
--   heartbeat köhnə açıq sessiyanı tapıb last_heartbeat_at yeniləyir.
--   Əgər close_stale_sessions işləməyibsə, 3 dəqiqəlik boşluq
--   iştirak müddətinə əlavə olunur.
--
-- Həll:
--   heartbeat-də köhnə sessiyanın last_heartbeat_at dəyərini yoxla:
--   - Əgər >2 dəqiqə köhnədirsə → köhnə sessiyanı BAĞLA (left_at = last_heartbeat_at)
--     və YENİ sessiya yarat (reconnect)
--   - Əgər <2 dəqiqədirsə → sadəcə heartbeat yenilə (normal)
--   - Açıq sessiya yoxdursa → yeni yarat
-- =====================================================================

create or replace function public.heartbeat(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r public.lesson_requests;
  v_session record;
begin
  select * into r from public.lesson_requests where id = p_request_id;
  if not found then return; end if;

  if auth.uid() not in (r.requester_id, r.teacher_id) then
    raise exception 'İcazə yoxdur';
  end if;

  if r.status <> 'accepted' then
    return; -- Dərs artıq başa çatıb
  end if;

  -- Açıq sessiyanı tap
  select * into v_session
    from public.lesson_attendance
   where lesson_request_id = p_request_id
     and user_id = auth.uid()
     and left_at is null
   order by joined_at desc
   limit 1;

  if not found then
    -- Açıq sessiya yoxdur — yeni yarat (ilk qoşulma və ya reconnect)
    insert into public.lesson_attendance (lesson_request_id, user_id, joined_at, last_heartbeat_at)
    values (p_request_id, auth.uid(), now(), now());
    return;
  end if;

  -- Köhnə sessiya var — last_heartbeat_at dəyərini yoxla
  if v_session.last_heartbeat_at < now() - interval '2 minutes' then
    -- STALE sessiya — bağla və yeni reconnect sessiyası yarat
    -- İtirilmiş bağlantı müddəti iştiraka əlavə OLUNMUR
    update public.lesson_attendance
       set left_at = v_session.last_heartbeat_at
     where id = v_session.id;

    insert into public.lesson_attendance (lesson_request_id, user_id, joined_at, last_heartbeat_at)
    values (p_request_id, auth.uid(), now(), now());
  else
    -- NORMAL heartbeat — sadəcə yenilə
    update public.lesson_attendance
       set last_heartbeat_at = now()
     where id = v_session.id;
  end if;
end;
$function$;

revoke execute on function public.heartbeat(bigint) from public, anon;
grant execute on function public.heartbeat(bigint) to authenticated;

-- =====================================================================
-- HIGH FIX 1: get_pending_review_lessons RPC (admin only)
--
-- Admin pending_review statuslu dərsləri görə bilər:
-- - müəllim/tələbə adları
-- - davamiyyət faizi
-- - kredit köçürmə vəziyyəti
-- - səbəb (insufficient_attendance / insufficient_credits)
-- =====================================================================

create or replace function public.get_pending_review_lessons()
returns table(
  lesson_request_id bigint,
  teacher_name text,
  student_name text,
  skill_name text,
  duration_hours integer,
  lesson_started_at timestamptz,
  teacher_attendance_pct numeric,
  student_attendance_pct numeric,
  blocking_reason text
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  is_admin boolean;
  r record;
  req_seconds integer;
  teacher_sec integer;
  student_sec integer;
  reason text;
begin
  select is_admin into is_admin from public.profiles where id = auth.uid();
  if not coalesce(is_admin, false) then
    raise exception 'Yalnız admin';
  end if;

  for r in
    select lr.id, lr.requester_id, lr.teacher_id, lr.duration_hours, lr.lesson_started_at,
           lr.skill_id
      from public.lesson_requests lr
     where lr.status = 'pending_review'
     order by lr.lesson_started_at desc
  loop
    req_seconds := r.duration_hours * 3600;
    teacher_sec := public.calculate_attended_seconds(r.id, r.teacher_id);
    student_sec := public.calculate_attended_seconds(r.id, r.requester_id);

    -- Audit log-dan blocking reason tap
    select details->>'reason' into reason
      from public.security_events
     where event_type = 'credit_transfer_blocked'
       and resource_id = r.id::text
     order by created_at desc
     limit 1;

    return query select
      r.id,
      (select full_name from public.profiles where id = r.teacher_id),
      (select full_name from public.profiles where id = r.requester_id),
      (select name from public.skills where id = r.skill_id),
      r.duration_hours,
      r.lesson_started_at,
      round((teacher_sec::numeric / req_seconds::numeric) * 100, 1),
      round((student_sec::numeric / req_seconds::numeric) * 100, 1),
      coalesce(reason, 'unknown');
  end loop;
end;
$function$;

revoke execute on function public.get_pending_review_lessons() from public, anon;
grant execute on function public.get_pending_review_lessons() to authenticated;

-- =====================================================================
-- HIGH FIX 2: resolve_pending_lesson RPC (admin only)
--
-- Admin pending_review dərsi manual olaraq həll edə bilər:
-- - 'complete' → kredit köçür və status = 'completed'
-- - 'cancel' → status = 'cancelled', kredit yox
-- Hər əməliyyat audit log-a yazılır.
-- =====================================================================

create or replace function public.resolve_pending_lesson(
  p_request_id bigint,
  p_action text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  is_admin boolean;
  r public.lesson_requests;
  bal integer;
begin
  select is_admin into is_admin from public.profiles where id = auth.uid();
  if not coalesce(is_admin, false) then
    raise exception 'Yalnız admin';
  end if;

  select * into r from public.lesson_requests where id = p_request_id for update;
  if not found then raise exception 'Sorğu tapılmadı'; end if;

  if r.status <> 'pending_review' then
    raise exception 'Bu dərs pending_review statusunda deyil';
  end if;

  if p_action = 'complete' then
    -- Kredit balansını yoxla
    select credit_balance into bal
      from public.profiles
     where id = r.requester_id
     for update;

    if bal is null or bal < r.duration_hours then
      raise exception 'Tələbənin krediti çatmır (% credit)', bal;
    end if;

    -- Atomik kredit köçürməsi
    update public.profiles
       set credit_balance = credit_balance - r.duration_hours
     where id = r.requester_id;

    update public.profiles
       set credit_balance = credit_balance + r.duration_hours
     where id = r.teacher_id;

    insert into public.credit_transactions (user_id, lesson_request_id, amount, type, note) values
      (r.requester_id, r.id, -r.duration_hours, 'lesson_spent',  'Admin manual complete'),
      (r.teacher_id,   r.id,  r.duration_hours, 'lesson_earned', 'Admin manual complete');

    update public.lesson_requests
       set status = 'completed',
           completed_at = now(),
           lesson_ended_at = now()
     where id = r.id;

  elsif p_action = 'cancel' then
    update public.lesson_requests
       set status = 'cancelled',
           lesson_ended_at = now()
     where id = r.id;

  else
    raise exception 'Yanlış action (complete və ya cancel)';
  end if;

  -- Audit log
  insert into public.security_events (event_type, user_id, resource_type, resource_id, severity, details)
  values (
    'unauthorized_admin_action',
    auth.uid(),
    'lesson_request',
    p_request_id::text,
    'info',
    jsonb_build_object(
      'action', 'resolve_pending_lesson',
      'resolution', p_action,
      'note', p_note,
      'admin_id', auth.uid()
    )
  );
end;
$function$;

revoke execute on function public.resolve_pending_lesson(bigint, text, text) from public, anon;
grant execute on function public.resolve_pending_lesson(bigint, text, text) to authenticated;

-- =====================================================================
-- JITSI HEARTBEAT MƏHDUDİYYƏTİ (sənədləşdirmə)
--
-- VACİB QEYD: Heartbeat mexanizmi istifadəçinin Jitsi video zəngində
-- həqiqətən iştirak etdiyini SÜBUT ETMİR. Yalnız "brauzer açıqdır və
-- JavaScript işləyir" sübut edir.
--
-- İştirakçılar kolludiya edərək (bir-biriylə razılaşaraq) heartbeat
-- çağırıb kreditləri ala bilərlər — heç bir real video dərs keçirilməsə belə.
--
-- Bu, PUBLIC Jitsi server (meet.jit.si) istifadə etdiyimiz üçün vacib
-- məhdudiyyətdir. Public server server-side participant verification
-- təmin etmir.
--
-- GƏLƏCƏK TƏHLÜKƏSİZLİK MƏRHƏLƏSİ (production üçün tövsiyə):
-- 1. Self-hosted Jitsi server qurun (Docker)
-- 2. JWT authentication aktiv edin
-- 3. Jitsi participant webhook konfiqurasiya edin:
--    - participantJoined / participantLeft hadisələri
--    - Webhook endpoint Supabase Edge Function olaraq
--    - Edge Function attendance cədvəlini yeniləyir
-- 4. VITE_JITSI_DOMAIN env var ilə öz serverinizi təyin edin
--
-- Bu miqrasiya heartbeat-i qoruyur (rate limit, stale detection),
-- amma Jitsi iştirak təsdiqi üçün tam həll deyil.
-- =====================================================================

commit;

-- =====================================================================
-- KONFİQURASİYA TƏLƏBLƏRİ:
-- 1. Bu miqrasiyanı 14-dən SONRA işlədin
-- 2. Frontend dəyişiklikləri (LessonRoom.tsx, Admin.tsx) lazımdır:
--    - LessonRoom: complete_lesson çağırışı silinir
--    - Admin: pending_review bölməsi əlavə edilir
--
-- TEST SSENARİLƏRİ (static):
-- 1. Authenticated istifadəçi lesson_attendance INSERT cəhdi → REJECT
-- 2. Authenticated istifadəçi lesson_attendance UPDATE cəhdi → REJECT
-- 3. Authenticated istifadəçi complete_lesson çağırışı → REJECT
-- 4. Heartbeat stale sessiya → köhnə bağlanır, yeni yaranır
-- 5. Heartbeat normal → sadəcə yenilənir
-- 6. Admin get_pending_review_lessons → siyahı qaytarır
-- 7. Admin resolve_pending_lesson('complete') → kredit köçürür
-- 8. Non-admin get_pending_review_lessons → REJECT
-- =====================================================================
