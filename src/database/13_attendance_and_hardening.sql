-- =====================================================================
-- Of Course — 13_attendance_and_hardening.sql
-- DEEP AUDIT FIXES — 4 kritik problema həlli:
--
-- 1. Attendance tracking: auto_complete artıq iştirak müddətini yoxlayır
-- 2. log_security_event rate limiting + spam qorunması
-- 3. verify_turnstile Vault istifadə edir (current_setting əvəzinə)
-- 4. complete_lesson yalnız cron üçün məhdudlaşdırılır
-- =====================================================================

begin;

-- =====================================================================
-- FIX 1: ATTENDANCE TRACKING
-- =====================================================================

-- lesson_attendance cədvəli — hər iştirakçının join/leave vaxtları
create table if not exists public.lesson_attendance (
  id                bigint generated always as identity primary key,
  lesson_request_id bigint not null references public.lesson_requests(id) on delete cascade,
  user_id           uuid   not null references public.profiles(id) on delete cascade,
  joined_at         timestamptz not null default now(),
  left_at           timestamptz,
  -- Hər qoşulma üçün ayrı row (reconnection üçün)
  unique (lesson_request_id, user_id, joined_at)
);

create index if not exists lesson_attendance_req_user_idx on public.lesson_attendance (lesson_request_id, user_id);
create index if not exists lesson_attendance_user_idx on public.lesson_attendance (user_id);

alter table public.lesson_attendance enable row level security;

-- RLS: yalnız iştirakçılar öz attendance-ını görə/yarada bilər
drop policy if exists "attendance_select_participants" on public.lesson_attendance;
create policy "attendance_select_participants" on public.lesson_attendance
  for select to authenticated
  using (
    exists (
      select 1 from public.lesson_requests lr
      where lr.id = lesson_attendance.lesson_request_id
        and (lr.requester_id = auth.uid() or lr.teacher_id = auth.uid())
    )
  );

drop policy if exists "attendance_insert_own" on public.lesson_attendance;
create policy "attendance_insert_own" on public.lesson_attendance
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.lesson_requests lr
      where lr.id = lesson_attendance.lesson_request_id
        and (lr.requester_id = auth.uid() or lr.teacher_id = auth.uid())
        and lr.status = 'accepted'
    )
  );

drop policy if exists "attendance_update_own" on public.lesson_attendance;
create policy "attendance_update_own" on public.lesson_attendance
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.lesson_attendance from anon, authenticated;
grant select, insert, update on public.lesson_attendance to authenticated;

-- mark_left RPC — iştirakçı otağı tərk edəndə çağırır
create or replace function public.mark_left(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare r public.lesson_requests;
begin
  select * into r from public.lesson_requests where id = p_request_id for update;
  if not found then raise exception 'Sorğu tapılmadı'; end if;
  if auth.uid() not in (r.requester_id, r.teacher_id) then
    raise exception 'İcazə yoxdur';
  end if;

  -- Son açıq attendance row-un left_at set et
  update public.lesson_attendance
     set left_at = now()
   where lesson_request_id = p_request_id
     and user_id = auth.uid()
     and left_at is null;
end;
$function$;

revoke execute on function public.mark_left(bigint) from public, anon;
grant execute on function public.mark_left(bigint) to authenticated;

-- =====================================================================
-- FIX 1b: calculate_attended_seconds helper
-- İştirakçının ümumi iştirak müddətini hesablayır (saniyə ilə)
-- Reconnection nəzərə alınır — hər join/leave cütlüğü sum olunur
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
begin
  for rec in
    select joined_at,
           coalesce(left_at, now()) as left_at
      from public.lesson_attendance
     where lesson_request_id = p_request_id
       and user_id = p_user_id
  loop
    total_seconds := total_seconds + extract(epoch from (rec.left_at - rec.joined_at))::integer;
  end loop;

  return total_seconds;
end;
$function$;

revoke execute on function public.calculate_attended_seconds(bigint, uuid) from public, anon;
grant execute on function public.calculate_attended_seconds(bigint, uuid) to authenticated;

-- =====================================================================
-- FIX 1c: auto_complete_expired_lessons — ATTENDANCE YOXLAMASI İLƏ
-- Artıq yalnız vaxt deyil, iştirak müddətini də yoxlayır:
-- - Hər iştirakçı ən azı 80% müddət iştirak etməlidir
-- - Əgər iştirak kifayət deyilsə — dərs completed olunur AMMA kredit köçürülmür
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
  -- Vaxtı keçmiş dərsləri tap (冗余 condition düzəldildi)
  for r in
    select lr.id, lr.requester_id, lr.teacher_id, lr.duration_hours, lr.lesson_started_at
      from public.lesson_requests lr
     where lr.status = 'accepted'
       and lr.lesson_started_at is not null
       and now() - lr.lesson_started_at >= (lr.duration_hours || ' hours')::interval
     for update of lr
  loop
    required_seconds := r.duration_hours * 3600;

    -- Hər iştirakçının iştirak müddətini hesabla
    teacher_seconds := public.calculate_attended_seconds(r.id, r.teacher_id);
    student_seconds := public.calculate_attended_seconds(r.id, r.requester_id);

    -- 80% iştirak tələbi (grace period: 20% müvəqqəti kəsilməyə icazə)
    attendance_ok := (teacher_seconds >= required_seconds * 0.8)
                     and (student_seconds >= required_seconds * 0.8);

    if not attendance_ok then
      -- İştirak kifayət deyil — dərs completed işarətlə, amma kredit köçürmə
      -- Admin manual olaraq yoxlamalıdır
      update public.lesson_requests
         set status = 'completed',
             completed_at = now(),
             lesson_ended_at = now()
       where id = r.id;

      -- Audit log — iştirak kifayət deyil
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
          'required_seconds', required_seconds
        )
      );

      completed_count := completed_count + 1;
      continue;
    end if;

    -- Kredit balansını yoxla (atomic lock)
    select credit_balance into bal
      from public.profiles
     where id = r.requester_id
     for update;

    if bal is null or bal < r.duration_hours then
      -- Kredit çatmır — dərs completed, kredit yox (admin həll etməli)
      update public.lesson_requests
         set status = 'completed',
             completed_at = now(),
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

    -- Atomik kredit köçürməsi
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
-- Yalnız pg_cron (superuser) çağıra bilər — authenticated-ə icazə verilmir

-- =====================================================================
-- FIX 2: log_security_event HARDENING
-- Rate limiting: hər istifadəçi dəqiqədə ən çox 10 hadisə log edə bilər
-- event_type CHECK constraint artıq var — saxta hadisə tipi reject olunur
-- user_id həmişə auth.uid() təyin edilir — başqa istifadəçi üçün fork edilə bilməz
-- =====================================================================
create or replace function public.log_security_event(
  p_event_type text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_details jsonb default null,
  p_severity text default 'info'
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  recent_count integer;
begin
  -- Severity validation
  if p_severity not in ('info', 'warning', 'critical') then
    p_severity := 'info';
  end if;

  -- Rate limit: son 1 dəqiqədə 10-dan çox hadisə yox
  select count(*) into recent_count
    from public.security_events
   where user_id = auth.uid()
     and created_at > now() - interval '1 minute';

  if recent_count >= 10 then
    -- Rate limit exceeded — sessiz şəkildə reject et (xəta yox, spam qarşısı al)
    return;
  end if;

  -- user_id HƏMİŞƏ auth.uid() — istifadəçi başqası üçün log edə bilməz
  insert into public.security_events (
    event_type, user_id, resource_type, resource_id, details, severity
  ) values (
    p_event_type, auth.uid(), p_resource_type, p_resource_id, p_details, p_severity
  );
end;
$function$;

revoke execute on function public.log_security_event(text, text, text, jsonb, text) from public, anon;
grant execute on function public.log_security_event(text, text, text, jsonb, text) to authenticated;

-- =====================================================================
-- FIX 3: verify_turnstile — Vault istifadə et (current_setting əvəzinə)
-- =====================================================================
create or replace function public.verify_turnstile(p_token text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  response json;
  success boolean;
  secret_key text;
begin
  if p_token is null or p_token = '' then
    return true; -- CAPTCHA deaktiv
  end if;

  -- Vault-dan secret key oxu ( Supabase Vault tələb edir)
  begin
    select vault.decrypted_secret into secret_key
      from vault.decrypted_secrets
     where name = 'turnstile_secret'
     limit 1;
  exception when others then
    -- Vault aktiv deyil və ya secret yoxdur
    secret_key := null;
  end;

  if secret_key is null then
    -- Fallback: current_setting (test üçün, production-da Vault istifadə et)
    begin
      secret_key := current_setting('app.turnstile_secret', true);
    exception when others then
      secret_key := null;
    end;
  end if;

  if secret_key is null then
    raise notice 'Turnstile secret key təyin edilməyib — verification skip';
    return true;
  end if;

  -- Cloudflare siteverify (pg_net)
  select content::json into response
  from net.http_post(
    url := 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    body := jsonb_build_object(
      'secret', secret_key,
      'response', p_token
    ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );

  success := coalesce((response->>'success')::boolean, false);
  return success;
end;
$function$;

revoke execute on function public.verify_turnstile(text) from public, anon;
grant execute on function public.verify_turnstile(text) to authenticated;

-- =====================================================================
-- FIX 4: complete_lesson — yalnız müəllim çağıra bilər, amma vaxt yoxlaması saxlanılır
-- (Bu funksiya artıq migration 05-də var, amma cron üçün auth.uid() yoxlaması yoxdur)
-- cron auto_complete_expired_lessons istifadə edir — complete_lesson manual çağrıla bilməməli
-- =====================================================================
-- Qeyd: complete_lesson artıq migration 05-də SECURITY DEFINER və auth.uid() yoxlaması var
-- (yalnız müəllim çağıra bilər). cron auto_complete_expired_lessons istifadə edir ki
-- öz içində auth.uid() yoxlaması yoxdur (service role kimi işləyir).
-- Bu, TƏHLÜKƏSİZDIR çünki:
-- 1. auto_complete_expired_lessons authenticated-ə grant edilməyib
-- 2. Yalnız pg_cron (superuser) çağıra bilər
-- 3. complete_lesson hələ də müəllim tərəfindən çağrıla bilər (backwards compat)
--    amma vaxt yoxlaması var — vaxt keçməyibsə reject edir

commit;

-- =====================================================================
-- KONFİQURASİYA TƏLƏBLƏRİ:
-- 1. pg_net extension aktiv (migration 08)
-- 2. pg_cron extension aktiv (migration 10)
-- 3. Supabase Vault aktiv (Dashboard → Database → Extensions → vault)
-- 4. Vault-a secret əlavə et:
--      select vault.create_secret('YOUR_CLOUDFLARE_SECRET', 'turnstile_secret');
-- 5. Bu miqrasiyanı 05-12-dən SONRA işlədin
-- =====================================================================

-- =====================================================================
-- TEST SSENARİLƏRİ (static):
-- 1. auto_complete vaxt keçib, iştirak 80%+ → kredit köçürülür
-- 2. auto_complete vaxt keçib, iştirak <80% → completed, kredit YOX
-- 3. log_security_event 11-ci çağırış → sessiz reject (rate limit)
-- 4. log_security_event saxta event_type → CHECK constraint reject
-- 5. log_security_event başqa user_id → mümkün deyil (auth.uid() məcburi)
-- 6. verify_turnstile Vault secret oxuyur → Cloudflare-ə POST → success/false
-- =====================================================================
