-- =====================================================================
-- 09_email_verification_enforcement — PRODUCTION-ADAPTED VERSION
--
-- DEVIATION from repo version (documented for audit):
--   Repo version's RLS policies query auth.users directly inside the
--   policy expression. Policies execute with the privileges of the
--   querying role (`authenticated`), which on Supabase has NO SELECT
--   grant on auth.users (verified on production:
--   has_table_privilege('authenticated','auth.users','SELECT') = false).
--   Applying the repo version verbatim would break EVERY
--   lesson_requests / user_skills INSERT with
--   "permission denied for table users".
--
-- Fix: SECURITY DEFINER helper public.email_is_confirmed(uuid) — reads
-- auth.users as the function owner (postgres). Enforces the SAME
-- email-verified requirement server-side; leaks nothing (boolean only).
-- respond_to_request is unchanged: as SECURITY DEFINER it may read
-- auth.users directly.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) Helper: email confirmation check (SECURITY DEFINER)
-- ---------------------------------------------------------------------
create or replace function public.email_is_confirmed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from auth.users
     where id = p_user_id
       and email_confirmed_at is not null
  );
$function$;

revoke execute on function public.email_is_confirmed(uuid) from public, anon;
grant execute on function public.email_is_confirmed(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 1) lesson_requests INSERT policy — email must be confirmed
-- ---------------------------------------------------------------------
drop policy if exists "requests_insert_own" on public.lesson_requests;
drop policy if exists "requests_insert_own_verified" on public.lesson_requests;

create policy "requests_insert_own_verified" on public.lesson_requests
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and status = 'pending'
    -- Email təsdiqlənməli (SECURITY DEFINER helper üzərindən)
    and public.email_is_confirmed(auth.uid())
    -- İstifadəçi dayandırılmamalı
    and not exists (
      select 1 from public.profiles
       where id = auth.uid()
         and is_suspended = true
         and (suspended_until is null or suspended_until > now())
    )
  );

-- ---------------------------------------------------------------------
-- 2) user_skills INSERT policy — email must be confirmed
-- ---------------------------------------------------------------------
drop policy if exists "user_skills_insert_own" on public.user_skills;
drop policy if exists "user_skills_insert_own_verified" on public.user_skills;

create policy "user_skills_insert_own_verified" on public.user_skills
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.email_is_confirmed(auth.uid())
  );

-- ---------------------------------------------------------------------
-- 3) respond_to_request — teacher must be verified as well
--    (SECURITY DEFINER: auth.users oxunuşu owner hüququ ilə təhlükəsizdir)
-- ---------------------------------------------------------------------
create or replace function public.respond_to_request(p_request_id bigint, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r public.lesson_requests;
  teacher_verified boolean;
begin
  select * into r from public.lesson_requests where id = p_request_id for update;
  if not found then raise exception 'Sorğu tapılmadı'; end if;
  if r.teacher_id <> auth.uid() then raise exception 'İcazə yoxdur'; end if;
  if r.status <> 'pending' then raise exception 'Sorğu artıq cavablandırılıb'; end if;

  -- Email təsdiqlənmə yoxlaması
  select (email_confirmed_at is not null) into teacher_verified
    from auth.users where id = auth.uid();

  if not coalesce(teacher_verified, false) then
    raise exception 'E-poçt təsdiqlənməyib';
  end if;

  update public.lesson_requests
     set status = case when p_accept then 'accepted' else 'rejected' end
   where id = p_request_id;
end;
$function$;

revoke execute on function public.respond_to_request(bigint, boolean) from public, anon;
grant execute on function public.respond_to_request(bigint, boolean) to authenticated;

commit;
