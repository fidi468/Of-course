-- =====================================================================
-- Of Course — 11_security_audit_log.sql
-- Suspicious activity monitoring və security audit log.
--
-- Bu miqrasiya security hadisələrini qeyd edən cədvəl və RPC yaradır.
-- Heç bir sensitive məlumat (password, token, JWT secret) log olunmur.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) security_events cədvəli
-- ---------------------------------------------------------------------
create table if not exists public.security_events (
  id              bigint generated always as identity primary key,
  event_type      text   not null check (event_type in (
    -- Auth events
    'login_failed', 'login_success', 'registration_failed',
    'registration_success', 'password_reset_requested',
    -- Lesson events
    'lesson_request_blocked', 'unauthorized_room_access',
    'lesson_complete_failed', 'duplicate_complete_attempt',
    -- Credit events
    'credit_transfer_blocked', 'insufficient_credits',
    -- Profile/admin events
    'unauthorized_profile_update', 'unauthorized_admin_action',
    'trust_level_change_blocked',
    -- CAPTCHA events
    'captcha_failed', 'captcha_bypass_attempt',
    -- Rate limit events
    'rate_limit_exceeded',
    -- Suspension events
    'suspended_user_action'
  )),
  user_id         uuid   references public.profiles(id) on delete set null,
  ip_address      inet,
  user_agent      text,
  resource_type   text,  -- 'lesson_request', 'lesson_room', 'profile', etc.
  resource_id     text,  -- ID of the resource being accessed
  details         jsonb, -- Safe contextual metadata (no secrets)
  severity        text   not null default 'info' check (severity in ('info', 'warning', 'critical')),
  created_at      timestamptz not null default now()
);

create index if not exists security_events_user_created_idx on public.security_events (user_id, created_at desc);
create index if not exists security_events_event_created_idx on public.security_events (event_type, created_at desc);
create index if not exists security_events_severity_created_idx on public.security_events (severity, created_at desc);

-- ---------------------------------------------------------------------
-- 2) RLS — admin see all, users see own events
-- ---------------------------------------------------------------------
alter table public.security_events enable row level security;

drop policy if exists "security_events_select_own_or_admin" on public.security_events;
create policy "security_events_select_own_or_admin" on public.security_events
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- INSERT yalnız RPC vasitəsilə (SECURITY DEFINER) — istifadəçilər birbaşa insert edə bilmir

-- ---------------------------------------------------------------------
-- 3) log_security_event RPC
--    İstənilən authenticated istifadəçi security hadisəsi log edə bilər.
--    Bu, frontend və digər RPC-lər tərəfindən çağrılır.
--    Heç bir sensitive məlumat qeyd olunmur.
-- ---------------------------------------------------------------------
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
begin
  -- Severity validation
  if p_severity not in ('info', 'warning', 'critical') then
    p_severity := 'info';
  end if;

  insert into public.security_events (
    event_type, user_id, resource_type, resource_id, details, severity
  ) values (
    p_event_type, auth.uid(), p_resource_type, p_resource_id, p_details, p_severity
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- 4) get_security_events RPC (admin only)
--    Admin-lər security hadisələrini görə bilər
-- ---------------------------------------------------------------------
create or replace function public.get_security_events(
  p_limit integer default 50,
  p_severity text default null
)
returns table(
  id bigint,
  event_type text,
  user_id uuid,
  resource_type text,
  resource_id text,
  details jsonb,
  severity text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to ''
as $function$
declare is_admin boolean;
begin
  select is_admin into is_admin from public.profiles where id = auth.uid();
  if not coalesce(is_admin, false) then
    raise exception 'Yalnız admin';
  end if;

  if p_severity is not null and p_severity in ('info', 'warning', 'critical') then
    return query
      select id, event_type, user_id, resource_type, resource_id, details, severity, created_at
        from public.security_events
       where severity = p_severity
       order by created_at desc
       limit least(p_limit, 200);
  else
    return query
      select id, event_type, user_id, resource_type, resource_id, details, severity, created_at
        from public.security_events
       order by created_at desc
       limit least(p_limit, 200);
  end if;
end;
$function$;

-- ---------------------------------------------------------------------
-- 5) İcazələr
-- ---------------------------------------------------------------------
revoke all on public.security_events from anon, authenticated;
grant select on public.security_events to authenticated;

revoke execute on function public.log_security_event(text, text, text, jsonb, text) from public, anon;
revoke execute on function public.get_security_events(integer, text) from public, anon;

grant execute on function public.log_security_event(text, text, text, jsonb, text) to authenticated;
grant execute on function public.get_security_events(integer, text) to authenticated;

commit;

-- =====================================================================
-- İstifadə təlimatı:
-- 1. Supabase Dashboard → SQL Editor → bu faylı yapışdırın → Run
-- 2. Frontend-də log_security_event çağrıla bilər:
--    supabase.rpc('log_security_event', { p_event_type: 'login_failed', ... })
-- 3. Admin panel-də get_security_events ilə hadisələri göstərin
--
-- Qeyd: Bu log CƏDVƏLİ heç vaxt password, token, JWT secret və ya
-- digər sensitive məlumat saxlamır. Yalnız event type, user ID,
-- resource ID və safe metadata saxlayır.
-- =====================================================================
