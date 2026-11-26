-- =====================================================================
-- Beyin İcarəsi (Rent a Brain) - 02_security_functions.sql
-- Bazanın hazırkı (canlı) vəziyyətindən çıxarılıb: funksiyalar, trigger-lər,
-- RLS qaydaları və icazələr. 01_tables.sql-dən SONRA işlədilir.
-- Təkrar işlətmək təhlükəsizdir (hər şey əvvəl silinib yenidən yaradılır)
-- və bütün fayl bir əməliyyatdadır: xəta çıxsa, heç nə dəyişmir.
-- Qeyd: rls_auto_enable funksiyası Supabase-in özünün şablonundandır,
-- bu fayla daxil edilməyib.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Funksiyalar
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_request_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare bal integer;
begin
  select credit_balance into bal from public.profiles where id = new.requester_id;
  if bal is null or bal < new.duration_hours then
    raise exception 'Kifayət qədər kredit yoxdur';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (id, full_name, credit_balance)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), 3);
  insert into public.credit_transactions (user_id, amount, type, note)
  values (new.id, 3, 'signup_bonus', 'Başlanğıc krediti');
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_request(p_request_id bigint, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.lesson_requests;
begin
  select * into r from public.lesson_requests where id = p_request_id for update;
  if not found then raise exception 'Sorğu tapılmadı'; end if;
  if r.teacher_id <> auth.uid() then raise exception 'İcazə yoxdur'; end if;
  if r.status <> 'pending' then raise exception 'Sorğu artıq cavablandırılıb'; end if;
  update public.lesson_requests
     set status = case when p_accept then 'accepted' else 'rejected' end
   where id = p_request_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_request(p_request_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.lesson_requests;
begin
  select * into r from public.lesson_requests where id = p_request_id for update;
  if not found then raise exception 'Sorğu tapılmadı'; end if;
  if auth.uid() not in (r.requester_id, r.teacher_id) then raise exception 'İcazə yoxdur'; end if;
  if r.status not in ('pending','accepted') then raise exception 'Bu sorğunu ləğv etmək olmaz'; end if;
  update public.lesson_requests set status = 'cancelled' where id = p_request_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_lesson(p_request_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r   public.lesson_requests;
  bal integer;
begin
  select * into r from public.lesson_requests where id = p_request_id for update;
  if not found then raise exception 'Sorğu tapılmadı'; end if;
  if r.teacher_id <> auth.uid() then raise exception 'Yalnız müəllim seansı bitirə bilər'; end if;
  if r.status <> 'accepted' then raise exception 'Seans əvvəlcə təsdiqlənməlidir'; end if;
  select credit_balance into bal from public.profiles where id = r.requester_id for update;
  if bal < r.duration_hours then raise exception 'Öyrənənin krediti çatmır'; end if;
  update public.profiles set credit_balance = credit_balance - r.duration_hours where id = r.requester_id;
  update public.profiles set credit_balance = credit_balance + r.duration_hours where id = r.teacher_id;
  insert into public.credit_transactions (user_id, lesson_request_id, amount, type, note) values
    (r.requester_id, r.id, -r.duration_hours, 'lesson_spent',  'Dərs üçün ödəniş'),
    (r.teacher_id,   r.id,  r.duration_hours, 'lesson_earned', 'Dərs verdin');
  update public.lesson_requests
     set status = 'completed', completed_at = now()
   where id = r.id;
end;
$function$
;


-- ---------------------------------------------------------------------
-- 2) Trigger-lər
--    - yeni istifadəçiyə avtomatik profil və 3 kredit
--    - dərs sorğusu yaradılanda kredit yoxlanılır
-- ---------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists lesson_request_balance on public.lesson_requests;
create trigger lesson_request_balance
  before insert on public.lesson_requests
  for each row execute function public.check_request_balance();

-- ---------------------------------------------------------------------
-- 3) Sətir səviyyəsində təhlükəsizlik (RLS) hər cədvəldə aktivdir
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.skills              enable row level security;
alter table public.user_skills         enable row level security;
alter table public.lesson_requests     enable row level security;
alter table public.credit_transactions enable row level security;

-- ---------------------------------------------------------------------
-- 4) RLS qaydaları
-- ---------------------------------------------------------------------
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "skills_select" on public.skills;
create policy "skills_select" on public.skills
  for select to authenticated using (true);

drop policy if exists "user_skills_select" on public.user_skills;
create policy "user_skills_select" on public.user_skills
  for select to authenticated using (true);

drop policy if exists "user_skills_insert_own" on public.user_skills;
create policy "user_skills_insert_own" on public.user_skills
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "user_skills_update_own" on public.user_skills;
create policy "user_skills_update_own" on public.user_skills
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "user_skills_delete_own" on public.user_skills;
create policy "user_skills_delete_own" on public.user_skills
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "requests_select_participants" on public.lesson_requests;
create policy "requests_select_participants" on public.lesson_requests
  for select to authenticated
  using (requester_id = auth.uid() or teacher_id = auth.uid());

drop policy if exists "requests_insert_own" on public.lesson_requests;
create policy "requests_insert_own" on public.lesson_requests
  for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');

drop policy if exists "tx_select_own" on public.credit_transactions;
create policy "tx_select_own" on public.credit_transactions
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 5) İcazələr (grants)
--    Əvvəl hamısı geri alınır, sonra yalnız lazım olanlar verilir.
--    Kredit və dərs statusu birbaşa dəyişdirilə bilməz, yalnız funksiyalarla.
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.skills, public.user_skills,
              public.lesson_requests, public.credit_transactions
  from anon, authenticated;

grant select on public.profiles            to authenticated;
grant select on public.skills              to authenticated;
grant select on public.user_skills         to authenticated;
grant select on public.lesson_requests     to authenticated;
grant select on public.credit_transactions to authenticated;

grant insert on public.lesson_requests to authenticated;
grant insert, update, delete on public.user_skills to authenticated;

-- profiles: yalnız bu 4 sütun dəyişdirilə bilər (credit_balance daxil deyil)
grant update (full_name, bio, avatar_url, university) on public.profiles to authenticated;

-- Frontend-in çağıra biləcəyi funksiyalar (anon və public üçün bağlıdır)
revoke execute on function public.respond_to_request(bigint, boolean) from public, anon;
revoke execute on function public.cancel_request(bigint)              from public, anon;
revoke execute on function public.complete_lesson(bigint)             from public, anon;

grant execute on function public.respond_to_request(bigint, boolean) to authenticated;
grant execute on function public.cancel_request(bigint)              to authenticated;
grant execute on function public.complete_lesson(bigint)             to authenticated;

commit;
