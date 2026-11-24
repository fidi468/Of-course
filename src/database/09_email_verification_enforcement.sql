-- =====================================================================
-- Of Course — 09_email_verification_enforcement.sql
-- AUDIT FIX: Email təsdiqlənməyən istifadəçilərin dərs istəyi göndərməsinin qarşısını al.
--
-- Problem:
--   auth.users.email_confirmed_at RLS policy-də istifadə oluna bilmir
--   deyə düşünülürdü. Əslində, auth.users cədvəli SELECT üçün açıqdır
--   (Supabase default) və subquery-də istifadə oluna bilər.
--
-- Həll:
--   RLS policy-ə auth.users subquery əlavə et: email_confirmed_at IS NOT NULL
--   Bu, email təsdiqlənməyən istifadəçinin lesson_requests INSERT-inə mane olur.
--
-- Təhlükəsizlik:
--   - Server tərəfdə yoxlanır (RLS policy)
--   - Frontend yoxlaması əlavə təbəqə (UX üçün)
--   - auth.users SELECT-anonim açıqdır, amma yalnız id və email_confirmed_at
--     oxunur (敏感 məlumat yoxdur)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) lesson_requests INSERT policy-ni yenilə
--    Email təsdiqlənməyən istifadəçi dərs istəyi göndərə bilməz
-- ---------------------------------------------------------------------
drop policy if exists "requests_insert_own" on public.lesson_requests;

create policy "requests_insert_own_verified" on public.lesson_requests
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and status = 'pending'
    -- Email təsdiqlənməli
    and exists (
      select 1 from auth.users
       where id = auth.uid()
         and email_confirmed_at is not null
    )
    -- İstifadəçi dayandırılmamalı
    and not exists (
      select 1 from public.profiles
       where id = auth.uid()
         and is_suspended = true
         and (suspended_until is null or suspended_until > now())
    )
  );

-- ---------------------------------------------------------------------
-- 2) user_skills INSERT policy-ni də yenilə (verified istifadəçilər)
-- ---------------------------------------------------------------------
drop policy if exists "user_skills_insert_own" on public.user_skills;

create policy "user_skills_insert_own_verified" on public.user_skills
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from auth.users
       where id = auth.uid()
         and email_confirmed_at is not null
    )
  );

-- ---------------------------------------------------------------------
-- 3) respond_to_request — müəllimin də verified olması tələb olunsun
--    (RPC içində yoxlama əlavə et)
-- ---------------------------------------------------------------------
-- Qeyd: respond_to_request 02_security_functions.sql-dədir.
-- Bu miqrasiya onu overwrite edir və email_verified yoxlaması əlavə edir.

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

-- İcazələri yenilə
revoke execute on function public.respond_to_request(bigint, boolean) from public, anon;
grant execute on function public.respond_to_request(bigint, boolean) to authenticated;

commit;

-- =====================================================================
-- Test ssenariləri:
-- 1. Email təsdiqlənməyən istifadəçi lesson_request insert cəhdi → RLS reject
-- 2. Email təsdiqlənmiş istifadəçi → uğurlu insert
-- 3. Dayandırılmış istifadəçi → RLS reject
-- 4. Email təsdiqlənməyən müəllim respond_to_request çağırır → RPC xəta
-- =====================================================================

-- =====================================================================
-- Qeyd: Bu miqrasiya auth.users cədvəlinə SELECT hüququ tələb edir.
-- Supabase default olaraq auth.users-ə authenticated istifadəçilər üçün
-- SELECT icazəsi verir (yalnız öz məlumatlarını görürlər RLS vasitəsilə).
-- Əgər auth.users RLS policy-niz varsa, əmin olun ki subquery işləyir.
-- =====================================================================
