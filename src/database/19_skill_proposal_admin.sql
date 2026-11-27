-- =====================================================================
-- Of Course — 19_skill_proposal_admin.sql
-- BACARIQ TƏKLİFLƏRİ: ADMIN BİLDİRİŞİ + TƏSDİQ/REDDET RPC
--
-- ADDITIVE migration: mövcud cədvəllər və məlumatlar dəyişmir.
-- Yalnız:
--   1. notifications.type CHECK-inə 3 yeni tip əlavə olunur:
--        skill_proposal_new       → adminə "yeni təklif gəldi"
--        skill_proposal_approved  → təklif sahibinə "təsdiqləndi"
--        skill_proposal_rejected  → təklif sahibinə "rədd edildi"
--   2. notify_skill_proposal() trigger funksiyası + trigger:
--        INSERT skill_proposals  → bütün adminlərə bildiriş
--        UPDATE status approved/rejected → təklif sahibinə bildiriş
--   3. respond_skill_proposal(p_proposal_id, p_decision) RPC —
--      SECURITY DEFINER + is_admin yoxlaması:
--        approved → skills cədvəlinə əlavə edir (unique name ilə
--                   toqquşmada səssiz keçir) və statusu yeniləyir
--        rejected → yalnız statusu yeniləyir
--      Bildirişlər trigger tərəfindən avtomatik yaradılır.
--
-- İDEMPOTENT: drop if exists / create or replace pattern.
-- İşlədilmə: Supabase SQL Editor vəya Management API.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) notifications.type CHECK genişləndirilir (additive — köhnə tiplər qalır)
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;

alter table public.notifications add constraint notifications_type_check
  check (type in (
    'lesson_request',
    'lesson_accepted',
    'lesson_rejected',
    'lesson_cancelled',
    'lesson_started',
    'participant_joined',
    'lesson_reminder_24h',
    'lesson_reminder_1h',
    'lesson_reminder_10min',
    'skill_proposal_new',
    'skill_proposal_approved',
    'skill_proposal_rejected'
  ));

-- ---------------------------------------------------------------------
-- 2) notify_skill_proposal — trigger funksiyası (SECURITY DEFINER)
--    Bildirişləri cədvəl owner-i kimi yaradır (RLS bypass — qanuni,
--    çünki INSERT/UPDATE policy-ləri client üçün yoxdur).
-- ---------------------------------------------------------------------
create or replace function public.notify_skill_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin uuid;
  v_type  text;
begin
  -- 2a) Yeni təklif → BÜTÜN adminlərə bildiriş (actor = təklif sahibi)
  if tg_op = 'INSERT' then
    for v_admin in
      select id from public.profiles where is_admin = true
    loop
      insert into public.notifications (user_id, lesson_request_id, actor_id, type)
      values (v_admin, null, new.proposed_by, 'skill_proposal_new');
    end loop;
    return new;
  end if;

  -- 2b) Status dəyişməyibsə — heç nə etmə
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- 2c) Qərar verilib → TƏKLİF SAHİBİNƏ bildiriş (actor = qərar verən admin)
  if new.status in ('approved', 'rejected') then
    v_type := case when new.status = 'approved'
                   then 'skill_proposal_approved'
                   else 'skill_proposal_rejected' end;

    insert into public.notifications (user_id, lesson_request_id, actor_id, type)
    values (new.proposed_by, null, auth.uid(), v_type);
  end if;

  return new;
end;
$function$;

drop trigger if exists skill_proposal_notify on public.skill_proposals;
create trigger skill_proposal_notify
  after insert or update of status on public.skill_proposals
  for each row execute function public.notify_skill_proposal();

-- ---------------------------------------------------------------------
-- 3) respond_skill_proposal — admin RPC (təsdiq / reddet)
--    RLS-də skill_proposals üzərində update policy YOXDUR —
--    status yalnız bu SECURITY DEFINER funksiya ilə dəyişir.
-- ---------------------------------------------------------------------
create or replace function public.respond_skill_proposal(
  p_proposal_id bigint,
  p_decision    text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_proposal public.skill_proposals;
begin
  -- Yalnız admin çağıra bilər
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and is_admin = true
  ) then
    raise exception 'İcazə yoxdur: yalnız admin';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Yanlış qərar: %', p_decision;
  end if;

  select * into v_proposal
    from public.skill_proposals
   where id = p_proposal_id
     and status = 'pending'
   for update;

  if not found then
    raise exception 'Təklif tapılmadı və ya artıq cavablandırılıb';
  end if;

  -- Təsdiq → skills cədvəlinə əlavə (eyni adlı bacarıq varsa səssiz keç)
  if p_decision = 'approved' then
    insert into public.skills (name, category)
    values (v_proposal.name, v_proposal.category)
    on conflict (name) do nothing;
  end if;

  -- Status yenilənməsi trigger-i avtomatik bildiriş yaradır
  update public.skill_proposals
     set status = p_decision
   where id = p_proposal_id;

  return true;
end;
$function$;

revoke execute on function public.respond_skill_proposal(bigint, text) from public, anon;
grant execute on function public.respond_skill_proposal(bigint, text) to authenticated;

-- PostgREST sxem keşi yenilə
notify pgrst, 'reload schema';
