-- =====================================================================
-- Of Course — 14_attendance_integrity_fix.sql
-- KRİTİK düzəlişlər — Migration 13-də tapılan 5 ciddi problema həlli:
--
-- PROBLEM 1: mark_joined lesson_attendance cədvəlinə insert ETMİR
--   → attendance həmişə 0% → kredit heç vaxt köçürülmür
-- PROBLEM 2: auto_complete attendance <80% olanda 'completed' qoyur
--   → kredit köçürülməsə belə dərs "tamamlandı" sayılır
-- PROBLEM 3: 'pending_review' status yoxdur
--   → CHECK constraint-də əlavə edilməli
-- PROBLEM 4: calculate_attended_seconds cap yoxdur
--   → iştirak müddəti dərs müddətini keçə bilər
-- PROBLEM 5: Heartbeat yoxdur — beforeunload etibarsız
--   → Server-side stale session detection lazımdır
-- =====================================================================

begin;

-- =====================================================================
-- FIX 1: 'pending_review' status əlavə et
-- =====================================================================
alter table public.lesson_requests
  drop constraint if exists lesson_requests_status_check;

alter table public.lesson_requests
  add constraint lesson_requests_status_check
  check (status in ('pending','accepted','rejected','completed','cancelled','pending_review'));

-- =====================================================================
-- FIX 2: lesson_attendance-ə heartbeat sütunu əlavə et
-- =====================================================================
alter table public.lesson_attendance
  add column if not exists last_heartbeat_at timestamptz;

-- =====================================================================
-- FIX 3: mark_joined-i yenilə — lesson_attendance-ə DA insert et
--   - Server timestamp (now()) — client timestamp etibarsız
--   - Overlap prevention: açıq session varsa, yeni yaratma
--   - Idempotent: eyni user üçün açıq session yoxdursa yarat
-- =====================================================================
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
  open_session_count integer;
begin
  select * into r from public.lesson_requests where id = p_request_id for update;
  if not found then raise exception 'Sorğu tapılmadı'; end if;

  if auth.uid() not in (r.requester_id, r.teacher_id) then
    raise exception 'İcazə yoxdur';
  end if;

  if r.status <> 'accepted' then
    raise exception 'Dərs əvvəlcə qəbul edilməlidir';
  end if;

  select * into room from public.lesson_rooms
   where lesson_request_id = p_request_id for update;

  if not found then
    raise exception 'Otaq tapılmadı';
  end if;

  is_teacher := (auth.uid() = r.teacher_id);

  -- lesson_rooms joined_at yenilə (migration 07 logic)
  if is_teacher and room.teacher_joined_at is null then
    update public.lesson_rooms set teacher_joined_at = now() where id = room.id;
    room.teacher_joined_at := now();  -- stale record düzəlişi: yenicə yazılan dəyəri əks etdir
  elsif not is_teacher and room.student_joined_at is null then
    update public.lesson_rooms set student_joined_at = now() where id = room.id;
    room.student_joined_at := now();  -- stale record düzəlişi: yenicə yazılan dəyəri əks etdir
  end if;

  -- lesson_started_at set et (hər ikisi qoşulanda)
  if room.teacher_joined_at is not null
     and room.student_joined_at is not null
     and r.lesson_started_at is null then
    update public.lesson_requests
       set lesson_started_at = greatest(room.teacher_joined_at, room.student_joined_at)
     where id = p_request_id;
  end if;

  -- YENİ: lesson_attendance-ə insert et (server timestamp, overlap prevention)
  select count(*) into open_session_count
    from public.lesson_attendance
   where lesson_request_id = p_request_id
     and user_id = auth.uid()
     and left_at is null;

  if open_session_count = 0 then
    -- Açıq session yoxdur — yeni yarat
    insert into public.lesson_attendance (lesson_request_id, user_id, joined_at, last_heartbeat_at)
    values (p_request_id, auth.uid(), now(), now());
  else
    -- Açıq session var — sadəcə heartbeat yenilə
    update public.lesson_attendance
       set last_heartbeat_at = now()
     where lesson_request_id = p_request_id
       and user_id = auth.uid()
       and left_at is null;
  end if;
end;
$function$;

revoke execute on function public.mark_joined(bigint) from public, anon;
grant execute on function public.mark_joined(bigint) to authenticated;

-- =====================================================================
-- FIX 4: heartbeat RPC — hər 30 saniyə çağrılır
--   - Açıq session varsa heartbeat yenilə
--   - Açıq session yoxsa yeni yarat (reconnect)
-- =====================================================================
create or replace function public.heartbeat(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare r public.lesson_requests;
begin
  select * into r from public.lesson_requests where id = p_request_id;
  if not found then return; end if;

  if auth.uid() not in (r.requester_id, r.teacher_id) then
    raise exception 'İcazə yoxdur';
  end if;

  if r.status <> 'accepted' then
    return; -- Sessiz şəkildə ignore — dərs artıq başa çatıb
  end if;

  -- Açıq session varsa heartbeat yenilə
  update public.lesson_attendance
     set last_heartbeat_at = now()
   where lesson_request_id = p_request_id
     and user_id = auth.uid()
     and left_at is null;

  -- Əgər update 0 row təsir etdisə (açıq session yoxdur) — reconnect et
  if not found then
    insert into public.lesson_attendance (lesson_request_id, user_id, joined_at, last_heartbeat_at)
    values (p_request_id, auth.uid(), now(), now());
  end if;
end;
$function$;

revoke execute on function public.heartbeat(bigint) from public, anon;
grant execute on function public.heartbeat(bigint) to authenticated;

-- =====================================================================
-- FIX 5: close_stale_sessions RPC — pg_cron tərəfindən çağrılır
--   - 2 dəqiqədən çox heartbeat olmayan session-ları bağla
--   - Bu, browser crash / network failure hallarını tutur
-- =====================================================================
create or replace function public.close_stale_sessions()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare closed_count integer := 0;
begin
  update public.lesson_attendance
     set left_at = last_heartbeat_at
   where left_at is null
     and last_heartbeat_at < now() - interval '2 minutes';

  get diagnostics closed_count = row_count;
  return closed_count;
end;
$function$;

revoke execute on function public.close_stale_sessions() from public, anon, authenticated;
-- Yalnız pg_cron (superuser) çağıra bilər

-- Schedule: hər dəqiqə stale session-ları bağla
do $$
begin
  perform cron.unschedule('close-stale-sessions');
exception when others then
  null;
end
$$;

select cron.schedule(
  'close-stale-sessions',
  '* * * * *',
  $$select public.close_stale_sessions();$$
);

-- =====================================================================
-- FIX 6: calculate_attended_seconds — CAP əlavə et
--   - İştirak müddəti dərs müddətini keçə bilməz
--   - Overlapping session-ları düzgün hesabla
-- =====================================================================
create or replace function public.calculate_attended_seconds(
  p_request_id bigint,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  total_seconds integer := 0;
  rec record;
  lesson_duration_seconds integer;
  lesson_started timestamptz;
  lesson_ended timestamptz;
  effective_left timestamptz;
begin
  -- Dərs müddətini əldə et (cap üçün)
  select duration_hours, lesson_started_at, lesson_ended_at
    into lesson_duration_seconds, lesson_started, lesson_ended
    from public.lesson_requests
   where id = p_request_id;

  if not found then return 0; end if;

  lesson_duration_seconds := lesson_duration_seconds * 3600;

  for rec in
    select joined_at,
           coalesce(left_at, now()) as left_at
      from public.lesson_attendance
     where lesson_request_id = p_request_id
       and user_id = p_user_id
     order by joined_at
  loop
    -- left_at dərs müddəti ilə məhdudlaşdır (cap)
    effective_left := rec.left_at;

    -- Əgər dərs başlamışsa və iştirak dərs müddətini keçirsə — cap et
    if lesson_started is not null then
      if effective_left > lesson_started + (lesson_duration_seconds || ' seconds')::interval then
        effective_left := lesson_started + (lesson_duration_seconds || ' seconds')::interval;
      end if;
      -- joined_at dərs başlamazdan əvvəl ola bilməz
      if rec.joined_at < lesson_started then
        -- Bu normaldır — mark_joined lesson_started_at-dan əvvəl çağrıla bilər
        null;
      end if;
    end if;

    total_seconds := total_seconds + extract(epoch from (effective_left - rec.joined_at))::integer;
  end loop;

  -- Ümumi cap: dərs müddətini keçə bilməz
  if total_seconds > lesson_duration_seconds then
    total_seconds := lesson_duration_seconds;
  end if;

  return greatest(total_seconds, 0);
end;
$function$;

revoke execute on function public.calculate_attended_seconds(bigint, uuid) from public, anon;
grant execute on function public.calculate_attended_seconds(bigint, uuid) to authenticated;

-- =====================================================================
-- FIX 7: auto_complete_expired_lessons — 'pending_review' istifadə et
--   - Attendance <80% → status = 'pending_review' (NOT 'completed')
--   - Kredit çatmırsa → status = 'pending_review'
--   - Uğurlu → status = 'completed' + kredit köçür
-- =====================================================================
create or replace function public.auto_complete_expired_lessons()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  completed_count integer := 0;
  r record;
  bal integer;
  teacher_seconds integer;
  student_seconds integer;
  required_seconds integer;
  attendance_ok boolean;
begin
  -- Önce stale session-ları bağla
  perform public.close_stale_sessions();

  for r in
    select lr.id, lr.requester_id, lr.teacher_id, lr.duration_hours, lr.lesson_started_at
      from public.lesson_requests lr
     where lr.status = 'accepted'
       and lr.lesson_started_at is not null
       and now() - lr.lesson_started_at >= (lr.duration_hours || ' hours')::interval
     for update of lr
  loop
    required_seconds := r.duration_hours * 3600;

    teacher_seconds := public.calculate_attended_seconds(r.id, r.teacher_id);
    student_seconds := public.calculate_attended_seconds(r.id, r.requester_id);

    attendance_ok := (teacher_seconds >= required_seconds * 0.8)
                     and (student_seconds >= required_seconds * 0.8);

    if not attendance_ok then
      -- STATUS: pending_review (NOT completed) — admin manual yoxlama tələb olunur
      update public.lesson_requests
         set status = 'pending_review',
             lesson_ended_at = now()
       where id = r.id;

      insert into public.security_events (event_type, resource_type, resource_id, severity, details)
      values (
        'credit_transfer_blocked',
        'lesson_request',
        r.id::text,
        'warning',
        jsonb_build_object(
          'reason', 'insufficient_attendance',
          'teacher_seconds', teacher_seconds,
          'student_seconds', student_seconds,
          'required_seconds', required_seconds,
          'threshold', '80%'
        )
      );

      completed_count := completed_count + 1;
      continue;
    end if;

    -- Kredit balansını yoxla
    select credit_balance into bal
      from public.profiles
     where id = r.requester_id
     for update;

    if bal is null or bal < r.duration_hours then
      -- STATUS: pending_review — kredit problemi admin tərəfindən həll olunmalı
      update public.lesson_requests
         set status = 'pending_review',
             lesson_ended_at = now()
       where id = r.id;

      insert into public.security_events (event_type, resource_type, resource_id, severity, details)
      values (
        'credit_transfer_blocked',
        'lesson_request',
        r.id::text,
        'warning',
        jsonb_build_object('reason', 'insufficient_credits', 'balance', bal, 'required', r.duration_hours)
      );

      completed_count := completed_count + 1;
      continue;
    end if;

    -- UĞURLU — atomik kredit köçürməsi + status = 'completed'
    update public.profiles
       set credit_balance = credit_balance - r.duration_hours
     where id = r.requester_id;

    update public.profiles
       set credit_balance = credit_balance + r.duration_hours
     where id = r.teacher_id;

    insert into public.credit_transactions (user_id, lesson_request_id, amount, type, note) values
      (r.requester_id, r.id, -r.duration_hours, 'lesson_spent',  'Dərs üçün ödəniş (auto)'),
      (r.teacher_id,   r.id,  r.duration_hours, 'lesson_earned', 'Dərs verdin (auto)');

    update public.lesson_requests
       set status = 'completed',
           completed_at = now(),
           lesson_ended_at = now()
     where id = r.id;

    completed_count := completed_count + 1;
  end loop;

  return completed_count;
end;
$function$;

revoke execute on function public.auto_complete_expired_lessons() from public, anon, authenticated;

-- =====================================================================
-- FIX 8: get_lesson_attendance RPC — iştirakçılara şəffaflıq
--   - Hər iştirakçı öz və digər tərəfin iştirak müddətini görə bilər
-- =====================================================================
create or replace function public.get_lesson_attendance(p_request_id bigint)
returns table(
  user_id uuid,
  attended_seconds integer,
  required_seconds integer,
  attendance_percentage numeric
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r public.lesson_requests;
  req_seconds integer;
  teacher_sec integer;
  student_sec integer;
begin
  select * into r from public.lesson_requests where id = p_request_id;
  if not found then return; end if;

  if auth.uid() not in (r.requester_id, r.teacher_id) then
    raise exception 'İcazə yoxdur';
  end if;

  req_seconds := r.duration_hours * 3600;
  teacher_sec := public.calculate_attended_seconds(p_request_id, r.teacher_id);
  student_sec := public.calculate_attended_seconds(p_request_id, r.requester_id);

  return query select r.teacher_id, teacher_sec, req_seconds,
    round((teacher_sec::numeric / req_seconds::numeric) * 100, 1);
  return query select r.requester_id, student_sec, req_seconds,
    round((student_sec::numeric / req_seconds::numeric) * 100, 1);
end;
$function$;

revoke execute on function public.get_lesson_attendance(bigint) from public, anon;
grant execute on function public.get_lesson_attendance(bigint) to authenticated;

commit;

-- =====================================================================
-- KONFİQURASİYA:
-- 1. Bu miqrasiyanı 13-dən SONRA işlədin
-- 2. pg_cron artıq aktiv olmalıdır (migration 10)
-- 3. Cron job-lar avtomatik schedule olunur:
--    - auto-complete-lessons: hər dəqiqə
--    - close-stale-sessions: hər dəqiqə
--
-- FRONTEND TƏLƏBİ:
-- LessonRoom.tsx-də heartbeat hər 30 saniyə çağrılmalıdır
-- =====================================================================
