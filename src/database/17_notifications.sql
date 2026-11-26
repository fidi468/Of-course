-- =====================================================================
-- Of Course — 17_notifications.sql
-- IN-APP + BROWSER BİLDİRİŞ SİSTEMİ
--
-- ADDITIVE migration: mövcud cədvəllərə, funksiyalara və cron job-lara
-- TOXUNMUR. auto-complete-lessons və close-stale-sessions kimi mövcud
-- cron-lar dəyişdirilmir — yalnız YENİ job-lar yaradılır.
--
-- Komponentlər:
--   1. notifications cədvəli (+ indekslər, təkrarlanma qorunması)
--   2. RLS: istifadəçi YALNIZ öz bildirişlərini görür və oxunmuş edə bilir
--   3. Client insert/delete edə BİLMƏZ — saxta bildiriş qorunması
--      (yalnız column-level UPDATE(is_read) icazəsi var)
--   4. notify_request_change trigger — server tərəfli hadisə bildirişləri:
--        INSERT  → müəllimə "yeni dərs sorğusu"
--        accepted→ tələbəyə "sorğu qəbul edildi"
--        rejected→ tələbəyə "sorğu rədd edildi"
--        cancelled→ digər iştirakçıya "dərs ləğv edildi"
--        lesson_started_at NULL→NOT NULL → hər iki tərəfə "dərs başladı"
--   5. notify_participant_joined RPC — Jitsi otağına qoşulma bildirişi
--      (3 dəqiqəlik dedupe pəncərəsi; attendance üçün İSTİFADƏ EDİLMİR)
--   6. send_lesson_reminders() — 24 saat / 1 saat / 10 dəqiqə xatırlatmaları
--      (partial unique index + ON CONFLICT DO NOTHING ilə təkrarlanma yoxdur)
--   7. cleanup_notifications() — oxunmuş >7 gün, oxunmamış >30 gün silinir
--   8. Yeni cron-lar: lesson-reminders (hər dəqiqə), notifications-cleanup (gündəlik 03:00)
--   9. Supabase Realtime publication-a notifications əlavə olunur
--
-- İDEMPOTENT: təkrar icra oluna bilər (if not exists / drop if exists /
-- create or replace / unschedule-schedule pattern).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) notifications cədvəli
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id                bigint generated always as identity primary key,
  user_id           uuid   not null references public.profiles(id) on delete cascade,
  lesson_request_id bigint references public.lesson_requests(id) on delete cascade,
  actor_id          uuid references public.profiles(id) on delete set null,
  type              text   not null check (type in (
    'lesson_request',        -- yeni dərs sorğusu → müəllim
    'lesson_accepted',       -- sorğu qəbul edildi → tələbə
    'lesson_rejected',       -- sorğu rədd edildi → tələbə
    'lesson_cancelled',      -- dərs ləğv edildi → digər iştirakçı
    'lesson_started',        -- dərs başladı → hər iki iştirakçı
    'participant_joined',    -- iştirakçı video otağa qoşuldu → digər iştirakçı
    'lesson_reminder_24h',   -- dərsdən 24 saat əvvəl
    'lesson_reminder_1h',    -- dərsdən 1 saat əvvəl
    'lesson_reminder_10min'  -- dərsdən 10 dəqiqə əvvəl
  )),
  is_read           boolean   not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where is_read = false;
create index if not exists notifications_request_idx
  on public.notifications (lesson_request_id);

-- Xatırlatma tipləri üçün təkrarlanma qorunması: eyni istifadəçi + eyni dərs +
-- eyni tip üçün yalnız BİR sətir. send_lesson_reminders() ON CONFLICT DO
-- NOTHING ilə bu indeksə arxalanır — cron iki dəfə işləsə belə dublikat yoxdur.
create unique index if not exists notifications_reminder_unique_idx
  on public.notifications (user_id, lesson_request_id, type)
  where type in ('lesson_reminder_24h', 'lesson_reminder_1h', 'lesson_reminder_10min');

-- Reminder cron sorğusu üçün dəstək indeksi (additive)
create index if not exists lesson_requests_status_scheduled_idx
  on public.lesson_requests (status, scheduled_at)
  where scheduled_at is not null;

-- ---------------------------------------------------------------------
-- 2) RLS — istifadəçilər yalnız ÖZ bildirişlərini görə/oxunmuş edə bilir
-- ---------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- INSERT və DELETE policy QƏSDƏN yoxdur:
-- - client heç vaxt bildiriş yarada bilməz (saxta bildiriş qorunması)
-- - client bildiriş silə bilməz (təmizlik yalnız cron-ların işidir)
-- Yaradılma yalnız SECURITY DEFINER trigger/RPC (cədvəl owner-i kimi) və
-- pg_cron tərəfindən baş verir.

-- ---------------------------------------------------------------------
-- 3) İcazələr
-- ---------------------------------------------------------------------
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
-- Column-level UPDATE: client yalnız is_read sütununu dəyişə bilər —
-- user_id/type/lesson_request_id/actor_id heç vaxt client tərəfindən dəyişmir
grant update (is_read) on public.notifications to authenticated;

-- ---------------------------------------------------------------------
-- 4) notify_request_change — lesson_requests trigger funksiyası
--    SECURITY DEFINER: cədvəl owner-i kimi işləyir → RLS-ni bypass edir
--    (postgres superuser şəraitində). auth.uid() trigger daxilində hələ
--    əlçatandır (PostgREST GUC-ları transaction boyu qalır).
-- ---------------------------------------------------------------------
create or replace function public.notify_request_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- 4a) Yeni dərs sorğusu → MÜƏLLİMƏ bildiriş
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, lesson_request_id, actor_id, type)
    values (new.teacher_id, new.id, new.requester_id, 'lesson_request');
    return new;
  end if;

  -- 4b) Dərs başladı (lesson_started_at NULL → NOT NULL) → HƏR İKİ tərəfə
  if old.lesson_started_at is null and new.lesson_started_at is not null then
    insert into public.notifications (user_id, lesson_request_id, actor_id, type)
    values (new.requester_id, new.id, null, 'lesson_started'),
           (new.teacher_id,   new.id, null, 'lesson_started');
    return new;
  end if;

  -- Status dəyişməyibsə — bildiriş lazım deyil (məs. heartbeat, timing update)
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- 4c) Qəbul edildi → TƏLƏBƏYƏ (actor = müəllim)
  if new.status = 'accepted' then
    insert into public.notifications (user_id, lesson_request_id, actor_id, type)
    values (new.requester_id, new.id, new.teacher_id, 'lesson_accepted');

  -- 4d) Rədd edildi → TƏLƏBƏYƏ (actor = müəllim — respond_to_request
  --     yalnız müəllimin rəddinə icazə verir)
  elsif new.status = 'rejected' then
    insert into public.notifications (user_id, lesson_request_id, actor_id, type)
    values (new.requester_id, new.id, new.teacher_id, 'lesson_rejected');

  -- 4e) Ləğv edildi → DİGƏR iştirakçıya (actor = ləğv edən tərəf).
  --     JWT yoxdursa (admin SQL / cron) — hər iki tərəfə bildiriş gedir.
  elsif new.status = 'cancelled' and old.status in ('pending', 'accepted') then
    if auth.uid() = new.teacher_id then
      insert into public.notifications (user_id, lesson_request_id, actor_id, type)
      values (new.requester_id, new.id, new.teacher_id, 'lesson_cancelled');
    elsif auth.uid() = new.requester_id then
      insert into public.notifications (user_id, lesson_request_id, actor_id, type)
      values (new.teacher_id, new.id, new.requester_id, 'lesson_cancelled');
    else
      insert into public.notifications (user_id, lesson_request_id, actor_id, type)
      values (new.requester_id, new.id, null, 'lesson_cancelled'),
             (new.teacher_id,   new.id, null, 'lesson_cancelled');
    end if;
  end if;

  return new;
end;
$function$;

-- Trigger-i yenidən yarat (idempotent)
drop trigger if exists lesson_request_notify on public.lesson_requests;
create trigger lesson_request_notify
  after insert or update on public.lesson_requests
  for each row execute function public.notify_request_change();

-- ---------------------------------------------------------------------
-- 5) notify_participant_joined RPC — Jitsi otağına qoşulma bildirişi
--
--    VƏZİFƏ PAYI:
--    - mark_joined (migration 14) = attendance sübutu — DƏYİŞMİR
--    - notify_participant_joined = YALNIZ bildiriş — attendance üçün
--      istifadə edilmir, kredit mexanizminə təsir etmir
--
--    Dedupe: son 3 dəqiqədə eyni aktor üçün bildiriş varsa, yenidən
--    yaradılmır (reconnect spam-inin qarşısını alır).
-- ---------------------------------------------------------------------
create or replace function public.notify_participant_joined(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r public.lesson_requests;
  other_user uuid;
begin
  select * into r from public.lesson_requests where id = p_request_id;
  if not found then
    raise exception 'Sorğu tapılmadı';
  end if;

  -- Yalnız dərs iştirakçısı çağıra bilər
  if auth.uid() is null or auth.uid() not in (r.requester_id, r.teacher_id) then
    raise exception 'İcazə yoxdur';
  end if;

  -- Qəbul edilməmiş dərs üçün bildiriş lazım deyil
  if r.status <> 'accepted' then
    return;
  end if;

  other_user := case when auth.uid() = r.teacher_id
                     then r.requester_id
                     else r.teacher_id end;

  -- Təkrarlanma qorunması: son 3 dəqiqədə eyni (istifadəçi, dərs, aktor)
  -- üçün bildiriş varsa — yenidən yaratma
  if exists (
    select 1 from public.notifications
     where user_id = other_user
       and lesson_request_id = p_request_id
       and actor_id = auth.uid()
       and type = 'participant_joined'
       and created_at > now() - interval '3 minutes'
  ) then
    return;
  end if;

  insert into public.notifications (user_id, lesson_request_id, actor_id, type)
  values (other_user, p_request_id, auth.uid(), 'participant_joined');
end;
$function$;

revoke execute on function public.notify_participant_joined(bigint) from public, anon;
grant execute on function public.notify_participant_joined(bigint) to authenticated;

commit;

-- ---------------------------------------------------------------------
-- 6) send_lesson_reminders — pg_cron üçün xatırlatma funksiyası
--
--    Pəncərələr (cron hər dəqiqə işləyir, dedupe indeksi dublikatı bloklayır):
--      24 saat  → qalan vaxt (23h, 24h]
--      1 saat   → qalan vaxt (50min, 60min]
--      10 dəq   → qalan vaxt (8min, 10min]
--    Geniş pəncərələr cron buraxılmış dəqiqələri kompensasiya edir;
--    ON CONFLICT DO NOTHING təkrar yaratmır.
--    (bu bölmə transaction xaricindədir — pg_cron pattern-i migration 10 ilə eyni)
-- ---------------------------------------------------------------------
create or replace function public.send_lesson_reminders()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  sent_count integer := 0;
  inserted   integer := 0;
  r record;
begin
  for r in
    select lr.id,
           lr.requester_id,
           lr.teacher_id,
           extract(epoch from (lr.scheduled_at - now())) as seconds_left
      from public.lesson_requests lr
     where lr.status = 'accepted'
       and lr.scheduled_at is not null
       and lr.scheduled_at > now()
       and lr.scheduled_at <= now() + interval '24 hours'
     for update of lr
  loop
    -- 24 saat xatırlatması — qalan vaxt (23h, 24h]
    if r.seconds_left <= 86400 and r.seconds_left > 82800 then
      insert into public.notifications (user_id, lesson_request_id, actor_id, type)
           values (r.requester_id, r.id, null, 'lesson_reminder_24h'),
                  (r.teacher_id,   r.id, null, 'lesson_reminder_24h')
      on conflict do nothing;
      get diagnostics inserted = row_count;
      sent_count := sent_count + inserted;
    end if;

    -- 1 saat xatırlatması — qalan vaxt (50min, 60min]
    if r.seconds_left <= 3600 and r.seconds_left > 3000 then
      insert into public.notifications (user_id, lesson_request_id, actor_id, type)
           values (r.requester_id, r.id, null, 'lesson_reminder_1h'),
                  (r.teacher_id,   r.id, null, 'lesson_reminder_1h')
      on conflict do nothing;
      get diagnostics inserted = row_count;
      sent_count := sent_count + inserted;
    end if;

    -- 10 dəqiqə xatırlatması — qalan vaxt (8min, 10min]
    if r.seconds_left <= 600 and r.seconds_left > 480 then
      insert into public.notifications (user_id, lesson_request_id, actor_id, type)
           values (r.requester_id, r.id, null, 'lesson_reminder_10min'),
                  (r.teacher_id,   r.id, null, 'lesson_reminder_10min')
      on conflict do nothing;
      get diagnostics inserted = row_count;
      sent_count := sent_count + inserted;
    end if;
  end loop;

  return sent_count;
end;
$function$;

-- ---------------------------------------------------------------------
-- 7) cleanup_notifications — köhnə bildirişlərin təmizlənməsi
--    Oxunmuşlar 7 gündən sonra, oxunmamışlar 30 gündən sonra silinir.
-- ---------------------------------------------------------------------
create or replace function public.cleanup_notifications()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  deleted integer;
begin
  delete from public.notifications
   where (is_read and created_at < now() - interval '7 days')
      or (not is_read and created_at < now() - interval '30 days');

  get diagnostics deleted = row_count;
  return deleted;
end;
$function$;

-- Yalnız pg_cron çağıra bilər — client API-ləri üçün bağlıdır
revoke execute on function public.send_lesson_reminders() from public, anon, authenticated;
revoke execute on function public.cleanup_notifications() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8) YENİ cron job-lar (mövcud auto-complete-lessons və
--    close-stale-sessions cron-larına TOXUNMURUQ)
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('lesson-reminders');
exception
  when others then
    null; -- job yoxdursa — ignore
end;
$$;

do $$
begin
  perform cron.unschedule('notifications-cleanup');
exception
  when others then
    null; -- job yoxdursa — ignore
end;
$$;

select cron.schedule(
  'lesson-reminders',
  '* * * * *', -- hər dəqiqə
  $$select public.send_lesson_reminders();$$
);

select cron.schedule(
  'notifications-cleanup',
  '0 3 * * *', -- gündəlik 03:00
  $$select public.cleanup_notifications();$$
);

-- ---------------------------------------------------------------------
-- 9) Supabase Realtime publication-a notifications əlavə et
--    (postgres_changes INSERT hadisələri üçün; RLS server tərəfində
--    tətbiq olunur — istifadəçi yalnız ÖZ bildirişlərini alır)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename  = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
exception
  when others then
    raise notice 'Realtime publication yenilənmədi: %', sqlerrm;
end;
$$;

-- =====================================================================
-- Doğrulama (SQL editor-də əl ilə):
--   select * from cron.job where jobname in ('lesson-reminders','notifications-cleanup');
--   select * from pg_publication_tables where pubname='supabase_realtime';
--   select count(*) from pg_policies where tablename='notifications';
--
-- Monitorinq:
--   select * from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname='lesson-reminders')
--    order by start_time desc limit 10;
-- =====================================================================
