-- =====================================================================
-- Of Course — 21_fix_is_admin_ambiguity.sql
-- Admin funksiyalarında "column reference is_admin is ambiguous" xətasının
-- düzəlişi. PL/pgSQL-də yerli dəyişən adı (is_admin) sütun adı ilə üst-üstə
-- düşür; sütun istinadı alias ilə təyin olunur (p.is_admin).
-- İşlədilmə: Supabase SQL Editor → yapışdır → Run. Təkrarı təhlükəsizdir.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_pending_review_lessons()
 RETURNS TABLE(lesson_request_id bigint, teacher_name text, student_name text, skill_name text, duration_hours integer, lesson_started_at timestamp with time zone, teacher_attendance_pct numeric, student_attendance_pct numeric, blocking_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  is_admin boolean;
  r record;
  req_seconds integer;
  teacher_sec integer;
  student_sec integer;
  reason text;
begin
  select p.is_admin into is_admin from public.profiles p where p.id = auth.uid();
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
$function$


-- STATEMENT --

CREATE OR REPLACE FUNCTION public.resolve_pending_lesson(p_request_id bigint, p_action text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  is_admin boolean;
  r public.lesson_requests;
  bal integer;
begin
  select p.is_admin into is_admin from public.profiles p where p.id = auth.uid();
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
$function$


-- STATEMENT --

CREATE OR REPLACE FUNCTION public.suspend_user(p_user_id uuid, p_duration_hours integer DEFAULT NULL::integer, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare is_admin boolean;
begin
  select p.is_admin into is_admin from public.profiles p where p.id = auth.uid();
  if not coalesce(is_admin, false) then
    raise exception 'Yalnız admin istifadəçi dayandıra bilər';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Özünüzü dayandıra bilməzsiniz';
  end if;

  update public.profiles
     set is_suspended = true,
         suspended_until = case when p_duration_hours is not null
                              then now() + (p_duration_hours || ' hours')::interval
                              else null end,
         suspended_reason = p_reason
   where id = p_user_id;
end;
$function$


-- STATEMENT --

CREATE OR REPLACE FUNCTION public.unsuspend_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare is_admin boolean;
begin
  select p.is_admin into is_admin from public.profiles p where p.id = auth.uid();
  if not coalesce(is_admin, false) then
    raise exception 'Yalnız admin';
  end if;

  update public.profiles
     set is_suspended = false,
         suspended_until = null,
         suspended_reason = null
   where id = p_user_id;
end;
$function$


-- STATEMENT --

CREATE OR REPLACE FUNCTION public.verify_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare is_admin boolean;
begin
  select p.is_admin into is_admin from public.profiles p where p.id = auth.uid();
  if not coalesce(is_admin, false) then
    raise exception 'Yalnız admin istifadəçi təsdiqləyə bilər';
  end if;

  update public.profiles
     set trust_level = 'verified',
         verified_by = auth.uid(),
         verified_at = now()
   where id = p_user_id;
end;
$function$

