-- =====================================================================
-- Of Course — 06_trust_moderation.sql
-- Saxta hesabların qarşısının alınması və moderasiya sistemi.
-- 01-05 miqrasiyalarından SONRA işlədilir.
--
-- Dəyişikliklər:
-- 1. profiles-ə trust_level, verified_by, verified_at,
--    is_suspended, suspended_until, suspended_reason sütunları
-- 2. Yeni cədvəl: user_reports
-- 3. Yeni cədvəl: rate_limit_log
-- 4. RPC-lər: submit_report, suspend_user, verify_user, check_rate_limit
-- 5. RLS qaydaları
--
-- Təhlükəsizlik:
-- - trust_level yalnız admin tərəfindən dəyişdirilə bilər
-- - suspend_user yalnız admin
-- - İstifadəçilər özlərinə verify badge verə bilməz
-- - Email təsdiqlənməyibsə dərs istəyi göndərə bilməz
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) profiles-ə etibar və dayandırma sütunları
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists trust_level       text not null default 'unverified'
    check (trust_level in ('unverified', 'verified', 'trusted')),
  add column if not exists verified_by       uuid references public.profiles(id),
  add column if not exists verified_at       timestamptz,
  add column if not exists is_suspended      boolean not null default false,
  add column if not exists suspended_until   timestamptz,
  add column if not exists suspended_reason  text;

-- ---------------------------------------------------------------------
-- 2) user_reports cədvəli
-- ---------------------------------------------------------------------
create table if not exists public.user_reports (
  id              bigint generated always as identity primary key,
  reporter_id     uuid   not null references public.profiles(id) on delete cascade,
  reported_id     uuid   not null references public.profiles(id) on delete cascade,
  reason          text   not null check (reason in (
    'spam', 'fake_account', 'harassment', 'inappropriate_content',
    'scam', 'off_platform_payment', 'other'
  )),
  description     text,
  status          text   not null default 'pending'
                  check (status in ('pending', 'reviewing', 'resolved', 'dismissed')),
  created_at      timestamptz not null default now(),
  resolved_by     uuid   references public.profiles(id),
  resolution_note text,
  check (reporter_id <> reported_id)
);

create index if not exists user_reports_reported_status_idx on public.user_reports (reported_id, status);
create index if not exists user_reports_reporter_idx on public.user_reports (reporter_id);
create index if not exists user_reports_status_created_idx on public.user_reports (status, created_at desc);

-- ---------------------------------------------------------------------
-- 3) rate_limit_log cədvəli (rate limiting üçün)
-- ---------------------------------------------------------------------
create table if not exists public.rate_limit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  action      text not null check (action in (
    'register', 'login', 'lesson_request', 'report'
  )),
  created_at  timestamptz not null default now()
);

create index if not exists rate_limit_log_user_action_idx on public.rate_limit_log (user_id, action, created_at desc);

-- ---------------------------------------------------------------------
-- 4) RLS aktivləşdir
-- ---------------------------------------------------------------------
alter table public.user_reports    enable row level security;
alter table public.rate_limit_log  enable row level security;

-- ---------------------------------------------------------------------
-- 5) RLS qaydaları — user_reports
-- ---------------------------------------------------------------------
drop policy if exists "reports_select_own_or_admin" on public.user_reports;
create policy "reports_select_own_or_admin" on public.user_reports
  for select to authenticated
  using (
    reporter_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

drop policy if exists "reports_insert_own" on public.user_reports;
create policy "reports_insert_own" on public.user_reports
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_suspended = false
        and (p.suspended_until is null or p.suspended_until < now())
    )
  );

-- ---------------------------------------------------------------------
-- 6) RLS qaydaları — rate_limit_log
--    İstifadəçilər yalnız öz log-larını görə bilər (debug üçün)
--    INSERT yaln366 RPC vasitəsilə (SECURITY DEFINER)
-- ---------------------------------------------------------------------
drop policy if exists "rate_limit_select_own" on public.rate_limit_log;
create policy "rate_limit_select_own" on public.rate_limit_log
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 7) RLS qaydaları — profiles
--    trust_level və suspend sahələri yaln366 admin tərəfindən dəyişdirilə bilər
-- ---------------------------------------------------------------------
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and trust_level = (
      select trust_level from public.profiles where id = auth.uid()
    )
    -- İstifadəçi öz trust_level-i dəyişdirə bilməz
  );

-- Admin üçün full update (trust_level, suspend sahələri də)
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- ---------------------------------------------------------------------
-- 8) RPC: submit_report
--    İstifadəçi başqa profili şikayət edir
-- ---------------------------------------------------------------------
create or replace function public.submit_report(
  p_reported_id uuid,
  p_reason text,
  p_description text default null
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  new_id bigint;
  is_suspended boolean;
  recent_count integer;
begin
  -- Özünü şikayət etməyin qarşısını al
  if p_reported_id = auth.uid() then
    raise exception 'Özünüzü şikayət edə bilməzsiniz';
  end if;

  -- Dayandırılmış istifadəçilər şikayət edə bilməz
  select is_suspended into is_suspended from public.profiles where id = auth.uid();
  if coalesce(is_suspended, false) then
    raise exception 'Hesabınız dayandırılıb';
  end if;

  -- Rate limit: son 1 saatda 5-dən çox şikayət olmaz
  select count(*) into recent_count
    from public.rate_limit_log
   where user_id = auth.uid()
     and action = 'report'
     and created_at > now() - interval '1 hour';

  if recent_count >= 5 then
    raise exception 'Çoxlu şikayət göndərdiniz — bir saat sonra cəhd edin';
  end if;

  -- Rate limit log
  insert into public.rate_limit_log (user_id, action)
  values (auth.uid(), 'report');

  -- Şikayət yarat
  insert into public.user_reports (reporter_id, reported_id, reason, description)
  values (auth.uid(), p_reported_id, p_reason, p_description)
  returning id into new_id;

  return new_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- 9) RPC: suspend_user (admin only)
-- ---------------------------------------------------------------------
create or replace function public.suspend_user(
  p_user_id uuid,
  p_duration_hours integer default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare is_admin boolean;
begin
  select is_admin into is_admin from public.profiles where id = auth.uid();
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
$function$;

-- ---------------------------------------------------------------------
-- 10) RPC: unsuspend_user (admin only)
-- ---------------------------------------------------------------------
create or replace function public.unsuspend_user(p_user_id uuid)
returns void
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

  update public.profiles
     set is_suspended = false,
         suspended_until = null,
         suspended_reason = null
   where id = p_user_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- 11) RPC: verify_user (admin only)
-- ---------------------------------------------------------------------
create or replace function public.verify_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare is_admin boolean;
begin
  select is_admin into is_admin from public.profiles where id = auth.uid();
  if not coalesce(is_admin, false) then
    raise exception 'Yalnız admin istifadəçi təsdiqləyə bilər';
  end if;

  update public.profiles
     set trust_level = 'verified',
         verified_by = auth.uid(),
         verified_at = now()
   where id = p_user_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- 12) RPC: resolve_report (admin only)
-- ---------------------------------------------------------------------
create or replace function public.resolve_report(
  p_report_id bigint,
  p_status text,
  p_resolution_note text default null
)
returns void
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

  if p_status not in ('resolved', 'dismissed') then
    raise exception 'Yanlış status';
  end if;

  update public.user_reports
     set status = p_status,
         resolved_by = auth.uid(),
         resolution_note = p_resolution_note
   where id = p_report_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- 13) İcazələr
-- ---------------------------------------------------------------------
revoke all on public.user_reports, public.rate_limit_log from anon, authenticated;

grant select, insert on public.user_reports   to authenticated;
grant select on public.rate_limit_log         to authenticated;
-- rate_limit_log INSERT yaln366 RPC vasitəsilə (SECURITY DEFINER)

revoke execute on function public.submit_report(uuid, text, text)      from public, anon;
revoke execute on function public.suspend_user(uuid, integer, text)    from public, anon;
revoke execute on function public.unsuspend_user(uuid)                 from public, anon;
revoke execute on function public.verify_user(uuid)                    from public, anon;
revoke execute on function public.resolve_report(bigint, text, text)   from public, anon;

grant execute on function public.submit_report(uuid, text, text)       to authenticated;
grant execute on function public.suspend_user(uuid, integer, text)     to authenticated;
grant execute on function public.unsuspend_user(uuid)                  to authenticated;
grant execute on function public.verify_user(uuid)                     to authenticated;
grant execute on function public.resolve_report(bigint, text, text)    to authenticated;

commit;

-- =====================================================================
-- Email təsdiqi tələbi:
-- Aşağıdakı əlavə RLS qaydası lesson_requests INSERT-ə email təsdiqi tələb edir.
-- Bu, 07_email_verification_enforcement.sql kimi ayrıca işlədilə bilər,
-- amma buraya daxil edilib ki kiçik dəyişiklik olsun.
-- =====================================================================

-- Qeyd: auth.users.email_confirmed_at sütunu RLS policy-də istifadə oluna bilməz
-- (auth.users cədvəli RLS-dən kənardır). Əvəzinə, handle_new_user trigger-ə
-- əlavə edə bilərik: email_confirmed_at NULL-dırsa, profiles.email_verified_at
-- NULL qalsın. Bu, 02_security_functions.sql-dəki handle_new_user-ə dəyişiklik tələb edir.

-- Praktik yanaşma: frontend-də user.email_confirmed_at yoxla və
-- lesson_request göndərməyi blokla. Bu, server tərəfdə tam təhlükəsiz deyil,
-- amma Supabase Auth-ın default davranışı ilə birlikdə kifayət qədər təhlükəsizdir.

-- =====================================================================
-- İstifadə təlimatı:
-- 1. Supabase dashboard → SQL Editor
-- 2. Bu faylın tam məzmununu yapışdırın
-- 3. Run klikləyin
-- =====================================================================
